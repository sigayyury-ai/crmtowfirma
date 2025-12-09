const express = require('express');
const axios = require('axios');
const multer = require('multer');
const router = express.Router();
const supabase = require('../services/supabaseClient');
const WfirmaClient = require('../services/wfirma');
const PipedriveClient = require('../services/pipedrive');
const UserManagementService = require('../services/userManagement');
const ProductManagementService = require('../services/productManagement');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const { getScheduler } = require('../services/scheduler');
const PaymentService = require('../services/payments/paymentService');
const { WfirmaLookup } = require('../services/vatMargin/wfirmaLookup');
const ProductReportService = require('../services/vatMargin/productReportService');
const DeletedProformaReportService = require('../services/deletedProformaReportService');
const stripeRouter = require('./stripe');
const stripeEventReportRouter = require('./stripeEventReport');
const analyticsRouter = require('./analytics');
const { requireStripeAccess } = require('../middleware/auth');
const stripeService = require('../services/stripe/service');
const stripeAnalyticsService = require('../services/stripe/analyticsService');
const logger = require('../utils/logger');
const CashPaymentsRepository = require('../services/cash/cashPaymentsRepository');
const { ensureCashStatus } = require('../services/cash/cashStatusSync');
const ProformaSecondPaymentReminderService = require('../services/proformaSecondPaymentReminderService');

// Создаем экземпляры сервисов
const wfirmaClient = new WfirmaClient();
let pipedriveClient;
try {
  pipedriveClient = new PipedriveClient();
  logger.info('PipedriveClient initialized successfully', {
    hasApiToken: !!process.env.PIPEDRIVE_API_TOKEN,
    baseURL: process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1'
  });
} catch (error) {
  logger.error('Failed to initialize PipedriveClient:', {
    error: error.message,
    stack: error.stack,
    hasApiToken: !!process.env.PIPEDRIVE_API_TOKEN,
    timestamp: new Date().toISOString()
  });
  // Create a dummy client that will return errors
  pipedriveClient = {
    testConnection: async () => {
      logger.warn('PipedriveClient.testConnection() called on dummy client', {
        reason: 'PIPEDRIVE_API_TOKEN is not set',
        timestamp: new Date().toISOString()
      });
      return {
        success: false,
        error: 'PipedriveClient not initialized',
        message: error.message || 'PIPEDRIVE_API_TOKEN is not set'
      };
    }
  };
}
const userManagement = new UserManagementService();
const productManagement = new ProductManagementService();
const invoiceProcessing = new InvoiceProcessingService();
const scheduler = getScheduler();
const paymentService = new PaymentService();
const productReportService = new ProductReportService();
const PaymentRevenueReportService = require('../services/vatMargin/paymentRevenueReportService');
const paymentRevenueReportService = new PaymentRevenueReportService();
const deletedProformaReportService = new DeletedProformaReportService();
const PnlReportService = require('../services/pnl/pnlReportService');
const pnlReportService = new PnlReportService();
const IncomeCategoryService = require('../services/pnl/incomeCategoryService');
const incomeCategoryService = new IncomeCategoryService();
const ExpenseCategoryService = require('../services/pnl/expenseCategoryService');
const expenseCategoryService = new ExpenseCategoryService();
const ExpenseCategoryMappingService = require('../services/pnl/expenseCategoryMappingService');
const expenseCategoryMappingService = new ExpenseCategoryMappingService();
const ManualEntryService = require('../services/pnl/manualEntryService');
const manualEntryService = new ManualEntryService();
const PaymentProductLinkService = require('../services/payments/paymentProductLinkService');
const proformaAdjustmentRoutes = require('./internal/proformaAdjustmentRoutes');
const paymentProductLinkService = new PaymentProductLinkService();
const cashPnlSyncService = require('../services/cash/cashPnlSyncService');
const cashPaymentsRepository = new CashPaymentsRepository();
const { createCashReminder } = require('../services/cash/cashReminderService');
const CrmStatusAutomationService = require('../services/crm/statusAutomationService');
const crmStatusAutomationService = new CrmStatusAutomationService();
const SecondPaymentSchedulerService = require('../services/stripe/secondPaymentSchedulerService');
const secondPaymentScheduler = new SecondPaymentSchedulerService();
const proformaReminderService = new ProformaSecondPaymentReminderService();

const ENABLE_CASH_STAGE_AUTOMATION = String(process.env.ENABLE_CASH_STAGE_AUTOMATION || 'true').toLowerCase() === 'true';
const CASH_STAGE_SECOND_PAYMENT_ID = Number(process.env.CASH_STAGE_SECOND_PAYMENT_ID || 32);
const CASH_STAGE_CAMP_WAITER_ID = Number(process.env.CASH_STAGE_CAMP_WAITER_ID || 27);
// Configure multer with memory storage and size limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

/**
 * POST /api/contractors
 * Создать нового контрагента в wFirma
 */
