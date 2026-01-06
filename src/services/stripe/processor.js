const logger = require('../../utils/logger');
const StripeRepository = require('./repository');
const {
  iterateCheckoutSessions,
  iterateRefunds,
  buildSessionFilters
} = require('./service');
const { fromMinorUnit, normaliseCurrency, roundBankers, toMinorUnit } = require('../../utils/currency');
const { logStripeError } = require('../../utils/logging/stripe');
const ParticipantPaymentPlanService = require('./participantPaymentPlanService');
const StripeEventStorageService = require('./eventStorageService');
const { STAGE_IDS: STAGES } = require('../crm/statusCalculator');
const StripeStatusAutomationService = require('../crm/stripeStatusAutomationService');
const PipedriveClient = require('../pipedrive');
const { getRate } = require('./exchangeRateService');
const { getStripeClient } = require('./client');
const SendPulseClient = require('../sendpulse');
const { extractCashFields } = require('../cash/cashFieldParser');
// Phase 0: Code Review Fixes - New unified services
const PaymentScheduleService = require('./paymentScheduleService');
const PaymentStateAnalyzer = require('./paymentStateAnalyzer');
const DealAmountCalculator = require('./dealAmountCalculator');
const DistributedLockService = require('./distributedLockService');

class StripeProcessorService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.repository = options.repository || new StripeRepository();
    this.paymentPlanService = options.paymentPlanService || new ParticipantPaymentPlanService();
    this.crmStatusAutomationService =
      options.crmStatusAutomationService || new StripeStatusAutomationService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    // Force recreate Stripe client to pick up current STRIPE_MODE
    this.stripe = options.stripe || getStripeClient();
    this.eventStorageService = new StripeEventStorageService({ stripe: this.stripe });
    this.mode = (process.env.STRIPE_MODE || 'live').toLowerCase();
    this.maxSessions = parseInt(process.env.STRIPE_PROCESSOR_MAX_SESSIONS || '500', 10);
    this.crmCache = new Map();
    this.addressTaskCache = new Set();
    this.invoiceTypeFieldKey = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    this.stripeTriggerValue = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');
    this.invoiceDoneValue = String(process.env.PIPEDRIVE_INVOICE_DONE_VALUE || '73');
    this.checkoutSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL || 'https://comoon.io/comoonity/';
    this.checkoutCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL || this.checkoutSuccessUrl;
    
    // Initialize SendPulse client (optional, may not be configured)
    this.sendpulseClient = null;
    try {
      const sendpulseId = process.env.SENDPULSE_ID?.trim();
      const sendpulseSecret = process.env.SENDPULSE_SECRET?.trim();
      const hasSendpulseId = !!sendpulseId;
      const hasSendpulseSecret = !!sendpulseSecret;
      
      this.logger.info('SendPulse initialization check:', {
        hasSendpulseId,
        hasSendpulseSecret,
        sendpulseIdLength: sendpulseId?.length || 0,
        sendpulseSecretLength: sendpulseSecret?.length || 0
      });
      
      if (hasSendpulseId && hasSendpulseSecret) {
        this.sendpulseClient = new SendPulseClient();
        this.logger.info('SendPulse client initialized successfully');
      } else {
        this.logger.warn('SendPulse client not initialized (credentials missing)', {
          hasSendpulseId,
          hasSendpulseSecret
        });
      }
    } catch (error) {
      this.logger.warn('SendPulse client initialization failed', { error: error.message });
      this.sendpulseClient = null;
    }
    
    // SendPulse ID field key in Pipedrive (same as invoiceProcessing)
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
    this.WEBHOOK_TASK_SUBJECT = '⚠️ Проверить обработку Stripe платежа';
  }

  async triggerCrmStatusAutomation(dealId, context = {}) {
    if (!dealId || !this.crmStatusAutomationService) {
      return;
    }
    if (
      typeof this.crmStatusAutomationService.isEnabled === 'function' &&
      !this.crmStatusAutomationService.isEnabled()
    ) {
      return;
    }
    try {
      await this.crmStatusAutomationService.syncDealStage(dealId, context);
    } catch (error) {
      this.logger.warn('CRM status automation failed after Stripe processor event', {
        dealId,
        context,
        error: error.message
      });
    }
  }

  async persistEventItems(session) {
    if (!this.eventStorageService?.supabase) {
      return;
    }
    if (!session?.id) {
      return;
    }
    try {
      await this.eventStorageService.syncSession(session);
    } catch (error) {
      this.logger.warn('Stripe processor: failed to persist event items', {
        sessionId: session.id,
        error: error.message
      });
    }
  }

  /**
   * Main entrypoint for scheduler/manual trigger.
   */
  /**
   * Проверить и исправить статусы сделок, где оба платежа оплачены, но статус не обновлен
   * @param {Object} options - Опции проверки
   * @returns {Promise<Object>} - Результат проверки
   */
  async verifyAndFixDealStatuses(options = {}) {
    const { limit = 100 } = options;
    const summary = {
      checked: 0,
      fixed: 0,
      errors: []
    };

    try {
      this.logger.info('Starting deal status verification', { limit });

      // Получаем все сделки с оплаченными платежами
      const allPayments = await this.repository.listPayments({});
      
      // Группируем по deal_id
      const dealPaymentsMap = new Map();
      for (const payment of allPayments) {
        if (!payment.deal_id || payment.payment_status !== 'paid') {
          continue;
        }
        
        if (!dealPaymentsMap.has(payment.deal_id)) {
          dealPaymentsMap.set(payment.deal_id, []);
        }
        dealPaymentsMap.get(payment.deal_id).push(payment);
      }

      // Проверяем каждую сделку
      for (const [dealId, payments] of Array.from(dealPaymentsMap.entries()).slice(0, limit)) {
        try {
          summary.checked++;
          
          // Проверяем, есть ли оба платежа
          const depositPayment = payments.find(p => 
            p.payment_type === 'deposit' || p.payment_type === 'first'
          );
          const restPayment = payments.find(p => 
            p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
          );

          // Если оба платежа оплачены, проверяем статус сделки
          if (depositPayment && restPayment) {
            const dealResult = await this.pipedriveClient.getDeal(dealId);
            if (!dealResult.success || !dealResult.deal) {
              continue;
            }

            const deal = dealResult.deal;
            const currentStageId = deal.stage_id;
            const STAGES = {
              CAMP_WAITER_ID: 27,
              SECOND_PAYMENT_ID: 32
            };

            // Если сделка в статусе "Second Payment", но оба платежа оплачены - исправляем
            if (currentStageId === STAGES.SECOND_PAYMENT_ID) {
              this.logger.info('Found deal with both payments paid but wrong status', {
                dealId,
                currentStage: currentStageId,
                expectedStage: STAGES.CAMP_WAITER_ID,
                depositSessionId: depositPayment.session_id,
                restSessionId: restPayment.session_id
              });

              await this.triggerCrmStatusAutomation(dealId, {
                reason: 'stripe:both-payments-complete-status-fix'
              });

              // Добавляем заметку о том, что все платежи оплачены
              await this.addAllPaymentsCompleteNote(dealId, {
                depositPayment,
                restPayment,
                depositSessionId: depositPayment.session_id,
                restSessionId: restPayment.session_id
              });

              summary.fixed++;
              this.logger.info('Deal status fixed', {
                dealId,
                from: currentStageId,
                to: STAGES.CAMP_WAITER_ID
              });
            }
          }
        } catch (error) {
          summary.errors.push({
            dealId,
            error: error.message
          });
          this.logger.warn('Error verifying deal status', {
            dealId,
            error: error.message
          });
        }
      }

      this.logger.info('Deal status verification completed', summary);
      return summary;
    } catch (error) {
      this.logger.error('Failed to verify deal statuses', {
        error: error.message
      });
      return {
        ...summary,
        error: error.message
      };
    }
  }

  async processPendingPayments(context = {}) {
    const {
      trigger = 'manual',
      runId = null,
      from,
      to,
      dealId,
      skipTriggers = false // Если true, пропускаем создание новых Checkout Sessions
    } = context;

    const dealIdFilter = dealId ? String(dealId) : null;

    this.logger.info('Stripe processor invoked', {
      trigger,
      runId,
      mode: this.mode,
      from,
      to,
      dealId: dealIdFilter,
      skipTriggers
    });

    if (!this.repository.isEnabled()) {
      this.logger.warn('StripeRepository disabled (Supabase missing). Skipping Stripe processing.');
      return {
        success: true,
        summary: { total: 0, successful: 0, errors: 0 },
        results: [],
        skipped: true,
        reason: 'repository_disabled'
      };
    }

    const summary = {
      total: 0,
      successful: 0,
      errors: 0
    };
    const results = [];
    const refundsSummary = {
      total: 0,
      amount: 0,
      amountPln: 0
    };
    const metadata = {
      trigger,
      runId,
      mode: this.mode,
      filters: { from, to, dealId: dealIdFilter }
    };

    let triggerSummary = {
      totalDeals: 0,
      sessionsCreated: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Создаем новые Checkout Sessions только если не пропущено
      if (!skipTriggers) {
        triggerSummary = await this.processCheckoutTriggers({
          trigger,
          runId,
          dealId: dealIdFilter
        });
      } else {
        this.logger.info('Skipping Checkout Sessions creation (skipTriggers=true)', {
          trigger,
          runId
        });
      }

      const filters = buildSessionFilters({ from, to });
      await iterateCheckoutSessions({
        filters,
        maxIterations: Math.ceil(this.maxSessions / 100),
        onPage: async (sessions) => {
          for (const session of sessions) {
            if (dealIdFilter && String(session?.metadata?.deal_id || '') !== dealIdFilter) {
              continue;
            }
            if (!this.shouldProcessSession(session)) continue;
            
            // Check if payment was already processed (skip if exists in database)
            const existingPayment = await this.repository.findPaymentBySessionId(session.id);
            if (existingPayment) {
              // Payment already processed, skip to avoid duplicate processing on startup
              continue;
            }
            
            // Check if payment was paid but not processed (webhook might have failed)
            const isPaid = session.payment_status === 'paid';
            const dealId = session.metadata?.deal_id;
            
            // If paid but not processed and more than 1 hour old, create task
            if (isPaid && dealId) {
              const sessionCreated = session.created ? new Date(session.created * 1000) : null;
              if (sessionCreated) {
                const hoursSinceCreated = (Date.now() - sessionCreated.getTime()) / (1000 * 60 * 60);
                if (hoursSinceCreated > 1) {
                  // Payment was paid more than 1 hour ago but not processed - webhook likely failed
                  await this.createWebhookFailureTask(dealId, session.id);
                }
              }
            }
            
            summary.total += 1;
            try {
              // eslint-disable-next-line no-await-in-loop
              await this.persistSession(session);
              summary.successful += 1;
              results.push({
                sessionId: session.id,
                dealId: session.metadata?.deal_id || null,
                success: true
              });
            } catch (error) {
              summary.errors += 1;
              const dealId = session.metadata?.deal_id || null;
              const errorResult = {
                sessionId: session.id,
                dealId,
                success: false,
                error: error.message,
                errorCode: error.code,
                errorDetails: error.details || error.response?.data || null,
                stack: error.stack
              };
              results.push(errorResult);
              
              // Детальное логирование для диагностики
              const logContext = {
                sessionId: session.id,
                dealId,
                sessionStatus: session.status,
                paymentStatus: session.payment_status,
                currency: session.currency,
                amount: session.amount_total,
                metadata: session.metadata,
                error: error.message,
                errorCode: error.code,
                errorType: error.constructor?.name,
                errorStack: error.stack?.split('\n').slice(0, 5).join('\n')
              };
              
              // Если это ошибка базы данных, добавляем больше контекста
              if (error.code && (error.code.startsWith('23') || error.code === '23505')) {
                logContext.databaseError = true;
                logContext.constraint = error.constraint || error.detail;
                this.logger.error('Database constraint violation while persisting Stripe session', logContext);
              } else if (error.response) {
                logContext.apiError = true;
                logContext.statusCode = error.response.status;
                this.logger.error('API error while persisting Stripe session', logContext);
              } else {
                this.logger.error('Failed to persist Stripe session', logContext);
              }
            }
            if (summary.total >= this.maxSessions) {
              throw new Error('Stripe session processing limit reached');
            }
          }
        }
      });

      // Filter refunds by dealId in metadata, not in Stripe API filters
      const refundFilters = { from: filters.from, to: filters.to };
      await this.processRefunds(refundFilters, refundsSummary, dealIdFilter);

      // Process refunds for lost deals (deals with status "lost" and reason "Refund")
      const lostDealsRefundsSummary = {
        totalDeals: 0,
        refundsCreated: 0,
        errors: []
      };
      await this.processLostDealRefunds({
        trigger,
        runId
      });
    } catch (error) {
      logStripeError(error, { scope: 'processPendingPayments' });
      const logPayload = {
        runId,
        trigger,
        summary,
        resultsCount: results.length,
        mode: this.mode,
        errorDetails: results.slice(0, 5).map(r => ({
          sessionId: r.sessionId,
          dealId: r.dealId,
          error: r.error
        }))
      };
      this.logger.error('Stripe processing finished with errors', logPayload);
      return {
        success: false,
        summary,
        results,
        checkout: triggerSummary,
        metadata,
        error: error.message
      };
    }

    const plans = Array.isArray(this.paymentPlanService)
      ? []
      : this.paymentPlanService;

    // Логируем ошибки, если они есть
    if (summary.errors > 0) {
      const errorDetails = results
        .filter(r => !r.success)
        .slice(0, 10)
        .map(r => ({
          sessionId: r.sessionId,
          dealId: r.dealId,
          error: r.error
        }));
      this.logger.warn('Stripe processing completed with errors', {
        runId,
        trigger,
        totalErrors: summary.errors,
        totalProcessed: summary.total,
        successful: summary.successful,
        errorDetails
      });
    }

    return {
      success: summary.errors === 0,
      summary,
      results,
      refunds: refundsSummary,
      plansSummary: plans?.getSummary ? plans.getSummary() : null,
      checkout: triggerSummary,
      metadata
    };
  }

  shouldProcessSession(session) {
    return session?.status === 'complete' && session?.payment_status === 'paid';
  }

  getParticipant(session) {
    const details = session.customer_details || {};
    const email = details.email || session.metadata?.customer_email || null;
    const name = details.name || session.metadata?.customer_name || email || 'Неизвестно';
    const address = details.address || {};
    return {
      email,
      name,
      address: {
        line1: address.line1 || address.line_1 || null,
        line2: address.line2 || address.line_2 || null,
        postalCode: address.postal_code || null,
        city: address.city || null,
        state: address.state || null,
        country: address.country || null
      }
    };
  }

  async convertAmount(amount, currency) {
    const { amountPln } = await this.convertAmountWithRate(amount, currency);
    return amountPln;
  }

  async convertAmountWithRate(amount, currency) {
    const source = normaliseCurrency(currency);
    const now = new Date().toISOString();

    if (!Number.isFinite(amount)) {
      if (source === 'PLN') {
        return { amountPln: 0, rate: 1, fetchedAt: now };
      }
      return { amountPln: 0, rate: null, fetchedAt: null };
    }

    if (source === 'PLN') {
      return {
        amountPln: roundBankers(amount),
        rate: 1,
        fetchedAt: now
      };
    }

    try {
      const rate = await getRate(source, 'PLN');
      return {
        amountPln: roundBankers(amount * rate),
        rate: roundBankers(rate, 6),
        fetchedAt: now
      };
    } catch (error) {
      this.logger.warn('Failed to fetch exchange rate', {
        currency: source,
        amount,
        error: error.message
      });
      return {
        amountPln: 0,
        rate: null,
        fetchedAt: null
      };
    }
  }

  async persistSession(session) {
    const currency = normaliseCurrency(session.currency);
    
    // VAT НЕ применяется в Stripe, поэтому amount_total = amount_subtotal (нет налога от Stripe)
    // Используем amount_total как базовую сумму (цена из CRM)
    const amountSubtotal = fromMinorUnit(session.amount_subtotal || session.amount_total || 0, currency);
    const amountTotal = fromMinorUnit(session.amount_total || 0, currency);
    
    // Базовая сумма для расчетов (цена из CRM)
    const amount = amountSubtotal || amountTotal;
    
    const amountConversion = await this.convertAmountWithRate(amount, currency);
    const amountPln = amountConversion.amountPln;
    
    // Получаем контекст CRM для определения необходимости VAT
    const participant = this.getParticipant(session);
    const dealId = session.metadata?.deal_id || null;
    const crmContext = await this.getCrmContext(dealId);

    // Если сделка удалена или отсутствует, не пытаемся сохранять платёж/обновлять стадии
    if (dealId && (!crmContext || crmContext.deal?.status === 'deleted' || crmContext.deal?.deleted === true)) {
      this.logger.warn('Skipping Stripe payment for deleted or missing deal', {
        dealId,
        sessionId: session.id
      });
      return;
    }
    
    // Проверка несоответствия валюты платежа и валюты сделки
    const dealCurrency = crmContext?.deal?.currency || null;
    if (dealId && dealCurrency && currency && currency !== dealCurrency) {
      const dealValue = crmContext?.deal?.value || null;
      this.logger.warn('⚠️ Currency mismatch detected: payment currency differs from deal currency', {
        dealId,
        sessionId: session.id,
        paymentCurrency: currency,
        dealCurrency: dealCurrency,
        paymentAmount: amount,
        dealValue: dealValue,
        note: 'User may have changed currency in Stripe Checkout. Payment will be processed based on webhook confirmation, not amount comparison. This is a normal situation if user changed currency during checkout.'
      });
      
      // ВАЖНО: При разных валютах мы полагаемся на webhook подтверждение факта оплаты,
      // а не на сравнение сумм. Это нормальная ситуация, если пользователь изменил валюту в Checkout.
      // Платеж все равно должен быть обработан, так как webhook подтверждает факт оплаты.
      // Диагностика будет показывать это как информационное сообщение, если есть webhook подтверждение,
      // или как предупреждение, если webhook подтверждения нет.
    }
    
    const customerType = crmContext?.isB2B ? 'organization' : 'person';
    
    // Определяем, должен ли применяться VAT (для расчета)
    const shouldApplyVat = this.shouldApplyVat({
      customerType,
      companyCountry: crmContext?.companyCountry,
      sessionCountry: participant?.address?.country
    });
    
    // Рассчитываем VAT вручную для отображения (если должен применяться)
    // VAT НЕ удерживается Stripe, только рассчитывается для чеков/инвойсов
    let amountTax = 0;
    let amountTaxPln = 0;
    
    // ВАЖНО: Проверка что Stripe не удерживал налог
    const stripeTaxAmount = fromMinorUnit(session.total_details?.amount_tax || 0, currency);
    this.logger.info('✅ Проверка: Stripe не удерживал налог', {
      dealId,
      sessionId: session.id,
      stripeTaxAmount,
      stripeTaxAmountPln: stripeTaxAmount > 0 ? roundBankers(stripeTaxAmount * (amountConversion.rate || 1)) : 0,
      hasTaxFromStripe: stripeTaxAmount > 0,
      note: 'stripeTaxAmount должен быть 0 - Stripe не удерживает VAT'
    });
    
    if (shouldApplyVat) {
      // Рассчитываем VAT 23% для Польши (только для отображения)
      // Цена включает VAT (inclusive): amountTax = amount * 23 / 123
      const vatRate = 0.23; // 23%
      amountTax = roundBankers(amount * vatRate / (1 + vatRate)); // VAT из цены с НДС
      
      if (amountConversion.rate) {
        amountTaxPln = roundBankers(amountTax * amountConversion.rate);
      } else {
        const taxConversion = await this.convertAmountWithRate(amountTax, currency);
        amountTaxPln = taxConversion.amountPln;
      }
      
      this.logger.info('📊 VAT рассчитан вручную для отображения (НЕ из Stripe)', {
        dealId,
        sessionId: session.id,
        amount,
        amountTax,
        amountTaxPln,
        vatRate: '23%',
        stripeTaxAmount,
        note: 'VAT только для расчетов и чеков, Stripe не удерживает налог. Рассчитано вручную.'
      });
    } else {
      this.logger.info('ℹ️  VAT не применяется для этой сделки', {
        dealId,
        sessionId: session.id,
        customerType,
        companyCountry: crmContext?.companyCountry,
        sessionCountry: participant?.address?.country,
        note: 'VAT не требуется по условиям'
      });
    }
    const addressValidation = await this.ensureAddress({
      dealId,
      shouldApplyVat,
      participant,
      crmContext
    });

    // Extract country code for VAT calculations
    const addressParts = this.extractAddressParts(crmContext);
    const countryCode = this.extractCountryCode(addressParts);
    const isB2B = crmContext?.isB2B || false;

    // Get product_link_id from metadata, or try to find it by crm_product_id for old sessions
    let productLinkId = session.metadata?.product_link_id || null;
    if (!productLinkId && session.metadata?.product_id) {
      // Try to find product link by CRM product ID for old sessions without product_link_id
      const productLink = await this.repository.findProductLinkByCrmId(String(session.metadata.product_id));
      if (productLink?.id) {
        productLinkId = productLink.id;
      } else {
        // If product link doesn't exist, try to create it from Stripe product metadata
        // This handles old sessions that have product_id in metadata but no product_link yet
        const stripeProductId = session.line_items?.data?.[0]?.price?.product || null;
        if (stripeProductId && session.metadata?.product_id) {
          try {
            const stripeProduct = await this.stripe.products.retrieve(stripeProductId);
            const crmProductName = stripeProduct.name || session.metadata.product_id;
            const newLink = await this.repository.upsertProductLink({
              crmProductId: String(session.metadata.product_id),
              crmProductName,
              stripeProductId,
              campProductId: null,
              status: 'active'
            });
            if (newLink?.id) {
              productLinkId = newLink.id;
            }
          } catch (error) {
            this.logger.warn('Failed to create product link from Stripe product', {
              stripeProductId,
              crmProductId: session.metadata.product_id,
              error: error.message
            });
          }
        }
      }
    }

    const paymentRecord = {
      session_id: session.id,
      deal_id: dealId,
      product_id: productLinkId,
      payment_type: session.metadata?.payment_type || null,
      payment_schedule: session.metadata?.payment_schedule || null, // '50/50' or '100%'
      currency,
      // Store subtotal (price from CRM) as original_amount for display
      original_amount: roundBankers(amount),
      amount_pln: amountPln,
      amount_tax: roundBankers(amountTax),
      amount_tax_pln: amountTaxPln,
      tax_behavior: 'inclusive', // VAT включен в цену (рассчитывается для отображения)
      tax_rate_id: shouldApplyVat ? '23%' : null, // Только для информации, не применяется в Stripe
      status: addressValidation.valid ? 'processed' : 'pending_metadata',
      customer_email: participant.email,
      customer_name: participant.name,
      customer_type: customerType,
      company_name: crmContext?.isB2B ? crmContext.companyName : null,
      company_tax_id: crmContext?.isB2B ? crmContext.companyTaxId : null,
      company_address: crmContext?.isB2B ? crmContext.companyAddress : null,
      company_country: crmContext?.isB2B ? crmContext.companyCountry : null,
      customer_country: participant?.address?.country || crmContext?.companyCountry || null,
      address_validated: addressValidation.valid,
      address_validation_reason: addressValidation.reason || null,
      expected_vat: shouldApplyVat,
      exchange_rate: amountConversion.rate,
      exchange_rate_fetched_at: amountConversion.fetchedAt,
      payment_status: session.payment_status || null,
      payment_mode: session.mode || null,
      checkout_url: session.url || null, // Сохраняем checkout URL для уведомлений
      created_at: session.created ? new Date(session.created * 1000).toISOString() : new Date().toISOString(),
      processed_at: new Date().toISOString(),
      raw_payload: session
    };

    // ВАЖНО: Логируем итоговые данные платежа для проверки
    this.logger.info('💾 Сохранение платежа в базу данных', {
      dealId,
      sessionId: session.id,
      original_amount: roundBankers(amount),
      amount_pln: amountPln,
      amount_tax: roundBankers(amountTax),
      amount_tax_pln: amountTaxPln,
      expected_vat: shouldApplyVat,
      stripeTaxAmount: fromMinorUnit(session.total_details?.amount_tax || 0, currency),
      note: 'VAT рассчитан вручную для отображения, Stripe не удерживал налог'
    });

    // Check if payment was already processed to avoid duplicate stage updates
    const existingPayment = await this.repository.findPaymentBySessionId(session.id);
    const isNewPayment = !existingPayment;

    // Get invoice/receipt number before saving
    let invoiceNumber = null;
    let receiptNumber = null;
    
    if (session.payment_status === 'paid') {
      try {
        // For B2B: get invoice number
        if (crmContext?.isB2B) {
          let invoiceId = null;
          if (session.invoice) {
            invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
          } else {
            // Try to retrieve from Checkout Session
            const expandedSession = await this.stripe.checkout.sessions.retrieve(session.id, {
              expand: ['invoice']
            });
            if (expandedSession.invoice) {
              invoiceId = typeof expandedSession.invoice === 'string' 
                ? expandedSession.invoice 
                : expandedSession.invoice.id;
            }
          }
          
          if (invoiceId) {
            try {
              const invoice = await this.stripe.invoices.retrieve(invoiceId);
              invoiceNumber = invoice.number || null;
            } catch (err) {
              this.logger.warn('Failed to retrieve invoice number', {
                invoiceId,
                error: err.message
              });
            }
          }
        } else {
          // For B2C: get receipt number from payment intent
          if (session.payment_intent) {
            const paymentIntentId = typeof session.payment_intent === 'string' 
              ? session.payment_intent 
              : session.payment_intent.id;
            
            try {
              // Retrieve payment intent with charges expanded
              const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
                expand: ['charges']
              });
              
              // Get receipt number from latest charge
              // receipt_number is available directly on charge object, no need to expand receipt
              if (paymentIntent.charges?.data?.length > 0) {
                const charge = paymentIntent.charges.data[0];
                receiptNumber = charge.receipt_number || null;
              }
            } catch (err) {
              this.logger.warn('Failed to retrieve receipt number', {
                paymentIntentId,
                error: err.message
              });
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to get invoice/receipt number', {
          dealId,
          sessionId: session.id,
          error: error.message
        });
      }
    }
    
    // Add invoice/receipt number to payment record (if columns exist in DB)
    // These fields are optional and may not exist in older database schemas
    if (invoiceNumber !== null) {
      paymentRecord.invoice_number = invoiceNumber;
    }
    if (receiptNumber !== null) {
      paymentRecord.receipt_number = receiptNumber;
    }
    
    // Save payment (repository handles missing invoice_number/receipt_number columns automatically)
    await this.repository.savePayment(paymentRecord);
    await this.persistEventItems(session);
    await this.paymentPlanService.updatePlanFromSession(paymentRecord, session);

    // Send invoice to customer for BOTH B2B and B2C deals
    // Invoice is created for all deals to show VAT breakdown in footer
    // Check if invoice was created (invoice_creation.enabled)
    const hasCustomer = session.customer && typeof session.customer === 'string';
    const hasInvoice = session.invoice || (session.payment_status === 'paid' && hasCustomer);
    
    if (hasInvoice && session.payment_status === 'paid') {
      try {
        let invoiceId = null;
        
        // Get invoice ID from session or retrieve it from Checkout Session
        if (session.invoice) {
          invoiceId = typeof session.invoice === 'string' ? session.invoice : session.invoice.id;
        } else {
          // Try to find invoice by retrieving the Checkout Session with expanded invoice
          const expandedSession = await this.stripe.checkout.sessions.retrieve(session.id, {
            expand: ['invoice']
          });
          if (expandedSession.invoice) {
            invoiceId = typeof expandedSession.invoice === 'string' 
              ? expandedSession.invoice 
              : expandedSession.invoice.id;
          }
        }
        
        if (!invoiceId) {
          this.logger.warn('No invoice found for B2B payment', {
            dealId,
            sessionId: session.id
          });
          return;
        }
        
        const invoice = await this.stripe.invoices.retrieve(invoiceId, {
          expand: ['customer']
        });
        
        // Get customer email from invoice or customer object
        let invoiceEmail = invoice.customer_email;
        if (!invoiceEmail && invoice.customer) {
          if (typeof invoice.customer === 'object' && invoice.customer.email) {
            invoiceEmail = invoice.customer.email;
          } else if (typeof invoice.customer === 'string') {
            // Fetch customer to get email
            try {
              const customer = await this.stripe.customers.retrieve(invoice.customer);
              invoiceEmail = customer.email;
            } catch (error) {
              this.logger.warn('Failed to retrieve customer email for invoice', {
                invoiceId,
                customerId: invoice.customer,
                error: error.message
              });
            }
          }
        }
        
        // If no email in invoice, try to get from session or payment record
        if (!invoiceEmail) {
          const participant = this.getParticipant(session);
          invoiceEmail = participant.email || paymentRecord.customer_email;
        }
        
        // Store invoice URL for adding to note/message
        const invoiceUrl = invoice.hosted_invoice_url || invoice.invoice_pdf || null;
        
        // Add VAT information to invoice footer if VAT should be applied
        // This ensures VAT breakdown is visible in the invoice PDF
        if (shouldApplyVat && countryCode === 'PL' && invoice.status !== 'paid') {
          try {
            const vatRate = 0.23; // 23%
            const invoiceAmount = fromMinorUnit(invoice.amount_due || invoice.total || 0, invoice.currency || 'pln');
            const vatAmount = roundBankers(invoiceAmount * vatRate / (1 + vatRate));
            const amountExcludingVat = roundBankers(invoiceAmount - vatAmount);
            
            const vatFooter = `VAT breakdown:\nAmount excluding VAT: ${amountExcludingVat.toFixed(2)} ${invoice.currency?.toUpperCase() || 'PLN'}\nVAT (23%): ${vatAmount.toFixed(2)} ${invoice.currency?.toUpperCase() || 'PLN'}\nTotal (including VAT): ${invoiceAmount.toFixed(2)} ${invoice.currency?.toUpperCase() || 'PLN'}\n\nNote: VAT is included in the price. Stripe does not collect VAT separately.`;
            
            // Update invoice footer to show VAT breakdown
            await this.stripe.invoices.update(invoiceId, {
              footer: vatFooter
            });
            
            this.logger.info(`📊 [Deal #${dealId}] VAT information added to invoice footer`, {
              invoiceId,
              vatAmount,
              amountExcludingVat,
              totalAmount: invoiceAmount,
              currency: invoice.currency
            });
          } catch (vatUpdateError) {
            this.logger.warn(`⚠️  [Deal #${dealId}] Failed to add VAT to invoice footer`, {
              invoiceId,
              error: vatUpdateError.message
            });
          }
        }
        
        // Check if invoice needs to be sent
        // For paid invoices, we can always send them (Stripe will handle duplicates)
        if (invoice.status === 'paid' || invoice.status === 'open') {
          try {
            // Verify email is available before sending
            if (!invoiceEmail) {
              this.logger.warn(`⚠️  [Deal #${dealId}] Cannot send invoice - no email found`, {
                invoiceId,
                invoiceCustomerEmail: invoice.customer_email,
                invoiceCustomer: typeof invoice.customer === 'object' ? invoice.customer?.email : invoice.customer,
                sessionCustomerEmail: session.customer_email,
                participantEmail: this.getParticipant(session)?.email
              });
              return;
            }
            
            // Ensure Customer has email set (required for Stripe to send invoice email)
            if (invoice.customer && typeof invoice.customer === 'object' && invoice.customer.id) {
              const customerId = invoice.customer.id;
              const customerEmail = invoice.customer.email;
              
              // If customer exists but doesn't have email, update it
              if (!customerEmail && invoiceEmail) {
                try {
                  this.logger.info(`📧 [Deal #${dealId}] Updating customer email before sending invoice`, {
                    customerId,
                    email: invoiceEmail
                  });
                  await this.stripe.customers.update(customerId, {
                    email: invoiceEmail
                  });
                  this.logger.info(`✅ [Deal #${dealId}] Customer email updated`, {
                    customerId,
                    email: invoiceEmail
                  });
                } catch (updateError) {
                  this.logger.warn(`⚠️  [Deal #${dealId}] Failed to update customer email`, {
                    customerId,
                    email: invoiceEmail,
                    error: updateError.message
                  });
                }
              }
            }
            
            // Try to send invoice - Stripe will handle if already sent
            this.logger.info(`📧 [Deal #${dealId}] Sending invoice to customer via Stripe API`, {
              invoiceId,
              customerEmail: invoiceEmail,
              invoiceStatus: invoice.status,
              invoiceCustomerEmail: invoice.customer_email,
              invoiceCustomerId: typeof invoice.customer === 'object' ? invoice.customer?.id : invoice.customer,
              invoiceUrl: invoice.hosted_invoice_url || invoice.invoice_pdf,
              note: 'Stripe will send email to customer_email or customer.email. Check Stripe Dashboard → Invoices → Email delivery status'
            });
            
            // Send invoice - Stripe will send email automatically if customer_email or customer.email is set
            await this.stripe.invoices.sendInvoice(invoiceId);
            
            this.logger.info(`✅ [Deal #${dealId}] Invoice sent successfully via Stripe API`, {
              invoiceId,
              customerEmail: invoiceEmail,
              invoiceUrl: invoice.hosted_invoice_url || invoice.invoice_pdf,
              invoicePdf: invoice.invoice_pdf,
              hostedInvoiceUrl: invoice.hosted_invoice_url,
              note: 'Invoice sent. Check Stripe Dashboard → Invoices → [invoice] → Email delivery status to verify email was sent. If not received, check spam folder.'
            });
            
            // Add invoice URL to payment note if available
            if (invoiceUrl && isNewPayment) {
              // Update payment note with invoice link
              const paymentRecord = await this.repository.findPaymentBySessionId(session.id);
              if (paymentRecord) {
                await this.addPaymentNoteToDeal(dealId, {
                  paymentType: paymentRecord.payment_type || 'payment',
                  amount: paymentRecord.original_amount,
                  currency: paymentRecord.currency,
                  amountPln: paymentRecord.amount_pln,
                  sessionId: session.id,
                  invoiceUrl: invoiceUrl
                });
              }
            }
          } catch (sendError) {
            // If invoice was already sent, Stripe returns an error - that's OK
            if (sendError.code === 'invoice_already_sent' || sendError.message?.includes('already sent')) {
              this.logger.info('Invoice already sent to customer', {
                invoiceId,
                dealId
              });
              
              // Still add invoice URL to note even if already sent
              if (invoiceUrl && isNewPayment) {
                const paymentRecord = await this.repository.findPaymentBySessionId(session.id);
                if (paymentRecord) {
                  await this.addPaymentNoteToDeal(dealId, {
                    paymentType: paymentRecord.payment_type || 'payment',
                    amount: paymentRecord.original_amount,
                    currency: paymentRecord.currency,
                    amountPln: paymentRecord.amount_pln,
                    sessionId: session.id,
                    invoiceUrl: invoiceUrl
                  });
                }
              }
            } else {
              throw sendError;
            }
          }
        } else if (invoice.status === 'draft') {
          // Finalize draft invoice first, then send
          this.logger.info(`📧 [Deal #${dealId}] Finalizing and sending draft invoice`, {
            invoiceId,
            customerEmail: invoice.customer_email || (typeof invoice.customer === 'object' ? invoice.customer.email : null)
          });
          await this.stripe.invoices.finalizeInvoice(invoiceId);
          await this.stripe.invoices.sendInvoice(invoiceId);
          this.logger.info(`✅ [Deal #${dealId}] Draft invoice finalized and sent successfully`, {
            invoiceId,
            customerEmail: invoice.customer_email || (typeof invoice.customer === 'object' ? invoice.customer.email : null)
          });
        }
      } catch (invoiceError) {
        // Log but don't fail - invoice sending is not critical
        this.logger.warn('Failed to send invoice to customer', {
          dealId,
          sessionId: session.id,
          error: invoiceError.message
        });
      }
    }

    // Send receipt for B2C payments (if not already sent automatically)
    if (!isB2B && session.payment_status === 'paid') {
      try {
        const participant = this.getParticipant(session);
        const receiptEmail = participant.email || paymentRecord.customer_email;
        
        if (receiptEmail && session.payment_intent) {
          const paymentIntentId = typeof session.payment_intent === 'string' 
            ? session.payment_intent 
            : session.payment_intent.id;
          
          try {
            // Get payment intent with charges expanded
            // receipt_email is available directly on charge object, no need to expand receipt
            const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ['charges']
            });
            
            // Check if receipt email was sent
            const charge = paymentIntent.charges?.data?.[0];
            if (charge) {
              // Get VAT breakdown from metadata if available
              const vatMetadata = paymentIntent.metadata || {};
              const shouldApplyVat = vatMetadata.vat_applicable === 'true';
              let chargeDescription = charge.description || '';
              
              // Add VAT breakdown to charge description if applicable
              if (shouldApplyVat && vatMetadata.vat_rate && vatMetadata.amount_excluding_vat && vatMetadata.vat_amount) {
                const vatBreakdown = `\n\nVAT Breakdown:\nAmount excluding VAT: ${vatMetadata.amount_excluding_vat} ${vatMetadata.vat_currency || 'PLN'}\nVAT (${vatMetadata.vat_rate}): ${vatMetadata.vat_amount} ${vatMetadata.vat_currency || 'PLN'}\nTotal (including VAT): ${vatMetadata.total_including_vat} ${vatMetadata.vat_currency || 'PLN'}\n\nNote: VAT is included in the price. Stripe does not collect VAT separately.`;
                chargeDescription = (chargeDescription || 'Payment receipt') + vatBreakdown;
              }
              
              // Always set receipt_email to ensure receipt is sent
              // Stripe sends receipt automatically when receipt_email is set
              try {
                const updateParams = {
                  receipt_email: receiptEmail
                };
                
                // Add description with VAT breakdown if applicable
                if (chargeDescription && chargeDescription !== charge.description) {
                  updateParams.description = chargeDescription;
                }
                
                if (!charge.receipt_email || charge.receipt_email !== receiptEmail || (chargeDescription && chargeDescription !== charge.description)) {
                  await this.stripe.charges.update(charge.id, updateParams);
                  this.logger.info(`📧 [Deal #${dealId}] Receipt email and VAT breakdown set on charge`, {
                    dealId,
                    sessionId: session.id,
                    email: receiptEmail,
                    chargeId: charge.id,
                    hasVatBreakdown: shouldApplyVat,
                    note: 'Stripe will send receipt email automatically. VAT breakdown added to charge description. Check Stripe Dashboard → Payments → [charge] → Receipt to verify.'
                  });
                } else {
                  this.logger.info(`📧 [Deal #${dealId}] Receipt email already set on charge`, {
                    dealId,
                    sessionId: session.id,
                    email: charge.receipt_email,
                    chargeId: charge.id
                  });
                }
              } catch (receiptError) {
                this.logger.warn(`⚠️  [Deal #${dealId}] Failed to set receipt email/VAT on charge`, {
                  dealId,
                  sessionId: session.id,
                  email: receiptEmail,
                  chargeId: charge.id,
                  error: receiptError.message
                });
              }
            } else {
              this.logger.warn(`⚠️  [Deal #${dealId}] No charge found in payment intent`, {
                dealId,
                sessionId: session.id,
                paymentIntentId
              });
            }
          } catch (piError) {
            this.logger.warn('Failed to retrieve payment intent for receipt email', {
              dealId,
              sessionId: session.id,
              error: piError.message
            });
          }
        }
      } catch (receiptError) {
        // Log but don't fail - receipt sending is not critical
        this.logger.warn('Failed to send receipt email to customer', {
          dealId,
          sessionId: session.id,
          error: receiptError.message
        });
      }
    }

    // Check if payment was refunded before creating notes or updating stages
    let isRefunded = false;
    if (session.payment_intent && session.payment_status === 'paid') {
      try {
        const paymentIntentId = typeof session.payment_intent === 'string' 
          ? session.payment_intent 
          : session.payment_intent.id;
        
        // Check if refund exists in database (by dealId and sessionId)
        const deletions = await this.repository.listDeletions({
          dealId: dealId ? String(dealId) : null
        });
        
        // Filter deletions by session_id from metadata
        const sessionDeletions = deletions.filter(d => {
          const metadata = d.metadata || {};
          const rawPayload = d.raw_payload || {};
          const payloadSession = rawPayload.session || {};
          return payloadSession.id === session.id || metadata.session_id === session.id;
        });
        
        if (sessionDeletions && sessionDeletions.length > 0) {
          isRefunded = true;
          this.logger.info('Payment was refunded, skipping note creation and stage update', {
            dealId,
            sessionId: session.id,
            paymentIntentId,
            deletionCount: sessionDeletions.length
          });
        } else {
          // Also check in Stripe directly
          try {
            const refunds = await this.stripe.refunds.list({
              payment_intent: paymentIntentId,
              limit: 1
            });
            if (refunds.data && refunds.data.length > 0) {
              isRefunded = true;
              this.logger.info('Payment was refunded in Stripe, skipping note creation and stage update', {
                dealId,
                sessionId: session.id,
                paymentIntentId,
                refundId: refunds.data[0].id
              });
            }
          } catch (refundCheckError) {
            // If we can't check refunds, continue (don't block processing)
            this.logger.warn('Failed to check refunds in Stripe', {
              dealId,
              sessionId: session.id,
              error: refundCheckError.message
            });
          }
        }
      } catch (deletionCheckError) {
        // If we can't check deletions, continue (don't block processing)
        this.logger.warn('Failed to check payment deletions', {
          dealId,
          sessionId: session.id,
          error: deletionCheckError.message
        });
      }
    }

    // Only update deal stage if this is a new payment (not a re-processing) and not refunded
    if (dealId && isNewPayment && !isRefunded) {
      const paymentType = session.metadata?.payment_type || 'payment';
      const isFinal = session.metadata?.is_final === 'true' || paymentType === 'final';
      // 'single' payment type means it's the only payment (should go to Camp Waiter)
      const isFirst = paymentType === 'deposit' || paymentType === 'first' || paymentType === 'single';
      const isRest = paymentType === 'rest' || paymentType === 'second';
      
      // First, check if both payments are already paid (for any payment type)
      // This handles the case where both payments are paid but stage wasn't updated
      try {
        const allPayments = await this.repository.listPayments({ dealId: String(dealId) });
        const paidPayments = allPayments.filter(p => 
          p.payment_status === 'paid' || p.session_id === session.id
        );
        
        // Add current payment if it's paid but not yet in DB
        if (session.payment_status === 'paid' && !allPayments.some(p => p.session_id === session.id)) {
          paidPayments.push({
            session_id: session.id,
            payment_type: paymentType,
            payment_status: 'paid',
            deal_id: String(dealId)
          });
        }
        
        const depositPayment = paidPayments.find(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') && 
          (p.payment_status === 'paid' || (p.session_id === session.id && isFirst && session.payment_status === 'paid'))
        );
        const restPayment = paidPayments.find(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') && 
          (p.payment_status === 'paid' || (p.session_id === session.id && isRest && session.payment_status === 'paid'))
        );
        
        // Check if both payments are paid (including current payment if it's paid)
        const hasDeposit = !!depositPayment || (isFirst && session.payment_status === 'paid');
        const hasRest = !!restPayment || (isRest && session.payment_status === 'paid');
        const hasBothPayments = hasDeposit && hasRest;
        
        if (hasBothPayments) {
          // Both payments are paid - move to Camp Waiter regardless of current payment type
          const depositSessionId = depositPayment?.session_id || (isFirst ? session.id : null);
          const restSessionId = restPayment?.session_id || (isRest ? session.id : null);
          
          this.logger.info(`✅ [Deal #${dealId}] Both payments confirmed paid - moving to Camp Waiter (stage ${STAGES.CAMP_WAITER_ID})`, {
            depositPaymentId: depositSessionId,
            restPaymentId: restSessionId,
            currentPaymentType: paymentType,
            stageId: STAGES.CAMP_WAITER_ID,
            hasDeposit,
            hasRest
          });
          
          await this.triggerCrmStatusAutomation(dealId, {
            reason: 'stripe:both-payments-complete'
          });
          
          await this.closeAddressTasks(dealId);
          
          // Add note for current payment
          await this.addPaymentNoteToDeal(dealId, {
            paymentType: isRest ? 'rest' : 'deposit',
            amount: paymentRecord.original_amount,
            currency: paymentRecord.currency,
            amountPln: paymentRecord.amount_pln,
            sessionId: session.id
          });
          
          // Add special note that all payments are complete
          await this.addAllPaymentsCompleteNote(dealId, {
            depositPayment,
            restPayment,
            depositSessionId: depositSessionId,
            restSessionId: restSessionId
          });
          
          // Exit early - stage already updated to Camp Waiter
          return;
        } else {
          this.logger.debug(`ℹ️  [Deal #${dealId}] Not all payments paid yet, continuing with individual payment logic`, {
            hasDeposit,
            hasRest,
            currentPaymentType: paymentType,
            currentPaymentStatus: session.payment_status
          });
        }
      } catch (checkError) {
        this.logger.warn(`⚠️  [Deal #${dealId}] Failed to check both payments status, continuing with individual payment logic`, {
          error: checkError.message
        });
        // Continue with individual payment logic below
      }

      // Get deal to check close_date for single payment logic and current stage
      let isSinglePaymentExpected = false;
      let currentDealStageId = null;
      try {
        const dealResult = await this.pipedriveClient.getDeal(dealId);
        if (dealResult.success && dealResult.deal) {
          currentDealStageId = dealResult.deal.stage_id;
          const closeDate = dealResult.deal.expected_close_date || dealResult.deal.close_date;
          if (closeDate) {
            const expectedCloseDate = new Date(closeDate);
            const today = new Date();
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            // If < 30 days, only one payment is expected
            isSinglePaymentExpected = daysDiff < 30;
          }
        }
      } catch (error) {
        this.logger.warn('Failed to check deal close_date for payment logic', {
          dealId,
          error: error.message
        });
      }

      // Logic for stage updates:
      // 1. If deal is in "First payment" stage → Camp Waiter (stage 27) - оплата при одном платеже
      // 2. If rest/second payment → Camp Waiter (stage 27) - второй платеж из двух
      // 3. If first payment AND single payment expected → Camp Waiter (stage 27)
      // 4. If first payment AND two payments expected → Second Payment (stage 32) - ждем второй платеж
      // 5. If final flag → Camp Waiter (stage 27)

      // Если сделка уже в стадии "First payment" и приходит оплата → Camp Waiter (один платеж)
      // Проверяем по ID: 18 (основной пайплайн) или 37 (другой пайплайн)
      const FIRST_PAYMENT_STAGE_IDS = [STAGES.FIRST_PAYMENT_ID, 37];
      if (FIRST_PAYMENT_STAGE_IDS.includes(currentDealStageId)) {
        await this.triggerCrmStatusAutomation(dealId, {
          reason: 'stripe:first-stage-paid'
        });
        
        // Close address tasks if payment received
        await this.closeAddressTasks(dealId);
        
        // Add note to deal about payment
        await this.addPaymentNoteToDeal(dealId, {
          paymentType: 'payment',
          amount: paymentRecord.original_amount,
          currency: paymentRecord.currency,
          amountPln: paymentRecord.amount_pln,
          sessionId: session.id
        });
      } else if (isFinal || isRest) {
        // Second payment (rest) or final payment - check if both payments are paid before moving to Camp Waiter
        this.logger.info(`🔍 [Deal #${dealId}] Checking if both payments are paid before moving to Camp Waiter (stage ${STAGES.CAMP_WAITER_ID})...`, {
          paymentType,
          sessionId: session.id,
          isRest,
          isFinal
        });
        
        // Check if both deposit and rest payments are paid
        // Include current payment in check (it's being processed now and will be saved)
        const allPayments = await this.repository.listPayments({ dealId: String(dealId) });
        
        // Add current payment to the list if it's not already there (it might not be saved yet)
        const currentPaymentIncluded = allPayments.some(p => p.session_id === session.id);
        if (!currentPaymentIncluded && session.payment_status === 'paid') {
          // Current payment is paid but not yet in DB - add it to check
          allPayments.push({
            session_id: session.id,
            payment_type: paymentType,
            payment_status: 'paid',
            deal_id: String(dealId)
          });
        }
        
        const paidPayments = allPayments.filter(p => 
          p.payment_status === 'paid' || p.session_id === session.id
        );
        
        const depositPayment = paidPayments.find(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') && 
          p.payment_status === 'paid'
        );
        const restPayment = paidPayments.find(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') && 
          (p.payment_status === 'paid' || p.session_id === session.id)
        );
        
        const hasDeposit = !!depositPayment;
        const hasRest = !!restPayment || (isRest && session.payment_status === 'paid');
        
        this.logger.info(`📊 [Deal #${dealId}] Payment status check for Camp Waiter transition`, {
          totalPayments: allPayments.length,
          paidPayments: paidPayments.length,
          hasDeposit,
          hasRest,
          depositPaymentId: depositPayment?.session_id || null,
          restPaymentId: restPayment?.session_id || (isRest ? session.id : null),
          currentPaymentType: paymentType,
          currentPaymentStatus: session.payment_status,
          currentSessionId: session.id
        });
        
        // Only move to Camp Waiter if both payments are paid
        if (hasDeposit && hasRest) {
          this.logger.info(`✅ [Deal #${dealId}] Both payments paid - moving to Camp Waiter (stage ${STAGES.CAMP_WAITER_ID})`, {
            depositPaymentId: depositPayment.session_id,
            restPaymentId: restPayment?.session_id || session.id,
            stageId: STAGES.CAMP_WAITER_ID
          });
          await this.triggerCrmStatusAutomation(dealId, {
            reason: 'stripe:final-payment'
          });
          
          // Close address tasks if payment received
          await this.closeAddressTasks(dealId);
          
          // Add note for current payment
          await this.addPaymentNoteToDeal(dealId, {
            paymentType: isRest ? 'rest' : 'deposit',
            amount: paymentRecord.original_amount,
            currency: paymentRecord.currency,
            amountPln: paymentRecord.amount_pln,
            sessionId: session.id
          });
          
          // Add special note that all payments are complete
          await this.addAllPaymentsCompleteNote(dealId, {
            depositPayment,
            restPayment,
            depositSessionId: depositPayment.session_id,
            restSessionId: restPayment?.session_id || session.id
          });
        } else {
          this.logger.warn(`⚠️  [Deal #${dealId}] Cannot move to Camp Waiter - missing payments`, {
            hasDeposit,
            hasRest,
            expectedPayments: 2,
            currentPaymentType: paymentType,
            allPaymentsDetails: allPayments.map(p => ({
              sessionId: p.session_id,
              paymentType: p.payment_type,
              paymentStatus: p.payment_status,
              isCurrent: p.session_id === session.id
            }))
          });
          
          // If deposit is missing but rest is paid, something is wrong - log it
          if (!hasDeposit && hasRest) {
            this.logger.error(`❌ [Deal #${dealId}] Rest payment received but deposit payment not found!`, {
              allPayments: allPayments.map(p => ({
                sessionId: p.session_id,
                paymentType: p.payment_type,
                paymentStatus: p.payment_status
              }))
            });
          }
          
          // If rest payment is received but deposit is missing, stay in Second Payment stage
          // If both are missing (shouldn't happen), also stay in Second Payment
          if (!hasDeposit) {
            this.logger.info(`⏸️  [Deal #${dealId}] Waiting for deposit payment - staying in Second Payment stage (${STAGES.SECOND_PAYMENT_ID})`);
            await this.triggerCrmStatusAutomation(dealId, {
              reason: 'stripe:rest-awaits-deposit'
            });
          }
        }
      } else if (isFirst) {
        // For 'single' payment type, always go to Camp Waiter (it's the only payment)
        if (paymentType === 'single' || isSinglePaymentExpected) {
          // Single payment expected (< 30 days) or 'single' type - move directly to Camp Waiter
          await this.triggerCrmStatusAutomation(dealId, {
            reason: 'stripe:single-payment'
          });
          
          // Close address tasks if payment received
          await this.closeAddressTasks(dealId);
        } else {
          // First payment of two (>= 30 days) - move to Second Payment stage (ждем второй платеж)
          await this.triggerCrmStatusAutomation(dealId, {
            reason: 'stripe:first-payment'
          });
        }

        // Add note to deal about payment (for all first payments including 'single')
        await this.addPaymentNoteToDeal(dealId, {
          paymentType: paymentType === 'single' ? 'payment' : 'deposit',
          amount: paymentRecord.original_amount,
          currency: paymentRecord.currency,
          amountPln: paymentRecord.amount_pln,
          sessionId: session.id
        });
      } else {
        // Fallback: unknown payment type, move to Second Payment stage
        await this.triggerCrmStatusAutomation(dealId, {
          reason: 'stripe:unknown-payment-type'
        });
      }
    } else if (dealId && !isNewPayment && !isRefunded) {
      // Payment was already processed, but check if status needs correction
      // For 'single' payment type, ensure it goes to Camp Waiter
      const paymentType = session.metadata?.payment_type || 'payment';
      if (paymentType === 'single') {
        // Check current deal stage and correct if needed
        try {
          const dealResult = await this.pipedriveClient.getDeal(dealId);
          if (dealResult.success && dealResult.deal) {
            const currentStageId = dealResult.deal.stage_id;
            // If not in Camp Waiter, correct it
            if (currentStageId !== STAGES.CAMP_WAITER_ID) {
              this.logger.info('Correcting deal stage for single payment', {
                dealId,
                currentStage: currentStageId,
                expectedStage: STAGES.CAMP_WAITER_ID
              });
              await this.triggerCrmStatusAutomation(dealId, {
                reason: 'stripe:single-payment-correction'
              });
              
              // Also add note if it doesn't exist (always add for single payment correction)
              // But only if payment is not refunded
              if (!isRefunded) {
                try {
                  await this.addPaymentNoteToDeal(dealId, {
                    paymentType: 'payment',
                    amount: paymentRecord.original_amount,
                    currency: paymentRecord.currency,
                    amountPln: paymentRecord.amount_pln,
                    sessionId: session.id
                  });
                } catch (noteError) {
                  // Note might already exist, that's OK
                  this.logger.debug('Note may already exist or failed to create', {
                    dealId,
                    error: noteError.message
                  });
                }
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to correct deal stage for single payment', {
            dealId,
            error: error.message
          });
        }
      } else {
        // Skip stage update for other payment types to avoid chaos
        this.logger.debug('Skipping stage update for already processed payment', {
          dealId,
          sessionId: session.id
        });
      }
    }
  }

  async getCrmContext(dealId) {
    if (!dealId) return null;
    if (this.crmCache.has(dealId)) {
      return this.crmCache.get(dealId);
    }

    const context = {
      deal: null,
      person: null,
      organization: null,
      isB2B: false,
      companyName: null,
      companyTaxId: null,
      companyAddress: null,
      companyCountry: null,
      addressParts: null
    };

    try {
      const dealResponse = await this.pipedriveClient.getDeal(dealId);
      if (!dealResponse.success) {
        // 404 для удаленной сделки - это ожидаемая ситуация, логируем как debug
        if (dealResponse.isNotFound) {
          this.logger.debug('Deal not found (likely deleted), skipping CRM context', { dealId });
        } else {
          this.logger.warn('Failed to load deal for Stripe payment', { dealId, error: dealResponse.error });
        }
        this.crmCache.set(dealId, null);
        return null;
      }

      const deal = dealResponse.deal;
      context.deal = deal;

      const personId = this.extractPipedriveId(deal?.person_id);
      const orgId = this.extractPipedriveId(deal?.org_id);

      if (personId) {
        const personResponse = await this.pipedriveClient.getPerson(personId);
        if (personResponse.success) {
          context.person = personResponse.person;
        }
      }

      if (orgId) {
        const orgResponse = await this.pipedriveClient.getOrganization(orgId);
        if (orgResponse.success) {
          context.organization = orgResponse.organization;
        }
      }

      context.isB2B = Boolean(context.organization);
      const addressParts = this.extractAddressParts(context);
      context.addressParts = addressParts;
      context.companyAddress = this.formatAddress(addressParts);
      context.companyCountry = this.extractCountryCode(addressParts);
      context.companyName = this.extractCompanyName(context);
      context.companyTaxId = this.extractTaxId(context.organization);

      this.crmCache.set(dealId, context);
      return context;
    } catch (error) {
      // 404 для удаленной сделки - это ожидаемая ситуация, не ошибка
      const isNotFound = error.response?.status === 404 || error.message?.includes('404') || error.message?.includes('not found');
      if (isNotFound) {
        this.logger.debug('Deal not found (likely deleted), skipping CRM context', { dealId });
      } else {
        this.logger.error('Failed to load CRM context for Stripe payment', {
          dealId,
          error: error.message
        });
      }
      this.crmCache.set(dealId, null);
      return null;
    }
  }

  extractPipedriveId(value) {
    if (!value) return null;
    if (typeof value === 'object' && value.value) return value.value;
    if (typeof value === 'string' || typeof value === 'number') return value;
    return null;
  }

  extractCompanyName(context) {
    if (context.organization?.name) return String(context.organization.name).trim();
    if (context.deal?.org_name) return String(context.deal.org_name).trim();
    return null;
  }

  extractTaxId(organization) {
    if (!organization) return null;
    const candidates = [
      organization.nip,
      organization.tax_id,
      organization.taxId,
      organization.vat_number,
      organization.vatNumber,
      organization.value?.tax_id,
      organization.value?.nip
    ].filter(Boolean);

    // Check custom_fields if they exist
    if (organization.custom_fields && typeof organization.custom_fields === 'object') {
      Object.entries(organization.custom_fields).forEach(([key, value]) => {
        if (!value) return;
        const normalisedKey = key.toLowerCase();
        if (normalisedKey.includes('nip') || normalisedKey.includes('tax')) {
          candidates.push(value);
        }
      });
    }

    // Check all fields in organization object for NIP/tax fields
    // Pipedrive API returns custom fields directly in the organization object
    // Standard Pipedrive fields to exclude from search
    const standardFields = new Set([
      'id', 'name', 'owner_id', 'open_deals_count', 'related_open_deals_count',
      'closed_deals_count', 'related_closed_deals_count', 'email_messages_count',
      'people_count', 'activities_count', 'done_activities_count', 'undone_activities_count',
      'files_count', 'notes_count', 'followers_count', 'won_deals_count', 'related_won_deals_count',
      'lost_deals_count', 'related_lost_deals_count', 'active_flag', 'picture_id', 'country_code',
      'first_char', 'update_time', 'delete_time', 'add_time', 'visible_to', 'next_activity_date',
      'next_activity_time', 'next_activity_id', 'last_activity_id', 'last_activity_date',
      'label', 'label_ids', 'address', 'address_subpremise', 'address_street_number',
      'address_route', 'address_sublocality', 'address_locality', 'address_admin_area_level_1',
      'address_admin_area_level_2', 'address_country', 'address_postal_code', 'address_formatted_address',
      'website', 'linkedin', 'industry', 'annual_revenue', 'employee_count', 'cc_email',
      'owner_name', 'edit_name', 'last_activity', 'next_activity', 'company_id', 'custom_fields'
    ]);
    
    Object.entries(organization).forEach(([key, value]) => {
      if (!value) return;
      const normalisedKey = key.toLowerCase();
      
      // Check if field name contains nip/tax
      if (normalisedKey.includes('nip') || normalisedKey.includes('tax')) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          if (trimmed.length > 0) {
            candidates.push(trimmed);
          }
        }
      }
      
      // Check custom fields (long hash-like keys) - they might contain NIP
      // Custom fields in Pipedrive are typically 40-character hex strings
      if (key.length === 40 && /^[a-f0-9]+$/i.test(key)) {
        if (typeof value === 'string') {
          const trimmed = value.trim();
          // NIP is typically 9-10 digits, sometimes with dashes
          if (trimmed.length >= 9 && trimmed.length <= 15 && /^[\d\-\s]+$/.test(trimmed)) {
            candidates.push(trimmed);
          }
        }
      }
    });

    const taxId = candidates.find((candidate) => {
      if (typeof candidate !== 'string') return false;
      const trimmed = candidate.trim();
      return trimmed.length > 0;
    });

    return taxId ? taxId.trim() : null;
  }

  extractAddressParts(context) {
    // Если context равен null или undefined, возвращаем пустые части адреса
    if (!context) {
      return {
        line1: null,
        line2: null,
        postalCode: null,
        city: null,
        state: null,
        country: null
      };
    }
    
    const organization = context.organization || {};
    const person = context.person || {};
    const deal = context.deal || {};

    const fromOrganization = {
      // Construct line1 from route + street number, or use formatted address
      line1: (organization.address_route && organization.address_street_number 
        ? `${organization.address_route} ${organization.address_street_number}` 
        : null) || organization.address || organization.address_street || organization.street_address || null,
      line2: organization.address_subpremise || organization.address_line_2 || organization.address_line2 || null,
      postalCode: organization.address_postal_code || organization.postal_code || organization.zip || organization.post_code || null,
      city: organization.address_locality || organization.city || organization.address_city || null,
      state: organization.address_admin_area_level_1 || organization.state || organization.region || null,
      country: organization.address_country || organization.country || null
    };

    const fromPerson = {
      line1: person.postal_address || person.postal_address_route || null,
      line2: person.postal_address_street_number || person.postal_address_neighborhood || null,
      postalCode: person.postal_address_postal_code || null,
      city: person.postal_address_locality || null,
      state: person.postal_address_admin_area_level_1 || null,
      country: person.postal_address_country || null
    };

    const fromDeal = {
      line1: deal.address || deal.address_street || null,
      line2: deal.address_line2 || null,
      postalCode: deal.zip || deal.address_postal_code || null,
      city: deal.city || null,
      state: deal.state || null,
      country: deal.country || deal.country_code || null
    };

    let parts = {
      line1: fromOrganization.line1 || fromDeal.line1 || fromPerson.line1 || null,
      line2: fromOrganization.line2 || fromDeal.line2 || fromPerson.line2 || null,
      postalCode: fromOrganization.postalCode || fromDeal.postalCode || fromPerson.postalCode || null,
      city: fromOrganization.city || fromDeal.city || fromPerson.city || null,
      state: fromOrganization.state || fromDeal.state || fromPerson.state || null,
      country: fromOrganization.country || fromDeal.country || fromPerson.country || null
    };

    // Clean up: if line2 is part of line1 (e.g., duplicate street number), remove it
    if (parts.line1 && parts.line2) {
      const line1Lower = parts.line1.toLowerCase().trim();
      const line2Lower = parts.line2.toLowerCase().trim();
      // If line2 appears in line1, clear line2
      if (line1Lower.includes(line2Lower) && line2Lower.length > 0) {
        parts.line2 = null;
      }
    }

    return parts;
  }

  extractCountryCode(parts = {}) {
    const country = parts.country || null;
    if (!country) return null;
    
    return this.normalizeCountryCode(country);
  }

  normalizeCountryCode(country) {
    if (!country) return null;
    
    const countryMap = {
      // Польские названия из wFirma -> ISO коды
      'Polska': 'PL',
      'Niemcy': 'DE',
      'Francja': 'FR',
      'Wielka Brytania': 'GB',
      'Stany Zjednoczone': 'US',
      'Czechy': 'CZ',
      'Litwa': 'LT',
      'Łotwa': 'LV',
      'Estonia': 'EE',
      
      // Английские названия из CRM -> ISO коды
      'Poland': 'PL',
      'Germany': 'DE',
      'Deutschland': 'DE',
      'France': 'FR',
      'United Kingdom': 'GB',
      'UK': 'GB',
      'United States': 'US',
      'USA': 'US',
      'Czech Republic': 'CZ',
      'Lithuania': 'LT',
      'Latvia': 'LV',
      'Estonia': 'EE',
      'Portugal': 'PT',
      'Spain': 'ES',
      'Italy': 'IT',
      'Netherlands': 'NL',
      'Belgium': 'BE',
      'Austria': 'AT',
      'Switzerland': 'CH',
      'Sweden': 'SE',
      'Norway': 'NO',
      'Denmark': 'DK',
      'Finland': 'FI',
      'Ukraine': 'UA',
      'Україна': 'UA',
      'Ukraina': 'UA'
    };
    
    const trimmed = String(country).trim();
    
    // Если уже двухбуквенный код
    if (trimmed.length === 2) {
      return trimmed.toUpperCase();
    }
    
    // Ищем в мапе (case-insensitive)
    const normalized = countryMap[trimmed] || countryMap[trimmed.toLowerCase()];
    if (normalized) {
      return normalized;
    }
    
    // Если не найдено, возвращаем null (не PL по умолчанию)
    return null;
  }

  formatAddress(parts = {}) {
    const segments = [
      parts.line1,
      parts.line2,
      [parts.postalCode, parts.city].filter(Boolean).join(' '),
      parts.state,
      parts.country
    ].filter((segment) => {
      if (!segment) return false;
      const value = String(segment).trim();
      return value.length > 0;
    });

    return segments.join(', ') || null;
  }

  /**
   * Ensure Poland VAT Tax Rate (23%) exists in Stripe.
   * Creates it if it doesn't exist, or returns existing one.
   * @returns {Promise<string>} Tax Rate ID
   */
  async ensurePolandTaxRate() {
    try {
      // Search for existing Poland VAT 23% tax rate
      const existingRates = await this.stripe.taxRates.list({
        limit: 100,
        active: true
      });

      // Look for Poland VAT 23% rate (inclusive - price already includes VAT)
          // Always prefer inclusive tax rate (VAT already included in price)
          const polandVatRate = existingRates.data.find(
            rate => rate.percentage === 23 && 
            rate.inclusive === true && // MUST be inclusive
            (rate.country === 'PL' || 
             rate.display_name?.toLowerCase().includes('vat') || 
             rate.display_name?.toLowerCase().includes('nds') ||
             rate.display_name?.toLowerCase().includes('poland'))
          );

      if (polandVatRate) {
        this.logger.info('Found existing Poland VAT Tax Rate', {
          taxRateId: polandVatRate.id,
          percentage: polandVatRate.percentage
        });
        return polandVatRate.id;
      }

      // Create new Poland VAT 23% tax rate (inclusive - price already includes VAT)
      // This ensures the final amount matches CRM price (1000 PLN stays 1000 PLN total)
      const newTaxRate = await this.stripe.taxRates.create({
        display_name: 'VAT Poland',
        description: 'VAT 23% для Польши (включен в цену)',
        percentage: 23,
        inclusive: true, // Price already includes VAT - final amount stays the same as CRM
        country: 'PL',
        active: true
      });

      this.logger.info('Created Poland VAT Tax Rate', {
        taxRateId: newTaxRate.id,
        percentage: newTaxRate.percentage
      });

      return newTaxRate.id;
    } catch (error) {
      this.logger.error('Failed to ensure Poland Tax Rate', {
        error: error.message,
        context: 'ensurePolandTaxRate'
      });
      throw error;
    }
  }

  /**
   * Create or get Stripe Customer for B2B companies
   * Ensures company details (name, tax ID, address) appear in Stripe invoices
   */
  async ensureStripeCustomer({ email, name, taxId, address, dealId }) {
    if (!email) {
      this.logger.warn('Cannot create Stripe Customer without email', { dealId });
      return null;
    }

    try {
      // Normalize country code for Stripe (must be ISO 2-letter code)
      let countryCode = null;
      if (address?.country) {
        countryCode = this.normalizeCountryCode(address.country);
        if (!countryCode) {
          this.logger.warn('Failed to normalize country code', {
            dealId,
            country: address.country
          });
        }
      }

      // Search for existing customer by email
      const existingCustomers = await this.stripe.customers.list({
        email: email,
        limit: 1
      });

      let customer;
      if (existingCustomers.data.length > 0) {
        // Update existing customer with latest company details
        customer = existingCustomers.data[0];
        const updateParams = {
          name: name || customer.name,
          metadata: {
            ...customer.metadata,
            deal_id: String(dealId),
            updated_by: 'stripe_processor',
            mode: this.mode
          }
        };

        // Add address if provided (country must be ISO 2-letter code)
        if (address?.line1 && countryCode) {
          updateParams.address = {
            line1: address.line1,
            line2: address.line2 || undefined,
            postal_code: address.postalCode || undefined,
            city: address.city || undefined,
            state: address.state || undefined,
            country: countryCode
          };
        }

        // Add tax ID if provided (especially important for Polish companies)
        // Note: Tax ID is optional - Customer will be created even if Tax ID is invalid
        if (taxId) {
          updateParams.metadata.company_tax_id = taxId;
          
          // Try to add Tax ID, but don't fail if it's invalid
          try {
            // Format tax ID for Stripe: Polish NIP needs PL prefix for eu_vat type
            let formattedTaxId = taxId.trim();
            if (countryCode === 'PL' && !formattedTaxId.toUpperCase().startsWith('PL')) {
              formattedTaxId = `PL${formattedTaxId}`;
            }
            
            // Check if tax ID already exists
            const existingTaxIds = await this.stripe.customers.listTaxIds(customer.id, { limit: 10 });
            const hasTaxId = existingTaxIds.data.some(t => t.value === formattedTaxId || t.value === taxId);
            
            if (!hasTaxId) {
              // Determine tax ID type based on normalized country code
              // For Polish companies, use eu_vat (Stripe doesn't have pl_nip type)
              const taxIdType = countryCode === 'PL' ? 'eu_vat' : 'eu_vat';
              // Add tax ID to customer
              await this.stripe.customers.createTaxId(customer.id, {
                type: taxIdType,
                value: formattedTaxId
              });
              this.logger.info('Added tax ID to Stripe Customer', {
                customerId: customer.id,
                taxId: formattedTaxId,
                taxIdType,
                dealId
              });
            }
          } catch (taxError) {
            // Log but don't fail - tax ID might be invalid format (e.g., test NIP)
            // Customer will still be created/updated without Tax ID
            this.logger.warn('Failed to add tax ID to Stripe Customer (continuing without it)', {
              customerId: customer.id,
              taxId,
              error: taxError.message,
              dealId
            });
          }
        }

        // Ensure email is updated in customer
        if (email && customer.email !== email) {
          updateParams.email = email;
        }
        
        // Update customer (even if Tax ID failed)
        customer = await this.stripe.customers.update(customer.id, updateParams);
        this.logger.info('Updated existing Stripe Customer', {
          customerId: customer.id,
          email: customer.email || email,
          dealId
        });
      } else {
        // Create new customer
        const createParams = {
          email: email,
          name: name || 'Company',
          metadata: {
            deal_id: String(dealId),
            created_by: 'stripe_processor',
            mode: this.mode
          }
        };

        // Add address if provided (country must be ISO 2-letter code)
        if (address?.line1 && countryCode) {
          createParams.address = {
            line1: address.line1,
            line2: address.line2 || undefined,
            postal_code: address.postalCode || undefined,
            city: address.city || undefined,
            state: address.state || undefined,
            country: countryCode
          };
        }

        // Add tax ID to metadata
        if (taxId) {
          createParams.metadata.company_tax_id = taxId;
        }

        customer = await this.stripe.customers.create(createParams);
        this.logger.info('Created new Stripe Customer', {
          customerId: customer.id,
          email,
          dealId
        });

        // Add tax ID separately if provided (for Polish companies)
        if (taxId) {
          try {
            // Format tax ID for Stripe: Polish NIP needs PL prefix for eu_vat type
            let formattedTaxId = taxId.trim();
            if (countryCode === 'PL' && !formattedTaxId.toUpperCase().startsWith('PL')) {
              formattedTaxId = `PL${formattedTaxId}`;
            }
            
            // Determine tax ID type based on normalized country code
            // For Polish companies, use eu_vat (Stripe doesn't have pl_nip type)
            const taxIdType = countryCode === 'PL' ? 'eu_vat' : 'eu_vat';
            await this.stripe.customers.createTaxId(customer.id, {
              type: taxIdType,
              value: formattedTaxId
            });
            this.logger.info('Added tax ID to new Stripe Customer', {
              customerId: customer.id,
              taxId: formattedTaxId,
              taxIdType,
              dealId
            });
          } catch (taxError) {
            // Log but don't fail - tax ID might be invalid format
            this.logger.warn('Failed to add tax ID to Stripe Customer', {
              customerId: customer.id,
              taxId,
              error: taxError.message,
              dealId
            });
          }
        }
      }

      return customer.id;
    } catch (error) {
      this.logger.error('Failed to ensure Stripe Customer', {
        email,
        dealId,
        error: error.message
      });
      return null;
    }
  }

  shouldApplyVat({ customerType, companyCountry, sessionCountry }) {
    if (customerType === 'organization') {
      if (!companyCountry) return false;
      return companyCountry.toUpperCase() === 'PL';
    }

    // B2C — всегда рассчитываем VAT
    if (sessionCountry) return true;
    return true;
  }

  async ensureAddress({ dealId, shouldApplyVat, participant, crmContext }) {
    this.logger.info('Checking address for deal', {
      dealId,
      shouldApplyVat,
      hasParticipant: !!participant,
      hasCrmContext: !!crmContext
    });
    
    if (!shouldApplyVat) {
      this.logger.info('VAT not required, skipping address check', { dealId });
      return { valid: true };
    }

    const customerAddress = participant?.address || {};
    const crmAddressParts = crmContext?.addressParts || {};
    const companyAddress = this.formatAddress(crmAddressParts);

    const hasStripeAddress = Boolean(
      customerAddress?.line1 &&
      customerAddress?.postalCode &&
      (customerAddress?.city || customerAddress?.state) &&
      customerAddress?.country
    );

    const hasCrmAddress = Boolean(
      crmAddressParts.line1 &&
      crmAddressParts.postalCode &&
      (crmAddressParts.city || crmAddressParts.state) &&
      crmAddressParts.country
    );

    this.logger.info('Address validation result', {
      dealId,
      hasStripeAddress,
      hasCrmAddress,
      hasCompanyAddress: !!companyAddress,
      customerAddress: customerAddress ? {
        line1: customerAddress.line1,
        postalCode: customerAddress.postalCode,
        city: customerAddress.city,
        country: customerAddress.country
      } : null,
      crmAddressParts: crmAddressParts ? {
        line1: crmAddressParts.line1,
        postalCode: crmAddressParts.postalCode,
        city: crmAddressParts.city,
        country: crmAddressParts.country
      } : null
    });

    if (hasStripeAddress || hasCrmAddress || companyAddress) {
      return { valid: true };
    }

    if (dealId && !this.addressTaskCache.has(dealId)) {
      this.logger.info('Creating address task for deal', { dealId });
      await this.createAddressTask(dealId);
      this.addressTaskCache.add(dealId);
    } else if (dealId && this.addressTaskCache.has(dealId)) {
      this.logger.info('Address task already created for deal (cached)', { dealId });
    }

    return {
      valid: false,
      reason: 'missing_address'
    };
  }

  async createAddressTask(dealId) {
    if (!dealId) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: 'Stripe: заполнить адрес для расчёта VAT',
        due_date: today,
        type: 'task',
        note: 'Страйп-процессор не нашёл адрес клиента. Заполните адрес (страна, город, индекс) и пересоздайте оплату/инвойс.'
      });
      this.logger.info('Created CRM task for missing address', { dealId });
    } catch (error) {
      this.logger.error('Failed to create CRM task for missing address', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Check if CRM already contains an open webhook failure task for the same session
   * @param {number|string} dealId
   * @param {string} sessionId
   * @returns {Promise<boolean>}
   */
  async hasExistingWebhookFailureTask(dealId, sessionId) {
    if (!dealId || !sessionId) {
      return false;
    }

    try {
      const tasksResult = await this.pipedriveClient.getDealActivities(dealId, 'task');
      if (!tasksResult?.success || !Array.isArray(tasksResult.activities)) {
        return false;
      }

      const normalizedSessionId = String(sessionId).trim();
      const subjectNeedle = 'Проверить обработку Stripe платежа';

      return tasksResult.activities.some((task) => {
        if (!task || task.done === 1) {
          return false;
        }

        const subject = task.subject || '';
        if (!subject.includes(subjectNeedle)) {
          return false;
        }

        const noteCandidates = [
          task.note,
          task.long_note,
          task.note_preview,
          task.note_plain,
          task.note_clean
        ].filter(Boolean);

        const noteText = noteCandidates.join(' ');
        if (!normalizedSessionId) {
          return true;
        }

        return subject.includes(normalizedSessionId) || noteText.includes(normalizedSessionId);
      });
    } catch (error) {
      this.logger.warn('Failed to check existing webhook failure tasks', {
        dealId,
        sessionId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Close address tasks for a deal after payment is received
   * @param {number} dealId - Deal ID
   */
  async closeAddressTasks(dealId) {
    if (!dealId) return;
    
    try {
      // Get all tasks for the deal
      const tasksResult = await this.pipedriveClient.getDealActivities(dealId, 'task');
      if (!tasksResult.success || !tasksResult.activities) {
        return;
      }

      // Find address tasks by subject
      const addressTasks = tasksResult.activities.filter(task => 
        task.subject && task.subject.includes('Stripe: заполнить адрес для расчёта VAT')
      );

      if (addressTasks.length === 0) {
        this.logger.debug('No address tasks found to close', { dealId });
        return;
      }

      // Close each address task
      for (const task of addressTasks) {
        try {
          // Mark task as done by setting done_date
          await this.pipedriveClient.updateActivity(task.id, {
            done: 1,
            done_date: new Date().toISOString().split('T')[0]
          });
          this.logger.info('Closed address task after payment', {
            dealId,
            taskId: task.id,
            taskSubject: task.subject
          });
        } catch (error) {
          this.logger.warn('Failed to close address task', {
            dealId,
            taskId: task.id,
            error: error.message
          });
        }
      }

      // Remove from cache
      this.addressTaskCache.delete(dealId);
    } catch (error) {
      this.logger.error('Failed to close address tasks', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Create a task in CRM when webhook likely failed to process a payment
   * @param {number} dealId - Deal ID
   * @param {string} sessionId - Stripe session ID
   */
  async createWebhookFailureTask(dealId, sessionId) {
    if (!dealId || !sessionId) return;
    const cacheKey = `webhook-${dealId}-${sessionId}`;

    // Check if task already exists (avoid duplicates)
    if (this.addressTaskCache.has(cacheKey)) {
      return;
    }
    
    try {
      const alreadyExists = await this.hasExistingWebhookFailureTask(dealId, sessionId);
      if (alreadyExists) {
        this.logger.info('Webhook failure task already exists, skipping creation', {
          dealId,
          sessionId
        });
        this.addressTaskCache.add(cacheKey);
        return;
      }

      const stripeMode = this.mode || 'test';
      const dashboardBase = stripeMode === 'test' 
        ? 'https://dashboard.stripe.com/test'
        : 'https://dashboard.stripe.com';
      const sessionLink = `${dashboardBase}/checkout_sessions/${sessionId}`;

      const today = new Date().toISOString().slice(0, 10);
      await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: this.WEBHOOK_TASK_SUBJECT,
        due_date: today,
        type: 'task',
        note: `Платеж был успешно оплачен в Stripe, но не был обработан через webhook.\n\n` +
              `Session ID: ${sessionId}\n` +
              `Ссылка на Stripe: ${sessionLink}\n\n` +
              `Пожалуйста, проверьте:\n` +
              `1. Статус платежа в Stripe Dashboard\n` +
              `2. Настройки webhook в Stripe\n` +
              `3. Логи сервиса на наличие ошибок\n` +
              `4. Что платеж отображается в отчетах\n\n` +
              `Платеж будет обработан автоматически при следующей периодической проверке.`
      });
      
      this.addressTaskCache.add(cacheKey);
      this.logger.info('Created CRM task for webhook failure', { dealId, sessionId });
    } catch (error) {
      this.logger.error('Failed to create CRM task for webhook failure', {
        dealId,
        sessionId,
        error: error.message
      });
    }
  }

  /**
   * Process CRM triggers: find deals with invoice_type = "75" (Stripe) and create Checkout Sessions.
   */
  async processCheckoutTriggers(context = {}) {
    const { trigger, runId, dealId } = context;
    const summary = {
      totalDeals: 0,
      sessionsCreated: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Query Pipedrive for deals with Stripe trigger
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'open'
      });

      if (!dealsResult.success) {
        this.logger.error('Failed to fetch deals for Stripe trigger', {
          error: dealsResult.error
        });
        return summary;
      }

      // Filter deals by invoice_type = "75" (Stripe trigger)
      const stripeDeals = dealsResult.deals.filter((deal) => {
        const invoiceTypeValue = deal[this.invoiceTypeFieldKey];
        if (!invoiceTypeValue) return false;
        const normalizedValue = String(invoiceTypeValue).trim();
        return normalizedValue === this.stripeTriggerValue;
      });

      // If dealId filter is set, only process that specific deal
      const dealsToProcess = dealId
        ? stripeDeals.filter((d) => String(d.id) === String(dealId))
        : stripeDeals;

      summary.totalDeals = dealsToProcess.length;

      this.logger.info('Found deals with Stripe trigger', {
        total: stripeDeals.length,
        toProcess: dealsToProcess.length,
        dealIdFilter: dealId || null
      });

      // Process each deal
      for (const deal of dealsToProcess) {
        try {
          // Check if deal is closed - skip closed deals
          if (deal.status === 'won' || deal.status === 'lost') {
            this.logger.info('Deal is closed, skipping Checkout Session creation', {
              dealId: deal.id,
              status: deal.status
            });
            summary.skipped++;
            continue;
          }
          
          // Check if Checkout Sessions already exist for this deal to avoid duplicates
          const existingPayments = await this.repository.listPayments({
            dealId: String(deal.id),
            limit: 10
          });
          
          // Check if all payments are already paid - skip if fully paid
          if (existingPayments && existingPayments.length > 0) {
            const allPaid = existingPayments.every(p => p.payment_status === 'paid');
            if (allPaid) {
              this.logger.info('All payments for deal are already paid, skipping Checkout Session creation', {
                dealId: deal.id,
                paidCount: existingPayments.filter(p => p.payment_status === 'paid').length,
                totalCount: existingPayments.length
              });
              summary.skipped++;
              continue;
            }
          }

          // Если в базе нет сессий, проверяем Stripe напрямую (на случай, если сессии не сохранились в базу)
          // Это предотвращает создание дубликатов
          let hasActiveSessionsInStripe = false;
          if (!existingPayments || existingPayments.length === 0) {
            try {
              const now = Math.floor(Date.now() / 1000);
              const sevenDaysAgo = now - (7 * 24 * 60 * 60);
              
              const sessions = await this.stripe.checkout.sessions.list({
                limit: 10,
                created: { gte: sevenDaysAgo }
              });

              const dealSessions = sessions.data.filter(s => 
                s.metadata?.deal_id === String(deal.id) &&
                (s.status === 'open' || s.payment_status === 'paid')
              );

              if (dealSessions.length > 0) {
                hasActiveSessionsInStripe = true;
                this.logger.info('Found active sessions in Stripe (not in database), skipping creation', {
                  dealId: deal.id,
                  activeSessionsCount: dealSessions.length,
                  sessionIds: dealSessions.map(s => s.id)
                });
                summary.skipped++;
                continue;
              }
            } catch (stripeError) {
              this.logger.warn('Failed to check Stripe sessions, continuing with database check only', {
                dealId: deal.id,
                error: stripeError.message
              });
              // Продолжаем работу, если не удалось проверить Stripe
            }
          }
          
          // Determine payment schedule using PaymentScheduleService (Phase 0: Code Review Fixes)
          const schedule = PaymentScheduleService.determineScheduleFromDeal(deal);
          const use50_50Schedule = schedule.schedule === '50/50';
          
          this.logger.info('Determining payment schedule', {
            dealId: deal.id,
            expected_close_date: deal.expected_close_date,
            close_date: deal.close_date,
            schedule: schedule.schedule,
            daysDiff: schedule.daysDiff
          });

          // Analyze payment state using PaymentStateAnalyzer (Phase 0: Code Review Fixes)
          const stateAnalyzer = new PaymentStateAnalyzer({
            repository: this.repository,
            stripe: this.stripe,
            logger: this.logger
          });
          
          const paymentState = await stateAnalyzer.analyzePaymentState(deal.id, schedule);
          
          this.logger.debug('Payment state analysis', {
            dealId: deal.id,
            schedule: paymentState.schedule,
            needsDeposit: paymentState.needsDeposit,
            needsRest: paymentState.needsRest,
            needsSingle: paymentState.needsSingle,
            depositPaid: paymentState.deposit.paid,
            restPaid: paymentState.rest.paid,
            singlePaid: paymentState.single.paid
          });
          
          // Skip if all required payments exist and are paid
          if (use50_50Schedule) {
            if (!paymentState.needsDeposit && !paymentState.needsRest) {
              this.logger.info('Deal already has both deposit and rest Checkout Sessions, skipping creation', {
                dealId: deal.id,
                existingCount: paymentState.summary.totalPayments
              });
              summary.skipped++;
              continue;
            }
          } else {
            if (!paymentState.needsSingle && !paymentState.needsRest) {
              this.logger.info('Deal already has Checkout Session or is fully paid, skipping creation', {
                dealId: deal.id,
                existingCount: paymentState.summary.totalPayments,
                singlePaid: paymentState.single.paid,
                depositPaid: paymentState.deposit.paid,
                restPaid: paymentState.rest.paid
              });
              summary.skipped++;
              continue;
            }
          }

          if (use50_50Schedule) {
            
            const sessionsToNotify = [];
            
            // Create deposit if needed (Phase 0: Code Review Fixes - using PaymentStateAnalyzer + DistributedLock)
            if (paymentState.needsDeposit) {
              let depositResult;
              try {
                depositResult = await this.lockService.withLock(
                  deal.id,
                  async () => {
                    return await this.createCheckoutSessionForDeal(deal, {
                      trigger,
                      runId,
                      paymentType: 'deposit',
                      paymentSchedule: '50/50',
                      paymentIndex: 1,
                      skipNotification: true // Skip notification, will send after both sessions created
                    });
                  },
                  {
                    lockType: 'payment_creation',
                    timeout: 30000, // 30 seconds
                    maxRetries: 2,
                    retryDelay: 500
                  }
                );
              } catch (lockError) {
                this.logger.error('Failed to acquire lock for deposit creation', {
                  dealId: deal.id,
                  error: lockError.message
                });
                depositResult = {
                  success: false,
                  error: `Lock acquisition failed: ${lockError.message}`
                };
              }
              
              if (depositResult.success) {
                summary.sessionsCreated++;
                this.logger.info('Created deposit Checkout Session', {
                  dealId: deal.id,
                  sessionId: depositResult.sessionId,
                  sessionUrl: depositResult.sessionUrl
                });
                sessionsToNotify.push({
                  id: depositResult.sessionId,
                  url: depositResult.sessionUrl,
                  type: 'deposit',
                  amount: depositResult.amount
                });
              } else {
                summary.errors.push({
                  dealId: deal.id,
                  reason: `deposit: ${depositResult.error || 'unknown'}`
                });
              }
            } else {
              // Find existing deposit session for notification (Phase 0: Code Review Fixes)
              if (paymentState.deposit.payment) {
                sessionsToNotify.push({
                  id: paymentState.deposit.payment.session_id,
                  url: `https://dashboard.stripe.com/${this.mode === 'test' ? 'test/' : ''}checkout/sessions/${paymentState.deposit.payment.session_id}`,
                  type: 'deposit',
                  amount: paymentState.deposit.payment.original_amount
                });
              }
            }

            // Create rest if needed (Phase 0: Code Review Fixes - using PaymentStateAnalyzer + DistributedLock)
            if (paymentState.needsRest) {
              let restResult;
              try {
                restResult = await this.lockService.withLock(
                  deal.id,
                  async () => {
                    return await this.createCheckoutSessionForDeal(deal, {
                      trigger,
                      runId,
                      paymentType: 'rest',
                      paymentSchedule: '50/50',
                      paymentIndex: 2,
                      skipNotification: true // Skip notification, will send after both sessions created
                    });
                  },
                  {
                    lockType: 'payment_creation',
                    timeout: 30000,
                    maxRetries: 2,
                    retryDelay: 500
                  }
                );
              } catch (lockError) {
                this.logger.error('Failed to acquire lock for rest creation', {
                  dealId: deal.id,
                  error: lockError.message
                });
                restResult = {
                  success: false,
                  error: `Lock acquisition failed: ${lockError.message}`
                };
              }
              
              if (restResult.success) {
                summary.sessionsCreated++;
                this.logger.info('Created rest Checkout Session', {
                  dealId: deal.id,
                  sessionId: restResult.sessionId,
                  sessionUrl: restResult.sessionUrl
                });
                // Логируем, что задача-напоминание будет доступна в cron
                this.logger.info('✅ Reminder task will be available in cron queue', {
                  dealId: deal.id,
                  sessionId: restResult.sessionId,
                  note: 'Task will appear in /api/second-payment-scheduler/upcoming-tasks via findReminderTasks()'
                });
                sessionsToNotify.push({
                  id: restResult.sessionId,
                  url: restResult.sessionUrl,
                  type: 'rest',
                  amount: restResult.amount
                });
              } else {
                summary.errors.push({
                  dealId: deal.id,
                  reason: `rest: ${restResult.error || 'unknown'}`
                });
              }
            } else {
              // Find existing rest session for notification (Phase 0: Code Review Fixes)
              if (paymentState.rest.payment) {
                sessionsToNotify.push({
                  id: paymentState.rest.payment.session_id,
                  url: `https://dashboard.stripe.com/${this.mode === 'test' ? 'test/' : ''}checkout/sessions/${paymentState.rest.payment.session_id}`,
                  type: 'rest',
                  amount: paymentState.rest.payment.original_amount
                });
              }
            }

            // Уведомления теперь отправляются только после создания ВСЕХ сессий
            // (в pipedriveWebhook.js после цикла создания сессий)
          } else {
            // Create payment for 100% schedule (Phase 0: Code Review Fixes)
            // Используем PaymentStateAnalyzer для определения нужных платежей
            // ВАЖНО: Для графика 100% needsRest всегда false, поэтому проверяем наличие deposit отдельно
            const hasPaidDeposit = paymentState.deposit.exists && paymentState.deposit.paid;
            const hasRest = paymentState.rest.exists;
            
            if (hasPaidDeposit && !hasRest) {
              // Есть оплаченный deposit платеж, но нет rest - создаем rest с остатком
              // Это происходит, когда график изменился с 50/50 на 100%
              // Получаем продукты для расчета остатка
              const dealProductsResult = await this.pipedriveClient.getDealProducts(deal.id);
              const products = dealProductsResult.success ? dealProductsResult.products : [];
              
              // Получаем все deposit платежи для расчета остатка
              const depositPayments = await stateAnalyzer.getDepositPayments(deal.id);
              
              // Рассчитываем остаток используя DealAmountCalculator
              const remainderAmount = DealAmountCalculator.calculateRemainderAfterDeposit(
                deal.id,
                deal,
                products,
                depositPayments,
                deal.currency || 'PLN'
              );
              
              // Рассчитываем сумму deposit платежей
              const depositAmount = depositPayments.reduce((sum, p) => 
                sum + parseFloat(p.original_amount || p.amount_pln || 0), 0);
              
              this.logger.info('Creating rest payment for remainder after deposit', {
                dealId: deal.id,
                depositAmount,
                remainderAmount,
                note: 'Graph changed from 50/50 to 100%, deposit is paid, creating rest for remainder'
              });
              
              const result = await this.createCheckoutSessionForDeal(deal, {
                trigger,
                runId,
                paymentType: 'rest',
                paymentSchedule: '100%',
                customAmount: remainderAmount
              });
              
              if (result.success) {
                summary.sessionsCreated++;
                this.logger.info('Created rest Checkout Session for remainder', {
                  dealId: deal.id,
                  sessionId: result.sessionId,
                  sessionUrl: result.sessionUrl,
                  amount: remainderAmount
                });
              } else {
                summary.skipped++;
                summary.errors.push({
                  dealId: deal.id,
                  reason: result.error || 'unknown'
                });
              }
            } else {
              // Нет deposit платежа - создаем single на полную сумму (Phase 0: Code Review Fixes - with DistributedLock)
              let result;
              try {
                result = await this.lockService.withLock(
                  deal.id,
                  async () => {
                    return await this.createCheckoutSessionForDeal(deal, {
                      trigger,
                      runId,
                      paymentType: 'single',
                      paymentSchedule: '100%'
                    });
                  },
                  {
                    lockType: 'payment_creation',
                    timeout: 30000,
                    maxRetries: 2,
                    retryDelay: 500
                  }
                );
              } catch (lockError) {
                this.logger.error('Failed to acquire lock for single payment creation', {
                  dealId: deal.id,
                  error: lockError.message
                });
                result = {
                  success: false,
                  error: `Lock acquisition failed: ${lockError.message}`
                };
              }
              
              if (result.success) {
                summary.sessionsCreated++;
                this.logger.info('Created single Checkout Session', {
                  dealId: deal.id,
                  sessionId: result.sessionId,
                  sessionUrl: result.sessionUrl
                });
              } else {
                summary.skipped++;
                summary.errors.push({
                  dealId: deal.id,
                  reason: result.error || 'unknown'
                });
              }
            }
          }
        } catch (error) {
          summary.errors.push({
            dealId: deal.id,
            reason: error.message
          });
          this.logger.error('Failed to create Checkout Session for deal', {
            dealId: deal.id,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.error('Error in processCheckoutTriggers', {
        error: error.message,
        stack: error.stack
      });
      summary.errors.push({
        reason: error.message
      });
    }

    return summary;
  }

  /**
   * Create Stripe Checkout Session for a single deal.
   */
  async createCheckoutSessionForDeal(deal, context = {}) {
    let {
      trigger,
      runId,
      paymentType,
      customAmount,
      paymentSchedule,
      paymentIndex,
      skipNotification,
      setInvoiceTypeDone
    } = context;
    const dealId = deal.id;
    const startTime = Date.now();
    let apiCallCount = 0;

    try {
      this.logger.info(`🔄 [Deal #${dealId}] Creating Checkout Session`, {
        paymentType,
        paymentSchedule,
        paymentIndex,
        trigger
      });

      // 1. Fetch full deal data with related entities
      apiCallCount++;
      this.logger.debug(`📡 [Deal #${dealId}] API Call #${apiCallCount}: Fetching deal with related data from Pipedrive...`);
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.deal) {
        return {
          success: false,
          error: `Failed to fetch deal: ${fullDealResult.error || 'unknown'}`
        };
      }

      const fullDeal = fullDealResult.deal;
      
      // Мержим данные из переданного deal (из webhook'а) в fullDeal
      // ВАЖНО: Приоритет отдаем данным из API, так как они более полные и актуальные
      // Webhook данные используются только для полей, которых нет в API или которые не пустые
      if (deal && deal !== fullDeal) {
        // Мержим только непустые значения из webhook, чтобы не перезаписать данные из API
        Object.keys(deal).forEach(key => {
          const webhookValue = deal[key];
          const apiValue = fullDeal[key];
          // Перезаписываем только если значение из webhook не пустое И значение из API пустое
          if (webhookValue !== null && webhookValue !== undefined && webhookValue !== '' && 
              (apiValue === null || apiValue === undefined || apiValue === '')) {
            fullDeal[key] = webhookValue;
          }
        });
      }
      
      // Определяем график платежей, если не передан в context (Phase 0: Code Review Fixes)
      // КРИТИЧНО: Схема фиксируется при первом платеже и НЕ МЕНЯЕТСЯ, даже если expected_close_date изменился
      if (!paymentSchedule) {
        // Сначала проверяем исходную схему из первого оплаченного платежа
        const SecondPaymentSchedulerService = require('./secondPaymentSchedulerService');
        const schedulerService = new SecondPaymentSchedulerService();
        const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
        
        if (initialSchedule.schedule === '50/50') {
          // Используем исходную схему 50/50 из первого платежа
          paymentSchedule = '50/50';
          this.logger.info('Using initial payment schedule from first payment (fixed, does not change)', {
            dealId,
            initialSchedule: initialSchedule.schedule,
            firstPaymentDate: initialSchedule.firstPaymentDate?.toISOString(),
            note: 'Schedule is fixed at first payment and does not change even if expected_close_date changes'
          });
        } else {
          // Если исходной схемы нет, определяем на основе текущего expected_close_date
          const schedule = PaymentScheduleService.determineScheduleFromDeal(fullDeal);
          paymentSchedule = schedule.schedule;
          this.logger.info('Auto-determined payment schedule (no initial schedule found)', {
            dealId,
            schedule: paymentSchedule,
            daysDiff: schedule.daysDiff,
            secondPaymentDate: schedule.secondPaymentDate
          });
        }
      } else {
        // Если схема явно передана в context - используем её (для ручных действий)
        this.logger.info('Using payment schedule from context', {
          dealId,
          paymentSchedule
        });
      }
      
      const person = fullDealResult.person;
      const organization = fullDealResult.organization;
      
      // Extract cash fields from deal (if any)
      const cashFields = extractCashFields(fullDeal);

      // 2. Get deal products
      apiCallCount++;
      this.logger.debug(`📡 [Deal #${dealId}] API Call #${apiCallCount}: Fetching deal products from Pipedrive...`);
      const dealProductsResult = await this.pipedriveClient.getDealProducts(dealId);
      if (!dealProductsResult.success || !dealProductsResult.products || dealProductsResult.products.length === 0) {
        return {
          success: false,
          error: 'No products found in deal'
        };
      }

      // 3. Calculate amount and currency using DealAmountCalculator (Phase 0: Code Review Fixes)
      const firstProduct = dealProductsResult.products[0];
      const quantity = parseFloat(firstProduct.quantity) || 1;
      
      // Calculate payment amount using unified calculator
      let productPrice;
      try {
        if (customAmount && customAmount > 0) {
          productPrice = customAmount;
          this.logger.info('Использована кастомная сумма', {
            dealId,
            customAmount
          });
        } else {
          productPrice = DealAmountCalculator.calculatePaymentAmount(
            fullDeal,
            dealProductsResult.products,
            paymentSchedule,
            paymentType
          );
          this.logger.debug('💰 Расчет цены продукта через DealAmountCalculator', {
            dealId,
            productPrice,
            paymentSchedule,
            paymentType,
            quantity,
            productName: firstProduct.name || firstProduct.product?.name || 'N/A'
          });
        }
      } catch (error) {
        this.logger.error('❌ Не удалось определить цену продукта', {
          dealId,
          error: error.message,
          firstProduct: JSON.stringify(firstProduct),
          dealValue: fullDeal.value
        });
        return {
          success: false,
          error: `Product price calculation failed: ${error.message}`,
          details: {
            product: firstProduct
          }
        };
      }
      
      // Нормализуем валюту: преобразуем полные названия (например, "Polish Zloty") в ISO коды (например, "PLN")
      const rawCurrency = fullDeal.currency || 'PLN';
      const currency = normaliseCurrency(rawCurrency);
      
      // Логируем нормализацию валюты для отладки
      if (rawCurrency !== currency) {
        this.logger.info('Валюта нормализована', {
          dealId,
          rawCurrency,
          normalizedCurrency: currency,
          note: 'Полное название валюты преобразовано в ISO код'
        });
      }
      const productName = firstProduct.name || firstProduct.product?.name || fullDeal.title || 'Camp / Tourist service';

      if (productPrice <= 0 || isNaN(productPrice)) {
        this.logger.error('❌ Итоговая цена продукта невалидна', {
          dealId,
          productPrice,
          customAmount,
          paymentSchedule,
          paymentType
        });
        return {
          success: false,
          error: 'Product price is zero or invalid',
          details: {
            productPrice,
            customAmount,
            paymentSchedule,
            paymentType
          }
        };
      }
      
      // Calculate sumPrice (total deal amount with discounts) for return value
      // This is used to match the total amount shown in notifications
      const sumPrice = DealAmountCalculator.getDealAmount(fullDeal, dealProductsResult.products, {
        includeDiscounts: true
      });

      // 4. Get CRM context for B2B/VAT logic
      const crmContext = await this.getCrmContext(dealId);
      const customerType = crmContext?.isB2B ? 'organization' : 'person';
      const customerEmail = person?.email?.[0]?.value || person?.email || organization?.email?.[0]?.value || organization?.email || null;
      const customerName = crmContext?.isB2B
        ? (crmContext.companyName || organization?.name || 'Company')
        : (person?.name || 'Customer');

      if (!customerEmail) {
        return {
          success: false,
          error: 'No email found for customer'
        };
      }

      // 5. Determine VAT applicability
      const addressParts = this.extractAddressParts(crmContext);
      const countryCode = this.extractCountryCode(addressParts);
      const shouldApplyVat = this.shouldApplyVat({
        customerType,
        companyCountry: countryCode,
        sessionCountry: countryCode
      });

      // 6. Validate address if VAT is required
      const addressValidation = await this.ensureAddress({
        dealId,
        shouldApplyVat,
        participant: { address: addressParts },
        crmContext
      });

      if (!addressValidation.valid && shouldApplyVat) {
        return {
          success: false,
          error: `Address validation failed: ${addressValidation.reason || 'missing_address'}`
        };
      }

      // 7. Get or create product link
      const crmProductId = firstProduct.product_id || firstProduct.product?.id || null;
      let productLink = null;
      if (crmProductId) {
        productLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
      }

      let stripeProductId = null;
      if (productLink?.stripe_product_id) {
        // Verify product exists in current Stripe account/mode
        try {
          await this.stripe.products.retrieve(productLink.stripe_product_id);
          stripeProductId = productLink.stripe_product_id;
        } catch (error) {
          // Product doesn't exist in current account/mode, search for it
          this.logger.warn('Stripe product from link not found, searching by CRM ID', {
            oldProductId: productLink.stripe_product_id,
            error: error.message
          });
          productLink = null; // Reset to search/create
        }
      }

      // If no product found via link, search by CRM product ID in metadata
      if (!stripeProductId && crmProductId) {
        try {
          const products = await this.stripe.products.list({
            limit: 100,
            expand: ['data']
          });
          const matchingProduct = products.data.find((p) => {
            return p.metadata?.crm_product_id === String(crmProductId) &&
                   p.metadata?.mode === this.mode;
          });
          if (matchingProduct) {
            stripeProductId = matchingProduct.id;
            this.logger.info('Found existing Stripe product by CRM ID', {
              crmProductId,
              stripeProductId,
              productName: matchingProduct.name
            });
            // Update product link if it exists but had wrong ID
            if (productLink) {
              await this.repository.upsertProductLink({
                crmProductId: String(crmProductId),
                crmProductName: productName,
                stripeProductId,
                campProductId: null,
                status: 'active'
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to search for existing product', {
            crmProductId,
            error: error.message
          });
        }
      }

      // Create new product only if not found
      if (!stripeProductId) {
        this.logger.info('Creating new Stripe product', {
          productName,
          crmProductId: crmProductId || 'none'
        });
        
        // Add VAT breakdown to product description if applicable
        let productDescription = `Camp product: ${productName}`;
        if (shouldApplyVat && countryCode === 'PL') {
          const vatRate = 0.23; // 23%
          const vatAmount = roundBankers(productPrice * vatRate / (1 + vatRate));
          const amountExcludingVat = roundBankers(productPrice - vatAmount);
          productDescription += `\n\nVAT breakdown:\nAmount excluding VAT: ${amountExcludingVat.toFixed(2)} ${currency}\nVAT (23%): ${vatAmount.toFixed(2)} ${currency}\nTotal (including VAT): ${productPrice.toFixed(2)} ${currency}`;
        }
        
        const stripeProduct = await this.stripe.products.create({
          name: productName,
          description: productDescription,
          metadata: {
            crm_product_id: crmProductId ? String(crmProductId) : null,
            deal_id: String(dealId),
            created_by: 'stripe_processor',
            mode: this.mode
          }
        });
        stripeProductId = stripeProduct.id;

        // Save product link
        if (crmProductId) {
          await this.repository.upsertProductLink({
            crmProductId: String(crmProductId),
            crmProductName: productName,
            stripeProductId,
            campProductId: null,
            status: 'active'
          });
        }
      }

      // Get product link ID for metadata (always, not just when creating new product)
      let productLinkId = null;
      if (crmProductId) {
        const existingLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
        if (existingLink?.id) {
          productLinkId = existingLink.id;
        }
      }

      // 8. Create or get Stripe Customer for B2B companies (to ensure company details appear in invoice)
      let stripeCustomerId = null;
      if (crmContext?.isB2B) {
        stripeCustomerId = await this.ensureStripeCustomer({
          email: customerEmail,
          name: crmContext.companyName || organization?.name || 'Company',
          taxId: crmContext.companyTaxId,
          address: addressParts,
          dealId
        });
      }

      // 9. Prepare Checkout Session parameters
      const amountInMinorUnits = toMinorUnit(productPrice, currency);
      
      // Prepare line item using price_data (required by Stripe API)
      // Note: description cannot be added to line_item directly - VAT breakdown is shown in invoice footer instead
      const lineItem = {
        price_data: {
          currency: currency.toLowerCase(),
          product: stripeProductId,
          unit_amount: amountInMinorUnits
        },
        quantity: quantity
      };
      
      // VAT breakdown is displayed in invoice footer (see invoice_creation.invoice_data.footer below)
      // This is the correct way to show VAT information in Stripe Checkout Sessions

      // ВАЖНО: Проверка что Tax Rate НЕ добавляется к line_item
      // Stripe НЕ будет удерживать VAT - это только для расчетов и отображения
      this.logger.info('✅ Проверка: Tax Rate НЕ добавляется к line_item', {
        dealId,
        hasTaxRates: !!lineItem.tax_rates,
        taxRatesCount: lineItem.tax_rates ? lineItem.tax_rates.length : 0,
        amount: productPrice,
        currency,
        note: 'Stripe не удерживает VAT - сумма платежа = сумме из CRM'
      });

      // VAT используется только для расчетов и отображения в чеках/инвойсах
      // НЕ применяется как Tax Rate в Stripe (Stripe не удерживает VAT)
      if (shouldApplyVat && countryCode === 'PL') {
        this.logger.info('📊 VAT будет рассчитан для отображения (не применяется в Stripe)', {
          dealId,
          vatRate: '23%',
          shouldApplyVat,
          countryCode,
          note: 'VAT только для расчетов и чеков, не удерживается Stripe'
        });
      }

      // Add VAT breakdown to metadata for display in Checkout Session
      const metadata = {
        deal_id: String(dealId),
        product_id: crmProductId ? String(crmProductId) : null,
        product_link_id: productLinkId ? String(productLinkId) : null,
        payment_id: `deal_${dealId}_${Date.now()}`,
        payment_type: paymentType || 'deposit', // Use provided paymentType or default to 'deposit'
        payment_schedule: paymentSchedule || '100%', // '50/50' or '100%'
        payment_part: paymentSchedule === '50/50' ? (paymentType === 'deposit' ? '1 of 2' : '2 of 2') : '1 of 1',
        created_by: 'stripe_processor',
        trigger,
        run_id: runId || null
      };
      
      // Add VAT breakdown to metadata if applicable (for display in Checkout Session)
      if (shouldApplyVat && countryCode === 'PL') {
        const vatRate = 0.23; // 23%
        const vatAmount = roundBankers(productPrice * vatRate / (1 + vatRate));
        const amountExcludingVat = roundBankers(productPrice - vatAmount);
        metadata.vat_applicable = 'true';
        metadata.vat_rate = '23%';
        metadata.amount_excluding_vat = amountExcludingVat.toFixed(2);
        metadata.vat_amount = vatAmount.toFixed(2);
        metadata.total_including_vat = productPrice.toFixed(2);
        metadata.vat_currency = currency;
      }

      if (cashFields && Number.isFinite(cashFields.amount) && cashFields.amount > 0) {
        metadata.cash_amount_expected = roundBankers(cashFields.amount).toFixed(2);
        if (cashFields.expectedDate) {
          metadata.cash_expected_date = cashFields.expectedDate;
        }
      }
      
      const sessionParams = {
        mode: 'payment',
        payment_method_types: ['card'],
        line_items: [lineItem],
        metadata,
        success_url: this.buildCheckoutUrl(this.checkoutSuccessUrl, dealId, 'success'),
        cancel_url: this.buildCheckoutUrl(this.checkoutCancelUrl || this.checkoutSuccessUrl, dealId, 'cancel')
        // Валюта уже задана в line_items, дополнительное ограничение не требуется
      };

      // 10. Set customer (B2B) or customer_email (B2C)
      // Для B2C тоже создаем invoice, чтобы показать VAT breakdown в footer
      // Receipt не поддерживает кастомные поля, поэтому используем invoice
      if (stripeCustomerId) {
        // B2B: Use Customer object to ensure company details appear in invoice
        sessionParams.customer = stripeCustomerId;
      } else {
        // B2C: Create customer for invoice (to show VAT breakdown)
        // Это позволяет показать VAT breakdown в invoice footer
        const b2cCustomer = await this.ensureStripeCustomer({
          email: customerEmail,
          name: customerName,
          taxId: null,
          address: addressParts,
          dealId
        });
        if (b2cCustomer) {
          sessionParams.customer = b2cCustomer;
        } else {
          // Fallback to customer_email if customer creation fails
          sessionParams.customer_email = customerEmail;
        }
      }
      
      // Enable invoice creation for BOTH B2B and B2C to show VAT breakdown
      // Add payment part information for partial payments (50/50)
      // Use product name instead of deal ID in description
      let invoiceDescription = productName || 'Camp / Tourist service';
      if (paymentSchedule === '50/50') {
        if (paymentType === 'deposit') {
          invoiceDescription = `${productName || 'Camp / Tourist service'} - Part 1 of 2 (Deposit 50%)`;
        } else if (paymentType === 'rest') {
          invoiceDescription = `${productName || 'Camp / Tourist service'} - Part 2 of 2 (Final payment 50%)`;
        }
      }
      
      // Calculate VAT for display in invoice (if applicable)
      let vatInfo = '';
      let vatFooter = null;
      if (shouldApplyVat && countryCode === 'PL') {
        const vatRate = 0.23; // 23%
        const vatAmount = roundBankers(productPrice * vatRate / (1 + vatRate));
        const amountExcludingVat = roundBankers(productPrice - vatAmount);
        vatInfo = `\n\nVAT breakdown:\nAmount excluding VAT: ${amountExcludingVat.toFixed(2)} ${currency}\nVAT (23%): ${vatAmount.toFixed(2)} ${currency}\nTotal (including VAT): ${productPrice.toFixed(2)} ${currency}\n\nNote: VAT is included in the price. Stripe does not collect VAT separately.`;
        vatFooter = `VAT Breakdown:\nAmount excluding VAT: ${amountExcludingVat.toFixed(2)} ${currency}\nVAT (23%): ${vatAmount.toFixed(2)} ${currency}\nTotal (including VAT): ${productPrice.toFixed(2)} ${currency}\n\nNote: VAT is included in the total amount. Stripe does not collect VAT separately.`;
      }
      
      sessionParams.invoice_creation = {
        enabled: true,
        invoice_data: {
          description: invoiceDescription + (vatInfo || ''),
          footer: vatFooter
        }
      };
      
      // Allow Stripe to update customer name/address if needed
      sessionParams.customer_update = {
        name: 'auto',
        address: 'auto'
      };
      
      // Add company details to metadata (for B2B)
      if (crmContext?.isB2B) {
        if (crmContext.companyName) {
          sessionParams.metadata.company_name = crmContext.companyName;
        }
        if (crmContext.companyTaxId) {
          sessionParams.metadata.company_tax_id = crmContext.companyTaxId;
        }
        if (crmContext.companyAddress) {
          sessionParams.metadata.company_address = crmContext.companyAddress;
        }
      }

      // 11. VAT используется только для расчетов и отображения (НЕ применяется в Stripe)
      // VAT рассчитывается и сохраняется в базе данных для отображения в чеках/инвойсах
      // Stripe НЕ удерживает VAT - это только для внутренних расчетов
      if (shouldApplyVat && countryCode === 'PL') {
        // Добавляем метаданные о VAT для расчетов (но не применяем Tax Rate)
        sessionParams.payment_intent_data = {
          metadata: {
            ...sessionParams.metadata,
            vat_calculation_only: 'true', // Только для расчетов, не для удержания
            vat_rate: '23%',
            vat_country: 'PL'
          }
        };
        this.logger.info('📊 VAT будет рассчитан для отображения (не применяется в Stripe)', {
          dealId,
          vatRate: '23%',
          note: 'VAT только для расчетов и чеков, не удерживается Stripe'
        });
      }

      // ВАЖНО: Проверка что sessionParams НЕ содержит tax_id_collection и automatic_tax
      // Детали проверки только в debug (слишком много логов)
      this.logger.debug('✅ Проверка: sessionParams не содержит налоговых настроек Stripe', {
        dealId,
        hasTaxIdCollection: !!sessionParams.tax_id_collection,
        hasAutomaticTax: !!sessionParams.automatic_tax,
        lineItemsCount: sessionParams.line_items?.length || 0,
        firstLineItemHasTaxRates: !!sessionParams.line_items?.[0]?.tax_rates,
        note: 'Stripe не будет удерживать VAT - сумма платежа = сумме из CRM'
      });

      // 12. Create Checkout Session in Stripe
      apiCallCount++;
      // Детали создания только в debug, итог останется в info ниже
      this.logger.debug(`💳 [Deal #${dealId}] API Call #${apiCallCount}: Creating Checkout Session in Stripe`, {
        amount: productPrice,
        currency,
        paymentSchedule,
        paymentType,
        totalApiCalls: apiCallCount,
        note: 'Сумма платежа в Stripe = сумме из CRM, VAT не удерживается'
      });
      
      // ВАЖНО: Удаляем неподдерживаемые параметры перед созданием сессии
      // Stripe не поддерживает payment_currency_types (это опечатка или устаревший параметр)
      if (sessionParams.payment_currency_types) {
        delete sessionParams.payment_currency_types;
        this.logger.warn('Removed unsupported payment_currency_types parameter', { dealId });
      }
      
      const session = await this.stripe.checkout.sessions.create(sessionParams);
      
      // ВАЖНО: Проверка что сессия создана без налога от Stripe
      // Проверка только в debug, ошибка логируется отдельно если налог > 0
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const amountTax = session.total_details?.amount_tax || 0;
      if (amountTax > 0) {
        // Если налог есть - это ошибка, логируем как warning
        this.logger.warn(`⚠️ [Deal #${dealId}] Checkout Session создан с налогом от Stripe (не должно быть)`, {
          sessionId: session.id,
          amountTax,
          note: 'amount_tax должен быть 0 (Stripe не удерживает VAT)'
        });
      }

      // 13. Create tasks in CRM after successful session creation (if address is missing)
      // Задачи создаются только если адрес не найден и нужен VAT
      if (!addressValidation.valid && shouldApplyVat) {
        // ensureAddress уже создал задачу, но проверяем еще раз для надежности
        if (dealId && !this.addressTaskCache.has(dealId)) {
          await this.createAddressTask(dealId);
          this.addressTaskCache.add(dealId);
        }
      }

      // 14. Update deal invoice_type in CRM after creating Checkout Session
      // Принудительно устанавливаем "Done" (73), если этого требует контекст
      try {
        apiCallCount++;
        const nextInvoiceTypeValue = setInvoiceTypeDone ? this.invoiceDoneValue : this.stripeTriggerValue;
        const nextInvoiceTypeLabel = setInvoiceTypeDone ? 'Done' : 'Stripe';
        this.logger.debug(
          `📡 [Deal #${dealId}] API Call #${apiCallCount}: Updating deal invoice_type to ${nextInvoiceTypeLabel} in Pipedrive...`
        );
        await this.pipedriveClient.updateDeal(dealId, {
          [this.invoiceTypeFieldKey]: nextInvoiceTypeValue
        });
        // Обновление invoice_type только в debug (не критично)
        this.logger.debug(`✅ [Deal #${dealId}] Updated deal invoice_type to ${nextInvoiceTypeLabel}`, {
          totalApiCalls: apiCallCount
        });
      } catch (updateError) {
        this.logger.warn('Failed to update deal invoice_type after session creation', {
          dealId,
          error: updateError.message
        });
      }

      // Уведомления теперь отправляются только после создания ВСЕХ сессий
      // (в pipedriveWebhook.js после цикла создания сессий)

      // 14. Log session creation with final statistics - упрощенная версия
      // Оставляем только критически важную информацию
      const finalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.info(`✅ [Deal #${dealId}] Checkout Session created`, {
        sessionId: session.id,
        amount: productPrice,
        currency,
        paymentType,
        paymentSchedule,
        duration: `${finalDuration}s`
      });

      // Output session URL to console for easy access
      // eslint-disable-next-line no-console
      console.log('\n✅ Stripe Checkout Session created successfully!');
      // eslint-disable-next-line no-console
      console.log(`📋 Session ID: ${session.id}`);
      // eslint-disable-next-line no-console
      console.log(`🔗 Payment URL: ${session.url}`);
      // eslint-disable-next-line no-console
      console.log(`💰 Amount: ${productPrice} ${currency}`);
      // eslint-disable-next-line no-console
      console.log(`📧 Customer: ${customerEmail}`);
      // eslint-disable-next-line no-console
      console.log(`\n💡 To complete the payment, open the URL above in your browser.\n`);

      // Return totalAmount as sumPrice (with discount) to match Stripe session amount
      // This ensures notification shows correct total that matches the Stripe session
      const returnedTotalAmount = sumPrice || parseFloat(fullDeal.value) || productPrice;
      
      return {
        success: true,
        sessionId: session.id,
        sessionUrl: session.url,
        amount: productPrice,
        currency,
        totalAmount: returnedTotalAmount
      };
    } catch (error) {
      const errorDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.error(`❌ [Deal #${dealId}] Failed to create Checkout Session`, {
        error: error.message,
        duration: `${errorDuration}s`,
        totalApiCalls: apiCallCount,
        stack: error.stack
      });
      logStripeError(error, {
        scope: 'createCheckoutSessionForDeal',
        dealId,
        totalApiCalls: apiCallCount
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processRefunds(filters = {}, summary = {}, dealIdFilter = null) {
    if (!this.repository.isEnabled()) return;

    const refunds = [];
    await iterateRefunds({
      filters,
      onPage: async (items) => {
        refunds.push(...items);
      }
    });

    if (refunds.length === 0) return;

    for (const refund of refunds) {
      if (dealIdFilter && String(refund?.metadata?.deal_id || '') !== dealIdFilter) {
        continue;
      }
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.persistRefund(refund);
        summary.total = (summary.total || 0) + 1;
        const values = await this.convertRefundAmounts(refund);
        summary.amount = (summary.amount || 0) + values.amount;
        summary.amountPln = (summary.amountPln || 0) + values.amountPln;
        await this.paymentPlanService.applyRefund(refund, values);
        const refundDealId = refund?.metadata?.deal_id || refund?.metadata?.dealId || null;
        if (refundDealId) {
          await this.triggerCrmStatusAutomation(refundDealId, { reason: 'stripe:refund' });
        }
      } catch (error) {
        logStripeError(error, { scope: 'persistRefund', refundId: refund.id });
      }
    }
  }

  async convertRefundAmounts(refund) {
    const currency = normaliseCurrency(refund.currency);
    const amount = fromMinorUnit(refund.amount || 0, currency);
    const conversion = await this.convertAmountWithRate(amount, currency);
    const amountPln = conversion.amountPln;
    return {
      amount: roundBankers(-Math.abs(amount)),
      amountPln: roundBankers(-Math.abs(amountPln))
    };
  }

  async persistRefund(refund) {
    const currency = normaliseCurrency(refund.currency);
    const amounts = await this.convertRefundAmounts(refund);
    const metadata = {
      ...(refund.metadata || {}),
      refund_id: refund.id
    };

    // Try to enrich metadata with customer/deal info from stored payment
    let customerName = metadata.customer_name || null;
    let customerEmail = metadata.customer_email || null;
    let metadataDealId = metadata.deal_id || null;

    if (refund.payment_intent) {
      try {
        const paymentRecord = await this.repository.findPaymentByPaymentIntent(refund.payment_intent);
        if (paymentRecord) {
          customerName =
            customerName ||
            paymentRecord.customer_name ||
            paymentRecord.raw_payload?.customer_details?.name ||
            null;
          customerEmail =
            customerEmail ||
            paymentRecord.customer_email ||
            paymentRecord.raw_payload?.customer_details?.email ||
            null;
          metadataDealId =
            metadataDealId ||
            paymentRecord.deal_id ||
            paymentRecord.raw_payload?.metadata?.deal_id ||
            null;
        }
      } catch (error) {
        this.logger?.warn('Failed to enrich refund metadata with payment info', {
          refundId: refund.id,
          paymentIntent: refund.payment_intent,
          error: error.message
        });
      }

      if ((!customerName || !customerEmail || !metadataDealId) && this.stripe) {
        try {
          const paymentIntent = await this.stripe.paymentIntents.retrieve(refund.payment_intent, {
            expand: ['charges.data.billing_details', 'customer']
          });

          const chargeDetails =
            paymentIntent?.charges?.data?.find(
              (charge) => charge?.billing_details?.name || charge?.billing_details?.email
            ) || paymentIntent?.charges?.data?.[0];

          customerName =
            customerName ||
            chargeDetails?.billing_details?.name ||
            paymentIntent?.shipping?.name ||
            (typeof paymentIntent?.customer === 'object' ? paymentIntent.customer?.name : null) ||
            null;
          customerEmail =
            customerEmail ||
            chargeDetails?.billing_details?.email ||
            paymentIntent?.receipt_email ||
            (typeof paymentIntent?.customer === 'object' ? paymentIntent.customer?.email : null) ||
            null;
          metadataDealId = metadataDealId || paymentIntent?.metadata?.deal_id || null;
        } catch (intentError) {
          this.logger?.warn('Failed to fetch payment intent while enriching refund metadata', {
            refundId: refund.id,
            paymentIntent: refund.payment_intent,
            error: intentError.message
          });
        }
      }
    }

    metadata.customer_name = customerName || metadata.customer_name || null;
    metadata.customer_email = customerEmail || metadata.customer_email || null;
    metadata.deal_id = metadataDealId || metadata.deal_id || null;

    const payload = {
      payment_id: refund.payment_intent || refund.charge || refund.id,
      reason: 'stripe_refund',
      amount: amounts.amount,
      currency,
      amount_pln: amounts.amountPln,
      logged_at: new Date((refund.created || 0) * 1000).toISOString(),
      metadata,
      raw_payload: refund
    };
    await this.repository.logDeletion(payload);
  }

  /**
   * Process refunds for deals with status "lost"
   * This method finds all Stripe payments for a deal and creates refunds in Stripe
   * @param {Object} context - Processing context
   * @param {string} context.trigger - Trigger source (scheduler, manual, etc.)
   * @param {string} context.runId - Run ID for logging
   * @returns {Promise<Object>} Summary of refund processing
   */
  async processLostDealRefunds(context = {}) {
    const { trigger = 'manual', runId = null } = context;
    
    this.logger.info('Processing refunds for lost deals', {
      trigger,
      runId,
      mode: this.mode
    });

    if (!this.repository.isEnabled()) {
      this.logger.warn('StripeRepository disabled. Skipping lost deal refunds.');
      return {
        success: true,
        summary: {
          totalDeals: 0,
          refundsCreated: 0,
          errors: []
        },
        skipped: true,
        reason: 'repository_disabled'
      };
    }

    const summary = {
      totalDeals: 0,
      refundsCreated: 0,
      errors: []
    };

    try {
      // Get all deals with status "lost" from Pipedrive
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'lost'
      });

      if (!dealsResult.success || !dealsResult.deals || dealsResult.deals.length === 0) {
        this.logger.info('No lost deals found');
        return {
          success: true,
          summary
        };
      }

      summary.totalDeals = dealsResult.deals.length;

      // Process each lost deal
      for (const deal of dealsResult.deals) {
        try {
          // Skip deleted deals - они не должны обрабатываться
          if (deal.status === 'deleted' || deal.deleted === true) {
            this.logger.debug('Skipping deleted deal', {
              dealId: deal.id
            });
            continue;
          }

          // Check lost_reason - only process if reason is "Refund"
          // Get full deal data to check lost_reason (may not be in list response)
          let lostReason = deal.lost_reason || deal.lostReason || deal['lost_reason'];
          let fullDeal = null;
          
          // If lost_reason not in list response, fetch full deal
          if (!lostReason) {
            try {
              const fullDealResult = await this.pipedriveClient.getDeal(deal.id);
              if (fullDealResult.success && fullDealResult.deal) {
                fullDeal = fullDealResult.deal;
                lostReason = fullDeal.lost_reason || fullDeal.lostReason || fullDeal['lost_reason'];
                
                // Проверяем, не удалена ли сделка (после получения полных данных)
                if (fullDeal.status === 'deleted' || fullDeal.deleted === true) {
                  this.logger.debug('Skipping deleted deal (checked via full deal fetch)', {
                    dealId: deal.id
                  });
                  continue;
                }
              } else if (!fullDealResult.success) {
                // Если сделка не найдена или удалена, пропускаем
                this.logger.debug('Deal not found or deleted, skipping', {
                  dealId: deal.id,
                  error: fullDealResult.error
                });
                continue;
              }
            } catch (error) {
              // Если ошибка связана с удаленной сделкой, пропускаем
              if (error.message?.includes('deleted') || error.message?.includes('Entity is deleted')) {
                this.logger.debug('Deal is deleted, skipping', {
                  dealId: deal.id
                });
                continue;
              }
              this.logger.warn('Failed to fetch full deal data for lost_reason check', {
                dealId: deal.id,
                error: error.message
              });
            }
          }

          const normalizedLostReason = lostReason ? String(lostReason).trim().toLowerCase() : '';
          // Accept both "refund" and "refound" (common typo)
          const isRefundReason = normalizedLostReason === 'refund' || normalizedLostReason === 'refound';

          if (!isRefundReason) {
            this.logger.debug('Skipping lost deal - reason is not "Refund"', {
              dealId: deal.id,
              lostReason: normalizedLostReason
            });
            continue;
          }

          await this.refundDealPayments(deal.id, summary);
        } catch (error) {
          summary.errors.push({
            dealId: deal.id,
            reason: error.message
          });
          this.logger.error('Failed to refund payments for lost deal', {
            dealId: deal.id,
            error: error.message
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing lost deal refunds', {
        error: error.message,
        stack: error.stack
      });
      summary.errors.push({
        reason: error.message
      });
    }

    return {
      success: summary.errors.length === 0,
      summary
    };
  }

  /**
   * Refund all Stripe payments for a specific deal
   * @param {number} dealId - Deal ID
   * @param {Object} summary - Summary object to update
   * @returns {Promise<void>}
   */
  async refundDealPayments(dealId, summary = {}) {
    if (!dealId) {
      throw new Error('Deal ID is required');
    }

    // Find all Stripe payments for this deal
    const payments = await this.repository.listPayments({
      dealId: String(dealId),
      status: 'processed' // Only refund processed payments
    });

    if (!payments || payments.length === 0) {
      this.logger.info('No Stripe payments found for deal', { dealId });
      return;
    }

    this.logger.info('Found Stripe payments for lost deal', {
      dealId,
      paymentsCount: payments.length
    });

    // Track refunds for summary note
    const refundedPayments = [];

    // Process each payment
    for (const payment of payments) {
      try {
        // Check if refund already exists in database
        const existingRefunds = await this.repository.listDeletions({
          paymentId: payment.session_id
        });

        // Get Checkout Session from Stripe to get payment_intent
        let session;
        try {
          session = await this.stripe.checkout.sessions.retrieve(payment.session_id, {
            expand: ['payment_intent']
          });
        } catch (error) {
          this.logger.warn('Failed to retrieve Checkout Session', {
            dealId,
            sessionId: payment.session_id,
            error: error.message
          });
          continue;
        }

        // Get payment_intent from session
        const paymentIntentId = session.payment_intent;
        if (!paymentIntentId) {
          this.logger.warn('No payment_intent found in Checkout Session', {
            dealId,
            sessionId: payment.session_id
          });
          continue;
        }

        // Check if payment was actually paid
        if (session.payment_status !== 'paid') {
          this.logger.info('Payment not paid, skipping refund', {
            dealId,
            sessionId: payment.session_id,
            paymentStatus: session.payment_status
          });
          continue;
        }

        // Check if refund already exists in Stripe (even if not logged in DB)
        const piId = typeof paymentIntentId === 'string' ? paymentIntentId : paymentIntentId.id;
        const stripeRefunds = await this.stripe.refunds.list({
          payment_intent: piId,
          limit: 1
        });

        if (stripeRefunds.data && stripeRefunds.data.length > 0) {
          // Refund exists in Stripe - log it if not already logged
          const existingRefund = stripeRefunds.data[0];
          if (!existingRefunds || existingRefunds.length === 0) {
            this.logger.info('Refund exists in Stripe but not logged, logging it', {
              dealId,
              sessionId: payment.session_id,
              refundId: existingRefund.id
            });
            await this.logDeletionForLostDeal(payment, dealId, 'already_refunded', existingRefund);
          } else {
            this.logger.info('Refund already exists for payment', {
              dealId,
              sessionId: payment.session_id
            });
          }
          
          // Add to refundedPayments for note/task creation (even if already refunded)
          refundedPayments.push({
            payment,
            refund: existingRefund
          });
          
          // Check if tax correction task needed
          await this.checkAndCreateTaxCorrectionTask(payment, dealId, existingRefund);
          
          continue;
        }

        // No refund in Stripe and no refund in DB - need to create refund

        // Get customer email for refund notification
        let refundEmail = null;
        try {
          if (session.customer && typeof session.customer === 'string') {
            // B2B: Get email from Customer
            const customer = await this.stripe.customers.retrieve(session.customer);
            refundEmail = customer.email;
          } else {
            // B2C: Get email from session
            refundEmail = session.customer_email || payment.customer_email;
          }
        } catch (error) {
          this.logger.warn('Failed to get customer email for refund', {
            dealId,
            sessionId: payment.session_id,
            error: error.message
          });
        }

        // Create refund in Stripe
        let refund;
        try {
          refund = await this.stripe.refunds.create({
            payment_intent: typeof paymentIntentId === 'string' ? paymentIntentId : paymentIntentId.id,
            reason: 'requested_by_customer',
            metadata: {
              deal_id: String(dealId),
              session_id: payment.session_id,
              refund_reason: 'deal_lost',
              refund_note: 'Клиент не едет на кэмп'
            },
            // Enable refund receipt email
            refund_application_fee: false,
            reverse_transfer: false
          });
          
          // Stripe automatically sends refund receipt emails to the original payment's receipt_email
          // But we need to ensure the email is set on the original charge
          if (refundEmail) {
            try {
              // Get the original charge to ensure receipt_email is set
              const paymentIntent = await this.stripe.paymentIntents.retrieve(piId, {
                expand: ['charges']
              });
              
              if (paymentIntent.charges?.data?.length > 0) {
                const charge = paymentIntent.charges.data[0];
                // If charge doesn't have receipt_email, set it so refund receipt will be sent
                if (!charge.receipt_email) {
                  await this.stripe.charges.update(charge.id, {
                    receipt_email: refundEmail
                  });
                  this.logger.info('Set receipt_email on charge for refund notification', {
                    chargeId: charge.id,
                    email: refundEmail,
                    dealId
                  });
                }
              }
              
              this.logger.info('Refund receipt email will be sent automatically by Stripe', {
                refundId: refund.id,
                email: refundEmail,
                dealId
              });
            } catch (emailError) {
              this.logger.warn('Failed to set receipt_email for refund notification', {
                refundId: refund.id,
                email: refundEmail,
                error: emailError.message
              });
            }
          }

          this.logger.info('Created refund in Stripe', {
            dealId,
            sessionId: payment.session_id,
            refundId: refund.id,
            amount: refund.amount,
            currency: refund.currency
          });
        } catch (error) {
          // Check if refund already exists
          if (error.code === 'charge_already_refunded') {
            this.logger.info('Payment already refunded', {
              dealId,
              sessionId: payment.session_id
            });
            // Still log the deletion for reporting
            await this.logDeletionForLostDeal(payment, dealId, 'already_refunded');
            continue;
          }
          throw error;
        }

        // Log deletion with refund information
        await this.logDeletionForLostDeal(payment, dealId, 'refunded', refund);

        // Check if refund is in different month than payment - create tax correction task
        await this.checkAndCreateTaxCorrectionTask(payment, dealId, refund);

        // Track refunded payment for note
        refundedPayments.push({
          payment,
          refund
        });

        summary.refundsCreated = (summary.refundsCreated || 0) + 1;
      } catch (error) {
        this.logger.error('Failed to refund payment', {
          dealId,
          sessionId: payment.session_id,
          error: error.message
        });
        if (summary.errors) {
          summary.errors.push({
            dealId,
            sessionId: payment.session_id,
            reason: error.message
          });
        }
      }
    }

    // Add note to deal about refunds (if any were processed)
    if (refundedPayments.length > 0) {
      try {
        await this.addRefundNoteToDeal(dealId, refundedPayments);
      } catch (error) {
        this.logger.warn('Failed to add refund note to deal', {
          dealId,
          error: error.message
        });
      }

      // Send SendPulse notification about refund
      try {
        await this.sendRefundNotificationForDeal(dealId, refundedPayments);
      } catch (error) {
        this.logger.warn('Failed to send refund notification', {
          dealId,
          error: error.message
        });
      }
    }
  }

  async cancelDealCheckoutSessions(dealId) {
    if (!dealId) {
      return { cancelled: 0, removed: 0 };
    }

    let cancelled = 0;
    const sessionIdsToCancel = new Set();

    // 1. Получаем сессии из базы данных
    const payments = await this.repository.listPayments({ dealId: String(dealId) });
    for (const payment of payments) {
      if (payment?.session_id && payment.payment_status !== 'paid') {
        sessionIdsToCancel.add(payment.session_id);
      }
    }

    // 2. Также ищем сессии в Stripe по metadata.deal_id (важно для случаев, когда сессии не сохранены в БД)
    try {
      const sessions = await this.stripe.checkout.sessions.list({
        limit: 100
      });
      
      const dealSessions = sessions.data.filter(s => 
        s.metadata && s.metadata.deal_id === String(dealId) &&
        s.status === 'open' && // Только активные сессии
        s.payment_status !== 'paid' // Не оплаченные
      );
      
      for (const session of dealSessions) {
        sessionIdsToCancel.add(session.id);
      }
      
      if (dealSessions.length > 0) {
        this.logger.info(`Найдено активных сессий в Stripe для отмены | Deal: ${dealId} | Количество: ${dealSessions.length}`);
      }
    } catch (error) {
      this.logger.warn('Failed to list Stripe sessions for cancellation', {
        dealId,
        error: error.message
      });
    }

    // 3. Отменяем все найденные сессии
    for (const sessionId of sessionIdsToCancel) {
      try {
        await this.stripe.checkout.sessions.expire(sessionId);
        cancelled += 1;
        this.logger.info('Expired Stripe Checkout Session for deleted deal', {
          dealId,
          sessionId
        });
      } catch (error) {
        if (error.code === 'resource_missing') {
          this.logger.info('Stripe Checkout Session already missing', {
            dealId,
            sessionId
          });
        } else {
          this.logger.warn('Failed to expire Stripe Checkout Session', {
            dealId,
            sessionId,
            error: error.message
          });
        }
      }
    }

    // 4. Удаляем записи из базы данных
    const deletionResult = await this.repository.deletePaymentsByDealId(dealId);
    if (deletionResult.deleted > 0) {
      this.logger.info('Removed stored Stripe payments for deleted deal', {
        dealId,
        deleted: deletionResult.deleted
      });
    }

    return {
      cancelled,
      removed: deletionResult.deleted || 0
    };
  }

  /**
   * Log deletion for a lost deal payment
   * @param {Object} payment - Payment record from database
   * @param {number} dealId - Deal ID
   * @param {string} status - Refund status (refunded, already_refunded)
   * @param {Object} refund - Stripe refund object (optional)
   * @returns {Promise<void>}
   */
  async logDeletionForLostDeal(payment, dealId, status, refund = null) {
    const currency = normaliseCurrency(payment.currency || 'PLN');
    const amount = payment.original_amount || 0;
    const amountPln = payment.amount_pln || 0;

    // Convert amounts to negative for refund
    const refundAmount = -Math.abs(amount);
    const refundAmountPln = -Math.abs(amountPln);

    const payload = {
      payment_id: payment.session_id,
      deal_id: String(dealId),
      reason: 'deal_lost',
      amount: refundAmount,
      currency,
      amount_pln: refundAmountPln,
      logged_at: new Date().toISOString(),
      metadata: {
        deal_id: String(dealId),
        session_id: payment.session_id,
        refund_reason: 'deal_lost',
        refund_note: 'Клиент не едет на кэмп',
        refund_status: status,
        refund_id: refund?.id || null
      },
      raw_payload: {
        payment,
        refund: refund || null
      }
    };

    await this.repository.logDeletion(payload);
  }

  /**
   * Add payment note to deal
   * @param {number} dealId - Deal ID
   * @param {Object} paymentInfo - Payment information
   * @param {string} paymentInfo.paymentType - Payment type (deposit, rest, single)
   * @param {number} paymentInfo.amount - Payment amount in original currency
   * @param {string} paymentInfo.currency - Currency code
   * @param {number} paymentInfo.amountPln - Payment amount in PLN
   * @param {string} paymentInfo.sessionId - Stripe session ID
   * @returns {Promise<Object>} - Result of adding note
   */
  async addPaymentNoteToDeal(dealId, paymentInfo) {
    const { paymentType, amount, currency, amountPln, sessionId, invoiceUrl } = paymentInfo;

    try {
      // Check if note with this session ID already exists to avoid duplicates
      try {
        const dealNotes = await this.pipedriveClient.getDealNotes(dealId);
        if (dealNotes && dealNotes.success && dealNotes.notes) {
          const sessionIdInNote = sessionId;
          const existingNote = dealNotes.notes.find(note => {
            const noteContent = note.content || '';
            // Check if note contains this session ID
            return noteContent.includes(sessionIdInNote);
          });
          
          if (existingNote) {
            this.logger.info('Payment note already exists for this session, skipping creation', {
              dealId,
              sessionId,
              existingNoteId: existingNote.id
            });
            return {
              success: true,
              skipped: true,
              reason: 'note_already_exists',
              note: existingNote
            };
          }
        }
      } catch (notesCheckError) {
        // If we can't check notes, continue (don't block note creation)
        this.logger.warn('Failed to check existing notes before creating payment note', {
          dealId,
          sessionId,
          error: notesCheckError.message
        });
      }

      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      const paymentTypeLabel = paymentType === 'deposit' ? 'Предоплата' : paymentType === 'rest' ? 'Остаток' : 'Платеж';

      // Build Stripe Dashboard link for Checkout Session
      const stripeMode = this.mode || 'test';
      const dashboardBaseUrl = stripeMode === 'test' 
        ? 'https://dashboard.stripe.com/test/checkout_sessions'
        : 'https://dashboard.stripe.com/checkout_sessions';
      const stripeDashboardLink = `${dashboardBaseUrl}/${sessionId}`;

      let noteContent = `💳 ${paymentTypeLabel} получена через Stripe\n\n`;
      noteContent += `Сумма: ${formatAmount(amount)} ${currency}`;
      if (amountPln && currency !== 'PLN') {
        noteContent += ` (${formatAmount(amountPln)} PLN)`;
      }
      noteContent += `\n\nСсылка на транзакцию: ${stripeDashboardLink}`;
      if (invoiceUrl) {
        noteContent += `\n\n📄 Инвойс: ${invoiceUrl}`;
      }
      noteContent += `\nДата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`;

      const result = await this.pipedriveClient.addNoteToDeal(dealId, noteContent);

      if (result.success) {
        this.logger.info('Payment note added to deal', {
          dealId,
          paymentType,
          amount,
          currency,
          noteId: result.note?.id
        });
      } else {
        this.logger.warn('Failed to add payment note to deal', {
          dealId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding payment note to deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Добавить заметку о том, что все платежи оплачены
   * @param {number} dealId - ID сделки
   * @param {Object} paymentInfo - Информация о платежах
   * @returns {Promise<Object>} - Результат добавления заметки
   */
  async addAllPaymentsCompleteNote(dealId, paymentInfo) {
    const { depositPayment, restPayment, depositSessionId, restSessionId } = paymentInfo;

    try {
      // Проверяем, не существует ли уже такая заметка
      try {
        const dealNotes = await this.pipedriveClient.getDealNotes(dealId);
        if (dealNotes && dealNotes.success && dealNotes.notes) {
          const existingNote = dealNotes.notes.find(note => {
            const noteContent = note.content || '';
            return noteContent.includes('✅ Все платежи оплачены') || 
                   noteContent.includes('Все платежи получены');
          });
          
          if (existingNote) {
            this.logger.info('All payments complete note already exists, skipping creation', {
              dealId,
              existingNoteId: existingNote.id
            });
            return {
              success: true,
              skipped: true,
              reason: 'note_already_exists',
              note: existingNote
            };
          }
        }
      } catch (notesCheckError) {
        this.logger.warn('Failed to check existing notes before creating all payments complete note', {
          dealId,
          error: notesCheckError.message
        });
      }

      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      
      // Собираем информацию о платежах
      const depositAmount = depositPayment?.original_amount || depositPayment?.amount || 0;
      const depositCurrency = depositPayment?.currency || 'PLN';
      const depositAmountPln = depositPayment?.amount_pln || 0;
      
      const restAmount = restPayment?.original_amount || restPayment?.amount || 0;
      const restCurrency = restPayment?.currency || 'PLN';
      const restAmountPln = restPayment?.amount_pln || 0;
      
      const totalAmount = depositAmount + restAmount;
      const totalAmountPln = depositAmountPln + restAmountPln;
      const currency = depositCurrency; // Используем валюту первого платежа
      
      // Строим ссылки на Stripe Dashboard
      const stripeMode = this.mode || 'test';
      const dashboardBaseUrl = stripeMode === 'test' 
        ? 'https://dashboard.stripe.com/test/checkout_sessions'
        : 'https://dashboard.stripe.com/checkout_sessions';
      
      let noteContent = `✅ Все платежи оплачены!\n\n`;
      noteContent += `💰 Общая сумма: ${formatAmount(totalAmount)} ${currency}`;
      if (totalAmountPln && currency !== 'PLN') {
        noteContent += ` (${formatAmount(totalAmountPln)} PLN)`;
      }
      noteContent += `\n\n`;
      
      // Детали по платежам
      noteContent += `📋 Детали платежей:\n`;
      noteContent += `1. Предоплата: ${formatAmount(depositAmount)} ${depositCurrency}`;
      if (depositAmountPln && depositCurrency !== 'PLN') {
        noteContent += ` (${formatAmount(depositAmountPln)} PLN)`;
      }
      if (depositSessionId) {
        noteContent += `\n   Ссылка: ${dashboardBaseUrl}/${depositSessionId}`;
      }
      
      noteContent += `\n\n`;
      noteContent += `2. Остаток: ${formatAmount(restAmount)} ${restCurrency}`;
      if (restAmountPln && restCurrency !== 'PLN') {
        noteContent += ` (${formatAmount(restAmountPln)} PLN)`;
      }
      if (restSessionId) {
        noteContent += `\n   Ссылка: ${dashboardBaseUrl}/${restSessionId}`;
      }
      
      noteContent += `\n\nДата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`;

      const result = await this.pipedriveClient.addNoteToDeal(dealId, noteContent);

      if (result.success) {
        this.logger.info('All payments complete note added to deal', {
          dealId,
          totalAmount,
          currency,
          noteId: result.note?.id
        });
      } else {
        this.logger.warn('Failed to add all payments complete note to deal', {
          dealId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding all payments complete note to deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async addRefundNoteToDeal(dealId, refundedPayments) {
    try {
      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      
      let noteContent = `🔄 Возврат средств (Refund)\n\n`;
      
      // For single payment, don't show count
      if (refundedPayments.length > 1) {
        noteContent += `Обработано возвратов: ${refundedPayments.length}\n\n`;
      }

      let totalAmount = 0;
      let totalAmountPln = 0;

      refundedPayments.forEach((item, index) => {
        const { payment, refund } = item;
        const currency = normaliseCurrency(payment.currency || 'PLN');
        const amount = payment.original_amount || 0;
        const amountPln = payment.amount_pln || 0;
        
        totalAmount += amount;
        totalAmountPln += amountPln;

        // Build Stripe Dashboard link for refund
        const stripeMode = this.mode || 'test';
        const refundDashboardUrl = stripeMode === 'test'
          ? `https://dashboard.stripe.com/test/refunds/${refund.id}`
          : `https://dashboard.stripe.com/refunds/${refund.id}`;

        // For multiple payments, show numbered list
        if (refundedPayments.length > 1) {
          noteContent += `${index + 1}. Платеж ${index + 1}:\n`;
          noteContent += `   Сумма возврата: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            noteContent += ` (${formatAmount(amountPln)} PLN)`;
          }
          noteContent += `\n   Refund ID: ${refund.id}\n`;
          noteContent += `   Ссылка на возврат: ${refundDashboardUrl}\n\n`;
        } else {
          // For single payment, show simpler format
          noteContent += `Сумма возврата: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            noteContent += ` (${formatAmount(amountPln)} PLN)`;
          }
          noteContent += `\nRefund ID: ${refund.id}\n`;
          noteContent += `Ссылка на возврат: ${refundDashboardUrl}\n\n`;
        }
      });

      // For multiple payments, show total amount
      if (refundedPayments.length > 1) {
        noteContent += `💰 Общая сумма возврата: ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          noteContent += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        noteContent += `\n\n`;
      }
      
      noteContent += `Дата: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`;

      const result = await this.pipedriveClient.addNoteToDeal(dealId, noteContent);

      if (result.success) {
        this.logger.info('Refund note added to deal', {
          dealId,
          refundsCount: refundedPayments.length,
          totalAmount,
          noteId: result.note?.id
        });
      } else {
        this.logger.warn('Failed to add refund note to deal', {
          dealId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error adding refund note to deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if refund is in different month than payment and create tax correction task if needed
   * @param {Object} payment - Payment record from database
   * @param {number} dealId - Deal ID
   * @param {Object} refund - Stripe refund object
   * @returns {Promise<void>}
   */
  async checkAndCreateTaxCorrectionTask(payment, dealId, refund) {
    try {
      // Get payment date from payment record
      const paymentDate = payment.created_at ? new Date(payment.created_at) : null;
      if (!paymentDate) {
        this.logger.warn('Cannot determine payment date for tax correction check', {
          dealId,
          sessionId: payment.session_id
        });
        return;
      }

      // Get refund date from refund object (Stripe timestamp)
      const refundDate = refund.created ? new Date(refund.created * 1000) : new Date();
      
      // Compare months (year-month)
      const paymentMonth = `${paymentDate.getFullYear()}-${String(paymentDate.getMonth() + 1).padStart(2, '0')}`;
      const refundMonth = `${refundDate.getFullYear()}-${String(refundDate.getMonth() + 1).padStart(2, '0')}`;

      // If same month, no task needed
      if (paymentMonth === refundMonth) {
        this.logger.debug('Refund and payment in same month, no tax correction needed', {
          dealId,
          paymentMonth,
          refundMonth
        });
        return;
      }

      // Different months - need tax correction task
      this.logger.info('Refund in different month than payment, creating tax correction task', {
        dealId,
        paymentMonth,
        refundMonth,
        paymentDate: paymentDate.toISOString(),
        refundDate: refundDate.toISOString()
      });

      // Get product name
      let productName = 'Неизвестный продукт';
      if (payment.product_id) {
        try {
          const productLink = await this.repository.findProductLinkById(payment.product_id);
          if (productLink?.crm_product_name) {
            productName = productLink.crm_product_name;
          }
        } catch (error) {
          this.logger.warn('Failed to get product name for tax correction task', {
            dealId,
            productId: payment.product_id,
            error: error.message
          });
        }
      }

      // Format month name in Russian
      const monthNames = [
        'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне',
        'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'
      ];
      const paymentMonthName = monthNames[paymentDate.getMonth()];
      const paymentYear = paymentDate.getFullYear();

      // Create task in Pipedrive
      const taskSubject = `Сделать корректировку по продукту "${productName}" в ${paymentMonthName} ${paymentYear}`;
      const taskNote = `Рефанд был сделан в ${refundMonth}, а платеж был в ${paymentMonth}. ` +
        `Необходимо сделать корректировку налогов.\n\n` +
        `Сумма возврата: ${payment.original_amount || 0} ${payment.currency || 'PLN'}\n` +
        `Refund ID: ${refund.id}\n` +
        `Session ID: ${payment.session_id}`;

      const taskResult = await this.pipedriveClient.createTask({
        deal_id: dealId,
        subject: taskSubject,
        type: 'task',
        note: taskNote,
        due_date: new Date().toISOString().split('T')[0] // Due today
      });

      if (taskResult.success) {
        this.logger.info('Tax correction task created', {
          dealId,
          taskId: taskResult.task?.id,
          productName,
          paymentMonth,
          refundMonth
        });
      } else {
        this.logger.warn('Failed to create tax correction task', {
          dealId,
          error: taskResult.error
        });
      }
    } catch (error) {
      this.logger.error('Error checking/creating tax correction task', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Send refund notification via SendPulse
   * @param {number} dealId - Deal ID
   * @param {Array} refundedPayments - Array of refunded payments with refund info
   * @returns {Promise<Object>} - Result of sending notification
   */
  async sendRefundNotificationForDeal(dealId, refundedPayments) {
    if (!this.sendpulseClient) {
      this.logger.warn('SendPulse client not initialized, skipping refund notification', { dealId });
      return { success: false, error: 'SendPulse client not initialized' };
    }

    try {
      // Get deal with person data
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.person) {
        this.logger.warn('Failed to get deal/person data for SendPulse refund notification', { dealId });
        return { success: false, error: 'Failed to get deal/person data' };
      }

      const person = fullDealResult.person;
      const sendpulseId = this.getSendpulseId(person);

      if (!sendpulseId) {
        this.logger.info('SendPulse ID not found for person, skipping refund notification', {
          dealId,
          personId: person.id
        });
        return { success: false, error: 'SendPulse ID not found' };
      }

      const formatAmount = (amt) => parseFloat(amt).toFixed(2);
      const stripeMode = this.mode || 'test';

      // Build refund notification message
      let message = `*Возврат средств*\n\n`;
      message += `Мы обработали ваш запрос на возврат средств.\n\n`;

      // Add refund details
      let totalAmount = 0;
      let totalAmountPln = 0;
      const refundLinks = [];

      refundedPayments.forEach((item, index) => {
        const { payment, refund } = item;
        const currency = normaliseCurrency(payment.currency || 'PLN');
        const amount = payment.original_amount || 0;
        const amountPln = payment.amount_pln || 0;
        
        totalAmount += amount;
        totalAmountPln += amountPln;

        // Get refund receipt URL if available (for completed refunds)
        let refundUrl = null;
        if (refund.receipt_url) {
          refundUrl = refund.receipt_url;
        } else {
          // Build Stripe Dashboard link for refund tracking
          refundUrl = stripeMode === 'test'
            ? `https://dashboard.stripe.com/test/refunds/${refund.id}`
            : `https://dashboard.stripe.com/refunds/${refund.id}`;
        }

        if (refundedPayments.length > 1) {
          message += `${index + 1}. Возврат: ${formatAmount(amount)} ${currency}`;
          if (amountPln && currency !== 'PLN') {
            message += ` (${formatAmount(amountPln)} PLN)`;
          }
          message += `\n`;
        }

        refundLinks.push({
          amount,
          currency,
          url: refundUrl,
          refundId: refund.id
        });
      });

      if (refundedPayments.length === 1) {
        message += `*Сумма возврата:* ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          message += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        message += `\n\n`;
      } else {
        message += `\n*Общая сумма возврата:* ${formatAmount(totalAmount)} ${refundedPayments[0]?.payment?.currency || 'PLN'}`;
        if (totalAmountPln && refundedPayments[0]?.payment?.currency !== 'PLN') {
          message += ` (${formatAmount(totalAmountPln)} PLN)`;
        }
        message += `\n\n`;
      }

      // Add refund timeline information
      message += `*Сроки возврата:*\n`;
      message += `Средства поступят на ваш счет в течение *5-10 рабочих дней* (в зависимости от банка).\n\n`;

      // Add tracking links
      if (refundLinks.length > 0) {
        message += `*Отслеживание возврата:*\n`;
        refundLinks.forEach((link, index) => {
          if (refundLinks.length > 1) {
            message += `${index + 1}. `;
          }
          message += `[Ссылка на возврат](${link.url})\n`;
        });
      }

      // Send message via SendPulse
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('Refund notification sent via SendPulse', {
          dealId,
          sendpulseId,
          refundsCount: refundedPayments.length
        });
        
        // Phase 9: Update SendPulse contact custom field with deal_id (Phase 0: Code Review Fixes)
        try {
          await this.sendpulseClient.updateContactCustomField(sendpulseId, {
            deal_id: String(dealId)
          });
          this.logger.debug('SendPulse contact deal_id updated', {
            dealId,
            sendpulseId
          });
        } catch (error) {
          this.logger.warn('Failed to update SendPulse contact deal_id', {
            dealId,
            sendpulseId,
            error: error.message
          });
          // Не прерываем выполнение, если обновление deal_id не удалось
        }
      } else {
        this.logger.warn('Failed to send refund notification via SendPulse', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending refund notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get SendPulse ID from person
   * @param {Object} person - Person object from Pipedrive
   * @returns {string|null} - SendPulse ID or null
   */
  getSendpulseId(person) {
    if (!person) return null;
    const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];
    if (!sendpulseId || String(sendpulseId).trim() === '') {
      return null;
    }
    return String(sendpulseId).trim();
  }

  /**
   * Send payment notification via SendPulse with payment schedule and links
   * @param {number} dealId - Deal ID
   * @param {Object} options - Notification options
   * @param {string} options.paymentSchedule - Payment schedule type ('50/50' or '100%')
   * @param {Array} options.sessions - Array of session objects with id, url, type, amount
   * @param {string} options.currency - Currency code
   * @param {number} options.totalAmount - Total amount
   * @returns {Promise<Object>} - Result of sending notification
   */
  async sendPaymentNotificationForDeal(dealId, options = {}) {
    const { paymentSchedule, sessions = [], currency, totalAmount } = options;
    const sessionsAmount = sessions.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const normalizedTotalAmount =
      typeof totalAmount === 'number' ? totalAmount : parseFloat(totalAmount) || 0;
    const dealTotalAmount =
      normalizedTotalAmount > 0 ? normalizedTotalAmount : (sessionsAmount || 0);
    const effectiveTotalAmount = sessions.length > 0 ? sessionsAmount : dealTotalAmount;
    
    // ВАЖНО: cashRemainder должен учитывать только реальные наличные платежи из полей сделки
    // Для графика 50/50 с одной сессией разница между dealTotalAmount и sessionsAmount - это не наличные,
    // а вторая часть платежа, которая еще не создана
    let cashRemainder = 0;
    try {
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (fullDealResult.success && fullDealResult.deal) {
        const cashFields = extractCashFields(fullDealResult.deal);
        if (cashFields && Number.isFinite(cashFields.amount) && cashFields.amount > 0) {
          cashRemainder = roundBankers(cashFields.amount);
        }
      }
    } catch (error) {
      this.logger.warn('Failed to get cash fields for notification', {
        dealId,
        error: error.message
      });
      // Fallback: если не удалось получить наличные, используем старую логику
      // но только если график не 50/50 с одной сессией
      if (paymentSchedule !== '50/50' || sessions.length >= 2) {
        cashRemainder = dealTotalAmount > 0 && sessionsAmount > 0
          ? Math.max(dealTotalAmount - sessionsAmount, 0)
          : 0;
      }
    }

    this.logger.info(`📧 Попытка отправить уведомление о платеже | Deal ID: ${dealId} | Sessions: ${sessions.length}`, {
      dealId,
      sessionsCount: sessions.length,
      paymentSchedule
    });

    if (!this.sendpulseClient) {
      this.logger.warn(`⚠️  SendPulse клиент не инициализирован, уведомление не отправлено | Deal ID: ${dealId}`, { dealId });
      return { success: false, error: 'SendPulse client not initialized' };
    }

    try {
      // Get deal with person data
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      
      // ВАЖНО: Проверяем статус сделки перед отправкой уведомления
      // Если сделка закрыта как "lost", не отправляем уведомления
      if (fullDealResult.success && fullDealResult.deal) {
        const dealStatus = fullDealResult.deal.status;
        if (dealStatus === 'lost') {
          this.logger.warn(`⚠️  Сделка закрыта как потерянная, уведомление не отправляется | Deal ID: ${dealId} | Status: lost`, {
            dealId,
            status: dealStatus,
            lostReason: fullDealResult.deal.lost_reason || 'не указан'
          });
          return { success: false, error: 'Deal is lost, notifications disabled' };
        }
      }
      
      if (!fullDealResult.success || !fullDealResult.person) {
        this.logger.warn(`⚠️  Не удалось получить данные сделки/персоны для уведомления | Deal ID: ${dealId}`, { 
          dealId,
          success: fullDealResult.success,
          hasPerson: !!fullDealResult.person,
          hasDeal: !!fullDealResult.deal
        });
        return { success: false, error: 'Failed to get deal/person data' };
      }

      const deal = fullDealResult.deal;
      const person = fullDealResult.person;
      
      // Get discount from deal (check various possible field names)
      const getDiscount = (deal) => {
        // Try different possible field names for discount
        const discountFields = [
          'discount',
          'discount_amount',
          'discount_percent',
          'discount_value',
          'rabat',
          'rabat_amount',
          'rabat_percent'
        ];
        
        for (const field of discountFields) {
          if (deal[field] !== null && deal[field] !== undefined && deal[field] !== '') {
            const value = typeof deal[field] === 'number' ? deal[field] : parseFloat(deal[field]);
            if (!isNaN(value) && value > 0) {
              return { value, type: field.includes('percent') ? 'percent' : 'amount' };
            }
          }
        }
        return null;
      };
      
      // Get discount from product (check discount field in product)
      const getProductDiscount = async (dealId) => {
        try {
          const dealProductsResult = await this.pipedriveClient.getDealProducts(dealId);
          if (dealProductsResult.success && dealProductsResult.products && dealProductsResult.products.length > 0) {
            const firstProduct = dealProductsResult.products[0];
            
            // Check for discount in product
            if (firstProduct.discount !== null && firstProduct.discount !== undefined && firstProduct.discount !== '') {
              const discountValue = typeof firstProduct.discount === 'number' 
                ? firstProduct.discount 
                : parseFloat(firstProduct.discount);
              
              if (!isNaN(discountValue) && discountValue > 0) {
                const discountType = firstProduct.discount_type === 'percent' ? 'percent' : 'amount';
                const itemPrice = typeof firstProduct.item_price === 'number' 
                  ? firstProduct.item_price 
                  : parseFloat(firstProduct.item_price) || 0;
                
                return {
                  value: discountValue,
                  type: discountType,
                  itemPrice: itemPrice,
                  productName: firstProduct.name || firstProduct.product?.name || 'Product'
                };
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to get product discount', {
            dealId,
            error: error.message
          });
        }
        return null;
      };
      
      const discountInfo = getDiscount(deal);
      const productDiscountInfo = await getProductDiscount(dealId);
      
      // Calculate base amount - IMPORTANT: if product discount exists, use itemPrice as base
      // because deal.value already includes the discount
      let dealBaseAmount = parseFloat(deal.value) || effectiveTotalAmount;
      
      // If product discount exists, use itemPrice as base amount (before discount)
      // because deal.value and sumPrice already include the discount
      if (productDiscountInfo && productDiscountInfo.itemPrice > 0) {
        dealBaseAmount = productDiscountInfo.itemPrice;
        this.logger.debug('💰 Используем itemPrice как базовую сумму (до скидки)', {
          dealId,
          itemPrice: productDiscountInfo.itemPrice,
          dealValue: deal.value,
          note: 'deal.value уже включает скидку продукта'
        });
      }
      
      // Calculate discount amount (prioritize product discount over deal discount)
      let discountAmount = 0;
      let discountSource = null;
      
      if (productDiscountInfo) {
        // Product discount takes priority
        if (productDiscountInfo.type === 'percent') {
          discountAmount = roundBankers(productDiscountInfo.itemPrice * productDiscountInfo.value / 100);
        } else {
          discountAmount = productDiscountInfo.value;
        }
        discountSource = 'product';
        this.logger.debug('💰 Скидка продукта найдена', {
          dealId,
          productName: productDiscountInfo.productName,
          discountValue: productDiscountInfo.value,
          discountType: productDiscountInfo.type,
          itemPrice: productDiscountInfo.itemPrice,
          discountAmount,
          discountSource
        });
      } else if (discountInfo) {
        // Fall back to deal discount
        // For deal discount, use deal.value as base (it doesn't include deal-level discount)
        const baseForDealDiscount = parseFloat(deal.value) || effectiveTotalAmount;
        if (discountInfo.type === 'percent') {
          discountAmount = roundBankers(baseForDealDiscount * discountInfo.value / 100);
        } else {
          discountAmount = discountInfo.value;
        }
        discountSource = 'deal';
        this.logger.debug('💰 Скидка сделки найдена', {
          dealId,
          discountValue: discountInfo.value,
          discountType: discountInfo.type,
          dealBaseAmount: baseForDealDiscount,
          discountAmount,
          discountSource
        });
      }
      
      // Calculate total with discount
      // If product discount was used, totalWithDiscount should match deal.value (which already includes discount)
      // If deal discount was used, calculate from deal.value
      const totalWithDiscount = productDiscountInfo 
        ? Math.max(0, dealBaseAmount - discountAmount)  // itemPrice - discount = correct total
        : Math.max(0, (parseFloat(deal.value) || effectiveTotalAmount) - discountAmount);  // deal.value - deal discount
      
      // Детали расчетов только в debug (слишком много логов)
      this.logger.debug('💰 Итоговый расчет суммы с учетом скидки', {
        dealId,
        dealBaseAmount,
        discountAmount,
        discountSource,
        totalWithDiscount,
        hasProductDiscount: !!productDiscountInfo,
        hasDealDiscount: !!discountInfo
      });
      
      // Детали персоны только в debug
      this.logger.debug(`📧 Данные персоны получены | Deal ID: ${dealId} | Person ID: ${person.id}`, {
        dealId,
        personId: person.id,
        personName: person.name,
        personEmails: person.email?.map(e => e.value) || [],
        personFields: Object.keys(person).filter(k => k.startsWith('ff') || k.includes('sendpulse') || k.includes('SendPulse')).map(k => `${k}: ${person[k]}`)
      });
      
      const sendpulseId = this.getSendpulseId(person);
      
      // SendPulse ID проверка только в debug
      this.logger.debug(`📧 SendPulse ID проверка | Deal ID: ${dealId} | Person ID: ${person.id} | SendPulse ID: ${sendpulseId || 'не найден'} | Поле: ${this.SENDPULSE_ID_FIELD_KEY}`, {
        dealId,
        personId: person.id,
        sendpulseId,
        sendpulseFieldKey: this.SENDPULSE_ID_FIELD_KEY,
        sendpulseFieldValue: person[this.SENDPULSE_ID_FIELD_KEY] || 'не найдено'
      });

      if (!sendpulseId) {
        this.logger.warn(`⚠️  SendPulse ID не найден для персоны, уведомление не отправлено | Deal ID: ${dealId} | Person ID: ${person.id} | Person Name: ${person.name}`, {
          dealId,
          personId: person.id,
          personName: person.name,
          personEmails: person.email?.map(e => e.value) || []
        });
        return { success: false, error: 'SendPulse ID not found' };
      }

      // Calculate payment dates based on close_date
      // ВАЖНО: Приоритет отдаем expected_close_date из API (deal), так как это основное поле
      const closeDate = deal.expected_close_date ||  // Приоритет 1: API deal
                       deal['expected_close_date'] ||  // Приоритет 2: API deal (bracket)
                       deal.close_date ||  // Приоритет 3: API deal close_date
                       deal['close_date'] ||  // Приоритет 4: API deal close_date (bracket)
                       null;
      let firstPaymentDate = null;
      let secondPaymentDate = null;
      let singlePaymentDate = null;

      if (closeDate) {
        try {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          
          if (paymentSchedule === '50/50') {
            // First payment: now (or today)
            firstPaymentDate = new Date(today);
            firstPaymentDate.setHours(0, 0, 0, 0);
            
            // Second payment: 1 month before close_date
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
            secondPaymentDate.setHours(0, 0, 0, 0);
          } else {
            // Single payment: before close_date (or now if close_date is soon)
            const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
            if (daysDiff > 7) {
              // If more than 7 days, set payment date to 7 days before close_date
              singlePaymentDate = new Date(expectedCloseDate);
              singlePaymentDate.setDate(singlePaymentDate.getDate() - 7);
            } else {
              // If less than 7 days, payment is due now
              singlePaymentDate = new Date(today);
            }
            singlePaymentDate.setHours(0, 0, 0, 0);
          }
        } catch (error) {
          this.logger.warn('Failed to calculate payment dates', {
            dealId,
            closeDate,
            error: error.message
          });
        }
      }

      // Format date helper
      const formatDate = (date) => {
        if (!date) return 'не указана';
        return date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          timeZone: 'Europe/Warsaw'
        });
      };

      // Build message with payment schedule and links (using Markdown formatting)
      const formatAmount = (amount) => {
        const num = Number(amount);
        if (Number.isNaN(num)) {
          return '0.00';
        }
        return num.toFixed(2);
      };

      let message = '';
      
      const depositSession = sessions.find(s => s.type === 'deposit');
      const restSession = sessions.find(s => s.type === 'rest');
      const singleSession = sessions[0];
      
      // Сценарий 1: 100% Stripe (только Stripe, без кеша)
      if (paymentSchedule === '100%' && sessions.length >= 1 && cashRemainder === 0) {
        message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
        message += `[Ссылка на оплату](${singleSession.url})\n`;
        message += `Ссылка действует 24 часа\n\n`;
        
        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            // Show base amount, discount, and total
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
          }
        }
        
        message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n`;
      }
      // Сценарий 2: 50/50 Stripe (только Stripe, без кеша) - только первый платеж
      else if (paymentSchedule === '50/50' && sessions.length === 1 && cashRemainder === 0) {
        const firstSession = sessions[0];
        message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
        message += `[Ссылка на оплату](${firstSession.url})\n`;
        message += `Ссылка действует 24 часа\n\n`;
        
        message += `График: 50/50 (первый платеж)\n`;
        if (secondPaymentDate) {
          message += `📧 Вторую ссылку на оплату пришлём позже (${formatDate(secondPaymentDate)})\n`;
        } else {
          message += `📧 Вторую ссылку на оплату пришлём позже\n`;
        }
        message += `\n`;
        
        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
          }
        }
        
        message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n`;
        message += `Предоплата: ${formatAmount(firstSession.amount)} ${currency}\n`;
      }
      // Сценарий 2b: 50/50 Stripe (только Stripe, без кеша) - оба платежа
      else if (paymentSchedule === '50/50' && sessions.length >= 2 && cashRemainder === 0) {
        message = `Привет! Для тебя созданы ссылки на оплату через Stripe.\n\n`;
        
        if (depositSession) {
          message += `1. Предоплата 50%: ${formatAmount(depositSession.amount)} ${currency}\n`;
          message += `[Оплатить предоплату](${depositSession.url})\n`;
          message += `Ссылка действует 24 часа\n\n`;
        }

        if (restSession) {
          message += `2. Остаток 50%: ${formatAmount(restSession.amount)} ${currency}`;
          if (secondPaymentDate) {
            message += ` нужно будет оплатить ${formatDate(secondPaymentDate)}, тебе придет напоминание и ссылка`;
          }
          message += `\n\n`;
        }

        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            // Show base amount, discount, and total for clarity
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
          }
        }

        message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n`;
      }
      // Сценарий 3: 100% с кешем (Stripe + наличные)
      else if (paymentSchedule === '100%' && sessions.length >= 1 && cashRemainder > 0) {
        message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
        message += `[Ссылка на оплату](${singleSession.url})\n`;
        message += `Ссылка действует 24 часа\n\n`;
        
        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            // Show base amount, discount, and total
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
            message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n\n`;
          }
        }
        
        message += `Оплата через Stripe: ${formatAmount(sessionsAmount)} ${currency}\n`;
        message += `Оплата наличными: ${formatAmount(cashRemainder)} ${currency}\n`;
      }
      // Сценарий 4: 50/50 с кешем (Stripe + наличные) - только первый платеж
      else if (paymentSchedule === '50/50' && sessions.length === 1 && cashRemainder > 0) {
        const firstSession = sessions[0];
        message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
        message += `[Ссылка на оплату](${firstSession.url})\n`;
        message += `Ссылка действует 24 часа\n\n`;
        
        message += `График: 50/50 (первый платеж)\n`;
        if (secondPaymentDate) {
          message += `📧 Вторую ссылку на оплату пришлём позже (${formatDate(secondPaymentDate)})\n`;
        } else {
          message += `📧 Вторую ссылку на оплату пришлём позже\n`;
        }
        message += `\n`;
        
        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
            message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n\n`;
          }
        }
        
        message += `Оплата через Stripe: ${formatAmount(sessionsAmount)} ${currency}\n`;
        message += `Оплата наличными: ${formatAmount(cashRemainder)} ${currency}\n`;
      }
      // Сценарий 4b: 50/50 с кешем (Stripe + наличные) - оба платежа
      else if (paymentSchedule === '50/50' && sessions.length >= 2 && cashRemainder > 0) {
        message = `Привет! Для тебя созданы ссылки на оплату через Stripe.\n\n`;
        
        if (depositSession) {
          message += `1. Предоплата 50%: ${formatAmount(depositSession.amount)} ${currency}\n`;
          message += `[Оплатить предоплату](${depositSession.url})\n`;
          message += `Ссылка действует 24 часа\n\n`;
        }

        if (restSession) {
          message += `2. Остаток 50%: ${formatAmount(restSession.amount)} ${currency}`;
          if (secondPaymentDate) {
            message += ` нужно будет оплатить ${formatDate(secondPaymentDate)}, тебе придет напоминание и ссылка`;
          }
          message += `\n\n`;
        }

        if (discountAmount > 0) {
          const discountInfoToUse = productDiscountInfo || discountInfo;
          if (discountInfoToUse) {
            // Show base amount, discount, and total for clarity
            message += `Сумма: ${formatAmount(dealBaseAmount)} ${currency}\n`;
            const discountText = discountInfoToUse.type === 'percent'
              ? `${discountInfoToUse.value}% (${formatAmount(discountAmount)} ${currency})`
              : `${formatAmount(discountAmount)} ${currency}`;
            message += `Скидка: ${discountText}\n`;
            message += `Итого: ${formatAmount(totalWithDiscount)} ${currency}\n\n`;
          }
        }

        message += `Оплата через Stripe: ${formatAmount(sessionsAmount)} ${currency}\n`;
        message += `Оплата наличными: ${formatAmount(cashRemainder)} ${currency}\n`;
      }

      // Проверяем, что сообщение не пустое
      if (!message || message.trim().length === 0) {
        this.logger.warn('Message is empty, cannot send notification', {
          dealId,
          paymentSchedule,
          sessionsCount: sessions.length,
          cashRemainder,
          sessionsAmount
        });
        return {
          success: false,
          error: 'Message is empty - no notification template matched the payment scenario'
        };
      }

      // Логируем сообщение перед отправкой для отладки
      this.logger.info('📧 Отправка SendPulse уведомления', {
        dealId,
        sendpulseId,
        paymentSchedule,
        sessionsCount: sessions.length,
        messageLength: message.length,
        messagePreview: message.substring(0, 200) + (message.length > 200 ? '...' : '')
      });

      // Send message via SendPulse
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        this.logger.info('SendPulse payment notification sent successfully', {
          dealId,
          sendpulseId,
          paymentSchedule,
          sessionsCount: sessions.length,
          messageId: result.messageId
        });
        
        // Phase 9: Update SendPulse contact custom field with deal_id (Phase 0: Code Review Fixes)
        try {
          await this.sendpulseClient.updateContactCustomField(sendpulseId, {
            deal_id: String(dealId)
          });
          this.logger.debug('SendPulse contact deal_id updated', {
            dealId,
            sendpulseId
          });
        } catch (error) {
          this.logger.warn('Failed to update SendPulse contact deal_id', {
            dealId,
            sendpulseId,
            error: error.message
          });
          // Не прерываем выполнение, если обновление deal_id не удалось
        }
      } else {
        this.logger.warn('Failed to send SendPulse payment notification', {
          dealId,
          sendpulseId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      this.logger.error('Error sending SendPulse payment notification', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Строит URL для редиректа после платежа с параметрами deal_id
   * @param {string} baseUrl - Базовый URL из переменной окружения
   * @param {string|number} dealId - ID сделки
   * @param {string} type - Тип редиректа ('success' или 'cancel')
   * @returns {string|null} - URL с параметрами или null если baseUrl не задан
   */
  buildCheckoutUrl(baseUrl, dealId, type = 'success') {
    if (!baseUrl) return null;
    
    try {
      const url = new URL(baseUrl);
      url.searchParams.set('deal_id', String(dealId));
      url.searchParams.set('type', type);
      return url.toString();
    } catch (error) {
      // Если baseUrl не валидный URL, возвращаем как есть с параметрами через ?
      if (baseUrl.includes('?')) {
        return `${baseUrl}&deal_id=${dealId}&type=${type}`;
      }
      return `${baseUrl}?deal_id=${dealId}&type=${type}`;
    }
  }
}

module.exports = StripeProcessorService;
