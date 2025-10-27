const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const vatMarginRoutes = require('./vatMargin');
const {
  getWfirmaClient,
  getPipedriveClient,
  getUserManagementService,
  getProductManagementService,
  getInvoiceProcessingService,
  getSchedulerService
} = require('../services/serviceManager');

console.log('🔧 API routes loaded - services will be initialized on demand');

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
    const wfirmaClient = getWfirmaClient();
    if (!wfirmaClient) {
      return res.status(500).json({
        success: false,
        error: 'wFirma client not initialized',
        message: 'wFirma client failed to initialize - check environment variables'
      });
    }
    
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
  const wfirmaClient = getWfirmaClient();
  const pipedriveClient = getPipedriveClient();
  const userManagement = getUserManagementService();
  const productManagement = getProductManagementService();
  const invoiceProcessing = getInvoiceProcessingService();
  const scheduler = getSchedulerService();
  
  const services = {
    wfirmaClient: wfirmaClient ? 'initialized' : 'failed',
    pipedriveClient: pipedriveClient ? 'initialized' : 'failed',
    userManagement: userManagement ? 'initialized' : 'failed',
    productManagement: productManagement ? 'initialized' : 'failed',
    invoiceProcessing: invoiceProcessing ? 'initialized' : 'failed',
    scheduler: scheduler ? 'initialized' : 'failed'
  };
  
  const allServicesHealthy = Object.values(services).every(status => status === 'initialized');
  
  res.status(allServicesHealthy ? 200 : 500).json({
    success: allServicesHealthy,
    message: allServicesHealthy ? 'Service is healthy' : 'Some services failed to initialize',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    services: services
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

router.use('/vat-margin', vatMarginRoutes);

module.exports = router;