router.post('/contractors', async (req, res) => {
  try {
    const { name, email, address, zip, country, business_id, type } = req.body;

    // Валидация обязательных полей
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Name and email are required fields'
      });
    }

    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    const contractorData = {
      name,
      email,
      address: address || '',
      zip: zip || '',
      country: country || 'PL',
      business_id: business_id || '',
      type: type || 'person'
    };

    logger.info('Creating contractor via API:', contractorData);

    const result = await wfirmaClient.createContractor(contractorData);

    if (result.success) {
      res.status(201).json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error in contractors API:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/contractors
 * Получить список контрагентов
 */
router.get('/contractors', async (req, res) => {
  try {
    const result = await wfirmaClient.getContractors();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting contractors:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/test
 * Тест подключения к wFirma API
 */
router.get('/test', async (req, res) => {
  try {
    const result = await wfirmaClient.testConnection();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error testing wFirma connection:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/health
 * Проверка здоровья сервиса
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Service is healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * POST /api/cash-payments
 * Создать запись о кэш-платеже (ручной ввод менеджером/кассиром)
 */
router.post('/cash-payments', async (req, res) => {
  if (!cashPaymentsRepository.isEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase client is not configured'
    });
  }

  try {
    const {
      dealId,
      proformaId = null,
      productId = null,
      amount,
      currency = 'PLN',
      expectedDate = null,
      note = null,
      source = 'manual'
    } = req.body || {};

    const normalizedDealId = Number(dealId);
    if (!Number.isFinite(normalizedDealId) || normalizedDealId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'dealId is required and must be a positive number'
      });
    }

    const cashAmount = parseCashAmount(amount);
    if (!Number.isFinite(cashAmount) || cashAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'amount must be a positive number'
      });
    }

    const normalizedProductId = productId === null || productId === undefined || productId === ''
      ? null
      : Number(productId);

    if (productId !== null && productId !== undefined && !Number.isFinite(normalizedProductId)) {
      return res.status(400).json({
        success: false,
        error: 'productId must be a number when provided'
      });
    }

    const normalizedCurrency = normalizeCurrencyCode(currency);
    const payload = {
      deal_id: normalizedDealId,
      proforma_id: proformaId || null,
      product_id: normalizedProductId,
      cash_expected_amount: roundCurrency(cashAmount),
      currency: normalizedCurrency,
      amount_pln: normalizedCurrency === 'PLN' ? roundCurrency(cashAmount) : null,
      expected_date: normalizeDateInput(expectedDate),
      status: 'pending_confirmation',
      source: source || 'manual',
      created_by: req.user?.email || 'api',
      note: note || null
    };

    const cashPayment = await cashPaymentsRepository.createPayment(payload);

    if (!cashPayment) {
      throw new Error('Failed to create cash payment');
    }

    await cashPaymentsRepository.logEvent(cashPayment.id, 'api:create', {
      source: 'api',
      payload: {
        endpoint: '/api/cash-payments'
      },
      createdBy: req.user?.email || 'api'
    });

    if (cashPayment.proforma_id) {
      await cashPaymentsRepository.updateProformaCashTotals(cashPayment.proforma_id);
    }

    await ensureCashStatus({
      pipedriveClient,
      dealId: normalizedDealId,
      currentStatus: null,
      targetStatus: 'PENDING'
    });

    try {
      const dealResult = await pipedriveClient.getDeal(normalizedDealId);
      const deal = dealResult?.deal;
      await createCashReminder(pipedriveClient, {
        dealId: normalizedDealId,
        amount: payload.cash_expected_amount,
        currency: payload.currency,
        expectedDate: payload.expected_date,
        closeDate: deal?.expected_close_date || deal?.close_date,
        source: 'Manual API',
        buyerName: deal?.person_name || deal?.title,
        personId: deal?.person_id?.value || deal?.person_id,
        sendpulseClient: invoiceProcessing.sendpulseClient
      });
    } catch (reminderError) {
      logger.warn('Failed to create cash reminder from API', {
        dealId: normalizedDealId,
        error: reminderError.message
      });
    }

    return res.status(201).json({
      success: true,
      cashPayment
    });
  } catch (error) {
    logger.error('Failed to create cash payment via API', {
      error: error.message,
      bodyKeys: Object.keys(req.body || {})
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/cash-payments', async (req, res) => {
  if (!cashPaymentsRepository.isEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase client is not configured'
    });
  }

  try {
    const {
      status,
      dealId,
      proformaId,
      productId,
      source,
      expectedFrom,
      expectedTo,
      createdFrom,
      createdTo,
      search,
      limit = 100,
      offset = 0
    } = req.query || {};

    const filters = {
      limit: Math.min(Number(limit) || 100, 500),
      offset: Number(offset) || 0
    };

    if (status) {
      filters.status = String(status)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (filters.status.length === 1) {
        filters.status = filters.status[0];
      }
    }

    if (dealId) {
      filters.dealId = Number(dealId);
    }
    if (proformaId) {
      filters.proformaId = proformaId;
    }
    if (productId) {
      filters.productId = Number(productId);
    }
    if (source) {
      filters.source = source;
    }
    if (expectedFrom) {
      filters.expectedFrom = normalizeDateInput(expectedFrom);
    }
    if (expectedTo) {
      filters.expectedTo = normalizeDateInput(expectedTo);
    }
    if (createdFrom) {
      filters.createdFrom = normalizeDateTimeInput(createdFrom);
    }
    if (createdTo) {
      filters.createdTo = normalizeDateTimeInput(createdTo);
    }
    if (search) {
      filters.searchFullnumber = search;
    }

    const payments = await cashPaymentsRepository.listPayments(filters);
    const items = Array.isArray(payments) ? payments : [];

    let enrichedItems = items;
    if (items.length && pipedriveClient) {
      const dealNameMap = new Map();
      const dealIdsToFetch = Array.from(
        new Set(
          items
            .filter((item) => {
              const hasBuyer =
                item?.proformas?.buyer_name ||
                item?.proformas?.buyer_alt_name ||
                item?.metadata?.buyerName ||
                item?.metadata?.buyer_name;
              return !hasBuyer && Number.isFinite(item?.deal_id);
            })
            .map((item) => item.deal_id)
            .filter((value) => Number.isFinite(value))
        )
      );

      await Promise.all(
        dealIdsToFetch.map(async (dealId) => {
          try {
            const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
            if (dealResult?.success && dealResult.deal) {
              const personName =
                dealResult.person?.name ||
                dealResult.deal?.person_name ||
                dealResult.deal?.title ||
                null;
              dealNameMap.set(dealId, personName);
            }
          } catch (fetchError) {
            logger.warn('Unable to resolve deal buyer name for cash payment', {
              dealId,
              error: fetchError.message
            });
          }
        })
      );

      enrichedItems = items.map((item) => {
        const fallbackName = dealNameMap.get(item.deal_id) || null;
        return {
          ...item,
          deal_person_name: fallbackName
        };
      });
    }

    return res.json({
      success: true,
      items: enrichedItems
    });
  } catch (error) {
    logger.error('Failed to fetch cash payments', {
      error: error.message
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.patch('/cash-payments/:id/confirm', async (req, res) => {
  if (!cashPaymentsRepository.isEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase client is not configured'
    });
  }

  const paymentId = Number(req.params.id);
  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'payment id must be a positive number'
    });
  }

  try {
    const { amount, currency, confirmedAt, note } = req.body || {};
    const normalizedAmount = parseCashAmount(amount ?? req.body?.cash_received_amount);

    const payment = await cashPaymentsRepository.confirmPayment(paymentId, {
      amount: normalizedAmount,
      currency,
      confirmedAt: normalizeDateTimeInput(confirmedAt),
      confirmedBy: req.user?.email || 'api',
      note
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Cash payment not found'
      });
    }

    await ensureCashStatus({
      pipedriveClient,
      dealId: payment.deal_id,
      currentStatus: null,
      targetStatus: 'RECEIVED'
    });
    await cashPnlSyncService.upsertEntryFromPayment(payment);
    await updateCashDealStage(payment.deal_id, CASH_STAGE_CAMP_WAITER_ID, 'cash-confirm');

    return res.json({
      success: true,
      cashPayment: payment
    });
  } catch (error) {
    logger.error('Failed to confirm cash payment', {
      error: error.message,
      paymentId
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/cash-refunds', async (req, res) => {
  if (!cashPaymentsRepository.isEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase client is not configured'
    });
  }

  const { cashPaymentId, amount, currency, reason, note, processedAt } = req.body || {};
  const paymentId = Number(cashPaymentId);

  if (!Number.isFinite(paymentId) || paymentId <= 0) {
    return res.status(400).json({
      success: false,
      error: 'cashPaymentId must be a positive number'
    });
  }

  try {
    const normalizedAmount = parseCashAmount(amount);
    const result = await cashPaymentsRepository.refundPayment(paymentId, {
      amount: normalizedAmount,
      currency,
      reason,
      processedBy: req.user?.email || 'api',
      processedAt: normalizeDateTimeInput(processedAt),
      note
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Cash payment not found'
      });
    }

    await ensureCashStatus({
      pipedriveClient,
      dealId: result.payment.deal_id,
      currentStatus: null,
      targetStatus: 'REFUNDED'
    });
    await cashPnlSyncService.markEntryRefunded(result.payment, reason);
    await updateCashDealStage(result.payment.deal_id, CASH_STAGE_SECOND_PAYMENT_ID, 'cash-refund');

    return res.status(201).json({
      success: true,
      cashPayment: result.payment,
      refund: result.refund
    });
  } catch (error) {
    logger.error('Failed to create cash refund', {
      error: error.message,
      cashPaymentId: paymentId
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.get('/cash-summary', async (req, res) => {
  if (!cashPaymentsRepository.isEnabled()) {
    return res.status(503).json({
      success: false,
      error: 'Supabase client is not configured'
    });
  }

  try {
    const {
      period,
      from,
      to,
      productId,
      currency,
      limit = 100
    } = req.query || {};

    const filters = {};
    if (period) {
      filters.periodMonth = period;
    }
    if (from) {
      filters.from = normalizeDateInput(from);
    }
    if (to) {
      filters.to = normalizeDateInput(to);
    }
    if (productId) {
      filters.productId = Number(productId);
    }
    if (currency) {
      filters.currency = String(currency).toUpperCase();
    }

    const summary = await cashPaymentsRepository.getMonthlySummary(filters);
    const limited = Array.isArray(summary) ? summary.slice(0, Number(limit) || 100) : [];

    return res.json({
      success: true,
      summary: limited
    });
  } catch (error) {
    logger.error('Failed to fetch cash summary', {
      error: error.message
    });
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/stripe-health
 * Проверка подключения к Stripe (используется в dev/test)
 */
router.get('/stripe-health', async (req, res) => {
  try {
    const data = await stripeService.checkHealth();
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Stripe health check failed via /api/stripe-health', {
      message: error.message
    });
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'StripeError',
      message: error.message
    });
  }
});

router.use('/stripe', requireStripeAccess, stripeRouter);
router.use('/reports/stripe-events', requireStripeAccess, stripeEventReportRouter);
router.use('/analytics', analyticsRouter);
router.use('/', proformaAdjustmentRoutes);

// ==================== PIPEDRIVE ENDPOINTS ====================

/**
 * GET /api/pipedrive/test
 * Тест подключения к Pipedrive API
 */
router.get('/pipedrive/test', async (req, res) => {
  logger.info('Pipedrive test endpoint called', {
    timestamp: new Date().toISOString(),
    hasPipedriveClient: !!pipedriveClient
  });

  try {
    // Check if pipedriveClient is available
    if (!pipedriveClient) {
      logger.warn('PipedriveClient not initialized - PIPEDRIVE_API_TOKEN may be missing', {
        endpoint: '/api/pipedrive/test',
        timestamp: new Date().toISOString()
      });
      // Return 400 (Bad Request) instead of 500 for configuration errors
      // This prevents browser console from showing it as a server error
      return res.status(400).json({
        success: false,
        error: 'PipedriveClient not initialized',
        message: 'PIPEDRIVE_API_TOKEN may be missing'
      });
    }

    logger.debug('Calling pipedriveClient.testConnection()');
    const result = await pipedriveClient.testConnection();
    
    if (result.success) {
      logger.info('Pipedrive connection test successful', {
        user: result.user?.name || 'Unknown',
        timestamp: new Date().toISOString()
      });
      res.json(result);
    } else {
      // Check if it's a configuration error (not initialized, missing token, etc.)
      const isConfigError = result.error?.includes('not set') || 
                           result.error?.includes('not initialized') ||
                           result.message?.includes('not set') ||
                           result.message?.includes('not initialized');
      
      // Log the result
      if (isConfigError) {
        logger.warn('Pipedrive connection test failed - configuration error', {
          error: result.error,
          message: result.message,
          timestamp: new Date().toISOString()
        });
      } else {
        logger.error('Pipedrive connection test failed - server error', {
          error: result.error,
          message: result.message,
          details: result.details,
          status: result.status,
          timestamp: new Date().toISOString()
        });
      }
      
      // Use 400 for configuration errors, 500 for actual server errors
      const statusCode = isConfigError ? 400 : 500;
      res.status(statusCode).json(result);
    }
  } catch (error) {
    logger.error('Error testing Pipedrive connection - exception caught', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      endpoint: '/api/pipedrive/test',
      timestamp: new Date().toISOString()
    });
    
    // Check if it's a configuration error
    const isConfigError = error.message && (
      error.message.includes('PIPEDRIVE_API_TOKEN') ||
      error.message.includes('not set') ||
      error.message.includes('not initialized')
    );
    
    if (isConfigError) {
      logger.warn('Pipedrive configuration error detected', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      // Return 400 for configuration errors instead of 500
      return res.status(400).json({
        success: false,
        error: 'Configuration error',
        message: 'PIPEDRIVE_API_TOKEN is not set in environment variables'
      });
    }
    
    // Only return 500 for actual server errors
    logger.error('Pipedrive test failed with server error', {
      error: error.message,
      timestamp: new Date().toISOString()
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message || 'Unknown error occurred'
    });
  }
});

/**
 * GET /api/pipedrive/deals
 * Получить список сделок
 */
router.get('/pipedrive/deals', async (req, res) => {
  try {
    const { limit = 10, start = 0, stage_id, status } = req.query;
    
    const options = {
      limit: parseInt(limit),
      start: parseInt(start)
    };
    
    if (stage_id) options.stage_id = stage_id;
    if (status) options.status = status;
    
    const result = await pipedriveClient.getDeals(options);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting deals:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/pipedrive/deals/:id
 * Получить сделку по ID с полными данными
 */
router.get('/pipedrive/deals/:id', async (req, res) => {
  try {
    const dealId = parseInt(req.params.id);
    
    if (isNaN(dealId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid deal ID'
      });
    }
    
    const result = await pipedriveClient.getDealWithRelatedData(dealId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting deal:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/pipedrive/organizations/:id
 * Получить организацию по ID
 */
router.get('/pipedrive/organizations/:id', async (req, res) => {
  try {
    const orgId = parseInt(req.params.id);
    
    if (isNaN(orgId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid organization ID'
      });
    }
    
    const result = await pipedriveClient.getOrganization(orgId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting organization:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/pipedrive/persons/:id
 * Получить контакт по ID
 */
router.get('/pipedrive/persons/:id', async (req, res) => {
  try {
    const personId = parseInt(req.params.id);
    
    if (isNaN(personId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid person ID'
      });
    }
    
    const result = await pipedriveClient.getPerson(personId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting person:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

// ==================== INVOICE PROCESSING ENDPOINTS ====================

/**
 * GET /api/invoice-processing/status
 * Получить статус планировщика обработки счетов
 */
router.get('/invoice-processing/status', (req, res) => {
  try {
    const status = scheduler.getStatus();
    res.json({
      success: true,
      status: {
        isScheduled: status.isScheduled,
        isProcessing: status.isProcessing,
        lastRunAt: status.lastRunAt,
        nextRun: status.nextRun,
        retryScheduled: status.retryScheduled,
        nextRetryAt: status.nextRetryAt,
        currentRun: status.currentRun,
        lastResult: status.lastResult,
        historySize: status.historySize,
        timezone: status.timezone,
        cronExpression: status.cronExpression
      }
    });
  } catch (error) {
    logger.error('Error getting scheduler status:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/invoice-processing/scheduler-history
 * Получить историю запусков планировщика
 */
router.get('/invoice-processing/scheduler-history', (req, res) => {
  try {
    const history = scheduler.getRunHistory();
    res.json({
      success: true,
      history
    });
  } catch (error) {
    logger.error('Error getting scheduler history:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/second-payment-scheduler/upcoming-tasks
 * Получить список будущих задач cron по созданию вторых платежей (Stripe + Proforma)
 */
router.get('/second-payment-scheduler/upcoming-tasks', async (req, res) => {
  try {
    // Константа для URL сделок
    const CRM_DEAL_BASE_URL = 'https://comoon.pipedrive.com/deal/';
    
    // Получаем задачи для Stripe платежей (создание сессии)
    const stripeDeals = await secondPaymentScheduler.findAllUpcomingTasks();
    
    // Получаем задачи-напоминания для Stripe платежей (сессия создана, но не оплачена)
    const stripeReminderTasks = await secondPaymentScheduler.findReminderTasks();
    
    // Получаем задачи для просроченных сессий (нужно пересоздать)
    const expiredSessionTasks = await secondPaymentScheduler.findExpiredSessionTasks();
    
    // Форматируем данные для Stripe задач (создание сессии)
    const stripeTasks = await Promise.all(stripeDeals.map(async ({ deal, secondPaymentDate, isDateReached }) => {
      const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
      const person = dealWithRelated?.person;
      const organization = dealWithRelated?.organization;
      
      const customerEmail = person?.email?.[0]?.value || 
                           person?.email || 
                           organization?.email?.[0]?.value || 
                           organization?.email || 
                           'N/A';
      
      const dealValue = parseFloat(deal.value) || 0;
      const currency = deal.currency || 'PLN';
      const secondPaymentAmount = dealValue / 2;
      
      const daysUntilSecondPayment = Math.ceil((secondPaymentDate - new Date()) / (1000 * 60 * 60 * 24));
      
      // Формируем ссылку на сделку в Pipedrive
      const dealUrl = `${CRM_DEAL_BASE_URL}${deal.id}`;
      
      return {
        dealId: deal.id,
        dealTitle: deal.title,
        dealUrl,
        customerEmail,
        expectedCloseDate: deal.expected_close_date || deal.close_date,
        secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
      secondPaymentAmount: (() => {
        const amount = Number(secondPaymentAmount);
        return isNaN(amount) ? 0 : amount;
      })(),
      currency: currency || 'PLN',
        daysUntilSecondPayment: daysUntilSecondPayment ?? null,
        isDateReached: isDateReached ?? false,
        status: isDateReached ? 'overdue' : ((daysUntilSecondPayment ?? 0) <= 3 ? 'soon' : 'upcoming'),
        type: 'stripe_second_payment', // Тип задачи: второй платеж Stripe
        paymentMethod: 'stripe',
        label: 'Stripe', // Лейбл для отображения
        taskDescription: 'Второй платеж' // Описание типа задачи
      };
    }));

    // Форматируем данные для Stripe задач-напоминаний
    const formattedStripeReminderTasks = stripeReminderTasks.map(task => ({
      dealId: task.dealId,
      dealTitle: task.dealTitle,
      dealUrl: `${CRM_DEAL_BASE_URL}${task.dealId}`,
      customerEmail: task.customerEmail,
      expectedCloseDate: task.deal.expected_close_date || task.deal.close_date,
      secondPaymentDate: task.secondPaymentDate.toISOString().split('T')[0],
      secondPaymentAmount: (() => {
        const amount = Number(task.secondPaymentAmount);
        return isNaN(amount) ? 0 : amount;
      })(),
      currency: task.currency || 'PLN',
      daysUntilSecondPayment: task.daysUntilSecondPayment ?? null,
      isDateReached: task.isDateReached ?? false,
      status: (task.isDateReached ?? false) ? 'overdue' : ((task.daysUntilSecondPayment ?? 0) <= 3 ? 'soon' : 'upcoming'),
      type: 'stripe_reminder', // Тип задачи: напоминание о втором платеже Stripe
      paymentMethod: 'stripe',
      label: 'Stripe', // Лейбл для отображения
      taskDescription: 'Второй платеж (напоминание)', // Описание типа задачи
      sessionId: task.sessionId,
      sessionUrl: task.sessionUrl
    }));

    // Форматируем данные для просроченных сессий
    const formattedExpiredSessionTasks = expiredSessionTasks.map(task => {
      try {
        const baseTask = {
          dealId: task.dealId,
          dealTitle: task.dealTitle,
          dealUrl: `${CRM_DEAL_BASE_URL}${task.dealId}`,
          customerEmail: task.customerEmail,
          expectedCloseDate: task.deal?.expected_close_date || task.deal?.close_date || null,
          currency: task.currency,
          status: 'expired', // Просроченная сессия
          type: 'stripe_expired_session', // Тип задачи: просроченная сессия, нужно пересоздать
          paymentMethod: 'stripe',
          sessionId: task.sessionId,
          sessionUrl: null, // Просроченная сессия не имеет активного URL
          isExpired: true,
          daysExpired: task.daysExpired || 0,
          paymentType: task.paymentType // Тип платежа: deposit, rest, second, final
        };
        
        // Для deposit используем paymentAmount, для rest - secondPaymentAmount
        // Устанавливаем оба поля, чтобы фронтенд не падал на null
        if (task.paymentType === 'deposit') {
          const amount = Number(task.paymentAmount);
          baseTask.paymentAmount = isNaN(amount) ? 0 : amount;
          // Для deposit также устанавливаем secondPaymentAmount = paymentAmount для единообразия с фронтендом
          baseTask.secondPaymentAmount = isNaN(amount) ? 0 : amount;
          // Для deposit используем expectedCloseDate как дату платежа
          if (baseTask.expectedCloseDate) {
            baseTask.secondPaymentDate = baseTask.expectedCloseDate; // Для отображения на фронтенде
            // Рассчитываем дни до платежа от expectedCloseDate
            const paymentDate = new Date(baseTask.expectedCloseDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            paymentDate.setHours(0, 0, 0, 0);
            baseTask.daysUntilSecondPayment = Math.ceil((paymentDate - today) / (1000 * 60 * 60 * 24));
            baseTask.isDateReached = paymentDate < today;
          } else {
            baseTask.daysUntilSecondPayment = null;
            baseTask.isDateReached = false;
          }
          baseTask.taskDescription = 'Первый платеж (депозит)';
        } else {
          // Для rest/second/final используем secondPaymentAmount, если есть, иначе paymentAmount
          const amount = Number(task.secondPaymentAmount || task.paymentAmount);
          baseTask.secondPaymentAmount = isNaN(amount) ? 0 : amount;
          baseTask.paymentAmount = 0; // Для rest paymentAmount = 0
          if (task.secondPaymentDate) {
            baseTask.secondPaymentDate = task.secondPaymentDate.toISOString().split('T')[0];
            baseTask.daysUntilSecondPayment = task.daysUntilSecondPayment ?? null;
            baseTask.isDateReached = task.isDateReached ?? false;
          } else {
            baseTask.daysUntilSecondPayment = null;
            baseTask.isDateReached = false;
          }
          baseTask.taskDescription = 'Второй платеж';
        }
        
        // Добавляем лейбл "Stripe" как у проформ
        baseTask.label = 'Stripe';
        
        return baseTask;
      } catch (error) {
        logger.error('Error formatting expired session task', {
          dealId: task.dealId,
          error: error.message,
          stack: error.stack
        });
        return null;
      }
    }).filter(task => task !== null); // Убираем задачи с ошибками форматирования

    // Получаем задачи для Proforma платежей
    // Показываем все задачи (включая просроченные), но не скрываем обработанные
    const proformaTasks = await proformaReminderService.findAllUpcomingTasks({ hideProcessed: false });
    
    // Форматируем данные для Proforma задач
    const formattedProformaTasks = proformaTasks.map(task => ({
      dealId: task.dealId,
      dealTitle: task.dealTitle,
      dealUrl: `${CRM_DEAL_BASE_URL}${task.dealId}`,
      customerEmail: task.customerEmail,
      expectedCloseDate: task.expectedCloseDate,
      secondPaymentDate: task.secondPaymentDate.toISOString().split('T')[0],
      secondPaymentAmount: (() => {
        const amount = Number(task.secondPaymentAmount);
        return isNaN(amount) ? 0 : amount;
      })(),
      currency: task.currency || 'PLN',
      daysUntilSecondPayment: task.daysUntilSecondPayment,
      isDateReached: task.isDateReached,
      status: task.isDateReached ? 'overdue' : (task.daysUntilSecondPayment <= 3 ? 'soon' : 'upcoming'),
      type: 'proforma_reminder', // Тип задачи: напоминание о втором платеже по проформе
      paymentMethod: 'proforma',
      label: 'Proforma', // Лейбл для отображения
      taskDescription: 'Второй платеж (проформа)', // Описание типа задачи
      proformaNumber: task.proformaNumber
      // bankAccountNumber удален из ответа API, так как не должен отображаться в описании задачи
    }));

    // Добавляем ручные задачи из cron (например, Deal #1660 на 4 декабря)
    const manualTaskDate = new Date('2025-12-04');
    manualTaskDate.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysUntilManualTask = Math.ceil((manualTaskDate - today) / (1000 * 60 * 60 * 24));
    
    const manualTasks = [
      {
        dealId: 1660,
        dealTitle: 'Заявка от Андрей',
        dealUrl: `${CRM_DEAL_BASE_URL}1660`,
        customerEmail: 'a.taliashvili@gmail.com',
        expectedCloseDate: '2025-12-30',
        secondPaymentDate: '2025-12-04',
        secondPaymentAmount: 1275,
        currency: 'PLN',
        daysUntilSecondPayment: daysUntilManualTask,
        isDateReached: manualTaskDate <= today,
        status: manualTaskDate <= today ? 'overdue' : (daysUntilManualTask <= 3 ? 'soon' : 'upcoming'),
        type: 'manual_rest',
        paymentMethod: 'stripe',
        note: 'Клиент попросил создать ссылку на оплату 4 декабря'
      }
    ];

    // Получаем задачи для Google Meet reminders
    let formattedGoogleMeetTasks = [];
    if (scheduler.googleMeetReminderService) {
      try {
        const googleMeetTasks = await scheduler.googleMeetReminderService.getAllReminderTasks();
        
        formattedGoogleMeetTasks = googleMeetTasks.map(task => {
          const scheduledDate = new Date(task.scheduledTime);
          const meetingDate = new Date(task.meetingTime);
          const now = new Date();
          
          // Рассчитываем дни до напоминания
          const daysUntilReminder = Math.ceil((scheduledDate - now) / (1000 * 60 * 60 * 24));
          const isReminderTimeReached = scheduledDate <= now;
          
          // Рассчитываем дни до встречи
          const daysUntilMeeting = Math.ceil((meetingDate - now) / (1000 * 60 * 60 * 24));
          
          return {
            taskId: task.taskId,
            eventId: task.eventId,
            eventSummary: task.eventSummary || 'Google Meet',
            clientEmail: task.clientEmail,
            meetLink: task.meetLink,
            scheduledTime: scheduledDate.toISOString(),
            scheduledDate: scheduledDate.toISOString().split('T')[0],
            scheduledTimeFormatted: scheduledDate.toLocaleString('ru-RU', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            meetingTime: meetingDate.toISOString(),
            meetingDate: meetingDate.toISOString().split('T')[0],
            meetingTimeFormatted: meetingDate.toLocaleString('ru-RU', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }),
            reminderType: task.reminderType, // '30min' или '5min'
            contactType: task.contactType, // 'telegram' или 'sms'
            daysUntilReminder: daysUntilReminder,
            daysUntilMeeting: daysUntilMeeting,
            isReminderTimeReached: isReminderTimeReached,
            isSent: task.sent || false,
            status: isReminderTimeReached ? (task.sent ? 'sent' : 'overdue') : (daysUntilReminder <= 1 ? 'soon' : 'upcoming'),
            type: 'google_meet_reminder',
            label: 'Google Meet',
            taskDescription: `Напоминание о звонке (${task.reminderType === '30min' ? 'за 30 мин' : 'за 5 мин'})`,
            // Используем scheduledDate для сортировки
            secondPaymentDate: scheduledDate.toISOString().split('T')[0],
            expectedCloseDate: meetingDate.toISOString().split('T')[0]
          };
        });
      } catch (error) {
        logger.error('Error getting Google Meet reminder tasks', {
          error: error.message,
          stack: error.stack
        });
      }
    }

    // Объединяем все задачи (только разовые задачи по сделкам, без системных cron задач)
    const allTasks = [...stripeTasks, ...formattedStripeReminderTasks, ...formattedExpiredSessionTasks, ...formattedProformaTasks, ...formattedGoogleMeetTasks, ...manualTasks];
    
    // Сортируем по дате (ближайшие сначала)
    allTasks.sort((a, b) => {
      // Для задач без даты ставим в конец
      const dateA = a.secondPaymentDate ? new Date(a.secondPaymentDate) : 
                     (a.expectedCloseDate ? new Date(a.expectedCloseDate) : new Date('9999-12-31'));
      const dateB = b.secondPaymentDate ? new Date(b.secondPaymentDate) : 
                     (b.expectedCloseDate ? new Date(b.expectedCloseDate) : new Date('9999-12-31'));
      return dateA - dateB;
    });
    
    // Фильтруем скрытые задачи
    const hiddenTasks = await getHiddenTasksFromSupabase();
    const visibleTasks = allTasks.filter(task => {
      const isHidden = hiddenTasks.some(hidden => {
        // Для deposit задач не проверяем second_payment_date
        if (task.paymentType === 'deposit') {
          return hidden.deal_id === task.dealId && 
                 hidden.task_type === task.type;
        }
        // Для остальных задач проверяем и deal_id, и task_type, и second_payment_date
        return hidden.deal_id === task.dealId && 
               hidden.task_type === task.type &&
               hidden.second_payment_date === task.secondPaymentDate;
      });
      
      return !isHidden;
    });
    
    res.json({
      success: true,
      tasks: visibleTasks,
      count: visibleTasks.length,
      nextRun: '09:00 ежедневно'
    });
  } catch (error) {
    logger.error('Error getting upcoming second payment tasks:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Получить список скрытых задач из Supabase
 * @returns {Promise<Array>} - Массив скрытых задач
 */
async function getHiddenTasksFromSupabase() {
  try {
    if (!supabase) {
      return [];
    }
    
    const { data, error } = await supabase
      .from('hidden_cron_tasks')
      .select('*');
    
    if (error) {
      logger.warn('Failed to fetch hidden tasks from Supabase', { error: error.message });
      return [];
    }
    
    return data || [];
  } catch (error) {
    logger.warn('Error fetching hidden tasks', { error: error.message });
    return [];
  }
}

/**
 * DELETE /api/google-meet-reminders/:taskId
 * Удалить задачу напоминания Google Meet
 */
router.delete('/google-meet-reminders/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    
    if (!taskId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: taskId'
      });
    }

    if (!scheduler.googleMeetReminderService) {
      return res.status(503).json({
        success: false,
        error: 'Google Meet Reminder Service not available'
      });
    }

    const deleted = await scheduler.googleMeetReminderService.deleteReminderTask(taskId);

    if (deleted) {
      logger.info('Google Meet reminder task deleted via API', { taskId });
      return res.json({
        success: true,
        message: 'Reminder task deleted successfully'
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Task not found or could not be deleted'
      });
    }
  } catch (error) {
    logger.error('Error deleting Google Meet reminder task', {
      error: error.message,
      stack: error.stack
    });
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/second-payment-scheduler/hide-task
 * Скрыть задачу из очереди
 */
router.post('/second-payment-scheduler/hide-task', async (req, res) => {
  try {
    const { dealId, taskType, secondPaymentDate } = req.body;
    
    if (!dealId || !taskType || !secondPaymentDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: dealId, taskType, secondPaymentDate'
      });
    }
    
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase not configured'
      });
    }
    
    // Проверяем, не скрыта ли уже задача
    const { data: existing } = await supabase
      .from('hidden_cron_tasks')
      .select('*')
      .eq('deal_id', dealId)
      .eq('task_type', taskType)
      .eq('second_payment_date', secondPaymentDate)
      .maybeSingle();
    
    if (existing) {
      return res.json({
        success: true,
        message: 'Task already hidden',
        alreadyHidden: true
      });
    }
    
    // Добавляем задачу в скрытые
    const { data, error } = await supabase
      .from('hidden_cron_tasks')
      .insert({
        deal_id: dealId,
        task_type: taskType,
        second_payment_date: secondPaymentDate,
        hidden_at: new Date().toISOString()
      })
      .select();
    
    if (error) {
      logger.error('Failed to hide task', { error: error.message, dealId, taskType });
      return res.status(500).json({
        success: false,
        error: 'Failed to hide task',
        message: error.message
      });
    }
    
    logger.info('Task hidden from cron queue', { dealId, taskType, secondPaymentDate });
    
    res.json({
      success: true,
      message: 'Task hidden successfully'
    });
  } catch (error) {
    logger.error('Error hiding task:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/second-payment-scheduler/send-reminder
 * Отправить напоминание о втором платеже Stripe вручную
 */
router.post('/second-payment-scheduler/send-reminder', async (req, res) => {
  try {
    const { dealId, secondPaymentDate } = req.body;
    
    if (!dealId || !secondPaymentDate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: dealId, secondPaymentDate'
      });
    }
    
    // Находим задачу
    const reminderTasks = await secondPaymentScheduler.findReminderTasks();
    const task = reminderTasks.find(t => 
      t.dealId === dealId && 
      t.secondPaymentDate.toISOString().split('T')[0] === secondPaymentDate
    );
    
    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Reminder task not found'
      });
    }
    
    // Отправляем напоминание
    const result = await secondPaymentScheduler.sendReminder(task, {
      trigger: 'manual',
      runId: `manual_reminder_${Date.now()}`
    });
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Reminder sent successfully',
        dealId: task.dealId
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error || 'Failed to send reminder'
      });
    }
  } catch (error) {
    logger.error('Error sending reminder:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/invoice-processing/run
 * Запустить обработку счетов вручную
 */
router.post('/invoice-processing/run', async (req, res) => {
  try {
    const { period = 'manual', force = false } = req.body;
    
    logger.info(`Manual invoice processing triggered with period: ${period}`, { force });
    
    // Если force=true, сбрасываем флаг isProcessing
    if (force && scheduler.isProcessing) {
      logger.warn('Force reset processing lock', { wasProcessing: scheduler.isProcessing });
      scheduler.isProcessing = false;
      scheduler.currentRun = null;
    }
    
    const result = await scheduler.runManualProcessing(period);

    if (result?.skipped) {
      return res.status(409).json({
        success: false,
        error: 'Processing already in progress',
        reason: result.reason || 'processing_in_progress',
        hint: 'Use { "force": true } to reset processing lock'
      });
    }

    if (result && result.success) {
      return res.json(result);
    }

    res.status(500).json(result || { success: false, error: 'Unknown error' });
  } catch (error) {
    logger.error('Error running manual invoice processing:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/invoice-processing/reset
 * Сбросить флаг обработки (если зависла)
 */
router.post('/invoice-processing/reset', async (req, res) => {
  try {
    const wasProcessing = scheduler.isProcessing;
    scheduler.isProcessing = false;
    scheduler.currentRun = null;
    
    logger.info('Processing lock reset', { wasProcessing });
    
    res.json({
      success: true,
      message: 'Processing lock reset',
      wasProcessing
    });
  } catch (error) {
    logger.error('Error resetting processing lock:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/invoice-processing/deal/:id
 * Обработать конкретную сделку по ID
 */
router.post('/invoice-processing/deal/:id', async (req, res) => {
  try {
    const dealId = parseInt(req.params.id);
    
    if (isNaN(dealId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid deal ID'
      });
    }
    
    logger.info(`Processing deal ${dealId} manually...`);
    
    const result = await invoiceProcessing.processDealById(dealId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error processing deal:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/invoice-processing/pending
 * Получить список сделок ожидающих обработки
 */
router.get('/invoice-processing/pending', async (req, res) => {
  try {
    logger.info('Getting pending deals', {
      timestamp: new Date().toISOString()
    });

    const creationResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (!creationResult.success) {
      // Check if it's a rate limit error (429)
      const isRateLimit = creationResult.error?.includes('429') || 
                         creationResult.error?.includes('Too Many Requests') ||
                         creationResult.message?.includes('429') ||
                         creationResult.message?.includes('Too Many Requests');
      
      logger.error('Failed to get pending invoice deals', {
        error: creationResult.error,
        message: creationResult.message,
        isRateLimit,
        timestamp: new Date().toISOString()
      });
      
      // Return 429 status for rate limit errors, 500 for others
      const statusCode = isRateLimit ? 429 : 500;
      return res.status(statusCode).json({
        success: false,
        error: isRateLimit 
          ? 'Pipedrive API rate limit exceeded. Please try again later.'
          : creationResult.error || 'Failed to get pending invoice deals',
        message: isRateLimit
          ? 'Превышен лимит запросов к Pipedrive API. Попробуйте позже.'
          : creationResult.message || creationResult.error || 'Unknown error'
      });
    }

    const deletionResult = await invoiceProcessing.getDealsMarkedForDeletion();
    if (!deletionResult.success) {
      // Check if it's a rate limit error (429)
      const isRateLimit = deletionResult.error?.includes('429') || 
                         deletionResult.error?.includes('Too Many Requests') ||
                         deletionResult.message?.includes('429') ||
                         deletionResult.message?.includes('Too Many Requests');
      
      logger.error('Failed to get deals marked for deletion', {
        error: deletionResult.error,
        message: deletionResult.message,
        isRateLimit,
        timestamp: new Date().toISOString()
      });
      
      // Return 429 status for rate limit errors, 500 for others
      const statusCode = isRateLimit ? 429 : 500;
      return res.status(statusCode).json({
        success: false,
        error: isRateLimit 
          ? 'Pipedrive API rate limit exceeded. Please try again later.'
          : deletionResult.error || 'Failed to get deals marked for deletion',
        message: isRateLimit
          ? 'Превышен лимит запросов к Pipedrive API. Попробуйте позже.'
          : deletionResult.message || deletionResult.error || 'Unknown error'
      });
    }

    const creationDeals = creationResult.deals || [];
    const deletionDeals = Array.isArray(deletionResult.deals) ? deletionResult.deals : [];

    logger.info('Pending deals retrieved successfully', {
      creationCount: creationDeals.length,
      deletionCount: deletionDeals.length,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      creationDeals,
      deletionDeals,
      stats: {
        creationCount: creationDeals.length,
        deletionCount: deletionDeals.length
      }
    });
  } catch (error) {
    logger.error('Error getting pending deals - exception caught', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      timestamp: new Date().toISOString()
    });
    
    // Check if it's a rate limit error
    const isRateLimit = error.message?.includes('429') || 
                       error.message?.includes('Too Many Requests') ||
                       error.response?.status === 429;
    
    const statusCode = isRateLimit ? 429 : 500;
    res.status(statusCode).json({
      success: false,
      error: isRateLimit 
        ? 'Pipedrive API rate limit exceeded. Please try again later.'
        : 'Failed to get pending deals',
      message: isRateLimit
        ? 'Превышен лимит запросов к Pipedrive API. Попробуйте позже.'
        : error.message || 'Unknown error occurred'
    });
  }
});

/**
 * GET /api/invoice-processing/queue
 * Получить сводку очереди задач с расписанием
 */
router.get('/invoice-processing/queue', async (req, res) => {
  try {
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    const schedulerStatus = scheduler.getStatus();
    
    if (pendingResult.success) {
      const queue = pendingResult.deals.map(deal => ({
        dealId: deal.id,
        title: deal.title,
        customerName: deal.person_name || deal.org_name || 'Unknown',
        customerEmail: deal.person_id?.email?.[0]?.value || 'No email',
        value: deal.formatted_value,
        currency: deal.currency,
        invoiceType: deal._invoiceTypeLabel || 
                    (deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '70' ? 'Proforma' : 
                     deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '71' ? 'Prepayment' :
                     deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '72' ? 'Final' : 'Unknown'),
        addTime: deal.add_time,
        updateTime: deal.update_time
      }));

      res.json({
        success: true,
        summary: {
          totalPending: queue.length,
          nextScheduledRun: schedulerStatus.nextRun || null,
          schedulerProcessing: schedulerStatus.isProcessing,
          retryScheduled: schedulerStatus.retryScheduled ? schedulerStatus.nextRetryAt : null
        },
        queue: queue,
        scheduler: {
          status: schedulerStatus.isScheduled ? 'scheduled' : 'stopped',
          lastRunAt: schedulerStatus.lastRunAt,
          nextRun: schedulerStatus.nextRun,
          timezone: schedulerStatus.timezone,
          cronExpression: schedulerStatus.cronExpression,
          historySize: schedulerStatus.historySize
        }
      });
    } else {
      res.status(500).json(pendingResult);
    }
  } catch (error) {
    logger.error('Error getting task queue:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/products
 * Получить все продукты из wFirma
 */
router.get('/products', async (req, res) => {
  try {
    const result = await productManagement.getAllProducts();
    
    if (result.success) {
      res.json({
        success: true,
        products: result.products,
        count: result.count
      });
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error getting products:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/products
 * Создать новый продукт в wFirma
 */
router.post('/products', async (req, res) => {
  try {
    const { name, price, unit } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({
        success: false,
        error: 'Product name and price are required'
      });
    }
    
    const result = await productManagement.createProduct(name, parseFloat(price), unit);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/products/find-or-create
 * Найти или создать продукт в wFirma
 */
router.post('/products/find-or-create', async (req, res) => {
  try {
    const { name, price, unit } = req.body;
    
    if (!name || !price) {
      return res.status(400).json({
        success: false,
        error: 'Product name and price are required'
      });
    }
    
    const result = await productManagement.findOrCreateProduct(name, parseFloat(price), unit);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error finding or creating product:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/products/in-progress
 * Получить продукты в статусе In Progress (для ручной привязки платежей)
 */
router.get('/products/in-progress', async (req, res) => {
  try {
    const products = await paymentProductLinkService.listInProgressProducts();
    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    logger.error('Error getting in-progress products:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Не удалось получить список продуктов'
    });
  }
});

/**
 * GET /api/products/in-progress
 * Получить продукты в статусе In Progress (для ручной привязки платежей)
 */
router.get('/products/in-progress', async (req, res) => {
  try {
    const products = await paymentProductLinkService.listInProgressProducts();
    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    logger.error('Error getting in-progress products:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Не удалось получить список продуктов'
    });
  }
});

/**
 * GET /api/products/search/:name
 * Поиск продукта по названию
 */
router.get('/products/search/:name', async (req, res) => {
  try {
    const { name } = req.params;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Product name is required'
      });
    }
    
    const result = await productManagement.findProductByName(name);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error searching for product:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/server-ip
 * Получить IP адрес сервера (для добавления в whitelist)
 */
router.get('/server-ip', async (req, res) => {
  try {
    // Получаем IP сервера через внешний API
    const ipResponse = await axios.get('https://api.ipify.org?format=json', {
      timeout: 10000
    });
    
    const serverIp = ipResponse.data.ip;
    
    res.json({
      success: true,
      serverIp: serverIp,
      message: 'Use this IP address to add to wFirma whitelist',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error getting server IP:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get server IP',
      message: error.message
    });
  }
});

// ==================== VAT MARGIN TRACKER ENDPOINTS ====================

/**
 * GET /api/vat-margin/monthly-proformas
 * Получить проформы текущего месяца, сгруппированные по продуктам
 */
function mergeStripeWithProformas(proformaData = [], stripeItems = []) {
  // Group proformas by product
  const proformaMap = new Map();
  proformaData.forEach(item => {
    const productKey = item.product_id ? `id:${item.product_id}` : (item.product_key || `key:${item.name?.toLowerCase() || 'без названия'}`);
    if (!proformaMap.has(productKey)) {
      proformaMap.set(productKey, {
        ...item,
        proformas: [],
        stripe_payments: []
      });
    }
    const group = proformaMap.get(productKey);
    if (item.fullnumber) {
      group.proformas.push({
        id: item.proforma_id,
        fullnumber: item.fullnumber,
        date: item.date,
        total: item.total,
        currency: item.currency,
        payments_total_pln: item.payments_total_pln
      });
    }
  });

  // Merge Stripe payments by product
  stripeItems.forEach(stripeItem => {
    const productId = stripeItem.campProductId || stripeItem.crmProductId;
    const productKey = productId ? `id:${productId}` : `key:${(stripeItem.productName || 'Без названия').toLowerCase()}`;
    
    if (!proformaMap.has(productKey)) {
      // Create new entry for Stripe-only product
      const stripeTotalPln = stripeItem.grossRevenuePln || 0;
      const stripeTotal = stripeItem.grossRevenue || 0;
      proformaMap.set(productKey, {
        product_id: productId,
        product_key: productKey,
        name: stripeItem.productName || 'Без названия',
        currency: stripeItem.currency || 'PLN',
        total: stripeTotal,
        proforma_total: stripeTotal,
        currency_exchange: stripeItem.currency === 'PLN' ? 1 : (stripeTotalPln / stripeTotal) || 1,
        payments_total_pln: stripeTotalPln,
        payments_total: stripeTotal,
        proformas: [],
        stripe_payments: []
      });
    }
    
    const group = proformaMap.get(productKey);
    // Add Stripe payment data
    group.stripe_payments.push({
      total_pln: stripeItem.grossRevenuePln || 0,
      total: stripeItem.grossRevenue || 0,
      currency: stripeItem.currency || 'PLN',
      payments_count: stripeItem.paymentsCount || 0
    });
    
    // Update totals to include Stripe
    const stripeTotalPln = stripeItem.grossRevenuePln || 0;
    const stripeTotal = stripeItem.grossRevenue || 0;
    group.total = (group.total || 0) + stripeTotal;
    group.proforma_total = (group.proforma_total || 0) + stripeTotal;
    group.payments_total_pln = (group.payments_total_pln || 0) + stripeTotalPln;
    
    // Recalculate total_pln if needed
    const currency = group.currency || 'PLN';
    const exchange = group.currency_exchange || (currency === 'PLN' ? 1 : null);
    if (exchange && group.total) {
      group.total_pln = group.total * exchange;
    } else if (currency === 'PLN') {
      group.total_pln = group.total;
    }
    
    // Update name if Stripe has better name
    if (stripeItem.productName && (!group.name || group.name === 'Без названия')) {
      group.name = stripeItem.productName;
    }
  });

  // Ensure total_pln is calculated for all groups
  proformaMap.forEach((group, key) => {
    if (group.total_pln === null || group.total_pln === undefined) {
      const currency = group.currency || 'PLN';
      const exchange = group.currency_exchange || (currency === 'PLN' ? 1 : null);
      if (exchange && group.total) {
        group.total_pln = group.total * exchange;
      } else if (currency === 'PLN' && group.total) {
        group.total_pln = group.total;
      }
    }
  });

  return Array.from(proformaMap.values());
}

function computeSummary(data = []) {
  const totalsByCurrency = {};
  const proformas = new Set();
  let totalPLN = 0;
  let paidPLN = 0;

  data.forEach(item => {
    const currency = item.currency || 'PLN';
    const amount = Number(item.total) || 0;
    const exchange = Number(item.currency_exchange) || (currency === 'PLN' ? 1 : null);
    const paymentsTotalRaw = Number(item.payments_total_pln ?? item.payments_total) || 0;
    const paymentsExchange = Number(item.payments_currency_exchange || exchange || 1);

    totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
    if (item.fullnumber || item.number || item.id) {
      proformas.add(item.fullnumber || item.number || item.id);
    }
    // Also count Stripe payments as "proformas" for summary
    if (item.stripe_payments && item.stripe_payments.length > 0) {
      item.stripe_payments.forEach((sp, idx) => {
        proformas.add(`stripe_${item.product_id || item.product_key}_${idx}`);
      });
    }

    const amountPln = exchange ? amount * exchange : amount;
    const paidPln = exchange ? paymentsTotalRaw * paymentsExchange : paymentsTotalRaw;

    totalPLN += amountPln;
    paidPLN += Math.min(paidPln, amountPln);
  });

  const pendingPLN = Math.max(totalPLN - paidPLN, 0);

  return {
    totalProducts: data.length,
    totalProformas: proformas.size,
    totalsByCurrency,
    totalPLN,
    paidPLN,
    pendingPLN
  };
}

router.get('/vat-margin/monthly-proformas', async (req, res) => {
  try {
    const { month, year, dateFrom, dateTo } = req.query;
    const options = {};

    if (dateFrom && dateTo) {
      const fromDate = new Date(dateFrom);
      const toDate = new Date(dateTo);

      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid dateFrom/dateTo format. Expected ISO date string.'
        });
      }

      options.dateFrom = fromDate;
      options.dateTo = toDate;
    } else {
      if (month) {
        const parsedMonth = parseInt(month, 10);
        if (Number.isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
          return res.status(400).json({
            success: false,
            error: 'Invalid month parameter. Expected value from 1 to 12.'
          });
        }
        options.month = parsedMonth;
      }

      if (year) {
        const parsedYear = parseInt(year, 10);
        if (Number.isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
          return res.status(400).json({
            success: false,
            error: 'Invalid year parameter. Expected reasonable year (2000-2100).' 
          });
        }
        options.year = parsedYear;
      }
    }

    const lookup = new WfirmaLookup();
    const range = lookup.resolveDateRange(options);
    const resolvedDateFrom = range.dateFrom;
    const resolvedDateTo = range.dateTo;
    const proformaData = await lookup.getMonthlyProformasByProduct({ ...options, dateFrom: resolvedDateFrom, dateTo: resolvedDateTo });
    const stripeData = await stripeAnalyticsService.getMonthlyStripeSummary({
      dateFrom: resolvedDateFrom,
      dateTo: resolvedDateTo
    });

    // Merge Stripe payments with proformas by product
    const mergedData = mergeStripeWithProformas(proformaData, stripeData.items || []);
    const summary = computeSummary(mergedData);

    if (Array.isArray(proformaData) && proformaData.length > 0) {
      const missingDealCount = proformaData.filter((item) => !item.pipedrive_deal_id).length;
      logger.info('Monthly proformas deal link coverage', {
        total: proformaData.length,
        missing: missingDealCount
      });
    }

    res.json({
      success: true,
      data: mergedData,
      count: mergedData.length,
      summary,
      stripe: stripeData,
      period: {
        month: options.month || null,
        year: options.year || null,
        dateFrom: resolvedDateFrom,
        dateTo: resolvedDateTo
      }
    });
  } catch (error) {
    logger.error('Error getting monthly proformas:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get monthly proformas',
      message: error.message
    });
  }
});

/**
 * GET /api/vat-margin/products/summary
 * Получить сводку по всем продуктам за весь период
 */
router.get('/vat-margin/products/summary', async (req, res) => {
  try {
    const summary = await productReportService.getProductSummary({ includeStripeData: true });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Error getting product summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get product summary',
      message: error.message
    });
  }
});

/**
 * GET /api/vat-margin/products/:productIdentifier/detail
 * Получить детальный отчет по конкретному продукту (весь период)
 */
router.get('/vat-margin/products/:productIdentifier/detail', async (req, res) => {
  try {
    const { productIdentifier } = req.params;
    const detail = await productReportService.getProductDetail(productIdentifier);

    if (!detail) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        message: 'Продукт не найден или по нему отсутствуют данные'
      });
    }

    res.json({
      success: true,
      data: detail
    });
  } catch (error) {
    logger.error('Error getting product detail:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get product detail',
      message: error.message
    });
  }
});

/**
 * POST /api/vat-margin/products/:productIdentifier/status
 * Обновить статус расчета и плановую дату по продукту
 */
router.post('/vat-margin/products/:productIdentifier/status', async (req, res) => {
  try {
    const { productIdentifier } = req.params;
    const { status, dueMonth } = req.body || {};
    const numericIdMatch = String(productIdentifier).match(/^id-(\d+)$/i);
    if (!numericIdMatch) {
      return res.status(400).json({
        success: false,
        error: 'Статус можно обновлять только для продуктов из базы'
      });
    }
    const productId = parseInt(numericIdMatch[1], 10);
    if (!Number.isFinite(productId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор продукта'
      });
    }

    const allowedStatuses = ['in_progress', 'calculated'];
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value. Allowed values: in_progress, calculated'
      });
    }

    if (typeof dueMonth === 'string' && dueMonth.trim().length > 0) {
      const monthPattern = /^\d{4}-\d{2}$/;
      if (!monthPattern.test(dueMonth.trim())) {
        return res.status(400).json({
          success: false,
          error: 'Invalid dueMonth format. Expected YYYY-MM'
        });
      }
    }

    const result = await productReportService.updateProductStatus(productIdentifier, {
      status,
      dueMonth
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error updating product status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update product status',
      message: error.message
    });
  }
});

/**
 * GET /api/vat-margin/proformas
 * Получить проформы за указанный период
 */
router.get('/vat-margin/proformas', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        success: false,
        error: 'dateFrom and dateTo query parameters are required (format: YYYY-MM-DD)'
      });
    }
    
    const lookup = new WfirmaLookup();
    const dateFromObj = new Date(dateFrom);
    const dateToObj = new Date(dateTo);
    dateToObj.setHours(23, 59, 59, 999); // Конец дня
    
    const result = await lookup.getProformasByDateRange(dateFromObj, dateToObj);
    
    res.json({
      success: true,
      data: result,
      count: result.length,
      period: {
        dateFrom: dateFromObj,
        dateTo: dateToObj
      }
    });
  } catch (error) {
    logger.error('Error getting proformas:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get proformas',
      message: error.message
    });
  }
});

router.get('/vat-margin/payment-report', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      month,
      year,
      status = 'approved'
    } = req.query;

    const report = await paymentRevenueReportService.getReport({
      dateFrom,
      dateTo,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      status
    });

    // Ensure report structure is valid
    if (!report) {
      logger.warn('Payment revenue report returned null/undefined', {
        month,
        year,
        status
      });
      return res.json({
        success: true,
        data: [],
        summary: {
          payments_count: 0,
          products_count: 0,
          total_pln: 0,
          unmatched_count: 0
        },
        filters: {
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          status: status || 'approved'
        }
      });
    }

    res.json({
      success: true,
      data: Array.isArray(report.products) ? report.products : [],
      summary: report.summary || {
        payments_count: 0,
        products_count: 0,
        total_pln: 0,
        unmatched_count: 0
      },
      filters: report.filters || {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        status: status || 'approved'
      }
    });
  } catch (error) {
    logger.error('Error building payment revenue report:', {
      error: error.message,
      stack: error.stack,
      month: req.query.month,
      year: req.query.year,
      status: req.query.status
    });
    res.status(500).json({
      success: false,
      error: 'Не удалось сформировать отчёт по платежам',
      message: error.message || 'Unknown error occurred'
    });
  }
});

router.get('/vat-margin/payment-report/export', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      month,
      year,
      status = 'approved'
    } = req.query;

    const csv = await paymentRevenueReportService.exportCsv({
      dateFrom,
      dateTo,
      month: month ? parseInt(month, 10) : undefined,
      year: year ? parseInt(year, 10) : undefined,
      status
    });

    const now = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payment-report-${now}.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    logger.error('Error exporting payment revenue report:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось экспортировать отчёт по платежам',
      message: error.message
    });
  }
});

router.get('/vat-margin/payer-payments', async (req, res) => {
  try {
    const { payer, proforma } = req.query;

    if ((!payer || !payer.trim()) && (!proforma || !proforma.trim())) {
      return res.status(400).json({
        success: false,
        error: 'payer or proforma query parameter is required'
      });
    }

    let query = supabase
      .from('payments')
      .select(`
        id,
        amount,
        amount_raw,
        currency,
        description,
        payer_name,
        payer_normalized_name,
        manual_status,
        match_status,
        operation_date,
        proforma_id,
        proforma_fullnumber,
        manual_proforma_id,
        manual_proforma_fullnumber,
        direction,
        income_category_id,
        expense_category_id
      `)
      .eq('direction', 'in')
      .is('deleted_at', null)
      .order('operation_date', { ascending: true });

    if (payer && payer.trim()) {
      const normalized = payer.trim().toLowerCase();
      query = query.eq('payer_normalized_name', normalized);
    }

    if (proforma && proforma.trim()) {
      const value = proforma.trim().replace(/"/g, '\\"');
      query = query.or(
        `proforma_fullnumber.eq."${value}",manual_proforma_fullnumber.eq."${value}"`
      );
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const payments = (data || []).map((payment) => {
      const baseAmount = typeof payment.amount === 'number' ? payment.amount : Number(payment.amount) || 0;
      return {
        id: payment.id,
        amount: baseAmount,
        amount_raw: payment.amount_raw || null,
        currency: payment.currency || 'PLN',
        date: payment.operation_date || null,
        description: payment.description || '',
        payer_name: payment.payer_name || null,
        payer_normalized_name: payment.payer_normalized_name || null,
        manual_status: payment.manual_status || null,
        match_status: payment.match_status || null,
        proforma_id: payment.manual_proforma_id || payment.proforma_id || null,
        proforma_fullnumber: payment.manual_proforma_fullnumber || payment.proforma_fullnumber || null,
        direction: payment.direction,
        income_category_id: payment.income_category_id || null,
        amount_pln: payment.currency === 'PLN' ? baseAmount : null
      };
    });

    res.json({
      success: true,
      payments,
      count: payments.length
    });
  } catch (error) {
    logger.error('Error fetching payer payments', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Не удалось получить платежи плательщика',
      message: error.message
    });
  }
});

router.get('/vat-margin/payments', async (req, res) => {
  let direction, limit, uncategorized;
  
  try {
    ({ direction, limit, uncategorized } = req.query);
    
    logger.info('GET /vat-margin/payments', {
      direction,
      limit,
      uncategorized,
      query: req.query
    });
    
    // DEBUG: Check total payments count in database
    try {
      const { count: totalCount } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true });
      
      const { count: outCount } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('direction', 'out');
      
      const { count: inCount } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .eq('direction', 'in');
      
      // Also check for null direction
      const { count: nullDirectionCount } = await supabase
        .from('payments')
        .select('*', { count: 'exact', head: true })
        .is('direction', null);
      
      // Get sample payments to see their directions
      const { data: samplePayments } = await supabase
        .from('payments')
        .select('id, direction, amount, description, expense_category_id')
        .limit(10);
      
      logger.info('Database payment counts', {
        total: totalCount,
        direction_out: outCount,
        direction_in: inCount,
        direction_null: nullDirectionCount,
        samplePayments: samplePayments?.map(p => ({
          id: p.id,
          direction: p.direction,
          amount: p.amount,
          hasExpenseCategory: !!p.expense_category_id,
          description: p.description?.substring(0, 50)
        })) || []
      });
    } catch (debugError) {
      logger.warn('Failed to get payment counts for debugging', { error: debugError.message });
    }
    
    // If uncategorized=true, filter for expenses without category
    // expenseCategoryId === undefined means "all expenses"
    // expenseCategoryId === null means "only uncategorized expenses"
    // expenseCategoryId === number means "only expenses with this category"
    let expenseCategoryId = undefined; // Default: show all expenses
    if (uncategorized === 'true' && direction === 'out') {
      expenseCategoryId = null; // null means IS NULL in Supabase (only uncategorized)
    }
    
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    
    logger.info('Calling paymentService.listPayments', {
      direction,
      limit: parsedLimit,
      expenseCategoryId,
      expenseCategoryIdType: typeof expenseCategoryId,
      note: expenseCategoryId === undefined ? 'Will show ALL expenses' : expenseCategoryId === null ? 'Will show only uncategorized expenses' : 'Will show expenses with specific category'
    });
    
    const { payments, history } = await paymentService.listPayments({ 
      direction, 
      limit: parsedLimit,
      expenseCategoryId: expenseCategoryId // Pass undefined to show all, null to show only uncategorized
    });
    
    logger.info('listPayments returned', {
      direction,
      paymentsCount: payments?.length || 0,
      historyCount: history?.length || 0,
      samplePayments: payments?.slice(0, 3).map(p => ({
        id: p?.id,
        direction: p?.direction,
        expense_category_id: p?.expense_category_id,
        description: p?.description?.substring(0, 50)
      })) || []
    });
    
    // Additional safety: filter out any payments with wrong direction if direction was specified
    let filteredPayments = payments || [];
    if (direction) {
      filteredPayments = (payments || []).filter(p => p && p.direction === direction);
      logger.info('After direction filter', {
        originalCount: payments?.length || 0,
        filteredCount: filteredPayments.length
      });
    }
    
    // Ensure we have valid arrays
    const safePayments = Array.isArray(filteredPayments) ? filteredPayments : [];
    const safeHistory = Array.isArray(history) ? history : [];
    
    logger.info('Sending response', {
      paymentsCount: safePayments.length,
      historyCount: safeHistory.length
    });
    
    res.json({
      success: true,
      data: safePayments,
      payments: safePayments, // Also include for backward compatibility
      history: safeHistory
    });
  } catch (error) {
    logger.error('Error loading payments:', {
      error: error.message,
      stack: error.stack,
      direction,
      limit,
      uncategorized
    });
    
    // Ensure we always send a response
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Не удалось загрузить платежи',
        message: error.message || 'Unknown error'
      });
    } else {
      logger.error('Response already sent, cannot send error response');
    }
  }
});

router.get('/vat-margin/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await paymentService.getPaymentDetails(id);
    res.json({
      success: true,
      payment: result.payment,
      candidates: result.candidates
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error getting payment details:', error);
    res.status(status).json({
      success: false,
      error: status === 404 ? 'Платёж не найден' : 'Не удалось получить детали платежа',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'Не найден файл CSV'
      });
    }

    const uploadedBy = req.session?.user?.email || req.user?.email || null;

    // Use unified CSV import handler
    const stats = await paymentService.ingestCsvUnified(req.file.buffer, {
      filename: req.file.originalname,
      uploadedBy,
      autoMatchThreshold: 100 // Disable auto-categorization for expenses
    });

    res.json({
      success: true,
      total: stats.total,
      matched: stats.income?.matched || 0,
      needs_review: stats.income?.needs_review || 0,
      unmatched: stats.income?.unmatched || 0,
      ignored: stats.total - (stats.expenses?.processed || 0) - (stats.income?.processed || 0),
      message: 'Файл обработан'
    });
  } catch (error) {
    logger.error('Error uploading bank CSV:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось обработать CSV',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { fullnumber, comment } = req.body || {};
    const user = req.session?.user?.email || req.user?.email || null;

    const result = await paymentService.assignManualMatch(id, fullnumber, {
      user,
      comment
    });

    res.json({
      success: true,
      payment: result.payment,
      candidates: result.candidates,
      message: 'Платёж привязан к проформе'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error assigning manual match:', error);
    res.status(status).json({
      success: false,
      error: status === 404 ? 'Платёж или проформа не найдены' : 'Не удалось привязать платеж',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/:id/unmatch', async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};
    const user = req.session?.user?.email || req.user?.email || null;

    const result = await paymentService.clearManualMatch(id, {
      user,
      comment
    });

    res.json({
      success: true,
      payment: result.payment,
      candidates: result.candidates,
      message: 'Привязка платежа удалена'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error clearing manual match:', error);
    res.status(status).json({
      success: false,
      error: status === 404 ? 'Платёж не найден' : 'Не удалось сбросить привязку',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/apply', async (req, res) => {
  try {
    const user = req.session?.user?.email || req.user?.email || null;
    const result = await paymentService.bulkApproveAutoMatches({ user });
    res.json({
      success: true,
      ...result,
      message: 'Автоматические совпадения подтверждены'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error applying automatic payment matches:', error);
    res.status(status).json({
      success: false,
      error: status === 400
        ? 'Массовое подтверждение отключено'
        : 'Не удалось подтвердить автоматические совпадения',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.session?.user?.email || req.user?.email || null;
    const result = await paymentService.approveAutoMatch(id, { user });
    res.json({
      success: true,
      payment: result.payment,
      candidates: result.candidates,
      message: 'Платёж подтверждён'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error approving payment match:', error);
    res.status(status).json({
      success: false,
      error: status === 400 ? 'Нет автоматического совпадения для подтверждения' : 'Не удалось подтвердить платеж',
      message: error.message
    });
  }
});

router.delete('/vat-margin/payments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await paymentService.deletePayment(id);
    res.json({
      success: true,
      message: 'Платёж удалён'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error deleting payment:', error);
    res.status(status).json({
      success: false,
      error: status === 404 ? 'Платёж не найден' : 'Не удалось удалить платеж',
      message: error.message
    });
  }
});

/**
 * PUT /api/vat-margin/payments/:id/direction
 * Change payment direction (in/out)
 * Body: { direction: 'in' | 'out' }
 */
router.put('/vat-margin/payments/:id/direction', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    const { direction } = req.body;
    
    if (direction !== 'in' && direction !== 'out') {
      return res.status(400).json({
        success: false,
        error: 'direction must be either "in" or "out"'
      });
    }

    // Get payment to verify it exists
    const payment = await paymentService.fetchPaymentRaw(paymentId);

    // Update payment direction
    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update({ 
        direction: direction,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Error updating payment direction:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update payment direction',
        message: updateError.message
      });
    }

    // If changing to 'out', clear proforma matching (expenses don't match to proformas)
    if (direction === 'out') {
      await supabase
        .from('payments')
        .update({
          match_status: 'unmatched',
          proforma_id: null,
          proforma_fullnumber: null,
          manual_proforma_id: null,
          manual_proforma_fullnumber: null,
          manual_status: null
        })
        .eq('id', paymentId);
    }
    
    // If changing to 'in', clear expense category (income doesn't have expense categories)
    if (direction === 'in') {
      await supabase
        .from('payments')
        .update({
          expense_category_id: null
        })
        .eq('id', paymentId);
    }

    // Return updated payment with details
    const result = await paymentService.getPaymentDetails(paymentId);

    res.json({
      success: true,
      payment: result.payment,
      message: `Направление платежа изменено на "${direction === 'out' ? 'расход' : 'доход'}"`
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error updating payment direction:', error);
    res.status(status).json({
      success: false,
      error: 'Не удалось изменить направление платежа',
      message: error.message
    });
  }
});

/**
 * PUT /api/vat-margin/payments/:id/expense-category
 * Update expense category for a payment
 * Body: { expense_category_id: number | null }
 */
router.put('/vat-margin/payments/:id/expense-category', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    const { expense_category_id } = req.body;
    
    // Validate expense_category_id (can be null to remove category)
    if (expense_category_id !== null && expense_category_id !== undefined) {
      if (!Number.isFinite(expense_category_id) || expense_category_id <= 0) {
        return res.status(400).json({
          success: false,
          error: 'expense_category_id must be a positive number or null'
        });
      }
    }

    // Get payment to verify it exists and is an expense
    const payment = await paymentService.fetchPaymentRaw(paymentId);
    
    if (payment.direction !== 'out') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for expense payments (direction = "out")'
      });
    }

    // Update payment category
    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update({ 
        expense_category_id: expense_category_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Error updating payment expense category:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update payment category',
        message: updateError.message
      });
    }

    // Return updated payment with details
    const result = await paymentService.getPaymentDetails(paymentId);

    res.json({
      success: true,
      payment: result.payment,
      message: expense_category_id ? 'Категория обновлена' : 'Категория удалена'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error updating payment expense category:', error);
    res.status(status).json({
      success: false,
      error: 'Не удалось обновить категорию',
      message: error.message
    });
  }
});

router.post('/vat-margin/payments/reset', async (_req, res) => {
  try {
    await paymentService.resetMatches();
    res.json({
      success: true,
      message: 'Все сопоставления сброшены'
    });
  } catch (error) {
    logger.error('Error resetting payment matches:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось сбросить сопоставления',
      message: error.message
    });
  }
});

/**
 * PUT /api/vat-margin/payments/:id/income-category
 * Update income category for a payment
 * Body: { income_category_id: number | null }
 */
router.put('/vat-margin/payments/:id/income-category', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    const { income_category_id } = req.body;
    
    // Validate income_category_id (can be null to remove category)
    if (income_category_id !== null && income_category_id !== undefined) {
      if (!Number.isFinite(income_category_id) || income_category_id <= 0) {
        return res.status(400).json({
          success: false,
          error: 'income_category_id must be a positive number or null'
        });
      }
    }

    // Get payment to verify it exists and is an income payment
    const payment = await paymentService.fetchPaymentRaw(paymentId);
    
    if (payment.direction !== 'in') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for income payments (direction = "in")'
      });
    }

    // Update payment category
    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update({ 
        income_category_id: income_category_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .select('*')
      .single();

    if (updateError) {
      logger.error('Error updating payment income category:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update payment income category',
        message: updateError.message
      });
    }

    // Return updated payment with details
    const result = await paymentService.getPaymentDetails(paymentId);

    res.json({
      success: true,
      payment: result.payment,
      message: income_category_id ? 'Категория дохода обновлена' : 'Категория дохода удалена'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error updating payment income category:', error);
    res.status(status).json({
      success: false,
      error: 'Не удалось обновить категорию дохода',
      message: error.message
    });
  }
});

/**
 * POST /api/vat-margin/payments/:id/mark-as-refund
 * Mark payment as refund - send to PNL refunds section
 * This sets income_category_id to "Возвраты" category and prevents matching to proformas
 */
router.post('/vat-margin/payments/:id/mark-as-refund', async (req, res) => {
  try {
    const { id } = req.params;
    const { comment } = req.body || {};
    const user = req.session?.user?.email || req.user?.email || null;

    // Get or create "Возвраты" income category
    const IncomeCategoryService = require('../services/pnl/incomeCategoryService');
    const incomeCategoryService = new IncomeCategoryService();
    
    // Try to find existing "Возвраты" category
    const categories = await incomeCategoryService.listCategories();
    let refundsCategory = categories.find(cat => cat.name === 'Возвраты');
    
    // Create if doesn't exist
    if (!refundsCategory) {
      refundsCategory = await incomeCategoryService.createCategory({
        name: 'Возвраты',
        description: 'Возвраты за аренду и другие услуги'
      });
      logger.info('Created "Возвраты" income category', { categoryId: refundsCategory.id });
    }

    // Update payment to mark as refund
    const result = await paymentService.markPaymentAsRefund(id, refundsCategory.id, {
      user,
      comment
    });

    res.json({
      success: true,
      payment: result.payment,
      message: 'Платеж помечен как возврат и отправлен в PNL отчет'
    });
  } catch (error) {
    const status = error.statusCode || 500;
    logger.error('Error marking payment as refund:', error);
    res.status(status).json({
      success: false,
      error: 'Не удалось пометить платеж как возврат',
      message: error.message
    });
  }
});

router.get('/vat-margin/payments/export', async (_req, res) => {
  try {
    const csv = await paymentService.exportCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="payments-export.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Error exporting payments CSV:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось сформировать CSV',
      message: error.message
    });
  }
});

router.get('/vat-margin/deleted-proformas', async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      status,
      buyer,
      search,
      page,
      pageSize,
      sort,
      order
    } = req.query;

    let statusFilter;
    if (status) {
      const parts = String(status)
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      if (parts.length === 1) {
        statusFilter = parts[0];
      } else if (parts.length > 1) {
        statusFilter = parts;
      }
    }

    const result = await deletedProformaReportService.fetchDeletedProformas({
      startDate,
      endDate,
      status: statusFilter,
      buyer,
      search,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      sort,
      order
    });

    if (!result.success) {
      return res.status(500).json(result);
    }

    res.json(result);
  } catch (error) {
    logger.error('Error fetching deleted proforma report:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось получить отчёт по удалённым проформам',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/report
 * Get monthly revenue report for PNL
 * Query parameters:
 *   - year (required): Year to get report for (2020-2030)
 *   - includeBreakdown (optional): Include currency breakdown (true/false)
 */
router.get('/pnl/report', async (req, res) => {
  try {
    const { year, includeBreakdown } = req.query;
    
    // Year is now required
    if (!year) {
      return res.status(400).json({
        success: false,
        error: 'Year parameter is required. Expected year between 2020 and 2030.'
      });
    }
    
    const yearParam = parseInt(year, 10);
    
    if (Number.isNaN(yearParam) || yearParam < 2020 || yearParam > 2030) {
      return res.status(400).json({
        success: false,
        error: 'Invalid year parameter. Expected year between 2020 and 2030.'
      });
    }

    const includeBreakdownParam = includeBreakdown === 'true' || includeBreakdown === '1';

    const report = await pnlReportService.getMonthlyRevenue(yearParam, includeBreakdownParam);

    logger.info('PNL report generated', {
      year: yearParam,
      hasData: !!report,
      reportKeys: report ? Object.keys(report) : [],
      reportType: typeof report
    });

    res.json({
      success: true,
      data: report
    });
  } catch (error) {
    logger.error('Error getting PNL report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get PNL report',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/categories
 * List all income categories
 */
router.get('/pnl/categories', async (req, res) => {
  try {
    const categories = await incomeCategoryService.listCategories();
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Error listing income categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list income categories',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/categories/:id
 * Get a single income category by ID
 */
router.get('/pnl/categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const category = await incomeCategoryService.getCategoryById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error getting income category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get income category',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/categories
 * Create a new income category
 * Body: { name: string, description?: string }
 */
router.post('/pnl/categories', async (req, res) => {
  try {
    const { name, description, management_type } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Category name is required and must be a non-empty string'
      });
    }

    const category = await incomeCategoryService.createCategory({ name, description, management_type });
    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error creating income category:', error);
    const statusCode = error.message.includes('already exists') ? 409 : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to create income category',
      message: error.message
    });
  }
});

/**
 * PUT /api/pnl/categories/:id
 * Update an existing income category
 * Body: { name?: string, description?: string }
 */
router.put('/pnl/categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const { name, description, management_type } = req.body;
    const category = await incomeCategoryService.updateCategory(id, { name, description, management_type });
    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error updating income category:', error);
    const statusCode = error.message.includes('not found') ? 404 
      : error.message.includes('already exists') ? 409 
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to update income category',
      message: error.message
    });
  }
});

/**
 * DELETE /api/pnl/categories/:id
 * Delete an income category
 */
router.delete('/pnl/categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const result = await incomeCategoryService.deleteCategory(id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error deleting income category:', error);
    const statusCode = error.message.includes('not found') ? 404 
      : error.message.includes('Cannot delete') ? 409 
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to delete income category',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/categories/:id/reorder
 * Reorder a category (move up or down)
 * Body: { direction: 'up' | 'down' }
 */
router.post('/pnl/categories/:id/reorder', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const { direction } = req.body;
    if (!direction || (direction !== 'up' && direction !== 'down')) {
      return res.status(400).json({
        success: false,
        error: 'Direction must be "up" or "down"'
      });
    }

    const category = await incomeCategoryService.reorderCategory(id, direction);
    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error reordering income category:', error);
    const statusCode = error.message.includes('not found') ? 404 
      : error.message.includes('Cannot move') ? 400 
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to reorder income category',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/manual-entries
 * Get manual entries for a category and year
 * Query params: categoryId (required), year (required), entryType (optional, default: 'revenue')
 */
router.get('/pnl/manual-entries', async (req, res) => {
  try {
    const categoryId = parseInt(req.query.categoryId, 10);
    const year = parseInt(req.query.year, 10);
    const entryType = req.query.entryType || 'revenue';

    if (Number.isNaN(categoryId) || categoryId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'categoryId is required and must be a positive number'
      });
    }

    if (Number.isNaN(year) || year < 2020 || year > 2030) {
      return res.status(400).json({
        success: false,
        error: 'year is required and must be between 2020 and 2030'
      });
    }

    if (entryType !== 'revenue' && entryType !== 'expense') {
      return res.status(400).json({
        success: false,
        error: 'entryType must be either "revenue" or "expense"'
      });
    }

    const entries = await manualEntryService.getEntriesByCategoryAndYear(categoryId, year, entryType);
    res.json({
      success: true,
      data: entries
    });
  } catch (error) {
    logger.error('Error getting manual entries:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get manual entries',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/manual-entries
 * Create or update a manual entry (upsert)
 * Body: { categoryId?: number, expenseCategoryId?: number, entryType?: 'revenue' | 'expense', year: number, month: number, amountPln: number, currencyBreakdown?: object, notes?: string }
 */
router.post('/pnl/manual-entries', async (req, res) => {
  try {
    const { categoryId, expenseCategoryId, entryType = 'revenue', year, month, amountPln, currencyBreakdown, notes } = req.body;

    if (entryType !== 'revenue' && entryType !== 'expense') {
      return res.status(400).json({
        success: false,
        error: 'entryType must be either "revenue" or "expense"'
      });
    }

    if (entryType === 'revenue' && (!Number.isFinite(categoryId) || categoryId <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'categoryId is required for revenue entries and must be a positive number'
      });
    }

    if (entryType === 'expense' && (!Number.isFinite(expenseCategoryId) || expenseCategoryId <= 0)) {
      return res.status(400).json({
        success: false,
        error: 'expenseCategoryId is required for expense entries and must be a positive number'
      });
    }

    if (!Number.isFinite(year) || year < 2020 || year > 2030) {
      return res.status(400).json({
        success: false,
        error: 'year is required and must be between 2020 and 2030'
      });
    }

    if (!Number.isFinite(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        error: 'month is required and must be between 1 and 12'
      });
    }

    if (!Number.isFinite(amountPln) || amountPln < 0) {
      return res.status(400).json({
        success: false,
        error: 'amountPln is required and must be a non-negative number'
      });
    }

    const entry = await manualEntryService.upsertEntry({
      categoryId,
      expenseCategoryId,
      entryType,
      year,
      month,
      amountPln,
      currencyBreakdown,
      notes
    });

    res.json({
      success: true,
      data: entry
    });
  } catch (error) {
    logger.error('Error upserting manual entry:', error);
    const statusCode = error.message.includes('not found') ? 404
      : error.message.includes('management_type') ? 400
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to upsert manual entry',
      message: error.message
    });
  }
});

/**
 * DELETE /api/pnl/manual-entries
 * Delete a manual entry
 * Query params: categoryId (required), year (required), month (required), entryType (optional, default: 'revenue')
 */
router.delete('/pnl/manual-entries', async (req, res) => {
  try {
    const categoryId = parseInt(req.query.categoryId, 10);
    const year = parseInt(req.query.year, 10);
    const month = parseInt(req.query.month, 10);
    const entryType = req.query.entryType || 'revenue';

    if (Number.isNaN(categoryId) || categoryId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'categoryId is required and must be a positive number'
      });
    }

    if (Number.isNaN(year) || year < 2020 || year > 2030) {
      return res.status(400).json({
        success: false,
        error: 'year is required and must be between 2020 and 2030'
      });
    }

    if (Number.isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({
        success: false,
        error: 'month is required and must be between 1 and 12'
      });
    }

    if (entryType !== 'revenue' && entryType !== 'expense') {
      return res.status(400).json({
        success: false,
        error: 'entryType must be either "revenue" or "expense"'
      });
    }

    const result = await manualEntryService.deleteEntry(categoryId, year, month, entryType);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error deleting manual entry:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete manual entry',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/expense-categories
 * Create a new expense category
 * Body: { name: string, description?: string, management_type?: 'auto' | 'manual' }
 */
router.post('/pnl/expense-categories', async (req, res) => {
  try {
    const { name, description, management_type } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'name is required and must be a non-empty string'
      });
    }

    const category = await expenseCategoryService.createCategory({
      name,
      description,
      management_type
    });

    res.status(201).json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error creating expense category:', error);
    const statusCode = error.message.includes('already exists') ? 409 : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to create expense category',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/expense-categories
 * List all expense categories
 */
router.get('/pnl/expense-categories', async (req, res) => {
  try {
    const categories = await expenseCategoryService.listCategories();
    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    logger.error('Error listing expense categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list expense categories',
      message: error.message
    });
  }
});

/**
 * GET /api/pnl/expense-categories/:id
 * Get a single expense category by ID
 */
router.get('/pnl/expense-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const category = await expenseCategoryService.getCategoryById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Expense category not found'
      });
    }

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error getting expense category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get expense category',
      message: error.message
    });
  }
});

/**
 * PUT /api/pnl/expense-categories/:id
 * Update an expense category
 * Body: { name?: string, description?: string, management_type?: 'auto' | 'manual' }
 */
router.put('/pnl/expense-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const { name, description, management_type, display_order } = req.body;

    const category = await expenseCategoryService.updateCategory(id, {
      name,
      description,
      management_type,
      display_order
    });

    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error updating expense category:', error);
    const statusCode = error.message.includes('not found') ? 404
      : error.message.includes('already exists') ? 409
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to update expense category',
      message: error.message
    });
  }
});

/**
 * DELETE /api/pnl/expense-categories/:id
 * Delete an expense category
 */
router.delete('/pnl/expense-categories/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const result = await expenseCategoryService.deleteCategory(id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error deleting expense category:', error);
    const statusCode = error.message.includes('not found') ? 404 
      : error.message.includes('Cannot delete') ? 409 
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to delete expense category',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/expense-categories/:id/reorder
 * Reorder an expense category (move up or down)
 * Body: { direction: 'up' | 'down' }
 */
router.post('/pnl/expense-categories/:id/reorder', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid category ID'
      });
    }

    const { direction } = req.body;
    if (!direction || (direction !== 'up' && direction !== 'down')) {
      return res.status(400).json({
        success: false,
        error: 'Direction must be "up" or "down"'
      });
    }

    const category = await expenseCategoryService.reorderCategory(id, direction);
    res.json({
      success: true,
      data: category
    });
  } catch (error) {
    logger.error('Error reordering expense category:', error);
    const statusCode = error.message.includes('not found') ? 404 
      : error.message.includes('Cannot move') ? 400 
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to reorder expense category',
      message: error.message
    });
  }
});

