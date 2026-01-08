const supabase = require('./supabaseClient');
const logger = require('../utils/logger');
const PipedriveClient = require('./pipedrive');
const StripeRepository = require('./stripe/repository');
const ProformaRepository = require('./proformaRepository');
const PaymentService = require('./payments/paymentService');
const CrmStatusAutomationService = require('./crm/statusAutomationService');

/**
 * Сервис для диагностики сделок - собирает полную информацию о платежах,
 * автоматизациях, уведомлениях и возможных проблемах
 */
class DealDiagnosticsService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.stripeRepository = options.stripeRepository || new StripeRepository();
    this.proformaRepository = options.proformaRepository || new ProformaRepository();
    this.paymentService = options.paymentService || new PaymentService();
    this.crmStatusAutomationService = options.crmStatusAutomationService || new CrmStatusAutomationService();
  }

  /**
   * Получить полную диагностическую информацию по сделке
   */
  async getDealDiagnostics(dealId) {
    const dealIdStr = String(dealId);
    
    try {
      // 1. Получаем базовую информацию о сделке
      const dealInfo = await this.getDealInfo(dealId);
      
      // 2. Получаем все платежи (Stripe, Proforma, Cash)
      const payments = await this.getAllPayments(dealIdStr);
      
      // 3. Получаем информацию о проформах
      const proformas = await this.getProformas(dealIdStr);
      
      // 4. Получаем информацию о возвратах
      const refunds = await this.getRefunds(dealIdStr);
      
      // 5. Получаем информацию о наличных платежах
      const cashPayments = await this.getCashPayments(dealIdStr);
      
      // 6. Получаем информацию об автоматизациях статусов
      const automations = await this.getAutomationHistory(dealIdStr);
      
      // 7. Получаем информацию о SendPulse уведомлениях
      const notifications = await this.getNotifications(dealIdStr);
      
      // 8. Получаем задачи из Pipedrive
      const tasks = await this.getDealTasks(dealId);
      
      // 9. Получаем cron задачи (вторые платежи, напоминания)
      let cronTasks = null;
      try {
        const SecondPaymentSchedulerService = require('./stripe/secondPaymentSchedulerService');
        const schedulerService = new SecondPaymentSchedulerService();
        
        // Проверяем, есть ли эта сделка в будущих задачах (создание второго платежа)
        const upcomingTasks = await schedulerService.findAllUpcomingTasks();
        const dealUpcomingTask = upcomingTasks.find(t => t.deal?.id === parseInt(dealId));
        
        // Проверяем, есть ли эта сделка в задачах-напоминаниях
        const reminderTasks = await schedulerService.findReminderTasks();
        const dealReminderTask = reminderTasks.find(t => t.dealId === parseInt(dealId));
        
        cronTasks = {
          hasUpcomingSecondPayment: !!dealUpcomingTask,
          upcomingSecondPaymentDate: dealUpcomingTask?.secondPaymentDate ? 
            new Date(dealUpcomingTask.secondPaymentDate).toISOString().split('T')[0] : null,
          isSecondPaymentDateReached: dealUpcomingTask?.isDateReached || false,
          daysUntilSecondPayment: dealUpcomingTask ? 
            Math.ceil((new Date(dealUpcomingTask.secondPaymentDate) - new Date()) / (1000 * 60 * 60 * 24)) : null,
          hasReminderTask: !!dealReminderTask,
          reminderTaskType: dealReminderTask?.type || null,
          reminderTaskDaysUntil: dealReminderTask?.daysUntilSecondPayment || null
        };
      } catch (error) {
        this.logger.warn('Error fetching cron tasks for deal', { dealId, error: error.message });
        cronTasks = null;
      }
      
      // 10. Определяем первичный график платежей
      const initialPaymentSchedule = this.determineInitialPaymentSchedule(payments);
      
      // 11. Определяем текущий график платежей
      const currentPaymentSchedule = this.determinePaymentSchedule(dealInfo);
      
      // 12. Анализируем проблемы
      const issues = this.analyzeIssues({
        dealInfo,
        payments,
        proformas,
        refunds,
        cashPayments,
        automations,
        notifications,
        initialPaymentSchedule,
        currentPaymentSchedule
      });
      
      // 13. Рассчитываем сводку
      const summary = this.calculateSummary({
        dealInfo,
        payments,
        proformas,
        refunds,
        cashPayments,
        initialPaymentSchedule,
        currentPaymentSchedule
      });
      
      // Определяем доступные действия для этой сделки
      const availableActions = this.determineAvailableActions({
        dealInfo,
        payments,
        proformas,
        notifications,
        issues,
        tasks,
        cronTasks
      });

      return {
        success: true,
        dealId: parseInt(dealId),
        dealInfo,
        summary,
        payments,
        proformas,
        refunds,
        cashPayments,
        automations,
        notifications,
        issues,
        tasks, // Задачи из Pipedrive
        cronTasks, // Задачи из cron (вторые платежи, напоминания)
        availableActions, // Доступные ручные действия
        paymentSchedules: {
          initial: initialPaymentSchedule,
          current: currentPaymentSchedule
        },
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Error getting deal diagnostics', {
        dealId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Получить базовую информацию о сделке
   */
  async getDealInfo(dealId) {
    try {
      const result = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!result || !result.success) {
        return {
          found: false,
          error: result?.error || 'Unknown error'
        };
      }
      
      const deal = result.deal;
      const person = result.person;
      const organization = result.organization;
      
      // Получаем название стадии, если оно не пришло в ответе
      let stageName = deal.stage?.name || null;
      if (!stageName && deal.stage_id) {
        try {
          // Пытаемся получить информацию о стадии через API
          const stageResult = await this.pipedriveClient.getStage(deal.stage_id);
          if (stageResult.success && stageResult.stage) {
            stageName = stageResult.stage.name;
          }
        } catch (error) {
          this.logger.warn('Failed to fetch stage name', { dealId, stageId: deal.stage_id, error: error.message });
        }
      }
      
      return {
        found: true,
        id: deal.id,
        title: deal.title,
        value: deal.value,
        currency: deal.currency,
        stageId: deal.stage_id,
        stageName: stageName || `ID: ${deal.stage_id}`,
        closeDate: deal.close_date,
        expectedCloseDate: deal.expected_close_date,
        person: person ? {
          id: person.id,
          name: person.name,
          email: person.email?.[0]?.value || null,
          phone: person.phone?.[0]?.value || null
        } : null,
        organization: organization ? {
          id: organization.id,
          name: organization.name
        } : null,
        customFields: deal
      };
    } catch (error) {
      this.logger.error('Error fetching deal info', { dealId, error: error.message });
      return {
        found: false,
        error: error.message
      };
    }
  }

  /**
   * Получить все платежи (Stripe + Proforma)
   */
  async getAllPayments(dealId) {
    const allPayments = {
      stripe: [],
      proforma: [],
      total: 0
    };
    
    // Stripe платежи
    try {
      if (this.stripeRepository.isEnabled()) {
        const stripePayments = await this.stripeRepository.listPayments({ dealId });
        allPayments.stripe = (stripePayments || []).map(p => ({
          id: p.id || p.session_id,
          sessionId: p.session_id,
          sessionUrl: p.session_id ? `https://dashboard.stripe.com/checkout_sessions/${p.session_id}` : null,
          paymentType: p.payment_type, // deposit, rest, single
          paymentStatus: p.payment_status, // paid, unpaid
          status: p.status, // processed, pending_metadata, refunded, deleted
          amount: p.original_amount || p.amount,
          currency: p.currency || 'PLN',
          amountPln: p.amount_pln,
          exchangeRate: p.exchange_rate,
          paymentSchedule: p.payment_schedule,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
          processedAt: p.processed_at,
          invoiceNumber: p.invoice_number,
          receiptNumber: p.receipt_number,
          // Добавляем информацию о webhook событиях для проверки факта оплаты
          webhookVerified: p.payment_status === 'paid' && p.status === 'processed'
        }));
      }
    } catch (error) {
      this.logger.warn('Error fetching Stripe payments', { dealId, error: error.message });
    }
    
    // Proforma платежи
    try {
      if (this.supabase) {
        // Находим проформы для сделки
        const { data: proformas } = await this.supabase
          .from('proformas')
          .select('id')
          .eq('pipedrive_deal_id', dealId)
          .is('deleted_at', null);
        
        if (proformas && proformas.length > 0) {
          const proformaIds = proformas.map(p => p.id);
          
          // Получаем платежи по проформам
          const { data: payments } = await this.supabase
            .from('payments')
            .select('*')
            .or(`proforma_id.in.(${proformaIds.join(',')}),manual_proforma_id.in.(${proformaIds.join(',')})`)
            .neq('manual_status', 'rejected')
            .is('deleted_at', null)
            .order('operation_date', { ascending: false });
          
          if (payments) {
            // Убираем дубликаты
            const uniquePayments = new Map();
            payments.forEach(p => {
              if (!uniquePayments.has(p.id)) {
                uniquePayments.set(p.id, p);
              }
            });
            
            allPayments.proforma = Array.from(uniquePayments.values()).map(p => ({
              id: p.id,
              operationDate: p.operation_date,
              paymentDate: p.payment_date,
              amount: p.amount,
              currency: p.currency || 'PLN',
              description: p.description,
              payerName: p.payer_name,
              proformaId: p.proforma_id || p.manual_proforma_id,
              proformaFullnumber: p.proforma_fullnumber || p.manual_proforma_fullnumber,
              matchStatus: p.match_status,
              manualStatus: p.manual_status,
              source: p.source,
              createdAt: p.created_at,
              updatedAt: p.updated_at
            }));
          }
        }
      }
    } catch (error) {
      this.logger.warn('Error fetching Proforma payments', { dealId, error: error.message });
    }
    
    // Получаем информацию о webhook событиях для Stripe платежей
    try {
      if (this.supabase && allPayments.stripe.length > 0) {
        const sessionIds = allPayments.stripe.map(p => p.sessionId).filter(Boolean);
        if (sessionIds.length > 0) {
          const { data: webhookEvents } = await this.supabase
            .from('stripe_event_items')
            .select('session_id, event_key, payment_status, amount, currency, created_at')
            .in('session_id', sessionIds)
            .eq('payment_status', 'paid')
            .order('created_at', { ascending: false });
          
          if (webhookEvents) {
            // Создаем мапу для быстрого доступа
            const webhookMap = new Map();
            webhookEvents.forEach(e => {
              if (!webhookMap.has(e.session_id)) {
                webhookMap.set(e.session_id, []);
              }
              webhookMap.get(e.session_id).push(e);
            });
            
            // Добавляем информацию о webhook событиях к платежам
            allPayments.stripe.forEach(p => {
              p.webhookEvents = webhookMap.get(p.sessionId) || [];
              p.webhookVerified = p.webhookEvents.length > 0 || (p.paymentStatus === 'paid' && p.status === 'processed');
            });
          }
        }
      }
    } catch (error) {
      this.logger.warn('Error fetching webhook events', { dealId, error: error.message });
    }
    
    // Рассчитываем общую сумму
    // ВАЖНО: Суммируем только в валюте сделки или конвертируем через PLN
    allPayments.total = [
      ...allPayments.stripe.filter(p => p.paymentStatus === 'paid').map(p => p.amountPln || p.amount || 0),
      ...allPayments.proforma.filter(p => p.manualStatus === 'approved' || p.matchStatus === 'matched').map(p => p.amount || 0)
    ].reduce((sum, amount) => sum + (Number(amount) || 0), 0);
    
    return allPayments;
  }

  /**
   * Получить информацию о проформах
   */
  async getProformas(dealId) {
    try {
      if (!this.supabase) return [];
      
      const { data, error } = await this.supabase
        .from('proformas')
        .select('*')
        .eq('pipedrive_deal_id', dealId)
        .is('deleted_at', null)
        .order('issued_at', { ascending: false });
      
      if (error) {
        this.logger.warn('Error fetching proformas', { dealId, error: error.message });
        return [];
      }
      
      return (data || []).map(p => ({
        id: p.id,
        fullnumber: p.fullnumber,
        total: p.total,
        currency: p.currency,
        paymentsTotal: p.payments_total || 0,
        paymentsTotalPln: p.payments_total_pln || 0,
        paymentsTotalCash: p.payments_total_cash || 0,
        paymentsTotalCashPln: p.payments_total_cash_pln || 0,
        paymentsCount: p.payments_count || 0,
        issuedAt: p.issued_at,
        status: p.status,
        buyerName: p.buyer_name,
        buyerEmail: p.buyer_email,
        remaining: Math.max((Number(p.total) || 0) - (Number(p.payments_total) || 0), 0),
        remainingPln: Math.max((Number(p.total) || 0) - (Number(p.payments_total_pln) || 0), 0)
      }));
    } catch (error) {
      this.logger.warn('Error fetching proformas', { dealId, error: error.message });
      return [];
    }
  }

  /**
   * Получить информацию о возвратах
   */
  async getRefunds(dealId) {
    const refunds = {
      stripe: [],
      cash: [],
      total: 0
    };
    
    // Stripe возвраты
    try {
      if (this.stripeRepository.isEnabled()) {
        const deletions = await this.stripeRepository.listDeletions({ dealId });
        refunds.stripe = (deletions || []).map(d => ({
          id: d.id,
          paymentId: d.payment_id,
          reason: d.reason,
          amount: d.amount,
          amountPln: d.amount_pln,
          currency: d.currency,
          loggedAt: d.logged_at,
          metadata: d.metadata,
          rawPayload: d.raw_payload
        }));
      }
    } catch (error) {
      this.logger.warn('Error fetching Stripe refunds', { dealId, error: error.message });
    }
    
    // Cash возвраты
    try {
      if (this.supabase) {
        const { data: cashPayments } = await this.supabase
          .from('cash_payments')
          .select('id')
          .eq('deal_id', dealId)
          .eq('status', 'refunded');
        
        if (cashPayments && cashPayments.length > 0) {
          const cashPaymentIds = cashPayments.map(cp => cp.id);
          
          const { data: cashRefunds } = await this.supabase
            .from('cash_refunds')
            .select('*')
            .in('cash_payment_id', cashPaymentIds)
            .order('created_at', { ascending: false });
          
          if (cashRefunds) {
            refunds.cash = cashRefunds.map(cr => ({
              id: cr.id,
              cashPaymentId: cr.cash_payment_id,
              amount: cr.amount,
              currency: cr.currency,
              reason: cr.reason,
              status: cr.status,
              processedAt: cr.processed_at,
              createdAt: cr.created_at
            }));
          }
        }
      }
    } catch (error) {
      this.logger.warn('Error fetching cash refunds', { dealId, error: error.message });
    }
    
    // Рассчитываем общую сумму возвратов
    refunds.total = [
      ...refunds.stripe.map(r => Math.abs(r.amountPln || r.amount || 0)),
      ...refunds.cash.map(r => Number(r.amount) || 0)
    ].reduce((sum, amount) => sum + amount, 0);
    
    return refunds;
  }

  /**
   * Получить информацию о наличных платежах
   */
  async getCashPayments(dealId) {
    try {
      if (!this.supabase) return [];
      
      const { data, error } = await this.supabase
        .from('cash_payments')
        .select('*')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false });
      
      if (error) {
        this.logger.warn('Error fetching cash payments', { dealId, error: error.message });
        return [];
      }
      
      return (data || []).map(cp => ({
        id: cp.id,
        proformaId: cp.proforma_id,
        proformaFullnumber: cp.proforma_fullnumber,
        expectedAmount: cp.cash_expected_amount,
        receivedAmount: cp.cash_received_amount,
        amountPln: cp.amount_pln,
        currency: cp.currency,
        status: cp.status,
        source: cp.source,
        expectedDate: cp.expected_date,
        confirmedAt: cp.confirmed_at,
        confirmedBy: cp.confirmed_by,
        createdAt: cp.created_at,
        updatedAt: cp.updated_at
      }));
    } catch (error) {
      this.logger.warn('Error fetching cash payments', { dealId, error: error.message });
      return [];
    }
  }

  /**
   * Получить историю автоматизаций статусов
   */
  async getAutomationHistory(dealId) {
    try {
      if (!this.supabase) return null;
      
      // Получаем данные для расчета
      const { data: proformas } = await this.supabase
        .from('proformas')
        .select('id, total, currency, payments_total, payments_total_pln, status')
        .eq('pipedrive_deal_id', String(dealId))
        .is('deleted_at', null);
      
      const stripePayments = this.stripeRepository.isEnabled() 
        ? await this.stripeRepository.listPayments({ dealId: String(dealId) })
        : [];
      
      // Пытаемся рассчитать ожидаемый статус
      let expectedStage = null;
      let calculation = null;
      
      try {
        // Пытаемся получить информацию о сделке для расчета
        const dealInfo = await this.getDealInfo(dealId);
        if (dealInfo.found) {
          // Используем метод evaluatePaymentStatus из statusCalculator
          const { evaluatePaymentStatus } = require('./crm/statusCalculator');
          const statusResult = evaluatePaymentStatus({
            proformas: proformas || [],
            stripePayments: stripePayments || [],
            deal: dealInfo
          });
          
          if (statusResult) {
            expectedStage = statusResult.targetStageId;
            calculation = statusResult;
          }
        }
      } catch (error) {
        this.logger.debug('Could not calculate expected stage', { dealId, error: error.message });
      }
      
      return {
        currentStage: null, // Будет заполнено из dealInfo
        expectedStage,
        calculation,
        proformasCount: proformas?.length || 0,
        stripePaymentsCount: stripePayments?.length || 0
      };
    } catch (error) {
      this.logger.warn('Error fetching automation history', { dealId, error: error.message });
      return null;
    }
  }

  /**
   * Получить информацию о SendPulse уведомлениях
   */
  async getNotifications(dealId) {
    try {
      if (!this.supabase) return [];
      
      // Ищем в логах напоминаний о проформах
      const { data: reminderLogs } = await this.supabase
        .from('proforma_reminder_logs')
        .select('*')
        .eq('deal_id', dealId)
        .order('sent_at', { ascending: false });
      
      return {
        proformaReminders: (reminderLogs || []).map(r => ({
          id: r.id,
          secondPaymentDate: r.second_payment_date,
          sentDate: r.sent_date,
          sentAt: r.sent_at,
          sendpulseId: r.sendpulse_id,
          proformaNumber: r.proforma_number,
          triggerSource: r.trigger_source
        })),
        // Примечание: Stripe уведомления отправляются через SendPulse, но не логируются отдельно
        // Можно проверить наличие SendPulse ID у персоны
        sendpulseAvailable: true // Будет проверено при получении dealInfo
      };
    } catch (error) {
      this.logger.warn('Error fetching notifications', { dealId, error: error.message });
      return {
        proformaReminders: [],
        sendpulseAvailable: false
      };
    }
  }

  /**
   * Определить график платежей на основе expected_close_date
   */
  determinePaymentSchedule(dealInfo) {
    const closeDate = dealInfo.expectedCloseDate || dealInfo.closeDate;
    if (!closeDate) {
      return { schedule: '100%', secondPaymentDate: null };
    }

    try {
      const expectedCloseDate = new Date(closeDate);
      const today = new Date();
      const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

      if (daysDiff >= 30) {
        const secondPaymentDate = new Date(expectedCloseDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        return { schedule: '50/50', secondPaymentDate };
      } else {
        return { schedule: '100%', secondPaymentDate: null };
      }
    } catch (error) {
      this.logger.warn('Failed to determine payment schedule', {
        dealId: dealInfo.id,
        closeDate,
        error: error.message
      });
      return { schedule: '100%', secondPaymentDate: null };
    }
  }

  /**
   * Определить первичный график платежей из первого платежа
   * Это график, который был установлен при создании первого платежа
   */
  determineInitialPaymentSchedule(payments) {
    // Ищем первый платеж (deposit или single) по дате создания
    const firstPayment = payments.stripe
      .filter(p => p.paymentType === 'deposit' || p.paymentType === 'single' || !p.paymentType)
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt) : new Date(0);
        const dateB = b.createdAt ? new Date(b.createdAt) : new Date(0);
        return dateA - dateB;
      })[0];

    if (firstPayment && firstPayment.paymentSchedule) {
      return {
        schedule: firstPayment.paymentSchedule,
        source: 'first_payment',
        firstPaymentDate: firstPayment.createdAt,
        firstPaymentType: firstPayment.paymentType
      };
    }

    return {
      schedule: null,
      source: 'not_found',
      note: 'Первичный график не найден - нет платежей или график не был сохранен'
    };
  }

  /**
   * Анализ проблем и ошибок
   */
  analyzeIssues({ dealInfo, payments, proformas, refunds, cashPayments, automations, notifications, initialPaymentSchedule, currentPaymentSchedule }) {
    const issues = [];
    
    // Проверка 1: Сделка не найдена
    if (!dealInfo.found) {
      issues.push({
        severity: 'critical',
        category: 'deal',
        code: 'DEAL_NOT_FOUND',
        message: 'Сделка не найдена в Pipedrive',
        details: { error: dealInfo.error }
      });
      return issues; // Нет смысла продолжать, если сделка не найдена
    }
    
    // Проверка 2: Нет проформ
    if (proformas.length === 0 && payments.stripe.length === 0 && cashPayments.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'proformas',
        code: 'NO_PROFORMAS_OR_PAYMENTS',
        message: 'Нет проформ, Stripe платежей или наличных платежей для этой сделки',
        details: {}
      });
    }
    
    // Используем первичный график, если он есть, иначе текущий
    const paymentSchedule = initialPaymentSchedule?.schedule 
      ? { schedule: initialPaymentSchedule.schedule, secondPaymentDate: currentPaymentSchedule.secondPaymentDate }
      : currentPaymentSchedule;
    
    // Проверяем, изменился ли график
    if (initialPaymentSchedule?.schedule && currentPaymentSchedule.schedule && 
        initialPaymentSchedule.schedule !== currentPaymentSchedule.schedule) {
      const firstPayment = payments.stripe.find(p => 
        (p.paymentType === 'deposit' || p.paymentType === 'first') &&
        p.paymentStatus === 'paid'
      );
      const hasSecondPayment = payments.stripe.some(p => 
        (p.paymentType === 'rest' || p.paymentType === 'second' || p.paymentType === 'final')
      );
      
      // Если график был 50/50, первый платеж оплачен, но второго платежа нет - это проблема
      if (initialPaymentSchedule.schedule === '50/50' && firstPayment && !hasSecondPayment) {
        const firstPaymentDate = initialPaymentSchedule.firstPaymentDate 
          ? new Date(initialPaymentSchedule.firstPaymentDate).toISOString().split('T')[0]
          : null;
        const expectedCloseDate = dealInfo.expectedCloseDate || dealInfo.closeDate;
        let daysUntilCamp = null;
        if (expectedCloseDate) {
          const today = new Date();
          const closeDate = new Date(expectedCloseDate);
          daysUntilCamp = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));
        }
        
        issues.push({
          severity: 'warning',
          category: 'schedule',
          code: 'MISSING_SECOND_PAYMENT_SCHEDULE_CHANGED',
          message: `Второй платеж не был создан: график изменился с 50/50 на 100% (до лагеря < 30 дней)`,
          details: {
            initialSchedule: initialPaymentSchedule.schedule,
            currentSchedule: currentPaymentSchedule.schedule,
            firstPaymentDate: firstPaymentDate,
            firstPaymentAmount: firstPayment?.amount,
            firstPaymentCurrency: firstPayment?.currency,
            expectedSecondPaymentAmount: dealInfo.value ? Number(dealInfo.value) / 2 : null,
            expectedSecondPaymentCurrency: dealInfo.currency,
            daysUntilCamp: daysUntilCamp,
            expectedCloseDate: expectedCloseDate,
            note: 'Первый платеж был создан с графиком 50/50, но сейчас до лагеря осталось меньше 30 дней, поэтому система определяет график как 100% и не создает второй платеж автоматически. Требуется ручное создание второго платежа.'
          }
        });
      } else {
        issues.push({
          severity: 'info',
          category: 'schedule',
          code: 'PAYMENT_SCHEDULE_CHANGED',
          message: `График платежей изменился: первичный был ${initialPaymentSchedule.schedule}, сейчас ${currentPaymentSchedule.schedule}`,
          details: {
            initialSchedule: initialPaymentSchedule.schedule,
            currentSchedule: currentPaymentSchedule.schedule,
            firstPaymentDate: initialPaymentSchedule.firstPaymentDate,
            note: 'Первичный график используется для определения необходимости второго платежа'
          }
        });
      }
    }
    
    // Проверка 3: Несоответствие валют
    const dealCurrency = dealInfo.currency || 'PLN';
    const stripePaymentsWithDifferentCurrency = payments.stripe.filter(p => 
      p.paymentStatus === 'paid' && p.currency && p.currency !== dealCurrency
    );
    const hasCurrencyMismatch = stripePaymentsWithDifferentCurrency.length > 0;
    
    // Проверяем, есть ли webhook подтверждения для платежей с разными валютами
    const currencyMismatchWithWebhook = stripePaymentsWithDifferentCurrency.filter(p => p.webhookVerified);
    const currencyMismatchWithoutWebhook = stripePaymentsWithDifferentCurrency.filter(p => !p.webhookVerified);
    
    if (hasCurrencyMismatch) {
      // Если есть webhook подтверждения - это нормальная ситуация (пользователь мог изменить валюту)
      if (currencyMismatchWithWebhook.length > 0 && currencyMismatchWithoutWebhook.length === 0) {
        issues.push({
          severity: 'info',
          category: 'currency',
          code: 'CURRENCY_MISMATCH_WITH_WEBHOOK',
          message: `Найдены платежи в валюте, отличной от валюты сделки (${dealCurrency}), но с webhook подтверждением`,
          details: {
            dealCurrency,
            payments: currencyMismatchWithWebhook.map(p => ({
              sessionId: p.sessionId,
              amount: p.amount,
              currency: p.currency,
              webhookVerified: true
            })),
            note: 'Платежи подтверждены через webhook. Возможно, пользователь изменил валюту в Stripe Checkout. Это нормальная ситуация.'
          }
        });
      } else if (currencyMismatchWithoutWebhook.length > 0) {
        // Если нет webhook подтверждений - это предупреждение
        issues.push({
          severity: 'warning',
          category: 'currency',
          code: 'CURRENCY_MISMATCH_WITHOUT_WEBHOOK',
          message: `Найдены платежи в валюте, отличной от валюты сделки (${dealCurrency}) без webhook подтверждения`,
          details: {
            dealCurrency,
            payments: currencyMismatchWithoutWebhook.map(p => ({
              sessionId: p.sessionId,
              amount: p.amount,
              currency: p.currency,
              webhookVerified: false
            })),
            note: 'ВАЖНО: При разных валютах требуется webhook подтверждение для проверки факта оплаты. Без webhook невозможно проверить, была ли оплата действительно выполнена.'
          }
        });
      }
    }
    
    // Проверка 3.1: Несоответствие сумм (только если валюты совпадают)
    const dealValue = Number(dealInfo.value) || 0;
    const totalPaid = payments.total;
    const totalProforma = proformas.reduce((sum, p) => sum + (Number(p.total) || 0), 0);
    const totalRefunded = refunds.total;
    
    // Для Stripe платежей проверяем суммы только в оригинальной валюте
    const stripePaidInOriginalCurrency = payments.stripe
      .filter(p => p.paymentStatus === 'paid' && p.currency === dealCurrency)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    
    if (!hasCurrencyMismatch && Math.abs(dealValue - totalProforma) > 0.01 && totalProforma > 0) {
      issues.push({
        severity: 'warning',
        category: 'amounts',
        code: 'DEAL_PROFORMA_AMOUNT_MISMATCH',
        message: `Сумма сделки (${dealValue} ${dealCurrency}) не совпадает с суммой проформ (${totalProforma} ${dealCurrency})`,
        details: { dealValue, totalProforma, difference: Math.abs(dealValue - totalProforma), currency: dealCurrency }
      });
    }
    
    // Проверка 3.2: Проверка сумм Stripe платежей в оригинальной валюте (с учетом графика платежей)
    if (!hasCurrencyMismatch && stripePaidInOriginalCurrency > 0) {
      const tolerance = 0.01; // Допустимая погрешность
      let expectedAmount = dealValue; // В валюте сделки
      let shouldCheckAmount = true; // Флаг для пропуска проверки, если это нормальная ситуация
      
      // Если график 50/50, учитываем, что может быть оплачена только половина
      if (paymentSchedule.schedule === '50/50') {
        const depositPayments = payments.stripe.filter(p => 
          p.paymentStatus === 'paid' && 
          p.currency === dealCurrency && 
          (p.paymentType === 'deposit' || p.paymentType === 'first')
        );
        const restPayments = payments.stripe.filter(p => 
          p.paymentStatus === 'paid' && 
          p.currency === dealCurrency && 
          (p.paymentType === 'rest' || p.paymentType === 'second' || p.paymentType === 'final')
        );
        
        // Если оплачен только депозит - проверяем, соответствует ли он ожидаемому
        if (depositPayments.length > 0 && restPayments.length === 0) {
          const expectedDeposit = dealValue / 2;
          const paidDeposit = depositPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
          if (Math.abs(paidDeposit - expectedDeposit) <= tolerance) {
            // Депозит оплачен правильно, второй платеж еще не оплачен - это нормально
            shouldCheckAmount = false; // Пропускаем проверку суммы
          } else {
            // Депозит оплачен неправильно - проверяем только депозит
            expectedAmount = expectedDeposit;
          }
        }
        // Если оба платежа оплачены - проверяем полную сумму (expectedAmount уже равен dealValue)
      }
      
      // Проверяем сумму только если нужно и она не соответствует ожидаемой
      if (shouldCheckAmount && Math.abs(stripePaidInOriginalCurrency - expectedAmount) > tolerance) {
        issues.push({
          severity: 'info',
          category: 'amounts',
          code: 'STRIPE_AMOUNT_MISMATCH',
          message: `Сумма Stripe платежей (${stripePaidInOriginalCurrency} ${dealCurrency}) не совпадает с суммой сделки (${expectedAmount} ${dealCurrency})`,
          details: {
            dealValue: expectedAmount,
            stripePaid: stripePaidInOriginalCurrency,
            difference: Math.abs(stripePaidInOriginalCurrency - expectedAmount),
            currency: dealCurrency,
            paymentSchedule: paymentSchedule.schedule,
            note: paymentSchedule.schedule === '50/50' 
              ? 'График платежей 50/50. Если оплачен только депозит, это нормально.'
              : 'Проверьте, все ли платежи были созданы и оплачены.'
          }
        });
      }
    }
    
    // Проверка 4: Неоплаченные Stripe сессии
    const unpaidStripe = payments.stripe.filter(p => p.paymentStatus === 'unpaid');
    if (unpaidStripe.length > 0) {
      issues.push({
        severity: 'info',
        category: 'stripe',
        code: 'UNPAID_STRIPE_SESSIONS',
        message: `Найдено ${unpaidStripe.length} неоплаченных Stripe сессий`,
        details: { count: unpaidStripe.length, sessions: unpaidStripe.map(s => s.sessionId) }
      });
    }
    
    // Проверка 4.1: Платежи без webhook подтверждения (критично для разных валют)
    const paidWithoutWebhook = payments.stripe.filter(p => 
      p.paymentStatus === 'paid' && !p.webhookVerified
    );
    if (paidWithoutWebhook.length > 0) {
      issues.push({
        severity: hasCurrencyMismatch ? 'warning' : 'info',
        category: 'stripe',
        code: 'PAID_WITHOUT_WEBHOOK',
        message: `Найдено ${paidWithoutWebhook.length} оплаченных платежей без webhook подтверждения`,
        details: {
          count: paidWithoutWebhook.length,
          sessions: paidWithoutWebhook.map(s => ({
            sessionId: s.sessionId,
            currency: s.currency,
            amount: s.amount
          })),
          note: hasCurrencyMismatch 
            ? 'ВАЖНО: При разных валютах требуется webhook подтверждение для проверки факта оплаты'
            : 'Рекомендуется проверить настройки webhook в Stripe'
        }
      });
    }
    
    // Проверка 5: Несоответствие статуса автоматизации
    if (automations && automations.expectedStage && dealInfo.stageId) {
      if (automations.expectedStage !== dealInfo.stageId) {
        issues.push({
          severity: 'warning',
          category: 'automation',
          code: 'STAGE_MISMATCH',
          message: `Текущий статус (${dealInfo.stageId}) не соответствует ожидаемому (${automations.expectedStage})`,
          details: {
            currentStage: dealInfo.stageId,
            expectedStage: automations.expectedStage,
            calculation: automations.calculation
          }
        });
      }
    }
    
    // Проверка 6: Проформы с неоплаченным остатком
    const unpaidProformas = proformas.filter(p => p.remaining > 0.01);
    if (unpaidProformas.length > 0) {
      issues.push({
        severity: 'info',
        category: 'proformas',
        code: 'UNPAID_PROFORMAS',
        message: `Найдено ${unpaidProformas.length} проформ с неоплаченным остатком`,
        details: {
          count: unpaidProformas.length,
          proformas: unpaidProformas.map(p => ({
            fullnumber: p.fullnumber,
            remaining: p.remaining,
            remainingPln: p.remainingPln
          }))
        }
      });
    }
    
    // Проверка 7: Нет SendPulse ID у персоны
    if (dealInfo.person && !notifications.sendpulseAvailable) {
      issues.push({
        severity: 'info',
        category: 'notifications',
        code: 'NO_SENDPULSE_ID',
        message: 'У персоны нет SendPulse ID - уведомления не могут быть отправлены',
        details: {}
      });
    }
    
    // Проверка 8: Нет платежей при наличии проформ
    if (proformas.length > 0 && payments.proforma.length === 0 && payments.stripe.length === 0) {
      issues.push({
        severity: 'warning',
        category: 'payments',
        code: 'NO_PAYMENTS_FOR_PROFORMAS',
        message: 'Есть проформы, но нет платежей',
        details: { proformasCount: proformas.length }
      });
    }
    
    // Проверка 9: Возвраты превышают платежи
    if (totalRefunded > totalPaid) {
      issues.push({
        severity: 'critical',
        category: 'refunds',
        code: 'REFUNDS_EXCEED_PAYMENTS',
        message: `Сумма возвратов (${totalRefunded}) превышает сумму платежей (${totalPaid})`,
        details: { totalPaid, totalRefunded }
      });
    }
    
    // Проверка 10: Наличные платежи без подтверждения
    const unconfirmedCash = cashPayments.filter(cp => 
      cp.status === 'pending' || cp.status === 'pending_confirmation'
    );
    if (unconfirmedCash.length > 0) {
      issues.push({
        severity: 'info',
        category: 'cash',
        code: 'UNCONFIRMED_CASH_PAYMENTS',
        message: `Найдено ${unconfirmedCash.length} неподтвержденных наличных платежей`,
        details: { count: unconfirmedCash.length }
      });
    }
    
    return issues;
  }

  /**
   * Получить задачи (activities) для сделки
   */
  async getDealTasks(dealId) {
    try {
      const activitiesResult = await this.pipedriveClient.getDealActivities(dealId, 'task');
      const activities = activitiesResult.activities || [];
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const tasks = activities.map(activity => {
        const dueDate = activity.due_date ? new Date(activity.due_date) : null;
        const isPast = dueDate && dueDate < today;
        const isUpcoming = dueDate && dueDate >= today;
        const isDone = activity.done === true || activity.done === 1;
        
        return {
          id: activity.id,
          subject: activity.subject,
          note: activity.note || activity.public_description || '',
          dueDate: activity.due_date,
          dueTime: activity.due_time,
          done: isDone,
          isPast: isPast && !isDone,
          isUpcoming: isUpcoming && !isDone,
          type: activity.type,
          assignedToUserId: activity.assigned_to_user_id,
          ownerName: activity.owner_name,
          addTime: activity.add_time,
          updateTime: activity.update_time,
          markedAsDoneTime: activity.marked_as_done_time
        };
      });
      
      return {
        total: tasks.length,
        done: tasks.filter(t => t.done).length,
        upcoming: tasks.filter(t => t.isUpcoming).length,
        past: tasks.filter(t => t.isPast).length,
        tasks: tasks.sort((a, b) => {
          // Сначала будущие, потом прошедшие
          if (a.isUpcoming && !b.isUpcoming) return -1;
          if (!a.isUpcoming && b.isUpcoming) return 1;
          // Сортировка по дате
          const dateA = a.dueDate ? new Date(a.dueDate) : new Date(0);
          const dateB = b.dueDate ? new Date(b.dueDate) : new Date(0);
          return dateA - dateB;
        })
      };
    } catch (error) {
      this.logger.warn('Error fetching deal tasks', { dealId, error: error.message });
      return {
        total: 0,
        done: 0,
        upcoming: 0,
        past: 0,
        tasks: []
      };
    }
  }

  /**
   * Системная диагностика всех сделок в статусах First Payment и Second Payment
   * Объединяет логику всех чек-скриптов
   */
  async getSystemDiagnostics(options = {}) {
    const {
      // Получаем ID статусов для всех пайплайнов
      stageIds = options.stageIds || (() => {
        const { PIPELINE_CONFIGS } = require('./crm/pipelineConfig');
        const allStageIds = new Set();
        Object.values(PIPELINE_CONFIGS).forEach(config => {
          if (config.stageIds.FIRST_PAYMENT) allStageIds.add(config.stageIds.FIRST_PAYMENT);
          if (config.stageIds.SECOND_PAYMENT) allStageIds.add(config.stageIds.SECOND_PAYMENT);
        });
        return Array.from(allStageIds);
      })(), // First Payment и Second Payment для всех пайплайнов
      includeTasks = true,
      includeStuckPayments = true,
      includeMissingSecondPayments = true,
      includeReminders = true
    } = options;

    try {
      this.logger.info('Starting system diagnostics', { stageIds, options });
      
      const results = {
        generatedAt: new Date().toISOString(),
        stageIds,
        totalDeals: 0,
        deals: [],
        summary: {
          firstPayment: { total: 0, stuck: 0, withIssues: 0 },
          secondPayment: { total: 0, stuck: 0, withIssues: 0 },
          totalStuck: 0,
          totalWithIssues: 0,
          totalWithTasks: 0,
          totalWithUpcomingTasks: 0,
          totalWithPastTasks: 0
        }
      };

      // Получаем все сделки в указанных статусах
      const allDeals = [];
      for (const stageId of stageIds) {
        const dealsResult = await this.pipedriveClient.getDeals({
          stage_id: stageId,
          status: 'all_not_deleted',
          limit: 500,
          start: 0
        });
        if (dealsResult.success && dealsResult.deals) {
          allDeals.push(...dealsResult.deals);
        }
      }

      results.totalDeals = allDeals.length;
      this.logger.info('Found deals for diagnostics', { count: allDeals.length });

      // Обрабатываем каждую сделку
      for (const deal of allDeals) {
        const dealId = String(deal.id);
        
        // Получаем ID статусов для пайплайна сделки
        let firstPaymentId = 18; // Default для Camps
        let secondPaymentId = 32; // Default для Camps
        try {
          const pipelineId = deal.pipeline_id || null;
          const pipelineName = deal.pipeline?.name || null;
          if (pipelineId) {
            const { getStageIdForPipeline } = require('./crm/pipelineConfig');
            firstPaymentId = getStageIdForPipeline(pipelineId, 'FIRST_PAYMENT', pipelineName) || 18;
            secondPaymentId = getStageIdForPipeline(pipelineId, 'SECOND_PAYMENT', pipelineName) || 32;
          }
        } catch (error) {
          this.logger.warn('Failed to get pipeline stage IDs, using defaults', { dealId, error: error.message });
        }
        
        const isFirstPayment = deal.stage_id === firstPaymentId;
        const isSecondPayment = deal.stage_id === secondPaymentId;

        try {
          // Получаем полную диагностику для сделки
          const dealDiagnostics = await this.getDealDiagnostics(dealId);
          
          // Получаем задачи из Pipedrive, если нужно
          let tasks = null;
          if (includeTasks) {
            tasks = await this.getDealTasks(dealId);
            if (tasks.total > 0) {
              results.summary.totalWithTasks++;
              if (tasks.upcoming > 0) results.summary.totalWithUpcomingTasks++;
              if (tasks.past > 0) results.summary.totalWithPastTasks++;
            }
          }

          // Получаем cron задачи (вторые платежи, напоминания), если нужно
          let cronTasks = null;
          if (includeReminders) {
            try {
              const SecondPaymentSchedulerService = require('./stripe/secondPaymentSchedulerService');
              const schedulerService = new SecondPaymentSchedulerService();
              
              // Проверяем, есть ли эта сделка в будущих задачах (создание второго платежа)
              const upcomingTasks = await schedulerService.findAllUpcomingTasks();
              const dealUpcomingTask = upcomingTasks.find(t => t.deal?.id === parseInt(dealId));
              
              // Проверяем, есть ли эта сделка в задачах-напоминаниях
              const reminderTasks = await schedulerService.findReminderTasks();
              const dealReminderTask = reminderTasks.find(t => t.dealId === parseInt(dealId));
              
              cronTasks = {
                hasUpcomingSecondPayment: !!dealUpcomingTask,
                upcomingSecondPaymentDate: dealUpcomingTask?.secondPaymentDate ? 
                  new Date(dealUpcomingTask.secondPaymentDate).toISOString().split('T')[0] : null,
                isSecondPaymentDateReached: dealUpcomingTask?.isDateReached || false,
                hasReminderTask: !!dealReminderTask,
                reminderTaskType: dealReminderTask?.type || null,
                reminderTaskDaysUntil: dealReminderTask?.daysUntilSecondPayment || null
              };
            } catch (error) {
              this.logger.warn('Error fetching cron tasks', { dealId, error: error.message });
              cronTasks = null;
            }
          }

          // Проверяем на застрявшие платежи
          const stuckIssues = [];
          if (includeStuckPayments) {
            const hasStripePayments = dealDiagnostics.payments.stripe.length > 0;
            const hasProformas = dealDiagnostics.proformas.length > 0;
            const hasCashPayments = dealDiagnostics.cashPayments.length > 0;
            const hasAnyPayments = hasStripePayments || hasProformas || hasCashPayments;

            // Проверяем дату закрытия
            const closeDate = dealDiagnostics.dealInfo.expectedCloseDate || dealDiagnostics.dealInfo.closeDate;
            let daysUntilClose = null;
            let isCloseDateRelevant = false;

            if (closeDate) {
              const expectedCloseDate = new Date(closeDate);
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              expectedCloseDate.setHours(0, 0, 0, 0);
              daysUntilClose = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
              isCloseDateRelevant = true;
            }

            // Проверяем истекшие сессии (проверка будет выполнена через StripeProcessorService если нужно)
            const unpaidStripe = dealDiagnostics.payments.stripe.filter(p => p.paymentStatus === 'unpaid');
            const expiredSessions = [];
            // Проверка истекших сессий будет выполнена через отдельный метод или пропущена для производительности
            // Можно добавить позже через StripeProcessorService

            // Определяем, застряла ли сделка
            let isStuck = false;
            if (!hasAnyPayments) {
              if (isSecondPayment) {
                // Second Payment: проблема только если дата закрытия уже прошла или близко (в пределах 60 дней)
                if (!isCloseDateRelevant || (daysUntilClose !== null && daysUntilClose <= 60)) {
                  const hasPaidFirstPayment = dealDiagnostics.payments.stripe.some(p => 
                    (p.paymentType === 'deposit' || p.paymentType === 'first') && p.paymentStatus === 'paid'
                  );
                  if (!hasPaidFirstPayment) {
                    isStuck = true;
                    stuckIssues.push('Нет платежей и первый платеж не оплачен');
                  }
                }
              } else {
                // First Payment: проблема только если дата закрытия близко (меньше 30 дней) или уже прошла
                if (!isCloseDateRelevant || (daysUntilClose !== null && daysUntilClose <= 30)) {
                  isStuck = true;
                  stuckIssues.push('Нет платежей');
                }
              }
            }

            if (expiredSessions.length > 0) {
              isStuck = true;
              stuckIssues.push(`Истекшие сессии: ${expiredSessions.length}`);
            }

            // Проверяем отсутствующие вторые платежи
            if (includeMissingSecondPayments && isSecondPayment) {
              const initialSchedule = dealDiagnostics.paymentSchedules.initial?.schedule;
              const hasPaidFirstPayment = dealDiagnostics.payments.stripe.some(p => 
                (p.paymentType === 'deposit' || p.paymentType === 'first') && p.paymentStatus === 'paid'
              );
              const hasSecondPayment = dealDiagnostics.payments.stripe.some(p => 
                (p.paymentType === 'rest' || p.paymentType === 'second' || p.paymentType === 'final')
              );

              if (initialSchedule === '50/50' && hasPaidFirstPayment && !hasSecondPayment) {
                isStuck = true;
                stuckIssues.push('Отсутствует второй платеж (график был 50/50)');
              }
            }
          }

          // Определяем доступные действия
          const availableActions = this.determineAvailableActions({
            dealInfo: {
              ...dealDiagnostics.dealInfo,
              dealId: parseInt(dealId)
            },
            payments: dealDiagnostics.payments,
            proformas: dealDiagnostics.proformas,
            notifications: dealDiagnostics.notifications,
            issues: dealDiagnostics.issues,
            tasks: tasks,
            cronTasks: cronTasks
          });

          // Собираем информацию о сделке
          const dealInfo = {
            dealId: parseInt(dealId),
            title: dealDiagnostics.dealInfo.title,
            stageId: dealDiagnostics.dealInfo.stageId,
            stageName: dealDiagnostics.dealInfo.stageName,
            value: dealDiagnostics.dealInfo.value,
            currency: dealDiagnostics.dealInfo.currency,
            expectedCloseDate: dealDiagnostics.dealInfo.expectedCloseDate,
            daysUntilClose: closeDate ? daysUntilClose : null,
            person: dealDiagnostics.dealInfo.person,
            summary: dealDiagnostics.summary,
            issues: dealDiagnostics.issues,
            stuckIssues: stuckIssues,
            isStuck: stuckIssues.length > 0,
            tasks: tasks, // Задачи из Pipedrive
            cronTasks: cronTasks, // Задачи из cron (вторые платежи, напоминания)
            availableActions: availableActions, // Доступные ручные действия
            paymentSchedules: dealDiagnostics.paymentSchedules,
            payments: {
              stripe: dealDiagnostics.payments.stripe.length,
              proforma: dealDiagnostics.payments.proforma.length,
              cash: dealDiagnostics.cashPayments.length
            }
          };

          // Обновляем сводку
          if (isFirstPayment) {
            results.summary.firstPayment.total++;
            if (dealInfo.isStuck) results.summary.firstPayment.stuck++;
            if (dealInfo.issues.length > 0) results.summary.firstPayment.withIssues++;
          } else if (isSecondPayment) {
            results.summary.secondPayment.total++;
            if (dealInfo.isStuck) results.summary.secondPayment.stuck++;
            if (dealInfo.issues.length > 0) results.summary.secondPayment.withIssues++;
          }

          if (dealInfo.isStuck) results.summary.totalStuck++;
          if (dealInfo.issues.length > 0) results.summary.totalWithIssues++;

          results.deals.push(dealInfo);

        } catch (error) {
          this.logger.error('Error processing deal in system diagnostics', {
            dealId,
            error: error.message,
            stack: error.stack
          });
          // Добавляем сделку с ошибкой
          results.deals.push({
            dealId: parseInt(dealId),
            title: deal.title || 'N/A',
            stageId: deal.stage_id,
            error: error.message,
            isStuck: false
          });
        }
      }

      // Сортируем сделки: сначала застрявшие, потом с проблемами
      results.deals.sort((a, b) => {
        if (a.isStuck && !b.isStuck) return -1;
        if (!a.isStuck && b.isStuck) return 1;
        if (a.issues && b.issues) {
          if (a.issues.length > b.issues.length) return -1;
          if (a.issues.length < b.issues.length) return 1;
        }
        return 0;
      });

      return {
        success: true,
        ...results
      };

    } catch (error) {
      this.logger.error('Error in system diagnostics', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Определить доступные ручные действия для сделки
   */
  determineAvailableActions({ dealInfo, payments, proformas, notifications, issues, tasks, cronTasks }) {
    const actions = [];

    // Проверяем, можно ли создать Stripe сессию
    const hasStripePayments = payments.stripe.length > 0;
    const hasProformas = proformas.length > 0;
    const hasAnyPayments = hasStripePayments || hasProformas;
    const invoiceType = dealInfo.invoiceType;
    const isStripeInvoiceType = invoiceType === '75' || invoiceType === 'Stripe';

    // КРИТИЧНО: Проверяем, нужен ли второй платеж по исходной схеме 50/50
    // Используем исходную схему из первого платежа, а не текущую
    const initialSchedule = this.determineInitialPaymentSchedule(payments);
    const hasPaidDeposit = payments.stripe.some(p => 
      (p.paymentType === 'deposit' || p.paymentType === 'first') && 
      p.paymentStatus === 'paid'
    );
    const hasSecondPayment = payments.stripe.some(p => 
      (p.paymentType === 'rest' || p.paymentType === 'second' || p.paymentType === 'final')
    );
    const needsSecondPayment = initialSchedule.schedule === '50/50' && 
                               hasPaidDeposit && 
                               !hasSecondPayment;

    // Действие: Создать Stripe сессию
    if (isStripeInvoiceType || !hasAnyPayments) {
      const unpaidStripe = payments.stripe.filter(p => p.paymentStatus === 'unpaid');
      const hasUnpaidSessions = unpaidStripe.length > 0;
      
      // Можно создать, если:
      // 1. Нет платежей
      // 2. Есть неоплаченные сессии
      // 3. Нужен второй платеж по исходной схеме 50/50 (даже если текущая схема 100%)
      if (!hasAnyPayments || hasUnpaidSessions || needsSecondPayment) {
        let reason = !hasAnyPayments ? 'Нет платежей' : 
                     hasUnpaidSessions ? 'Есть неоплаченные сессии' : 
                     'Нужен второй платеж по исходной схеме 50/50';
        
        actions.push({
          id: 'create-stripe-session',
          name: needsSecondPayment ? 'Создать второй платеж (rest, 50%)' : 'Создать Stripe сессию',
          description: needsSecondPayment 
            ? 'Создать второй платеж по исходной схеме 50/50 (клиент уже оплатил deposit)'
            : 'Создать новую Stripe Checkout Session для оплаты',
          endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/create-stripe-session`,
          method: 'POST',
          available: true,
          reason: reason,
          metadata: needsSecondPayment ? {
            paymentType: 'rest',
            paymentSchedule: '50/50',
            paymentIndex: 2,
            initialSchedule: initialSchedule.schedule,
            note: 'Используется исходная схема 50/50 из первого платежа, даже если текущая схема 100%'
          } : null
        });
      }
    }

    // Действие: Отправить SendPulse уведомление
    const hasSendPulseId = dealInfo.person?.sendpulseId || 
      (dealInfo.person && dealInfo.person['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c']);
    const hasActiveSessions = payments.stripe.some(p => 
      p.paymentStatus === 'unpaid' && p.sessionId
    );

    if (hasSendPulseId && hasActiveSessions) {
      actions.push({
        id: 'send-payment-notification',
        name: 'Отправить SendPulse уведомление',
        description: 'Отправить уведомление о платеже через SendPulse (Telegram)',
        endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/send-payment-notification`,
        method: 'POST',
        available: true,
        reason: 'Есть активные сессии и SendPulse ID'
      });
    } else if (!hasSendPulseId) {
      actions.push({
        id: 'send-payment-notification',
        name: 'Отправить SendPulse уведомление',
        description: 'Отправить уведомление о платеже через SendPulse (Telegram)',
        endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/send-payment-notification`,
        method: 'POST',
        available: false,
        reason: 'SendPulse ID не найден у персоны'
      });
    } else if (!hasActiveSessions) {
      actions.push({
        id: 'send-payment-notification',
        name: 'Отправить SendPulse уведомление',
        description: 'Отправить уведомление о платеже через SendPulse (Telegram)',
        endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/send-payment-notification`,
        method: 'POST',
        available: false,
        reason: 'Нет активных сессий для уведомления'
      });
    }

    // Действие: Пересоздать истекшую сессию
    const unpaidStripe = payments.stripe.filter(p => p.paymentStatus === 'unpaid');
    if (unpaidStripe.length > 0) {
      actions.push({
        id: 'recreate-expired-session',
        name: 'Пересоздать истекшую сессию',
        description: 'Создать новую сессию вместо истекшей',
        endpoint: `/api/pipedrive/deals/${dealInfo.dealId}/diagnostics/actions/recreate-expired-session`,
        method: 'POST',
        available: true,
        reason: `Найдено ${unpaidStripe.length} неоплаченных сессий`
      });
    }

    return actions;
  }

  /**
   * Рассчитать сводку
   */
  calculateSummary({ dealInfo, payments, proformas, refunds, cashPayments, initialPaymentSchedule, currentPaymentSchedule }) {
    const dealValue = Number(dealInfo.value) || 0;
    const dealCurrency = dealInfo.currency || 'PLN';
    const totalPaid = payments.total; // В PLN (конвертированная сумма)
    const totalProforma = proformas.reduce((sum, p) => sum + (Number(p.total) || 0), 0);
    const totalRefunded = refunds.total;
    const totalCashExpected = cashPayments.reduce((sum, cp) => sum + (Number(cp.expectedAmount) || 0), 0);
    const totalCashReceived = cashPayments.filter(cp => cp.status === 'received')
      .reduce((sum, cp) => sum + (Number(cp.receivedAmount) || 0), 0);
    
    // Рассчитываем оплату в оригинальной валюте сделки
    const stripePaidInOriginalCurrency = payments.stripe
      .filter(p => p.paymentStatus === 'paid' && p.currency === dealCurrency)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    
    const proformaPaidInOriginalCurrency = payments.proforma
      .filter(p => (p.manualStatus === 'approved' || p.matchStatus === 'matched') && p.currency === dealCurrency)
      .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    
    const totalPaidInOriginalCurrency = stripePaidInOriginalCurrency + proformaPaidInOriginalCurrency;
    
    // Проверяем наличие платежей в другой валюте
    const hasCurrencyMismatch = payments.stripe.some(p => 
      p.paymentStatus === 'paid' && p.currency && p.currency !== dealCurrency
    );
    
    // Если есть платежи в другой валюте, используем факт оплаты через webhook
    // В этом случае paymentProgress рассчитывается по факту оплаты, а не по сумме
    const stripePaidCount = payments.stripe.filter(p => p.paymentStatus === 'paid').length;
    const stripeWebhookVerifiedCount = payments.stripe.filter(p => p.webhookVerified).length;
    
    // Для расчета прогресса используем:
    // 1. Если валюты совпадают - по сумме
    // 2. Если валюты разные - по факту оплаты (webhook verified)
    let paymentProgress = 0;
    if (hasCurrencyMismatch) {
      // Используем факт оплаты: если есть webhook подтверждение - считаем оплаченным
      const expectedPayments = dealInfo.closeDate ? 2 : 1; // 50/50 или 100%
      paymentProgress = expectedPayments > 0 ? (stripeWebhookVerifiedCount / expectedPayments) * 100 : 0;
    } else {
      // Используем сумму в оригинальной валюте
      paymentProgress = dealValue > 0 ? (totalPaidInOriginalCurrency / dealValue) * 100 : 0;
    }
    
    return {
      dealValue,
      dealCurrency,
      totalPaid, // В PLN (для отчетности)
      totalPaidInOriginalCurrency, // В валюте сделки
      totalProforma,
      totalRefunded,
      totalCashExpected,
      totalCashReceived,
      remaining: hasCurrencyMismatch ? null : Math.max(dealValue - totalPaidInOriginalCurrency, 0),
      paymentProgress: Math.min(paymentProgress, 100), // Ограничиваем 100%
      hasCurrencyMismatch,
      stripePaymentsCount: payments.stripe.length,
      stripePaidCount,
      stripeWebhookVerifiedCount,
      proformaPaymentsCount: payments.proforma.length,
      proformasCount: proformas.length,
      cashPaymentsCount: cashPayments.length,
      refundsCount: refunds.stripe.length + refunds.cash.length,
      initialPaymentSchedule: initialPaymentSchedule?.schedule || null,
      currentPaymentSchedule: currentPaymentSchedule?.schedule || null
    };
  }
}

module.exports = DealDiagnosticsService;

