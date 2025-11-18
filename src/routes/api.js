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
const { requireStripeAccess } = require('../middleware/auth');
const stripeService = require('../services/stripe/service');
const stripeAnalyticsService = require('../services/stripe/analyticsService');
const logger = require('../utils/logger');

// Создаем экземпляры сервисов
const wfirmaClient = new WfirmaClient();
let pipedriveClient;
try {
  pipedriveClient = new PipedriveClient();
} catch (error) {
  logger.error('Failed to initialize PipedriveClient:', error);
  // Create a dummy client that will return errors
  pipedriveClient = {
    testConnection: async () => ({
      success: false,
      error: 'PipedriveClient not initialized',
      message: error.message || 'PIPEDRIVE_API_TOKEN is not set'
    })
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
const upload = multer();

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

// ==================== PIPEDRIVE ENDPOINTS ====================

/**
 * GET /api/pipedrive/test
 * Тест подключения к Pipedrive API
 */
router.get('/pipedrive/test', async (req, res) => {
  try {
    // Check if pipedriveClient is available
    if (!pipedriveClient) {
      logger.error('PipedriveClient not initialized');
      return res.status(500).json({
        success: false,
        error: 'PipedriveClient not initialized',
        message: 'PIPEDRIVE_API_TOKEN may be missing'
      });
    }

    const result = await pipedriveClient.testConnection();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error testing Pipedrive connection:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    
    // Check if it's a configuration error
    if (error.message && error.message.includes('PIPEDRIVE_API_TOKEN')) {
      return res.status(500).json({
        success: false,
        error: 'Configuration error',
        message: 'PIPEDRIVE_API_TOKEN is not set in environment variables'
      });
    }
    
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
 * POST /api/invoice-processing/run
 * Запустить обработку счетов вручную
 */
router.post('/invoice-processing/run', async (req, res) => {
  try {
    const { period = 'manual' } = req.body;
    
    logger.info(`Manual invoice processing triggered with period: ${period}`);
    
    const result = await scheduler.runManualProcessing(period);

    if (result?.skipped) {
      return res.status(409).json({
        success: false,
        error: 'Processing already in progress',
        reason: result.reason || 'processing_in_progress'
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
    const creationResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (!creationResult.success) {
      return res.status(500).json(creationResult);
    }

    const deletionResult = await invoiceProcessing.getDealsMarkedForDeletion();
    if (!deletionResult.success) {
      return res.status(500).json(deletionResult);
    }

    const creationDeals = creationResult.deals || [];
    const deletionDeals = Array.isArray(deletionResult.deals) ? deletionResult.deals : [];

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
    logger.error('Error getting pending deals:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
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
        invoiceType: deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '70' ? 'Proforma' : 
                   deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '71' ? 'Prepayment' :
                   deal.ad67729ecfe0345287b71a3b00910e8ba5b3b496 === '72' ? 'Final' : 'Unknown',
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
    const data = await lookup.getMonthlyProformasByProduct({ ...options, dateFrom: resolvedDateFrom, dateTo: resolvedDateTo });
    const summary = computeSummary(data);
    const stripeData = await stripeAnalyticsService.getMonthlyStripeSummary({
      dateFrom: resolvedDateFrom,
      dateTo: resolvedDateTo
    });

    if (Array.isArray(data) && data.length > 0) {
      const missingDealCount = data.filter((item) => !item.pipedrive_deal_id).length;
      logger.info('Monthly proformas deal link coverage', {
        total: data.length,
        missing: missingDealCount
      });
    }

    res.json({
      success: true,
      data,
      count: data.length,
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
    const summary = await productReportService.getProductSummary();

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

    res.json({
      success: true,
      data: report.products,
      summary: report.summary,
      filters: report.filters
    });
  } catch (error) {
    logger.error('Error building payment revenue report:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось сформировать отчёт по платежам',
      message: error.message
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

router.get('/vat-margin/payments', async (req, res) => {
  try {
    const { direction, limit, uncategorized } = req.query;
    
    // If uncategorized=true, filter for expenses without category
    let expenseCategoryId = undefined;
    if (uncategorized === 'true' && direction === 'out') {
      expenseCategoryId = null; // null means IS NULL in Supabase
    }
    
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;
    const { payments, history } = await paymentService.listPayments({ 
      direction, 
      limit: parsedLimit,
      expenseCategoryId 
    });
    
    // Additional safety: filter out any payments with wrong direction if direction was specified
    let filteredPayments = payments;
    if (direction) {
      filteredPayments = payments.filter(p => p.direction === direction);
    }
    
    res.json({
      success: true,
      data: filteredPayments,
      payments: filteredPayments, // Also include for backward compatibility
      history
    });
  } catch (error) {
    logger.error('Error loading payments:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось загрузить платежи',
      message: error.message
    });
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

    const stats = await paymentService.ingestCsv(req.file.buffer, {
      filename: req.file.originalname,
      uploadedBy
    });

    res.json({
      success: true,
      ...stats,
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
    logger.error('Error applying automatic payment matches:', error);
    res.status(500).json({
      success: false,
      error: 'Не удалось подтвердить автоматические совпадения',
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

    const { name, description, management_type } = req.body;

    const category = await expenseCategoryService.updateCategory(id, {
      name,
      description,
      management_type
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
router.post('/payments/import-expenses', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    logger.info('Importing expenses CSV', {
      filename: req.file.originalname,
      size: req.file.buffer.length
    });

    // Get auto-match threshold from query parameter (default: 90%)
    const autoMatchThreshold = req.query.autoMatchThreshold 
      ? parseInt(req.query.autoMatchThreshold, 10) 
      : 90;
    
    // Validate threshold (0-100)
    const validThreshold = Math.max(0, Math.min(100, autoMatchThreshold));
    
    const stats = await paymentService.ingestExpensesCsv(req.file.buffer, {
      filename: req.file.originalname,
      uploadedBy: req.user?.email || req.user?.name || null,
      autoMatchThreshold: validThreshold
    });

    logger.info('Expenses CSV imported successfully', stats);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error importing expenses CSV:', {
      error: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      success: false,
      error: 'Failed to import expenses CSV',
      message: error.message
    });
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

    // Get suggestions
    const suggestions = await expenseCategoryMappingService.findCategorySuggestions({
      category: payment.category,
      description: payment.description,
      payer_name: payment.payer_name
    }, 5);

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
    logger.error('Error getting expense category suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get suggestions',
      message: error.message
    });
  }
});

module.exports = router;