/**
 * POST /api/payments/import-expenses
 * Import expenses from CSV file
 * Upload: CSV file with bank statement (expenses only, direction = 'out')
 */
router.post('/payments/import-expenses', (req, res, next) => {
  // Wrap multer middleware with error handling
  upload.single('file')(req, res, (err) => {
    if (err) {
      logger.error('Multer error during CSV upload:', {
        code: err.code,
        message: err.message,
        fieldName: err.field,
        fileSizeLimit: err.code === 'LIMIT_FILE_SIZE' ? '10MB' : undefined,
        stack: err.stack
      });
      
      if (err instanceof multer.MulterError) {
        return res.status(400).json({
          success: false,
          error: `Ошибка загрузки файла: ${err.message}`,
          message: err.code === 'LIMIT_FILE_SIZE' ? 'Файл слишком большой (макс. 10MB)' : err.message
        });
      } else {
        return res.status(500).json({
          success: false,
          error: 'Неизвестная ошибка при загрузке файла',
          message: err.message
        });
      }
    }
    next();
  });
}, async (req, res) => {
  try {
    logger.info('CSV upload request received', {
      hasFile: !!req.file,
      filename: req.file?.originalname,
      fileSize: req.file?.buffer?.length,
      mimetype: req.file?.mimetype,
      user: req.user?.email || req.user?.name || 'unknown',
      query: req.query
    });

    if (!req.file) {
      logger.warn('CSV upload failed: no file in request');
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    logger.info('Importing expenses CSV', {
      filename: req.file.originalname,
      size: req.file.buffer.length,
      mimetype: req.file.mimetype,
      user: req.user?.email || req.user?.name || 'unknown'
    });

    // Get auto-match threshold from query parameter (default: 100% = disabled)
    const autoMatchThreshold = req.query.autoMatchThreshold 
      ? parseInt(req.query.autoMatchThreshold, 10) 
      : 100; // Default: 100% = auto-categorization disabled
    
    // Validate threshold (0-100)
    const validThreshold = Math.max(0, Math.min(100, autoMatchThreshold));
    
    logger.info('Starting CSV processing', {
      filename: req.file.originalname,
      autoMatchThreshold: validThreshold,
      bufferSize: req.file.buffer.length
    });

    let stats;
    try {
      // Use unified CSV import handler - it processes both expenses and income automatically
      stats = await paymentService.ingestCsvUnified(req.file.buffer, {
        filename: req.file.originalname,
        uploadedBy: req.user?.email || req.user?.name || null,
        autoMatchThreshold: validThreshold
      });
    } catch (processingError) {
      logger.error('Error during CSV processing', {
        error: processingError.message,
        stack: processingError.stack,
        name: processingError.name,
        filename: req.file.originalname
      });
      throw processingError; // Re-throw to be caught by outer catch
    }

    logger.info('CSV imported successfully (unified)', stats);

    // Get uncategorized expenses from the last import
    let uncategorizedExpenses = [];
    if (stats.importId && stats.expenses?.uncategorized > 0) {
      try {
        const { data: expenses, error: expensesError } = await supabase
          .from('payments')
          .select('id, operation_date, description, payer_name, amount, currency, expense_category_id')
          .eq('import_id', stats.importId)
          .eq('direction', 'out')
          .is('expense_category_id', null)
          .order('operation_date', { ascending: false })
          .limit(1000);
        
        if (!expensesError && expenses) {
          uncategorizedExpenses = expenses;
        } else if (expensesError) {
          logger.warn('Failed to fetch uncategorized expenses', { error: expensesError });
        }
      } catch (error) {
        logger.warn('Error fetching uncategorized expenses', { error: error.message });
      }
    }

    res.json({
      success: true,
      data: {
        total: stats.total,
        processed: stats.expenses?.processed || 0,
        categorized: stats.expenses?.categorized || 0,
        uncategorized: stats.expenses?.uncategorized || 0,
        ignored: stats.total - (stats.expenses?.processed || 0) - (stats.income?.processed || 0),
        autoMatchThreshold: validThreshold,
        importId: stats.importId,
        uncategorizedExpenses: uncategorizedExpenses
      },
      expenses: stats.expenses,
      income: stats.income
    });
  } catch (error) {
    logger.error('Error importing expenses CSV:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      filename: req.file?.originalname
    });
    
    // Ensure response is sent even if error occurs
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: 'Failed to import expenses CSV',
        message: error.message
      });
    } else {
      logger.error('Response already sent, cannot send error response');
    }
  }
});

