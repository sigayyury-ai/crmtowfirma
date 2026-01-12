const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const PipedriveClient = require('../pipedrive');
const StripeRepository = require('../stripe/repository');
const SendPulseClient = require('../sendpulse');
const {
  evaluatePaymentStatus,
  normalizeSchedule,
  STAGE_IDS,
  SCHEDULE_PROFILES
} = require('./statusCalculator');
const { getPipelineConfig, getSupportedStageIdsForPipeline } = require('./pipelineConfig');
const {
  toNumber,
  convertToPln,
  parseRawMetadata,
  detectScheduleFromPayments,
  estimateScheduleFromDeal
} = require('./statusAutomationUtils');

// SUPPORTED_STAGE_IDS теперь определяется динамически на основе пайплайна
// Дефолтные ID для Camps (для обратной совместимости)
const DEFAULT_SUPPORTED_STAGE_IDS = new Set([STAGE_IDS.FIRST_PAYMENT, STAGE_IDS.SECOND_PAYMENT, STAGE_IDS.CAMP_WAITER]);

// Глобальный кеш для отслеживания последних уведомлений (работает между экземплярами сервиса)
// Ключ: dealId, значение: timestamp последнего уведомления
const paymentNotificationCache = new Map();

class CrmStatusAutomationService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.stripeRepository = options.stripeRepository || new StripeRepository();
    this.stripeProcessor = options.stripeProcessor; // Для конвертации валют через convertAmountWithRate
    
    // Инициализируем SendPulse клиент (опционально)
    try {
      this.sendpulseClient = options.sendpulseClient || new SendPulseClient();
    } catch (error) {
      this.logger.warn('SendPulse not available for payment notifications', { error: error.message });
      this.sendpulseClient = null;
    }
    
    // Ключ поля SendPulse ID в Pipedrive
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
  }

  isEnabled() {
    return !!this.supabase;
  }

  async loadProformas(dealId) {
    if (!this.isEnabled()) {
      throw new Error('Supabase client is not configured – cannot load proformas');
    }

    const { data, error } = await this.supabase
      .from('proformas')
      .select(`
        id,
        fullnumber,
        total,
        currency,
        currency_exchange,
        payments_total,
        payments_total_pln,
        payments_total_cash,
        payments_total_cash_pln,
        payments_count,
        issued_at,
        status
      `)
      .eq('pipedrive_deal_id', String(dealId))
      .eq('status', 'active');

    if (error) {
      this.logger.error('Failed to load proformas for CRM status automation', {
        dealId,
        error: error.message
      });
      throw error;
    }

    return data || [];
  }

  async loadStripePayments(dealId) {
    this.logger.info('Loading Stripe payments for deal', {
      dealId,
      repositoryEnabled: this.stripeRepository?.isEnabled?.() || false
    });
    
    if (!this.stripeRepository.isEnabled()) {
      this.logger.warn('Stripe repository is not enabled, returning empty array', { dealId });
      return [];
    }

    try {
      const payments = await this.stripeRepository.listPayments({
        dealId: String(dealId),
        limit: 500
      });
      
      this.logger.info('Stripe payments loaded', {
        dealId,
        paymentsCount: payments?.length || 0,
        payments: payments?.map(p => ({
          id: p.id,
          dealId: p.deal_id,
          amount: p.original_amount,
          currency: p.currency,
          paymentStatus: p.payment_status
        })) || []
      });
      
      return payments || [];
    } catch (error) {
      this.logger.error('Failed to load stripe payments for CRM status automation', {
        dealId,
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  sumProformaTotals(proformas = []) {
    return proformas.reduce(
      (acc, row) => {
        const expected = convertToPln(row.total, row.currency, row.currency_exchange);
        const bankPaid = toNumber(row.payments_total_pln);
        const cashPaid = toNumber(row.payments_total_cash_pln);
        const bankCount = toNumber(row.payments_count);

        acc.expectedAmountPln += expected || 0;
        acc.bankPaidPln += Number.isFinite(bankPaid) ? bankPaid : 0;
        acc.cashPaidPln += Number.isFinite(cashPaid) ? cashPaid : 0;
        acc.bankPaymentsCount += Number.isFinite(bankCount) ? bankCount : 0;

        return acc;
      },
      {
        expectedAmountPln: 0,
        bankPaidPln: 0,
        cashPaidPln: 0,
        bankPaymentsCount: 0
      }
    );
  }

  async sumStripeTotals(payments = [], dealCurrency = null) {
    this.logger.info('sumStripeTotals: filtering payments', {
      paymentsCount: payments.length,
      payments: payments.map(p => ({
        id: p.id,
        status: p.status,
        payment_status: p.payment_status,
        amount: p.original_amount || p.amount,
        currency: p.currency,
        deal_id: p.deal_id
      }))
    });
    
    // Фильтруем оплаченные платежи: проверяем payment_status='paid' или status='processed'
    // Это позволяет учитывать все оплаченные платежи независимо от их внутреннего статуса обработки
    const processed = payments.filter(
      (row) => row && (
        row.payment_status === 'paid' || 
        (row.status === 'processed' && (!row.payment_status || row.payment_status === 'paid'))
      )
    );
    
    this.logger.info('sumStripeTotals: filtered payments', {
      processedCount: processed.length,
      processed: processed.map(p => ({
        id: p.id,
        status: p.status,
        payment_status: p.payment_status,
        amount: p.original_amount || p.amount,
        currency: p.currency
      }))
    });

    // Проверяем, есть ли платежи с разными валютами
    const hasCurrencyMismatch = dealCurrency && processed.some(
      (row) => row.currency && row.currency !== dealCurrency
    );

    // Если есть платежи с разными валютами, используем факт оплаты через webhook
    if (hasCurrencyMismatch && this.supabase) {
      try {
        const sessionIds = processed.map(p => p.session_id).filter(Boolean);
        if (sessionIds.length > 0) {
          // Проверяем наличие webhook подтверждений
          const { data: webhookEvents } = await this.supabase
            .from('stripe_event_items')
            .select('session_id')
            .in('session_id', sessionIds)
            .eq('payment_status', 'paid');

          if (webhookEvents && webhookEvents.length > 0) {
            // Используем количество подтвержденных платежей для расчета прогресса
            // В этом случае мы не можем использовать сумму, так как валюты разные
            // Используем количество подтвержденных платежей * ожидаемую сумму на платеж
            const verifiedSessionIds = new Set(webhookEvents.map(e => e.session_id));
            const verifiedPayments = processed.filter(p => verifiedSessionIds.has(p.session_id));
            
            this.logger.info('Using webhook verification for currency mismatch', {
              dealCurrency,
              verifiedCount: verifiedPayments.length,
              totalProcessed: processed.length,
              note: 'When currencies differ, we use webhook verification count instead of amount comparison'
            });

            // Для расчета используем количество подтвержденных платежей
            // Сумма будет рассчитана на основе количества платежей и графика
            return {
              stripePaidPln: 0, // Не используем сумму при разных валютах
              stripePaymentsCount: verifiedPayments.length, // Используем количество подтвержденных
              processed: verifiedPayments,
              hasCurrencyMismatch: true,
              webhookVerifiedCount: verifiedPayments.length
            };
          }
        }
      } catch (error) {
        this.logger.warn('Failed to check webhook events for currency mismatch', {
          error: error.message
        });
      }
    }

    // Если валюты совпадают или нет webhook подтверждений, используем сумму как обычно
    const stripePaidPln = processed.reduce((acc, row) => acc + (toNumber(row.amount_pln) || 0), 0);
    
    this.logger.info('sumStripeTotals: returning totals', {
      stripePaidPln,
      stripePaymentsCount: processed.length,
      processedCount: processed.length,
      hasCurrencyMismatch: false,
      processed: processed.map(p => ({
        id: p.id,
        amount_pln: p.amount_pln,
        original_amount: p.original_amount,
        amount: p.amount
      }))
    });
    
    return {
      stripePaidPln,
      stripePaymentsCount: processed.length,
      processed,
      hasCurrencyMismatch: false
    };
  }

  resolveSchedule(deal, proformas, stripePayments) {
    const scheduleFromPayments = detectScheduleFromPayments(stripePayments);
    if (scheduleFromPayments) {
      return scheduleFromPayments;
    }
    const scheduleFromDeal = estimateScheduleFromDeal(deal, proformas);
    if (scheduleFromDeal) {
      return scheduleFromDeal;
    }
    return SCHEDULE_PROFILES['100%'].key;
  }

  async buildDealSnapshot(dealId, deal = null) {
    if (!dealId) {
      throw new Error('dealId is required for buildDealSnapshot');
    }

    const proformas = await this.loadProformas(dealId);
    const stripePayments = await this.loadStripePayments(dealId);
    
    // Если нет проформ, но есть Stripe платежи, все равно обрабатываем
    if (proformas.length === 0 && stripePayments.length === 0) {
      return {
        dealId,
        proformas: [],
        stripePayments: [],
        totals: {
          expectedAmountPln: 0,
          bankPaidPln: 0,
          cashPaidPln: 0,
          stripePaidPln: 0,
          totalPaidPln: 0
        },
        paymentsCount: {
          bank: 0,
          stripe: 0,
          total: 0
        },
        scheduleType: SCHEDULE_PROFILES['100%'].key
      };
    }
    
    // Если есть проформы, суммируем их, иначе используем пустые значения
    const proformaTotals = proformas.length > 0 
      ? this.sumProformaTotals(proformas)
      : {
          expectedAmountPln: 0,
          bankPaidPln: 0,
          cashPaidPln: 0,
          bankPaymentsCount: 0
        };
    const dealCurrency = deal?.currency || null;
    const stripeTotals = await this.sumStripeTotals(stripePayments, dealCurrency);

    // Если есть несоответствие валют и webhook подтверждения, используем количество платежей для расчета
    // В этом случае мы не можем использовать сумму, так как валюты разные
    let stripePaidPln = stripeTotals.stripePaidPln;
    if (stripeTotals.hasCurrencyMismatch && stripeTotals.webhookVerifiedCount > 0 && deal) {
      // Используем количество подтвержденных платежей * ожидаемую сумму на платеж
      const dealValue = toNumber(deal.value) || 0;
      const dealCurrency = deal.currency || 'PLN';
      const scheduleType = this.resolveSchedule(deal, proformas, stripePayments);
      const profile = SCHEDULE_PROFILES[scheduleType] || SCHEDULE_PROFILES['100%'];
      const expectedPayments = profile.paymentsExpected;
      const amountPerPayment = expectedPayments > 0 ? dealValue / expectedPayments : dealValue;
      
      // Конвертируем сумму в PLN для расчета
      const amountPerPaymentPln = convertToPln(amountPerPayment, dealCurrency, null);
      
      // Рассчитываем сумму на основе количества подтвержденных платежей
      stripePaidPln = stripeTotals.webhookVerifiedCount * amountPerPaymentPln;
      
      this.logger.info('Using webhook count for currency mismatch calculation', {
        dealId,
        dealCurrency,
        dealValue,
        webhookVerifiedCount: stripeTotals.webhookVerifiedCount,
        expectedPayments,
        amountPerPayment,
        amountPerPaymentPln,
        calculatedStripePaidPln: stripePaidPln,
        note: 'When currencies differ, calculated amount based on webhook-verified payment count'
      });
    }

    const totals = {
      expectedAmountPln: proformaTotals.expectedAmountPln,
      bankPaidPln: proformaTotals.bankPaidPln,
      cashPaidPln: proformaTotals.cashPaidPln,
      stripePaidPln: stripePaidPln
    };
    totals.totalPaidPln = totals.bankPaidPln + totals.cashPaidPln + totals.stripePaidPln;

    const paymentsCount = {
      bank: proformaTotals.bankPaymentsCount,
      stripe: stripeTotals.stripePaymentsCount,
      total: proformaTotals.bankPaymentsCount + stripeTotals.stripePaymentsCount
    };
    
    this.logger.info('buildDealSnapshot: creating totals and paymentsCount', {
      dealId,
      totals,
      paymentsCount,
      stripeTotals: {
        stripePaidPln: stripeTotals.stripePaidPln,
        stripePaymentsCount: stripeTotals.stripePaymentsCount
      },
      proformaTotals: {
        expectedAmountPln: proformaTotals.expectedAmountPln,
        bankPaymentsCount: proformaTotals.bankPaymentsCount
      }
    });

    const scheduleType = this.resolveSchedule(deal, proformas, stripePayments);

    return {
      dealId,
      proformas,
      stripePayments,
      totals,
      paymentsCount,
      scheduleType
    };
  }

  shouldUpdateStage(currentStageId, targetStageId, { force = false, pipelineId = null, pipelineName = null } = {}) {
    // Получаем поддерживаемые ID статусов для пайплайна
    const supportedStageIds = pipelineId 
      ? getSupportedStageIdsForPipeline(pipelineId, pipelineName)
      : DEFAULT_SUPPORTED_STAGE_IDS;
    
    // Получаем конфигурацию пайплайна для определения порядка статусов
    const pipelineConfig = getPipelineConfig(pipelineId, pipelineName);
    const stageOrder = pipelineConfig?.stageIds 
      ? [pipelineConfig.stageIds.FIRST_PAYMENT, pipelineConfig.stageIds.SECOND_PAYMENT, pipelineConfig.stageIds.CAMP_WAITER].filter(id => id !== null)
      : [STAGE_IDS.FIRST_PAYMENT, STAGE_IDS.SECOND_PAYMENT, STAGE_IDS.CAMP_WAITER];

    if (!supportedStageIds.has(targetStageId)) {
      return { canUpdate: false, reason: 'Target stage is not supported for automation' };
    }

    if (force) {
      return { canUpdate: true };
    }

    if (!supportedStageIds.has(currentStageId)) {
      return { canUpdate: false, reason: 'Deal is in a custom stage; automation skipped' };
    }

    if (currentStageId === targetStageId) {
      return { canUpdate: false, reason: 'Stage already matches target' };
    }

    const currentIndex = stageOrder.indexOf(currentStageId);
    const targetIndex = stageOrder.indexOf(targetStageId);

    if (currentIndex === -1 || targetIndex === -1) {
      return { canUpdate: false, reason: 'Stage order undefined' };
    }

    if (targetIndex < currentIndex) {
      return { canUpdate: false, reason: 'Automation does not downgrade stages without force flag' };
    }

    return { canUpdate: true };
  }

  async syncDealStage(dealId, options = {}) {
    this.logger.info('syncDealStage called', {
      dealId,
      options,
      timestamp: new Date().toISOString()
    });
    
    const normalizedDealId = String(dealId).trim();
    if (!normalizedDealId) {
      throw new Error('dealId is required to sync CRM status');
    }

    this.logger.info('Loading deal from Pipedrive', { dealId: normalizedDealId });
    const dealResult = await this.pipedriveClient.getDeal(normalizedDealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Failed to load Pipedrive deal #${normalizedDealId}`);
    }

    // Определяем пайплайн сразу после загрузки сделки для логирования
    const pipelineId = dealResult.deal.pipeline_id || null;
    const pipelineName = dealResult.deal.pipeline?.name || null;
    const pipelineConfig = getPipelineConfig(pipelineId, pipelineName);
    
    this.logger.info('Pipeline detected for deal', {
      dealId: normalizedDealId,
      pipelineId,
      pipelineName: pipelineConfig?.pipelineName || 'Camps (default)',
      stageIds: pipelineConfig?.stageIds || null
    });

    this.logger.info('Building deal snapshot', { dealId: normalizedDealId });
    const snapshot = await this.buildDealSnapshot(normalizedDealId, dealResult.deal);
    
    this.logger.info('Deal snapshot received', {
      dealId: normalizedDealId,
      totals: snapshot.totals,
      paymentsCount: snapshot.paymentsCount,
      stripePaymentsArrayLength: snapshot.stripePayments?.length || 0,
      proformasCount: snapshot.proformas?.length || 0
    });
    
    this.logger.info('Deal snapshot built', {
      dealId: normalizedDealId,
      snapshot: {
        totalPaidPln: snapshot.totals?.totalPaidPln,
        expectedAmountPln: snapshot.totals?.expectedAmountPln,
        stripePaidPln: snapshot.totals?.stripePaidPln,
        bankPaidPln: snapshot.totals?.bankPaidPln,
        cashPaidPln: snapshot.totals?.cashPaidPln,
        scheduleType: snapshot.scheduleType,
        paymentsCount: snapshot.paymentsCount,
        stripePaymentsCount: snapshot.paymentsCount?.stripe,
        bankPaymentsCount: snapshot.paymentsCount?.bank,
        proformasCount: snapshot.proformas?.length || 0,
        stripePaymentsArrayLength: snapshot.stripePayments?.length || 0,
        totalsKeys: Object.keys(snapshot.totals || {}),
        totalsFull: snapshot.totals
      }
    });
    
    // Проверяем, есть ли платежи (Stripe или проформы)
    // Для Stripe-платежей может не быть проформ, но платежи есть
    this.logger.info('syncDealStage: checking for payments', {
      dealId: normalizedDealId,
      totalPaidPln: snapshot.totals?.totalPaidPln,
      stripePaidPln: snapshot.totals?.stripePaidPln,
      bankPaidPln: snapshot.totals?.bankPaidPln,
      cashPaidPln: snapshot.totals?.cashPaidPln,
      paymentsCountStripe: snapshot.paymentsCount?.stripe,
      paymentsCountBank: snapshot.paymentsCount?.bank,
      paymentsCountTotal: snapshot.paymentsCount?.total,
      paymentsCount: snapshot.paymentsCount,
      proformasCount: snapshot.proformas?.length || 0,
      expectedAmountPln: snapshot.totals?.expectedAmountPln,
      snapshotTotals: snapshot.totals,
      snapshotPaymentsCount: snapshot.paymentsCount,
      stripePaymentsArrayLength: snapshot.stripePayments?.length || 0
    });
    
    // Проверяем наличие платежей: либо есть оплаченные суммы, либо есть Stripe платежи (даже если totalPaidPln еще не установлен)
    // ВАЖНО: Проверяем как paymentsCount.stripe, так и массив stripePayments (fallback на случай, если счетчик не заполнен)
    const hasStripePayments = snapshot.paymentsCount.stripe > 0 || (snapshot.stripePayments && snapshot.stripePayments.length > 0);
    const hasPayments = snapshot.totals.totalPaidPln > 0 || hasStripePayments || snapshot.paymentsCount.bank > 0;
    const hasExpectedAmount = snapshot.totals.expectedAmountPln > 0;
    
    this.logger.info('syncDealStage: payment check result', {
      dealId: normalizedDealId,
      hasPayments,
      hasStripePayments,
      hasExpectedAmount,
      totalPaidPln: snapshot.totals.totalPaidPln,
      paymentsCountStripe: snapshot.paymentsCount.stripe,
      stripePaymentsArrayLength: snapshot.stripePayments?.length || 0
    });
    
    // Если нет проформ И нет Stripe платежей, не обновляем статус
    if (snapshot.proformas.length === 0 && !hasPayments && !hasExpectedAmount) {
      this.logger.info('syncDealStage: early return - no payments', {
        dealId: normalizedDealId,
        reason: 'Нет активных проформ и нет платежей',
        totalPaidPln: snapshot.totals.totalPaidPln,
        paymentsCountStripe: snapshot.paymentsCount.stripe
      });
      return {
        updated: false,
        reason: 'Нет активных проформ и нет платежей',
        dealId: normalizedDealId,
        snapshot
      };
    }
    
    // Если есть Stripe платежи, но нет проформ, используем сумму сделки как expectedAmount
    // Проверяем наличие Stripe платежей по paymentsCount.stripe ИЛИ по массиву stripePayments
    // (hasStripePayments уже объявлена выше)
    if (snapshot.proformas.length === 0 && hasStripePayments && snapshot.totals.expectedAmountPln <= 0) {
      const dealValue = parseFloat(dealResult.deal.value || 0);
      const dealCurrency = dealResult.deal.currency || 'PLN';
      if (dealValue > 0) {
        // ВАЖНО: Убеждаемся, что stripePaidPln есть в snapshot.totals
        // Если его нет, пересчитываем из stripePayments
        if (!snapshot.totals.stripePaidPln && snapshot.stripePayments && snapshot.stripePayments.length > 0) {
          const stripeTotal = snapshot.stripePayments
            .filter(p => p.payment_status === 'paid' || p.status === 'processed')
            .reduce((sum, p) => sum + (parseFloat(p.amount_pln) || 0), 0);
          snapshot.totals.stripePaidPln = stripeTotal;
          this.logger.info('Recalculated stripePaidPln from stripePayments array', {
            dealId: normalizedDealId,
            stripePaidPln: snapshot.totals.stripePaidPln,
            stripePaymentsCount: snapshot.stripePayments.length
          });
        }
        
        // Конвертируем в PLN если нужно
        let expectedAmountPln = dealValue;
        if (dealCurrency !== 'PLN') {
          try {
            if (this.stripeProcessor && this.stripeProcessor.convertAmountWithRate) {
              const { amountPln } = await this.stripeProcessor.convertAmountWithRate(dealValue, dealCurrency);
              expectedAmountPln = amountPln;
            } else {
              // Fallback на старый способ если stripeProcessor недоступен
              const { getRate } = require('../stripe/exchangeRateService');
              const rate = await getRate(dealCurrency, 'PLN');
              expectedAmountPln = dealValue * rate;
            }
          } catch (error) {
            this.logger.warn('Failed to get exchange rate for deal value conversion', {
              dealId: normalizedDealId,
              dealCurrency,
              error: error.message
            });
            // Fallback: используем сумму из Stripe платежей в PLN
            expectedAmountPln = snapshot.totals.stripePaidPln || 0;
          }
        }
        snapshot.totals.expectedAmountPln = expectedAmountPln;
        // Пересчитываем totalPaidPln после установки expectedAmountPln
        snapshot.totals.totalPaidPln = (snapshot.totals.bankPaidPln || 0) + (snapshot.totals.cashPaidPln || 0) + (snapshot.totals.stripePaidPln || 0);
        this.logger.info('Using deal value as expected amount for Stripe-only payment', {
          dealId: normalizedDealId,
          dealValue,
          dealCurrency,
          expectedAmountPln,
          stripePaymentsCount: snapshot.paymentsCount.stripe,
          stripePaidPln: snapshot.totals.stripePaidPln,
          totalPaidPln: snapshot.totals.totalPaidPln,
          hasStripePayments,
          hasPayments
        });
      }
    }

    // Если expectedAmountPln все еще 0, но есть Stripe платежи, устанавливаем из суммы сделки
    // Проверяем по paymentsCount.stripe ИЛИ по массиву stripePayments
    const hasStripePaymentsFallback = snapshot.paymentsCount.stripe > 0 || (snapshot.stripePayments && snapshot.stripePayments.length > 0);
    if (snapshot.totals.expectedAmountPln <= 0 && hasStripePaymentsFallback && dealResult.deal.value) {
      // ВАЖНО: Убеждаемся, что stripePaidPln есть в snapshot.totals
      if (!snapshot.totals.stripePaidPln && snapshot.stripePayments && snapshot.stripePayments.length > 0) {
        const stripeTotal = snapshot.stripePayments
          .filter(p => p.payment_status === 'paid' || p.status === 'processed')
          .reduce((sum, p) => sum + (parseFloat(p.amount_pln) || 0), 0);
        snapshot.totals.stripePaidPln = stripeTotal;
        this.logger.info('Fallback: Recalculated stripePaidPln from stripePayments array', {
          dealId: normalizedDealId,
          stripePaidPln: snapshot.totals.stripePaidPln
        });
      }
      
      const dealValue = parseFloat(dealResult.deal.value || 0);
      const dealCurrency = dealResult.deal.currency || 'PLN';
      if (dealValue > 0) {
        let expectedAmountPln = dealValue;
        if (dealCurrency !== 'PLN') {
          try {
            if (this.stripeProcessor && this.stripeProcessor.convertAmountWithRate) {
              const { amountPln } = await this.stripeProcessor.convertAmountWithRate(dealValue, dealCurrency);
              expectedAmountPln = amountPln;
            } else {
              // Fallback на старый способ если stripeProcessor недоступен
              const { getRate } = require('../stripe/exchangeRateService');
              const rate = await getRate(dealCurrency, 'PLN');
              expectedAmountPln = dealValue * rate;
            }
          } catch (error) {
            this.logger.warn('Failed to get exchange rate for fallback conversion', {
              dealId: normalizedDealId,
              dealCurrency,
              error: error.message
            });
            // Fallback: используем сумму из Stripe платежей в PLN
            expectedAmountPln = snapshot.totals.stripePaidPln || 0;
          }
        }
        snapshot.totals.expectedAmountPln = expectedAmountPln;
        // Пересчитываем totalPaidPln после установки expectedAmountPln
        snapshot.totals.totalPaidPln = (snapshot.totals.bankPaidPln || 0) + (snapshot.totals.cashPaidPln || 0) + (snapshot.totals.stripePaidPln || 0);
        this.logger.info('Fallback: Setting expectedAmountPln from deal value before evaluation', {
          dealId: normalizedDealId,
          dealValue,
          dealCurrency,
          expectedAmountPln,
          stripePaidPln: snapshot.totals.stripePaidPln,
          totalPaidPln: snapshot.totals.totalPaidPln,
          stripePaymentsCount: snapshot.paymentsCount.stripe
        });
      }
    }

    let evaluation;
    try {
      // ВАЖНО: Убеждаемся, что stripePaidPln есть в snapshot.totals перед пересчетом totalPaidPln
      if (!snapshot.totals.stripePaidPln && snapshot.stripePayments && snapshot.stripePayments.length > 0) {
        const stripeTotal = snapshot.stripePayments
          .filter(p => p.payment_status === 'paid' || p.status === 'processed')
          .reduce((sum, p) => sum + (parseFloat(p.amount_pln) || 0), 0);
        snapshot.totals.stripePaidPln = stripeTotal;
        this.logger.info('Final check: Recalculated stripePaidPln before evaluation', {
          dealId: normalizedDealId,
          stripePaidPln: snapshot.totals.stripePaidPln
        });
      }
      
      // ВАЖНО: Убеждаемся, что totalPaidPln пересчитан перед вызовом evaluatePaymentStatus
      snapshot.totals.totalPaidPln = (snapshot.totals.bankPaidPln || 0) + (snapshot.totals.cashPaidPln || 0) + (snapshot.totals.stripePaidPln || 0);
      
      // ВАЖНО: Сравниваем суммы в валюте сделки, а не в PLN!
      // PLN нужен только для отчетов
      const dealCurrency = dealResult.deal.currency || 'PLN';
      const dealValue = parseFloat(dealResult.deal.value || 0);
      
      // Вычисляем суммы в валюте сделки
      // Для expectedAmount всегда используем сумму сделки напрямую (в валюте сделки)
      let expectedAmount = dealValue > 0 ? dealValue : (snapshot.totals.expectedAmountPln || 0);
      
      // Для paidAmount суммируем original_amount из stripePayments в валюте сделки
      // ВАЖНО: Если платеж в другой валюте, конвертируем его в валюту сделки через PLN
      let paidAmount = 0;
      
      if (snapshot.stripePayments && snapshot.stripePayments.length > 0) {
        const paidPayments = snapshot.stripePayments.filter(
          p => p.payment_status === 'paid' || p.status === 'processed'
        );
        
        // Суммируем все оплаченные платежи, конвертируя в валюту сделки если нужно
        for (const payment of paidPayments) {
          const paymentAmount = parseFloat(payment.original_amount) || 0;
          const paymentCurrency = payment.currency || dealCurrency;
          
          if (paymentCurrency === dealCurrency) {
            // Платеж в валюте сделки - используем напрямую
            paidAmount += paymentAmount;
          } else {
            // Платеж в другой валюте - конвертируем в валюту сделки через PLN
            if (this.stripeProcessor && this.stripeProcessor.convertAmountWithRate) {
              try {
                // Шаг 1: Конвертируем из валюты платежа в PLN
                const toPlnConversion = await this.stripeProcessor.convertAmountWithRate(paymentAmount, paymentCurrency);
                const plnAmount = toPlnConversion.amountPln;
                
                // Шаг 2: Конвертируем из PLN в валюту сделки
                if (dealCurrency === 'PLN') {
                  paidAmount += plnAmount;
                } else {
                  // Конвертируем 1 единицу валюты сделки в PLN, чтобы получить курс
                  const dealToPlnConversion = await this.stripeProcessor.convertAmountWithRate(1, dealCurrency);
                  const dealToPlnRate = dealToPlnConversion.amountPln; // Сколько PLN в 1 единице валюты сделки
                  
                  // Конвертируем PLN обратно в валюту сделки
                  const amountInDealCurrency = plnAmount / dealToPlnRate;
                  paidAmount += amountInDealCurrency;
                }
              } catch (error) {
                this.logger.warn('Failed to convert payment amount to deal currency', {
                  dealId: normalizedDealId,
                  dealCurrency,
                  paymentCurrency,
                  paymentAmount,
                  error: error.message
                });
                // Fallback: используем original_amount (может быть неточным, но лучше чем ничего)
                paidAmount += paymentAmount;
              }
            } else {
              // Fallback: если нет stripeProcessor, используем original_amount
              this.logger.warn('No stripeProcessor available for currency conversion', {
                dealId: normalizedDealId,
                dealCurrency,
                paymentCurrency
              });
              paidAmount += paymentAmount;
            }
          }
        }
      }
      
      // Если нет Stripe платежей в валюте сделки, но есть в PLN (для PLN сделок)
      // или если валюта PLN и нет original_amount, используем amount_pln
      if (paidAmount === 0 && dealCurrency === 'PLN' && snapshot.totals.totalPaidPln > 0) {
        paidAmount = snapshot.totals.totalPaidPln;
      }
      
      // Если expectedAmount все еще 0, используем из snapshot (для обратной совместимости)
      if (expectedAmount === 0 && snapshot.totals.expectedAmountPln > 0) {
        expectedAmount = snapshot.totals.expectedAmountPln;
      }
      
      this.logger.info('Calling evaluatePaymentStatus', {
        dealId: normalizedDealId,
        dealCurrency,
        expectedAmount,
        paidAmount,
        expectedAmountPln: snapshot.totals.expectedAmountPln,
        paidAmountPln: snapshot.totals.totalPaidPln,
        stripePaidPln: snapshot.totals.stripePaidPln,
        bankPaidPln: snapshot.totals.bankPaidPln,
        cashPaidPln: snapshot.totals.cashPaidPln,
        scheduleType: snapshot.scheduleType,
        manualPaymentsCount: snapshot.paymentsCount.total,
        paymentsCountStripe: snapshot.paymentsCount.stripe
      });
      
      evaluation = evaluatePaymentStatus({
        expectedAmount,
        paidAmount,
        scheduleType: snapshot.scheduleType,
        manualPaymentsCount: snapshot.paymentsCount.total,
        pipelineId: pipelineId,
        pipelineName: pipelineName,
        expectedAmountPln: snapshot.totals.expectedAmountPln,
        paidAmountPln: snapshot.totals.totalPaidPln
      });
    } catch (error) {
      this.logger.error('Failed to evaluate payment status', {
        dealId: normalizedDealId,
        expectedAmountPln: snapshot.totals.expectedAmountPln,
        paidAmountPln: snapshot.totals.totalPaidPln,
        scheduleType: snapshot.scheduleType,
        paymentsCount: snapshot.paymentsCount,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }

    const currentStageId = dealResult.deal.stage_id;
    
    this.logger.info('CRM status automation: evaluating stage update', {
      dealId: normalizedDealId,
      currentStageId,
      targetStageId: evaluation.targetStageId,
      scheduleType: evaluation.scheduleType,
      paidRatio: evaluation.paidRatio,
      paidPercent: Math.round(evaluation.paidRatio * 100),
      expectedAmountPln: snapshot.totals.expectedAmountPln,
      totalPaidPln: snapshot.totals.totalPaidPln,
      stripePaymentsCount: snapshot.paymentsCount.stripe,
      proformasCount: snapshot.proformas.length,
      options
    });
    
    const updateDecision = this.shouldUpdateStage(currentStageId, evaluation.targetStageId, {
      force: options.force === true,
      pipelineId,
      pipelineName
    });

    this.logger.info('CRM status automation: update decision', {
      dealId: normalizedDealId,
      canUpdate: updateDecision.canUpdate,
      reason: updateDecision.reason,
      currentStageId,
      targetStageId: evaluation.targetStageId,
      force: options.force === true
    });

    if (!updateDecision.canUpdate) {
      this.logger.info('CRM status automation: stage unchanged', {
        dealId: normalizedDealId,
        currentStageId,
        targetStageId: evaluation.targetStageId,
        reason: updateDecision.reason,
        scheduleType: evaluation.scheduleType,
        paidPercent: Math.round(evaluation.paidRatio * 100)
      });
      return {
        updated: false,
        reason: updateDecision.reason,
        dealId: normalizedDealId,
        evaluation,
        snapshot,
        currentStageId
      };
    }

    try {
      await this.pipedriveClient.updateDealStage(normalizedDealId, evaluation.targetStageId);
      this.logger.info('CRM status automation: stage updated', {
        dealId: normalizedDealId,
        from: currentStageId,
        to: evaluation.targetStageId,
        scheduleType: evaluation.scheduleType,
        paidPercent: Math.round(evaluation.paidRatio * 100)
      });
      
      // Отправляем уведомление о получении платежа через SendPulse
      await this.sendPaymentReceivedNotification(normalizedDealId, snapshot, evaluation);
    } catch (error) {
      this.logger.error('Failed to update Pipedrive stage during CRM automation', {
        dealId: normalizedDealId,
        targetStageId: evaluation.targetStageId,
        error: error.message
      });
      throw error;
    }

    return {
      updated: true,
      dealId: normalizedDealId,
      previousStageId: currentStageId,
      nextStageId: evaluation.targetStageId,
      evaluation,
      snapshot
    };
  }

  /**
   * Отправить уведомление о получении платежа через SendPulse
   * @param {string} dealId - ID сделки
   * @param {Object} snapshot - Снимок данных сделки (опционально, будет получен автоматически)
   * @param {Object} evaluation - Результат оценки статуса платежа (опционально)
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendPaymentReceivedNotification(dealId, snapshot, evaluation) {
    if (!this.sendpulseClient) {
      return { success: false, error: 'SendPulse not available' };
    }

    try {
      // Проверяем, не отправляли ли мы уведомление недавно (в течение последнего часа)
      // Это предотвращает дублирование уведомлений при повторной обработке платежей
      // Используем глобальный кеш, чтобы защита работала между экземплярами сервиса (webhook, cron, etc.)
      const lastNotificationTime = paymentNotificationCache.get(dealId);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000; // 1 час в миллисекундах

      if (lastNotificationTime && (now - lastNotificationTime) < oneHour) {
        this.logger.debug('Payment notification skipped: already sent recently', {
          dealId,
          lastSent: new Date(lastNotificationTime).toISOString(),
          timeSinceLastSent: Math.round((now - lastNotificationTime) / 1000 / 60) + ' minutes'
        });
        return { success: false, error: 'Notification already sent recently', skipped: true };
      }

      // Получаем данные сделки и персоны
      const dealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!dealResult || !dealResult.person) {
        this.logger.warn('Failed to get deal/person data for payment notification', { dealId });
        return { success: false, error: 'Deal or person not found' };
      }

      const person = dealResult.person;
      const deal = dealResult.deal || {};
      const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];

      if (!sendpulseId) {
        this.logger.debug('SendPulse ID not found for person, skipping payment notification', { dealId });
        return { success: false, error: 'SendPulse ID not found' };
      }

      // Если snapshot не передан, получаем его автоматически
      if (!snapshot || !snapshot.totals) {
        snapshot = await this.buildDealSnapshot(dealId, deal);
      }

    // Формируем информацию о платеже
    // ВАЖНО: totalPaidPln и expectedAmountPln используются только для отчетов
    // Для логирования используем значения из evaluation, которые уже в правильной валюте сделки
    const paidAmount = evaluation?.paidAmount || 0;
    const expectedAmount = evaluation?.expectedAmount || 0;
    const paidPercent = evaluation?.paidRatio ? Math.round(evaluation.paidRatio * 100) : (expectedAmount > 0 ? Math.round((paidAmount / expectedAmount) * 100) : 0);
    
    const message = '✅ Твой платеж получен, спасибо!';

      // Отправляем сообщение
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        // Сохраняем время последнего уведомления в глобальном кеше для предотвращения дублирования
        paymentNotificationCache.set(dealId, now);
        
        // Очищаем старые записи из кеша (старше 24 часов), чтобы не накапливать память
        if (paymentNotificationCache.size > 1000) {
          const oneDay = 24 * 60 * 60 * 1000;
          for (const [cachedDealId, cachedTime] of paymentNotificationCache.entries()) {
            if (now - cachedTime > oneDay) {
              paymentNotificationCache.delete(cachedDealId);
            }
          }
        }
        
        this.logger.info('Payment received notification sent via SendPulse', {
          dealId,
          sendpulseId,
          paidAmount,
          paidPercent
        });
      } else {
        this.logger.warn('Failed to send payment received notification', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending payment received notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = CrmStatusAutomationService;
