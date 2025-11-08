const express = require('express');
const axios = require('axios');
const multer = require('multer');
const router = express.Router();
const WfirmaClient = require('../services/wfirma');
const PipedriveClient = require('../services/pipedrive');
const UserManagementService = require('../services/userManagement');
const ProductManagementService = require('../services/productManagement');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const SchedulerService = require('../services/scheduler');
const PaymentService = require('../services/payments/paymentService');
const { WfirmaLookup } = require('../services/vatMargin/wfirmaLookup');
const ProductReportService = require('../services/vatMargin/productReportService');
const logger = require('../utils/logger');

// Создаем экземпляры сервисов
const wfirmaClient = new WfirmaClient();
const pipedriveClient = new PipedriveClient();
const userManagement = new UserManagementService();
const productManagement = new ProductManagementService();
const invoiceProcessing = new InvoiceProcessingService();
const scheduler = new SchedulerService();
const paymentService = new PaymentService();
const productReportService = new ProductReportService();
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

// ==================== PIPEDRIVE ENDPOINTS ====================

/**
 * GET /api/pipedrive/test
 * Тест подключения к Pipedrive API
 */
router.get('/pipedrive/test', async (req, res) => {
  try {
    const result = await pipedriveClient.testConnection();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error testing Pipedrive connection:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
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
    res.json({ success: true, status });
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
 * POST /api/invoice-processing/start
 * Запустить планировщик обработки счетов
 */
router.post('/invoice-processing/start', (req, res) => {
  try {
    scheduler.start();
    res.json({
      success: true,
      message: 'Invoice processing scheduler started',
      status: scheduler.getStatus()
    });
  } catch (error) {
    logger.error('Error starting scheduler:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * POST /api/invoice-processing/stop
 * Остановить планировщик обработки счетов
 */
router.post('/invoice-processing/stop', (req, res) => {
  try {
    scheduler.stop();
    res.json({
      success: true,
      message: 'Invoice processing scheduler stopped',
      status: scheduler.getStatus()
    });
  } catch (error) {
    logger.error('Error stopping scheduler:', error);
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
    
    if (result && result.success) {
      res.json(result);
    } else {
      res.status(500).json(result || { success: false, error: 'Unknown error' });
    }
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
    const result = await invoiceProcessing.getPendingInvoiceDeals();
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
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
          nextScheduledRun: schedulerStatus.nextRuns?.[0] || null,
          schedulerRunning: schedulerStatus.isRunning
        },
        queue: queue,
        scheduler: {
          status: schedulerStatus.isRunning ? 'running' : 'stopped',
          schedule: schedulerStatus.schedule,
          nextRuns: schedulerStatus.nextRuns
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
    const data = await lookup.getMonthlyProformasByProduct(options);
    const summary = computeSummary(data);

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
      period: {
        month: options.month || null,
        year: options.year || null,
        dateFrom: options.dateFrom || null,
        dateTo: options.dateTo || null
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

router.get('/vat-margin/payments', async (_req, res) => {
  try {
    const { payments, history } = await paymentService.listPayments();
    res.json({
      success: true,
      data: payments,
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

module.exports = router;