/**
 * GET /api/pnl/expense-category-mappings
 * List all expense category mappings
 * Query params: expenseCategoryId (optional)
 */
router.get('/pnl/expense-category-mappings', async (req, res) => {
  try {
    const expenseCategoryId = req.query.expenseCategoryId 
      ? parseInt(req.query.expenseCategoryId, 10) 
      : null;

    if (expenseCategoryId !== null && Number.isNaN(expenseCategoryId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid expenseCategoryId'
      });
    }

    const mappings = await expenseCategoryMappingService.listMappings(expenseCategoryId);
    res.json({
      success: true,
      data: mappings
    });
  } catch (error) {
    logger.error('Error listing expense category mappings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list expense category mappings',
      message: error.message
    });
  }
});

/**
 * POST /api/pnl/expense-category-mappings
 * Create a new expense category mapping
 * Body: { pattern_type: 'category' | 'description' | 'payer', pattern_value: string, expense_category_id: number, priority?: number }
 */
router.post('/pnl/expense-category-mappings', async (req, res) => {
  try {
    const { pattern_type, pattern_value, expense_category_id, priority } = req.body;

    if (!pattern_type || !['category', 'description', 'payer'].includes(pattern_type)) {
      return res.status(400).json({
        success: false,
        error: 'pattern_type must be one of: category, description, payer'
      });
    }

    if (!pattern_value || typeof pattern_value !== 'string' || pattern_value.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'pattern_value is required and must be a non-empty string'
      });
    }

    if (!Number.isFinite(expense_category_id) || expense_category_id <= 0) {
      return res.status(400).json({
        success: false,
        error: 'expense_category_id is required and must be a positive number'
      });
    }

    const mapping = await expenseCategoryMappingService.createMapping({
      pattern_type,
      pattern_value,
      expense_category_id,
      priority
    });

    res.status(201).json({
      success: true,
      data: mapping
    });
  } catch (error) {
    logger.error('Error creating expense category mapping:', error);
    const statusCode = error.message.includes('already exists') ? 409
      : error.message.includes('not found') ? 404
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to create expense category mapping',
      message: error.message
    });
  }
});

/**
 * PUT /api/pnl/expense-category-mappings/:id
 * Update an expense category mapping
 * Body: { pattern_type?: string, pattern_value?: string, expense_category_id?: number, priority?: number }
 */
router.put('/pnl/expense-category-mappings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mapping ID'
      });
    }

    const { pattern_type, pattern_value, expense_category_id, priority } = req.body;

    const mapping = await expenseCategoryMappingService.updateMapping(id, {
      pattern_type,
      pattern_value,
      expense_category_id,
      priority
    });

    res.json({
      success: true,
      data: mapping
    });
  } catch (error) {
    logger.error('Error updating expense category mapping:', error);
    const statusCode = error.message.includes('not found') ? 404
      : error.message.includes('already exists') ? 409
      : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to update expense category mapping',
      message: error.message
    });
  }
});

/**
 * DELETE /api/pnl/expense-category-mappings/:id
 * Delete an expense category mapping
 */
router.delete('/pnl/expense-category-mappings/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid mapping ID'
      });
    }

    const result = await expenseCategoryMappingService.deleteMapping(id);
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Error deleting expense category mapping:', error);
    const statusCode = error.message.includes('not found') ? 404 : 500;
    res.status(statusCode).json({
      success: false,
      error: 'Failed to delete expense category mapping',
      message: error.message
    });
  }
});

/**
 * PUT /api/payments/:id/expense-category
 * Assign expense category to a payment and optionally create a mapping rule
 * Body: { expenseCategoryId: number, createMapping?: boolean, patternType?: 'category' | 'description' | 'payer', patternValue?: string, priority?: number }
 */
router.put('/payments/:id/expense-category', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    const { expenseCategoryId, createMapping, patternType, patternValue, priority } = req.body;

    if (!Number.isFinite(expenseCategoryId) || expenseCategoryId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'expenseCategoryId is required and must be a positive number'
      });
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, description, payer_name, category, direction')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    if (payment.direction !== 'out') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for expense payments (direction = "out")'
      });
    }

    // Update payment category
    logger.info('Updating payment expense category', {
      paymentId,
      expenseCategoryId,
      createMapping,
      patternType,
      patternValue
    });
    
    const { data: updatedPayment, error: updateError } = await supabase
      .from('payments')
      .update({ expense_category_id: expenseCategoryId })
      .eq('id', paymentId)
      .select('id, expense_category_id, operation_date, amount, currency, direction, description, payer_name')
      .single();

    if (updateError) {
      logger.error('Error updating payment expense category:', {
        error: updateError,
        code: updateError.code,
        message: updateError.message,
        details: updateError.details,
        paymentId,
        expenseCategoryId
      });
      return res.status(500).json({
        success: false,
        error: 'Failed to update payment category',
        message: updateError.message
      });
    }

    if (!updatedPayment) {
      logger.error('Payment not found after update', { paymentId });
      return res.status(404).json({
        success: false,
        error: 'Payment not found after update'
      });
    }

    // Log update for debugging
    logger.info('Payment expense category updated successfully', {
      paymentId: updatedPayment.id,
      expenseCategoryId: updatedPayment.expense_category_id,
      operationDate: updatedPayment.operation_date,
      amount: updatedPayment.amount,
      currency: updatedPayment.currency,
      description: updatedPayment.description?.substring(0, 50)
    });

    let createdMapping = null;

    // Create mapping rule if requested
    if (createMapping && patternType && patternValue) {
      try {
        // Determine pattern value if not provided
        let finalPatternValue = patternValue;
        if (!finalPatternValue) {
          if (patternType === 'category' && payment.category) {
            finalPatternValue = payment.category;
          } else if (patternType === 'description' && payment.description) {
            // Extract key words from description (simplified - could be improved)
            finalPatternValue = payment.description.substring(0, 100);
          } else if (patternType === 'payer' && payment.payer_name) {
            finalPatternValue = payment.payer_name;
          }
        }

        if (finalPatternValue) {
          createdMapping = await expenseCategoryMappingService.createMapping({
            pattern_type: patternType,
            pattern_value: finalPatternValue,
            expense_category_id: expenseCategoryId,
            priority: priority || 0
          });
        }
      } catch (mappingError) {
        logger.warn('Failed to create mapping rule:', mappingError);
        // Don't fail the request if mapping creation fails
      }
    }

    // Verify the update was successful
    if (updatedPayment.expense_category_id !== expenseCategoryId) {
      logger.error('Category mismatch after update', {
        paymentId,
        expected: expenseCategoryId,
        actual: updatedPayment.expense_category_id
      });
      return res.status(500).json({
        success: false,
        error: 'Category was not updated correctly',
        message: `Expected category ${expenseCategoryId}, but got ${updatedPayment.expense_category_id}`
      });
    }

    res.json({
      success: true,
      data: {
        payment: updatedPayment,
        mapping: createdMapping
      }
    });
  } catch (error) {
    logger.error('Error assigning expense category:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign expense category',
      message: error.message
    });
  }
});

/**
 * GET /api/payments/:id
 * Get a single payment by ID
 */
router.get('/payments/:id', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    const { data: payment, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({
          success: false,
          error: 'Payment not found'
        });
      }
      logger.error('Error fetching payment:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch payment',
        message: error.message
      });
    }

    res.json({
      success: true,
      data: payment
    });
  } catch (error) {
    logger.error('Error getting payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get payment',
      message: error.message
    });
  }
});

/**
 * GET /api/payments/:id/expense-category-suggestions
 * Get expense category suggestions for a payment
 */
router.get('/payments/:id/expense-category-suggestions', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid payment ID'
      });
    }

    // Get payment details
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('id, description, payer_name, category, direction')
      .eq('id', paymentId)
      .single();

    if (paymentError || !payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found'
      });
    }

    if (payment.direction !== 'out') {
      return res.status(400).json({
        success: false,
        error: 'This endpoint is only for expense payments (direction = "out")'
      });
    }

    // Get suggestions (OpenAI errors are handled internally)
    let suggestions = [];
    try {
      suggestions = await expenseCategoryMappingService.findCategorySuggestions({
        category: payment.category,
        description: payment.description,
        payer_name: payment.payer_name
      }, 5);
    } catch (suggestionsError) {
      logger.error('Error getting category suggestions:', {
        error: suggestionsError.message,
        paymentId: paymentId,
        stack: suggestionsError.stack
      });
      // Continue with empty suggestions instead of failing
      suggestions = [];
    }

    // Enrich with category names
    const enrichedSuggestions = await Promise.all(
      suggestions.map(async (suggestion) => {
        try {
          const category = await expenseCategoryService.getCategoryById(suggestion.categoryId);
          return {
            ...suggestion,
            categoryName: category?.name || 'Unknown'
          };
        } catch (error) {
          logger.warn('Error getting category name for suggestion', {
            categoryId: suggestion.categoryId,
            error: error.message
          });
          return {
            ...suggestion,
            categoryName: 'Unknown'
          };
        }
      })
    );

  res.json({
    success: true,
    data: enrichedSuggestions
  });
} catch (error) {
  logger.error('Error getting expense category suggestions:', {
    error: error.message,
    stack: error.stack,
    paymentId: req.params.id
  });
  res.status(500).json({
    success: false,
    error: 'Failed to get suggestions',
    message: error.message || 'Unknown error occurred'
  });
}
});

/**
 * POST /api/payments/:id/link-product
 * Связать платеж с продуктом
 */
router.post('/payments/:id/link-product', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    const { productId } = req.body || {};

    if (Number.isNaN(paymentId) || !Number.isInteger(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор платежа'
      });
    }

    const numericProductId = Number(productId);
    if (!Number.isInteger(numericProductId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор продукта'
      });
    }

    const linkedBy = req.user?.email || req.user?.id || null;
    const link = await paymentProductLinkService.createLink({
      paymentId,
      productId: numericProductId,
      linkedBy
    });

    res.json({
      success: true,
      data: link
    });
  } catch (error) {
    logger.error('Error linking payment to product:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Не удалось связать платеж с продуктом'
    });
  }
});

/**
 * GET /api/payments/:id/link-product
 * Получить текущую связь платежа с продуктом
 */
router.get('/payments/:id/link-product', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId) || !Number.isInteger(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор платежа'
      });
    }

    const link = await paymentProductLinkService.getLinkByPayment(paymentId);
    res.json({
      success: true,
      data: link
    });
  } catch (error) {
    logger.error('Error getting payment link info:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Не удалось получить связь платежа'
    });
  }
});

/**
 * DELETE /api/payments/:id/link-product
 * Удалить связь платежа с продуктом
 */
router.delete('/payments/:id/link-product', async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id, 10);
    if (Number.isNaN(paymentId) || !Number.isInteger(paymentId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор платежа'
      });
    }

    await paymentProductLinkService.removeLink({ paymentId });

    res.json({
      success: true
    });
  } catch (error) {
    logger.error('Error unlinking payment from product:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Не удалось удалить связь платежа'
    });
  }
});

/**
 * GET /api/products/:id/linked-payments
 * Получить платежи, связанные с продуктом
 */
router.get('/products/:id/linked-payments', async (req, res) => {
  try {
    const productId = parseInt(req.params.id, 10);
    if (Number.isNaN(productId) || !Number.isInteger(productId)) {
      return res.status(400).json({
        success: false,
        error: 'Некорректный идентификатор продукта'
      });
    }

    const links = await paymentProductLinkService.getLinkedPayments(productId);
    res.json({
      success: true,
      data: links
    });
  } catch (error) {
    logger.error('Error loading linked payments:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Не удалось получить связанные платежи'
    });
  }
});

/**
 * POST /api/crm/status-automation/sync
 * Ручной запуск пересчёта статуса сделки на основе платежей
 */
router.post('/crm/status-automation/sync', async (req, res) => {
  try {
    const { dealId, force = false } = req.body || {};
    if (!dealId) {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать dealId'
      });
    }

    if (!crmStatusAutomationService.isEnabled()) {
      return res.status(503).json({
        success: false,
        error: 'Supabase не сконфигурирован, автоматизация статусов недоступна'
      });
    }

    const result = await crmStatusAutomationService.syncDealStage(dealId, { force });
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    logger.error('Failed to sync CRM deal status', {
      error: error.message,
      requestBody: req.body
    });
    res.status(500).json({
      success: false,
      error: error.message || 'Не удалось синхронизировать статус сделки'
    });
  }
});

function parseCashAmount(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const sanitized = value.replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const parsed = parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCurrencyCode(value) {
  if (typeof value !== 'string') {
    return 'PLN';
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed || 'PLN';
}

function normalizeDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function normalizeDateTimeInput(value) {
  if (!value) {
    return new Date().toISOString();
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }
  return date.toISOString();
}

async function updateCashDealStage(dealId, stageId, reason) {
  if (!ENABLE_CASH_STAGE_AUTOMATION || !dealId || !stageId) {
    return;
  }
  try {
    await pipedriveClient.updateDealStage(dealId, stageId);
    logger.info('Cash automation: deal stage updated', {
      dealId,
      stageId,
      reason
    });
  } catch (error) {
    logger.warn('Cash automation: failed to update deal stage', {
      dealId,
      stageId,
      reason,
      error: error.message
    });
  }
}
module.exports = router;
