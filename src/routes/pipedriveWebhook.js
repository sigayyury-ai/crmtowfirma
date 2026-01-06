const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const ProformaRepository = require('../services/proformaRepository');
const supabase = require('../services/supabaseClient');
const { STAGE_IDS: STAGES } = require('../services/crm/statusCalculator');
const logger = require('../utils/logger');
const { normaliseCurrency } = require('../utils/currency');
const CashPaymentsRepository = require('../services/cash/cashPaymentsRepository');
const { extractCashFields, parseDateString } = require('../services/cash/cashFieldParser');
const { ensureCashStatus } = require('../services/cash/cashStatusSync');
const { createCashReminder, closeCashReminders } = require('../services/cash/cashReminderService');
// Phase 0: Code Review Fixes - New unified services
const PaymentScheduleService = require('../services/stripe/paymentScheduleService');

const stripeProcessor = new StripeProcessorService();
const invoiceProcessing = new InvoiceProcessingService();
const proformaRepository = new ProformaRepository();
const cashPaymentsRepository = new CashPaymentsRepository();
const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
const INVOICE_NUMBER_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_NUMBER_FIELD_KEY || '0598d1168fe79005061aa3710ec45c3e03dbe8a3';
const STRIPE_DASHBOARD_ACCOUNT_PATH = process.env.STRIPE_DASHBOARD_ACCOUNT_PATH || '';
const STRIPE_DASHBOARD_WORKSPACE_ID = process.env.STRIPE_DASHBOARD_WORKSPACE_ID || '';

function resolvePipedriveClient() {
  if (invoiceProcessing?.pipedriveClient) {
    return invoiceProcessing.pipedriveClient;
  }
  if (stripeProcessor?.pipedriveClient) {
    return stripeProcessor.pipedriveClient;
  }
  return null;
}

function formatStripeInvoiceMarker(sessionId) {
  if (!sessionId) {
    return null;
  }
  const suffix = String(sessionId).slice(-6).toUpperCase();
  return `STR-${suffix}`;
}

function buildStripeSearchUrl(query) {
  const stripeMode = (process.env.STRIPE_MODE || 'test').toLowerCase();
  const baseUrl = stripeMode === 'live'
    ? 'https://dashboard.stripe.com'
    : 'https://dashboard.stripe.com/test';
  const accountSegment = STRIPE_DASHBOARD_ACCOUNT_PATH ? `/${STRIPE_DASHBOARD_ACCOUNT_PATH}` : '';
  const workspaceSegment = STRIPE_DASHBOARD_WORKSPACE_ID
    ? `&search_context_id=${encodeURIComponent(STRIPE_DASHBOARD_WORKSPACE_ID)}`
    : '';
  return `${baseUrl}${accountSegment}/search?query=${encodeURIComponent(query)}${workspaceSegment}`;
}

async function updateInvoiceNumberField(dealId, value) {
  const client = resolvePipedriveClient();
  if (!client || !dealId || !INVOICE_NUMBER_FIELD_KEY) {
    return false;
  }

  try {
    await client.updateDeal(dealId, {
      [INVOICE_NUMBER_FIELD_KEY]: value
    });
    logger.info('Invoice number field updated', { dealId, value });
    return true;
  } catch (error) {
    logger.warn('Failed to update invoice number field', {
      dealId,
      error: error.message
    });
    return false;
  }
}

async function updateInvoiceTypeField(dealId, value) {
  const client = resolvePipedriveClient();
  if (!client || !dealId || !INVOICE_TYPE_FIELD_KEY) {
    return false;
  }

  try {
    await client.updateDeal(dealId, {
      [INVOICE_TYPE_FIELD_KEY]: value
    });
    logger.info('Invoice field updated', { dealId, value });
    return true;
  } catch (error) {
    logger.warn('Failed to update invoice field', {
      dealId,
      error: error.message
    });
    return false;
  }
}

function hasProformaCandidates(deal) {
  if (!deal || !INVOICE_NUMBER_FIELD_KEY) {
    return false;
  }
  const rawValue = deal[INVOICE_NUMBER_FIELD_KEY];
  if (rawValue === undefined || rawValue === null) {
    return false;
  }
  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (['delete', 'done', 'stripe', 'str', 'n/a', '-'].includes(normalized)) {
    return false;
  }
  return true;
}

async function hasStripePaymentsForDeal(dealId) {
  if (!dealId || !stripeProcessor?.repository?.isEnabled()) {
    return false;
  }

  try {
    const payments = await stripeProcessor.repository.listPayments({
      dealId: String(dealId),
      limit: 1
    });
    return Array.isArray(payments) && payments.length > 0;
  } catch (error) {
    logger.warn('Failed to check Stripe payments for deal', {
      dealId,
      error: error.message
    });
    return false;
  }
}

async function refundStripePayments(dealId) {
  const summary = {
    totalDeals: 1,
    refundsCreated: 0,
    errors: []
  };

  try {
    await stripeProcessor.refundDealPayments(dealId, summary);
    if (summary.refundsCreated > 0) {
      logger.info('Stripe refunds processed for deal', {
        dealId,
        refundsCreated: summary.refundsCreated,
        errors: summary.errors?.length || 0
      });
    } else {
      logger.info('No Stripe refunds created for deal', {
        dealId,
        errors: summary.errors?.length || 0
      });
    }
  } catch (error) {
    logger.warn('Failed to refund Stripe payments for deal', {
      dealId,
      error: error.message
    });
  }
}

async function cleanupDealArtifacts(dealId) {
  const result = {
    cashDeleted: 0,
    stripeCancelled: 0,
    stripeRemoved: 0,
    reminderTasksClosed: 0,
    reminderNotesRemoved: 0
  };

  if (!dealId) {
    return result;
  }

  if (cashPaymentsRepository.isEnabled()) {
    try {
      const deletion = await cashPaymentsRepository.deleteByDealId(dealId);
      result.cashDeleted = deletion.deleted || 0;
      if (result.cashDeleted > 0) {
        logger.info('Removed cash payments for deleted deal', {
          dealId,
          deleted: result.cashDeleted
        });
      }
    } catch (error) {
      logger.warn('Failed to delete cash payments for deal', {
        dealId,
        error: error.message
      });
    }
  }

  try {
    const stripeResult = await stripeProcessor.cancelDealCheckoutSessions(dealId);
    result.stripeCancelled = stripeResult.cancelled || 0;
    result.stripeRemoved = stripeResult.removed || 0;
  } catch (error) {
    logger.warn('Failed to cancel Stripe sessions for deleted deal', {
      dealId,
      error: error.message
    });
  }

  const pipedriveClient = resolvePipedriveClient();
  if (pipedriveClient) {
    try {
      const reminderResult = await closeCashReminders(pipedriveClient, { dealId });
      result.reminderTasksClosed = reminderResult.tasksClosed || 0;
      result.reminderNotesRemoved = reminderResult.notesRemoved || 0;
    } catch (error) {
      logger.warn('Failed to cleanup cash reminders for deal', {
        dealId,
        error: error.message
      });
    }
  }

  await updateInvoiceTypeField(dealId, 'Done');
  await updateInvoiceNumberField(dealId, null);

  return result;
}

/**
 * Нормализует invoice_type к числовому ID
 * Преобразует строковые значения в числовые ID для единообразной обработки
 * @param {string|number} invoiceType - Значение invoice_type из webhook или deal
 * @returns {string|null} - Нормализованное значение (ID) или null
 */
function normalizeInvoiceTypeToId(invoiceType) {
  if (!invoiceType) {
    logger.debug('normalizeInvoiceTypeToId: invoiceType is null/undefined');
    return null;
  }
  
  const originalValue = String(invoiceType);
  const normalized = originalValue.trim().toLowerCase();
  
  // Маппинг строковых значений на числовые ID
  const typeMapping = {
    'stripe': '75',
    'proforma': '70',
    'proforma 70': '70',
    'proforma 71': '71',
    'proforma 72': '72',
    'delete': '74',
    'done': '73',
    'refund': 'refund' // Оставляем как есть для рефандов
  };
  
  // Если это уже числовое значение, возвращаем как есть
  if (/^\d+$/.test(normalized)) {
    logger.debug(`normalizeInvoiceTypeToId: числовое значение "${originalValue}" → "${normalized}"`);
    return normalized;
  }
  
  // Если есть маппинг, возвращаем ID
  if (typeMapping[normalized]) {
    logger.debug(`normalizeInvoiceTypeToId: маппинг "${originalValue}" → "${typeMapping[normalized]}"`);
    return typeMapping[normalized];
  }
  
  // Если не найдено, возвращаем оригинальное значение (может быть кастомное)
  const result = String(invoiceType).trim();
  logger.warn(`normalizeInvoiceTypeToId: неизвестное значение "${originalValue}" → "${result}" (нет маппинга)`);
  return result;
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function hasAmountChanged(currentValue, previousValue) {
  if (!Number.isFinite(currentValue)) {
    return false;
  }
  if (!Number.isFinite(previousValue)) {
    return true;
  }
  return Math.abs(currentValue - previousValue) >= 0.01;
}

function resolveDealCurrency(deal) {
  if (!deal) return 'PLN';
  const currency = deal.currency ||
    deal['Deal currency'] ||
    deal['deal_currency'] ||
    deal['Currency'];
  if (!currency || typeof currency !== 'string') {
    return 'PLN';
  }
  return currency.toUpperCase();
}

function fallbackExpectedDate(deal) {
  if (!deal) return null;
  return parseDateString(
    deal.expected_close_date ||
    deal.close_date ||
    deal['Expected close date'] ||
    deal['expected_close_date'] ||
    deal['close_date']
  );
}

async function syncCashExpectationFromDeal({ dealId, currentDeal, previousDeal }) {
  if (!cashPaymentsRepository.isEnabled() || !dealId || !currentDeal) {
    return;
  }

  const currentFields = extractCashFields(currentDeal);
  if (!currentFields || !Number.isFinite(currentFields.amount) || currentFields.amount <= 0) {
    return;
  }

  const previousFields = previousDeal ? extractCashFields(previousDeal) : null;
  const previousAmount = previousFields?.amount;

  if (!hasAmountChanged(currentFields.amount, previousAmount)) {
    return;
  }

  const normalizedDealId = typeof dealId === 'string' ? dealId : Number(dealId);
  const currency = resolveDealCurrency(currentDeal);
  const expectedDate = currentFields.expectedDate || fallbackExpectedDate(currentDeal);
  const roundedAmount = roundCurrency(currentFields.amount);

  const existing = await cashPaymentsRepository.findDealExpectation(normalizedDealId);
  const isNewExpectation = !existing;
  const payload = {
    cash_expected_amount: roundedAmount,
    expected_date: expectedDate,
    currency,
    amount_pln: currency === 'PLN' ? roundedAmount : existing?.amount_pln ?? null,
    status: existing && existing.status !== 'cancelled' ? existing.status : 'pending',
    note: 'Создано из Pipedrive (cash_amount)'
  };

  let record = null;

  if (existing) {
    record = await cashPaymentsRepository.updatePayment(existing.id, payload);
  } else {
    record = await cashPaymentsRepository.createPayment({
      deal_id: normalizedDealId,
      proforma_id: null,
      product_id: null,
      cash_expected_amount: payload.cash_expected_amount,
      currency: payload.currency,
      amount_pln: currency === 'PLN' ? payload.cash_expected_amount : null,
      expected_date: payload.expected_date,
      status: 'pending',
      source: 'crm',
      created_by: 'pipedrive_webhook',
      note: payload.note,
      metadata: {
        source: 'pipedrive'
      }
    });
  }

  if (record && record.id) {
    await cashPaymentsRepository.logEvent(record.id, existing ? 'crm:update' : 'crm:create', {
      source: 'pipedrive_webhook',
      payload: {
        amount: payload.cash_expected_amount,
        expected_date: payload.expected_date
      },
      createdBy: 'pipedrive_webhook'
    });

    await ensureCashStatus({
      pipedriveClient: invoiceProcessing.pipedriveClient,
      dealId: normalizedDealId,
      currentStatus: currentFields.status,
      targetStatus: 'PENDING'
    });

    if (isNewExpectation) {
      await createCashReminder(invoiceProcessing.pipedriveClient, {
        dealId: normalizedDealId,
        amount: payload.cash_expected_amount,
        currency: payload.currency,
        expectedDate: payload.expected_date,
        closeDate: currentDeal.expected_close_date || currentDeal.close_date,
        source: 'CRM',
        buyerName: currentDeal.person_id?.name || currentDeal.person_name || currentDeal.title,
        personId: currentDeal.person_id?.value || currentDeal.person_id,
        sendpulseClient: invoiceProcessing.sendpulseClient
      });
    }
  }
}

// Хранилище последних webhook событий для отладки (в памяти, последние 50)
const webhookHistory = [];
const MAX_HISTORY_SIZE = 50;

// Защита от дублирующихся webhooks (последние 500 событий, храним 60 секунд)
const recentWebhookHashes = new Map(); // Map<hash, timestamp>
const MAX_HASH_SIZE = 500;
const HASH_TTL_MS = 60000; // 60 секунд

// Блокировка обработки Stripe платежей для конкретных сделок (предотвращает параллельную обработку)
const stripeProcessingLocks = new Map(); // Map<dealId, timestamp>
const STRIPE_LOCK_TTL_MS = 30 * 1000; // 30 секунд блокировка

// Кэш продуктов сделок для отслеживания изменений
const productChangeCache = new Map(); // Map<dealId, { productId, productName, timestamp }>
const PRODUCT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа
const PRODUCT_CACHE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Очистка каждый час

// Периодическая очистка устаревших записей из кэша продуктов
setInterval(() => {
  const now = Date.now();
  for (const [dealId, cache] of productChangeCache.entries()) {
    if (now - cache.timestamp > PRODUCT_CACHE_TTL_MS) {
      productChangeCache.delete(dealId);
    }
  }
}, PRODUCT_CACHE_CLEANUP_INTERVAL_MS);

/**
 * POST /api/webhooks/pipedrive
 * Webhook endpoint for Pipedrive deal updates
 * Обрабатывает триггеры:
 * 1. Изменение статуса на "lost" с reason "Refund" → обработка рефандов
 * 2. Изменение статуса на "lost" (любой другой reason) → удаление инвойсов
 * 3. Стадия "First payment" → создание Stripe Checkout Session
 * 4. Изменение invoice_type → создание инвойса или Stripe Checkout Session
 * 5. Изменение invoice_type на "delete"/"74" → удаление инвойсов
 * 6. Удаление сделки (deleted.deal) → удаление инвойсов
 */
// Middleware для логирования всех запросов к webhook (до парсинга body)
router.use('/webhooks/pipedrive', (req, res, next) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const userAgent = req.headers['user-agent'] || 'unknown';
  
  logger.info(`📥 Pipedrive Webhook Request | Timestamp: ${timestamp} | Method: ${req.method} | URL: ${req.url} | IP: ${clientIP} | User-Agent: ${userAgent.substring(0, 100)}`);
  
  // Логируем заголовки для отладки
  logger.debug('Pipedrive Webhook Headers', {
    'content-type': req.headers['content-type'],
    'content-length': req.headers['content-length'],
    'x-forwarded-for': req.headers['x-forwarded-for'],
    'user-agent': userAgent
  });
  
  next();
});

router.post('/webhooks/pipedrive', express.json({ limit: '10mb' }), async (req, res) => {
  const timestamp = new Date().toISOString();
  
  // Логируем получение webhook'а в самом начале
  logger.info(`📥 Webhook получен | Timestamp: ${timestamp} | Method: ${req.method} | URL: ${req.url}`);
  
  try {
    const webhookData = req.body;
    
    // Логируем структуру webhook'а для отладки
    logger.info(`📥 Webhook данные получены | Keys: ${webhookData ? Object.keys(webhookData).join(', ') : 'нет данных'}`);
    
    // Проверяем, не является ли это webhook от Stripe (игнорируем его)
    // Проверяем по User-Agent, IP адресам Stripe и структуре данных
    const userAgent = req.headers['user-agent'] || '';
    const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const isStripeUserAgent = userAgent.includes('Stripe');
    const isStripeIP = clientIP && (
      clientIP.includes('54.187.') || // Stripe IP ranges
      clientIP.includes('54.230.') ||
      clientIP.includes('54.239.')
    );
    const isStripeStructure = webhookData && webhookData.object === 'event' && webhookData.type && webhookData.api_version;
    
    if (isStripeUserAgent || isStripeIP || isStripeStructure) {
      // Это Stripe webhook, игнорируем его без логирования
      // ВАЖНО: В Stripe Dashboard должен быть указан URL: https://invoices.comoon.io/api/webhooks/stripe
      return res.status(200).json({
        success: true,
        message: 'Stripe webhook ignored - use /api/webhooks/stripe endpoint'
      });
    }
    
    // Извлекаем dealId для проверки дубликатов
    const dealIdForHash = webhookData?.current?.id || 
                          webhookData?.previous?.id || 
                          webhookData?.['Deal ID'] || 
                          webhookData?.['Deal_id'] ||
                          webhookData?.dealId ||
                          webhookData?.deal_id;
    
    // Очищаем устаревшие хеши
    const now = Date.now();
    for (const [hash, timestamp] of recentWebhookHashes.entries()) {
      if (now - timestamp > HASH_TTL_MS) {
        recentWebhookHashes.delete(hash);
      }
    }
    
    // Создаем упрощенный хеш для проверки дубликатов (только ключевые поля)
    const stageId = webhookData?.['Deal_stage_id'] || webhookData?.current?.stage_id || webhookData?.previous?.stage_id;
    const status = webhookData?.['Deal_status'] || webhookData?.current?.status || webhookData?.previous?.status;
    const invoice = webhookData?.['Invoice'] || webhookData?.current?.['ad67729ecfe0345287b71a3b00910e8ba5b3b496'] || webhookData?.previous?.['ad67729ecfe0345287b71a3b00910e8ba5b3b496'];
    
    const webhookHash = `${dealIdForHash || 'no-deal'}|${webhookData?.event || 'workflow'}|${stageId || ''}|${status || ''}|${invoice || ''}`;
    
    // Проверяем, не обрабатывали ли мы этот webhook недавно
    if (recentWebhookHashes.has(webhookHash)) {
      // Дублирующийся webhook, игнорируем без логирования
      return res.status(200).json({
        success: true,
        message: 'Duplicate webhook ignored',
        dealId: dealIdForHash
      });
    }
    
    // Добавляем хеш с timestamp
    recentWebhookHashes.set(webhookHash, now);
    
    // Ограничиваем размер (удаляем самые старые)
    if (recentWebhookHashes.size > MAX_HASH_SIZE) {
      const sortedEntries = Array.from(recentWebhookHashes.entries()).sort((a, b) => a[1] - b[1]);
      const toDelete = sortedEntries.slice(0, sortedEntries.length - MAX_HASH_SIZE / 2);
      toDelete.forEach(([hash]) => recentWebhookHashes.delete(hash));
    }
    
    // Сохраняем событие в историю для отладки
    const webhookEvent = {
      timestamp,
      event: webhookData?.event || 'workflow_automation',
      dealId: dealIdForHash,
      bodyKeys: webhookData ? Object.keys(webhookData) : [],
      bodyPreview: webhookData ? Object.fromEntries(
        Object.entries(webhookData).slice(0, 10).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).substring(0, 100) : String(v).substring(0, 100)])
      ) : {},
      body: webhookData // Сохраняем полное тело для отладки
    };
    
    // Логируем все поля, связанные с Invoice, для диагностики
    const invoiceFields = webhookData ? Object.entries(webhookData)
      .filter(([key]) => key.toLowerCase().includes('invoice') || key.toLowerCase().includes('invoice'))
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ') : 'нет';
    logger.debug(`🔍 Поля Invoice в webhook | Deal: ${dealIdForHash || 'неизвестен'} | Поля: ${invoiceFields || 'нет'}`);
    
    webhookHistory.unshift(webhookEvent); // Добавляем в начало
    if (webhookHistory.length > MAX_HISTORY_SIZE) {
      webhookHistory.pop(); // Удаляем старые события
    }
    
    // Log webhook received - только важное на info, детали в debug
    const eventType = webhookData.event || 'workflow_automation';
    logger.debug(`📥 Webhook получен | Deal: ${webhookEvent.dealId || 'неизвестен'}`);
    logger.debug(`🔍 Начало обработки webhook | Deal: ${webhookEvent.dealId || 'неизвестен'} | Event type: ${eventType}`);

    // Поддержка двух форматов:
    // 1. Стандартный формат Pipedrive: { event: "updated.deal", current: {...}, previous: {...} }
    // 2. Формат от workflow automation: { "Deal ID": "123" } или { dealId: "123" }
    
    let dealId = null;
    let currentDeal = null;
    let previousDeal = null;
    let isWorkflowAutomation = false;

    // Проверяем формат workflow automation (Deal ID или расширенные данные)
    // Поддержка разных форматов: Deal ID, Deal_id, dealId
    if (webhookData['Deal ID'] || webhookData['Deal_id'] || webhookData.dealId || webhookData.deal_id) {
      dealId = webhookData['Deal ID'] || webhookData['Deal_id'] || webhookData.dealId || webhookData.deal_id;
      isWorkflowAutomation = true;
      
      const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
      const INVOICE_NUMBER_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_NUMBER_FIELD_KEY || '0598d1168fe79005061aa3710ec45c3e03dbe8a3';
      
      // Проверяем, есть ли уже данные в webhook (оптимизация)
      // Поддержка разных форматов названий полей (с пробелами, с подчеркиваниями, camelCase)
      const hasInvoiceType = webhookData['Invoice type'] !== undefined || 
                            webhookData['Invoice'] !== undefined ||
                            webhookData['invoice_type'] !== undefined ||
                            webhookData['invoice'] !== undefined ||
                            webhookData[INVOICE_TYPE_FIELD_KEY] !== undefined;
      const hasStatus = webhookData['Deal status'] !== undefined || 
                       webhookData['Deal_status'] !== undefined ||
                       webhookData['deal_status'] !== undefined ||
                       webhookData['status'] !== undefined;
      
      // Проверяем, есть ли Deal_stage_id (числовой ID стадии) в webhook'е
      const stageId = webhookData['Deal_stage_id'] || 
                     webhookData['Deal stage id'] || 
                     webhookData['deal_stage_id'] || 
                     webhookData['stage_id'];
      const hasStageId = stageId !== undefined && !isNaN(Number(stageId));
      
      // Если есть stage_id и status, используем их без запроса к API
      // invoice_type не обязателен для триггера стадии "First payment"
      if (hasStageId && hasStatus) {
        // Используем данные из webhook без запроса к API
        
        // Собираем данные сделки из webhook - берем все поля
        currentDeal = {
          id: dealId,
          // Основные поля
          title: webhookData['Deal title'] || 
                webhookData['Deal_title'] ||
                webhookData['deal_title'] ||
                webhookData['title'] ||
                webhookData['Deal name'] ||
                webhookData['Deal_name'] ||
                webhookData['deal_name'] ||
                webhookData['name'],
          stage_id: Number(stageId),
          stage_name: webhookData['Deal stage'] || 
                   webhookData['Deal_stage'] || 
                   webhookData['deal_stage'] || 
                     webhookData['stage_name'],
          status: webhookData['Deal status'] || 
                 webhookData['Deal_status'] || 
                 webhookData['deal_status'] || 
                 webhookData['status'],
          // Invoice поля - обрабатываем случаи, когда значение может быть объектом с полем .value
          [INVOICE_TYPE_FIELD_KEY]: (() => {
            const extractInvoiceValue = (val) => {
              if (val === null || val === undefined) return null;
              if (typeof val === 'object' && val !== null && 'value' in val) {
                return val.value;
              }
              return val;
            };
            return extractInvoiceValue(webhookData['Invoice type']) || 
                   extractInvoiceValue(webhookData['Invoice']) ||
                   extractInvoiceValue(webhookData['invoice_type']) || 
                   extractInvoiceValue(webhookData['invoice']) ||
                   extractInvoiceValue(webhookData[INVOICE_TYPE_FIELD_KEY]);
          })(),
          [INVOICE_NUMBER_FIELD_KEY]: webhookData['Invoice number'] ||
                                     webhookData['Invoice_number'] ||
                                     webhookData['invoice_number'] ||
                                     webhookData['invoiceNumber'] ||
                                     webhookData[INVOICE_NUMBER_FIELD_KEY] ||
                                     webhookData['Invoice'],
          // Финансовые поля
          value: webhookData['Deal value'] || 
                webhookData['Deal_value'] ||
                webhookData['deal_value'] || 
                webhookData['value'],
          currency: webhookData['Deal currency'] || 
                   webhookData['Deal_currency'] ||
                   webhookData['deal_currency'] || 
                   webhookData['currency'] ||
                   webhookData['Currency'],
          // Даты
          expected_close_date: webhookData['Expected close date'] || 
                               webhookData['Deal_close_date'] ||
                               webhookData['expected_close_date'] || 
                               webhookData['expectedCloseDate'],
          close_date: webhookData['Deal_close_date'] ||
                     webhookData['Deal closed date'] ||
                     webhookData['close_date'],
          // Связи
          person_id: webhookData['Person ID'] || 
                    webhookData['Contact id'] ||
                    webhookData['Contact_id'] ||
                    webhookData['person_id'] || 
                    webhookData['personId'] || 
                    (webhookData['Person ID']?.value ? webhookData['Person ID'].value : null) ||
                    (webhookData['Contact id']?.value ? webhookData['Contact id'].value : null),
          organization_id: webhookData['Organization ID'] || 
                          webhookData['Organisation_id'] ||
                          webhookData['organization_id'] || 
                          webhookData['organizationId'] ||
                          (webhookData['Organization ID']?.value ? webhookData['Organization ID'].value : null) ||
                          (webhookData['Organisation_id']?.value ? webhookData['Organisation_id'].value : null),
          // Lost reason
          lost_reason: webhookData['Deal_lost_reason'] ||
                      webhookData['Deal lost reason'] ||
                      webhookData['lost_reason'] ||
                      webhookData['lostReason'],
          // Дополнительные поля для совместимости
          org_id: webhookData['Organization ID'] || 
                 webhookData['Organisation_id'] ||
                 webhookData['organization_id'] || 
                 webhookData['organizationId'] ||
                 webhookData['org_id'] ||
                 (webhookData['Organization ID']?.value ? webhookData['Organization ID'].value : null) ||
                 (webhookData['Organisation_id']?.value ? webhookData['Organisation_id'].value : null),
          // Копируем ВСЕ остальные поля из webhook'а (кроме Deal_id вариантов, чтобы не перезаписать id)
          // Это гарантирует, что все поля из webhook попадут в currentDeal и будут доступны обработчикам
          ...Object.fromEntries(
            Object.entries(webhookData).filter(([key]) => {
              const lowerKey = key.toLowerCase();
              // Исключаем только варианты Deal ID, чтобы не перезаписать id
              return !['deal_id', 'dealid', 'deal id', 'deal_id', 'deal id'].includes(lowerKey);
            })
          )
        };
          previousDeal = null;
      } else {
        // Если нет stage_id или данных недостаточно, получаем полные данные через API

        try {
          const dealResult = await invoiceProcessing.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            logger.error(`❌ Ошибка получения данных сделки | Deal: ${dealId}`);
            return res.status(400).json({ 
              success: false, 
              error: `Failed to fetch deal: ${dealResult.error || 'unknown'}` 
            });
          }
          currentDeal = dealResult.deal;
          previousDeal = null;
        } catch (error) {
          logger.error(`❌ Ошибка получения данных сделки | Deal: ${dealId}`);
          return res.status(500).json({ 
            success: false, 
            error: `Error fetching deal: ${error.message}` 
          });
        }
      }
    } else {
      // Стандартный формат Pipedrive webhook
      // Проверяем тип события
      const eventType = webhookData.event || '';
      
      // Обработка удаления сделки (deleted.deal)
      if (eventType.includes('deleted') && eventType.includes('deal')) {
        // При удалении сделки в webhook приходит previous с данными удаленной сделки
        const deletedDeal = webhookData.previous || webhookData.data?.previous;
        dealId = deletedDeal?.id || webhookData.current?.id || webhookData.data?.current?.id;
        
        if (!dealId) {
          logger.warn('Webhook for deleted deal missing deal id', { 
            event: webhookData.event,
            bodyKeys: Object.keys(webhookData)
          });
          return res.status(400).json({ success: false, error: 'Missing deal id in deleted deal webhook' });
        }
        
        logger.info(`🗑️  Сделка удалена, удаляем проформы | Deal: ${dealId}`);
        
        try {
          // Получаем данные сделки перед удалением для поиска проформ
          const dealResult = await invoiceProcessing.pipedriveClient.getDeal(dealId);
          const deal = dealResult.success && dealResult.deal ? dealResult.deal : deletedDeal;
          
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, deal);
          if (result.success) {
            logger.info(`✅ Проформы удалены | Deal: ${dealId}`);
          } else {
            logger.warn(`⚠️  Не удалось удалить проформы | Deal: ${dealId}`);
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Proformas deleted' : result.error,
            dealId
          });
        } catch (error) {
          logger.error(`❌ Ошибка удаления проформ | Deal: ${dealId}`);
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }
      
      // Check if this is a deal update event
      if (!eventType.includes('deal') && !eventType.includes('updated')) {
        logger.info(`ℹ️  Webhook событие не является обновлением сделки, пропускаем | Deal: ${dealId || 'unknown'} | Event type: ${eventType}`);
        return res.status(200).json({ success: true, message: 'Event ignored', eventType });
      }
      
      logger.info(`✅ Webhook событие распознано как обновление сделки | Deal: ${dealId || 'unknown'} | Event type: ${eventType}`);

      currentDeal = webhookData.current || webhookData.data?.current;
      previousDeal = webhookData.previous || webhookData.data?.previous;

      if (!currentDeal || !currentDeal.id) {
        logger.warn('Webhook missing deal data', { 
          event: webhookData.event,
          hasCurrent: !!currentDeal,
          hasPrevious: !!previousDeal
        });
        return res.status(400).json({ success: false, error: 'Missing deal data' });
      }

      dealId = currentDeal.id;
    }
    
    logger.info(`🔍 Deal ID определен | Deal: ${dealId} | isWorkflowAutomation: ${isWorkflowAutomation}`);
    
    const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Get invoice_type values - проверяем сначала webhookData для workflow automation, потом currentDeal
    // Обрабатываем случаи, когда значение может быть объектом с полем .value (формат Pipedrive)
    const extractValue = (val) => {
      if (val === null || val === undefined) return null;
      if (typeof val === 'object' && val !== null && 'value' in val) {
        return val.value;
      }
      return val;
    };
    
    const invoiceTypeFromWebhook1 = extractValue(webhookData?.['Invoice type']);
    const invoiceTypeFromWebhook2 = extractValue(webhookData?.['Invoice']);
    const invoiceTypeFromWebhook3 = extractValue(webhookData?.['invoice_type']);
    const invoiceTypeFromWebhook4 = extractValue(webhookData?.['invoice']);
    const invoiceTypeFromWebhook5 = extractValue(webhookData?.[INVOICE_TYPE_FIELD_KEY]);
    const invoiceFromWebhook = invoiceTypeFromWebhook1 || invoiceTypeFromWebhook2 || invoiceTypeFromWebhook3 || invoiceTypeFromWebhook4 || invoiceTypeFromWebhook5;
    const invoiceFromDeal = currentDeal?.[INVOICE_TYPE_FIELD_KEY];
    const rawInvoiceType = invoiceFromWebhook || invoiceFromDeal || null;
    
    // Детальное логирование всех вариантов для диагностики
    logger.info(`🔍 Детальное извлечение invoice_type | Deal: ${dealId}`, {
      dealId,
      'Invoice type': invoiceTypeFromWebhook1,
      'Invoice': invoiceTypeFromWebhook2,
      'invoice_type': invoiceTypeFromWebhook3,
      'invoice': invoiceTypeFromWebhook4,
      [INVOICE_TYPE_FIELD_KEY]: invoiceTypeFromWebhook5,
      invoiceFromWebhook: invoiceFromWebhook,
      invoiceFromDeal: invoiceFromDeal,
      rawInvoiceType: rawInvoiceType,
      webhookDataKeys: webhookData ? Object.keys(webhookData).filter(k => k.toLowerCase().includes('invoice')) : [],
      // Дополнительно: все значения полей с "Invoice" в названии
      invoiceFieldValues: webhookData ? Object.keys(webhookData)
        .filter(k => k.toLowerCase().includes('invoice'))
        .reduce((acc, key) => {
          const value = webhookData[key];
          acc[key] = {
            value: value,
            type: typeof value,
            stringified: value !== null && value !== undefined ? String(value) : 'null/undefined'
          };
          return acc;
        }, {}) : {}
    });
    
    // Нормализуем invoice_type к ID (основной метод)
    const currentInvoiceType = normalizeInvoiceTypeToId(rawInvoiceType);
    
    // Логируем извлечение invoice_type для диагностики - INFO уровень для production
    logger.info(`🔍 Извлечение invoice_type | Deal: ${dealId} | Сырое значение: ${rawInvoiceType || 'null'} | Нормализовано к ID: ${currentInvoiceType || 'null'} | Из webhook: ${invoiceFromWebhook || 'null'} | Из deal API: ${invoiceFromDeal || 'null'}`);
    
    // Get status - проверяем сначала webhookData для workflow automation, потом currentDeal
    const currentStatus = (webhookData && (webhookData['Deal status'] || webhookData['Deal_status'] || webhookData['deal_status'] || webhookData['status'])) ||
                         currentDeal?.status ||
                         'open';
    
    logger.debug(`🔍 Извлечение статуса | Deal: ${dealId} | Status: ${currentStatus}`);
    
    // Get stage - проверяем сначала webhookData для workflow automation, потом currentDeal
    const currentStageId = (webhookData && (webhookData['Deal_stage_id'] || webhookData['Deal stage id'] || webhookData['deal_stage_id'] || webhookData['stage_id'])) ||
                          currentDeal?.stage_id ||
                          null;
    // Проверяем все возможные варианты названия стадии из webhook'а и из currentDeal
    // Сначала проверяем webhookData (оригинальные данные), потом currentDeal
    const currentStageName = (webhookData && (webhookData['Deal stage'] || webhookData['Deal_stage'] || webhookData['deal_stage'])) ||
                            currentDeal?.stage_name || 
                            currentDeal?.['Deal stage'] || 
                            currentDeal?.['Deal_stage'] ||
                            currentDeal?.['deal_stage'];
    
    // Get lost_reason
    const lostReason = currentDeal?.lost_reason || currentDeal?.lostReason || currentDeal?.['lost_reason'] || null;

    try {
      await syncCashExpectationFromDeal({
        dealId,
        currentDeal,
        previousDeal
      });
    } catch (cashSyncError) {
      logger.warn('Failed to sync cash expectation from deal', {
        dealId,
        error: cashSyncError.message
      });
    }

    // ========== Обработка 1: Статус "lost" (приоритет) ==========
    // Проверяем статус lost ПЕРЕД обработкой invoice_type, так как это более критично
    if (currentStatus === 'lost') {
      const normalizedLostReason = lostReason ? String(lostReason).trim().toLowerCase() : '';
      const isRefundReason = normalizedLostReason === 'refund' || normalizedLostReason === 'refound';
      
      logger.info(`❌ Сделка закрыта как потерянная | Deal: ${dealId} | Рефанд: ${isRefundReason ? 'да' : 'нет'}`);

      if (isRefundReason) {
        logger.info(`💰 Обработка рефандов | Deal: ${dealId}`);

        const summary = {
          totalDeals: 1,
          refundsCreated: 0,
          errors: []
        };

        try {
          await stripeProcessor.refundDealPayments(dealId, summary);
          
          logger.info(`✅ Рефанды обработаны | Deal: ${dealId}`);

            return res.status(200).json({
              success: true,
            message: 'Refunds processed',
              dealId,
            refundsCreated: summary.refundsCreated,
            errors: summary.errors
          });
        } catch (error) {
          logger.error(`❌ Ошибка обработки рефандов | Deal: ${dealId}`);
            return res.status(200).json({
              success: false,
            error: error.message,
              dealId
            });
          }
        } else {
        const hasStripePayments = await hasStripePaymentsForDeal(dealId);
        if (hasStripePayments || !hasProformaCandidates(currentDeal)) {
          logger.info(`🗑️  Удаление Stripe платежей (без проформ) | Deal: ${dealId}`);
          await refundStripePayments(dealId);
          await cleanupDealArtifacts(dealId);
          return res.status(200).json({
            success: true,
            message: 'Stripe payments deleted',
            dealId
          });
        }

        // Если lost_reason не "Refund" и Stripe-платежей нет, удаляем проформы
        logger.info(`🗑️  Удаление проформ | Deal: ${dealId}`);

        try {
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
          if (result.success) {
            logger.info(`✅ Проформы удалены | Deal: ${dealId}`);
          } else {
            logger.warn(`⚠️  Не удалось удалить проформы | Deal: ${dealId}`);
          }
          await cleanupDealArtifacts(dealId);
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Proformas deleted' : result.error,
            dealId
          });
        } catch (error) {
          logger.error(`❌ Ошибка удаления проформ | Deal: ${dealId}`);
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }
    }

    // ========== Обработка 2: invoice_type = "Delete" (приоритет перед стадией) ==========
    // Проверяем удаление ПЕРЕД обработкой стадии, чтобы удаление имело приоритет
    // Используем только ID "74" для удаления
    if (currentInvoiceType === '74') {
      const hasStripePayments = await hasStripePaymentsForDeal(dealId);
      if (hasStripePayments || !hasProformaCandidates(currentDeal)) {
        logger.info(`🗑️  Удаление Stripe платежей (invoice_type=Delete) | Deal: ${dealId}`);
        await refundStripePayments(dealId);
        await cleanupDealArtifacts(dealId);
        return res.status(200).json({
          success: true,
          message: 'Stripe payments deleted',
          dealId
        });
      }

      logger.info(`🗑️  Удаление проформ | Deal: ${dealId}`);

      try {
        const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
        if (result.success) {
          logger.info(`✅ Проформы удалены | Deal: ${dealId}`);
        } else {
          logger.warn(`⚠️  Не удалось удалить проформы | Deal: ${dealId}`);
        }
        await cleanupDealArtifacts(dealId);
        return res.status(200).json({
          success: result.success,
          message: result.success ? 'Deletion processed' : result.error,
          dealId
        });
      } catch (error) {
        logger.error(`❌ Ошибка удаления проформ | Deal: ${dealId}`);
        return res.status(200).json({
          success: false,
          error: error.message,
          dealId
        });
      }
    }

    // ========== Обработка 3: Стадия "First payment" (ID: 18) (триггер для Stripe) ==========
    // ВРЕМЕННО ОТКЛЮЧЕНО: создание Stripe Checkout Sessions через стадию "First payment"
    // Используется только триггер через invoice_type = "Stripe" (75)
    // const isFirstPaymentStage = String(currentStageId) === String(STAGES.FIRST_PAYMENT_ID);
    // 
    // if (isFirstPaymentStage && currentStatus !== 'lost') {
    //   // Логика создания Checkout Sessions отключена
    // }

    // ========== Обработка 3: invoice_type ==========
    // Упрощенная логика: обрабатываем invoice_type всегда, когда он установлен
    // Используем только ID (основной метод)
    logger.info(`🔍 Проверка invoice_type | Deal: ${dealId} | currentInvoiceType (ID): ${currentInvoiceType || 'null'}`);
    
    if (!currentInvoiceType) {
      logger.info(`⚠️  invoice_type не найден | Deal: ${dealId} | Проверяем webhook и API, но значение отсутствует`);
    } else {
      // Stripe trigger - используем только ID "75" (основной метод)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      
      logger.info(`🔍 Сравнение invoice_type | Deal: ${dealId} | currentInvoiceType (ID): "${currentInvoiceType}" | STRIPE_TRIGGER_VALUE: "${STRIPE_TRIGGER_VALUE}" | Совпадает: ${currentInvoiceType === STRIPE_TRIGGER_VALUE}`);
      
      if (currentInvoiceType === STRIPE_TRIGGER_VALUE) {
          logger.info(`✅ Webhook сработал: invoice_type = Stripe (75) | Deal: ${dealId}`);
          
          // Проверяем блокировку обработки для этой сделки
          const lockTimestamp = stripeProcessingLocks.get(dealId);
          const now = Date.now();
          
          if (lockTimestamp && (now - lockTimestamp) < STRIPE_LOCK_TTL_MS) {
            logger.info(`⏸️  Обработка Stripe платежей уже выполняется для этой сделки, пропускаем | Deal: ${dealId} | Блокировка до: ${new Date(lockTimestamp + STRIPE_LOCK_TTL_MS).toISOString()}`);
            return res.status(200).json({
              success: true,
              message: 'Stripe processing already in progress for this deal',
              dealId
            });
          }
          
          // Устанавливаем блокировку
          stripeProcessingLocks.set(dealId, now);
          
          // Очищаем устаревшие блокировки
          for (const [lockedDealId, timestamp] of stripeProcessingLocks.entries()) {
            if (now - timestamp > STRIPE_LOCK_TTL_MS) {
              stripeProcessingLocks.delete(lockedDealId);
            }
          }
          
          logger.info(`💳 Начало обработки Stripe платежей | Deal: ${dealId}`);

          try {
            // Получаем полные данные сделки для определения графика платежей
          const dealResult = await stripeProcessor.pipedriveClient.getDealWithRelatedData(dealId);
          if (!dealResult.success || !dealResult.deal) {
            throw new Error(`Failed to fetch deal: ${dealResult.error || 'unknown'}`);
          }

          const deal = dealResult.deal;
          // Мержим данные из webhook в deal из API (чтобы сохранить все поля из webhook)
          // ВАЖНО: Приоритет отдаем данным из API, так как они более полные и актуальные
          // Webhook данные используются только для полей, которых нет в API
          const dealWithWebhookData = currentDeal ? { 
            ...deal, 
            ...Object.fromEntries(
              Object.entries(currentDeal).filter(([key, value]) => 
                value !== null && value !== undefined && value !== ''
              )
            )
          } : deal;

          // Рассчитываем график платежей на основе expected_close_date
          // ВАЖНО: Приоритет отдаем expected_close_date из API (deal), так как это основное поле
          // Проверяем все возможные варианты названий полей
          const closeDate = deal.expected_close_date ||  // Приоритет 1: API deal
                           deal['expected_close_date'] ||  // Приоритет 2: API deal (bracket)
                           deal.close_date ||  // Приоритет 3: API deal close_date
                           deal['close_date'] ||  // Приоритет 4: API deal close_date (bracket)
                           dealWithWebhookData.expected_close_date ||  // Приоритет 5: Merged data
                           dealWithWebhookData['expected_close_date'] ||
                           dealWithWebhookData.close_date ||
                           dealWithWebhookData['close_date'] ||
                           webhookData?.['Expected close date'] ||  // Приоритет 6: Webhook
                           webhookData?.['Deal_close_date'] ||
                           webhookData?.['expected_close_date'] ||
                           webhookData?.['close_date'] ||
                           null;
          
          // Детальное логирование всех возможных полей с датами
          const dealDateFields = Object.keys(deal).filter(k => 
            k.toLowerCase().includes('close') || 
            k.toLowerCase().includes('date') ||
            k.toLowerCase().includes('expected')
          ).reduce((acc, key) => {
            acc[key] = deal[key];
            return acc;
          }, {});
          
          logger.info(`📅 Расчет графика платежей | Deal: ${dealId}`, {
            dealId,
            closeDate: closeDate || 'не указана',
            fromDeal: deal.expected_close_date || deal.close_date || deal['expected_close_date'] || deal['close_date'] || 'нет',
            fromCurrentDeal: currentDeal?.expected_close_date || currentDeal?.close_date || currentDeal?.['expected_close_date'] || currentDeal?.['close_date'] || 'нет',
            fromWebhook: webhookData?.['Deal_close_date'] || webhookData?.['Expected close date'] || webhookData?.['expected_close_date'] || webhookData?.['close_date'] || 'нет',
            allDealDateFields: dealDateFields,
            dealKeysWithDate: Object.keys(deal).filter(k => k.toLowerCase().includes('close') || k.toLowerCase().includes('date')).join(', ')
          });
          
          // Определяем график платежей используя PaymentScheduleService (Phase 0: Code Review Fixes)
          const schedule = PaymentScheduleService.determineSchedule(closeDate, new Date(), { dealId });
          const paymentSchedule = schedule.schedule;
          
          logger.info(`📅 Расчет количества платежей | Deal: ${dealId} | График: ${paymentSchedule} | Дней до закрытия: ${schedule.daysDiff || 'N/A'}`);
          
          logger.info(`📅 Итоговый график платежей | Deal: ${dealId} | График: ${paymentSchedule}`);

          // Проверяем, какие сессии уже существуют
          logger.debug(`🔍 Проверка существующих Stripe сессий | Deal: ${dealId} | Ожидаемый график: ${paymentSchedule}`);
          const existingPayments = await stripeProcessor.repository.listPayments({
            dealId: String(dealId),
            limit: 10
          });

          // Проверяем существующие платежи с учетом статуса оплаты
          const existingPaymentTypes = existingPayments ? existingPayments.map(p => p.payment_type).filter(Boolean) : [];
          
          // Проверяем статус оплаты для каждого типа платежа
          const getPaymentByType = (type) => existingPayments?.find(p => p.payment_type === type);
          
          // Проверяем статус сессии в Stripe API (не только в базе данных)
          // Сессия может быть истекшей, отмененной или неактивной
          const checkSessionStatus = async (payment) => {
            if (!payment || !payment.session_id) return { exists: false, paid: false, active: false };
            
            try {
              // Получаем актуальный статус сессии из Stripe
              const session = await stripeProcessor.stripe.checkout.sessions.retrieve(payment.session_id);
              
              const isPaid = session.payment_status === 'paid';
              const isActive = session.status === 'open' || session.status === 'complete';
              const isExpired = session.status === 'expired';
              const isCanceled = session.status === 'canceled';
              
              return {
                exists: true,
                paid: isPaid,
                active: isActive && !isExpired && !isCanceled,
                expired: isExpired,
                canceled: isCanceled,
                paymentStatus: session.payment_status,
                sessionStatus: session.status,
                sessionId: session.id
              };
            } catch (error) {
              // Если сессия не найдена в Stripe, считаем что её нет
              logger.warn(`⚠️  Сессия не найдена в Stripe | Deal: ${dealId} | Session ID: ${payment.session_id}`, {
            dealId,
                sessionId: payment.session_id,
                error: error.message
              });
              return { exists: false, paid: false, active: false, error: error.message };
            }
          };

          const depositPayment = getPaymentByType('deposit');
          const restPayment = getPaymentByType('rest');
          const singlePayment = getPaymentByType('single');

          const hasDeposit = !!depositPayment;
          const hasRest = !!restPayment;
          const hasSingle = !!singlePayment;
          
          // Проверяем статус каждой сессии в Stripe API
          const depositStatus = depositPayment ? await checkSessionStatus(depositPayment) : { exists: false, paid: false, active: false };
          const restStatus = restPayment ? await checkSessionStatus(restPayment) : { exists: false, paid: false, active: false };
          const singleStatus = singlePayment ? await checkSessionStatus(singlePayment) : { exists: false, paid: false, active: false };
          
          const depositPaid = depositStatus.paid;
          const restPaid = restStatus.paid;
          const singlePaid = singleStatus.paid;
          
          const depositActive = depositStatus.active;
          const restActive = restStatus.active;
          const singleActive = singleStatus.active;

          logger.debug(`🔍 Проверка статуса сессий в Stripe API | Deal: ${dealId}`, {
            dealId,
            paymentSchedule,
            deposit: {
              exists: hasDeposit,
              paid: depositPaid,
              active: depositActive,
              expired: depositStatus.expired,
              canceled: depositStatus.canceled,
              paymentStatus: depositStatus.paymentStatus,
              sessionStatus: depositStatus.sessionStatus
            },
            rest: {
              exists: hasRest,
              paid: restPaid,
              active: restActive,
              expired: restStatus.expired,
              canceled: restStatus.canceled,
              paymentStatus: restStatus.paymentStatus,
              sessionStatus: restStatus.sessionStatus
            },
            single: {
              exists: hasSingle,
              paid: singlePaid,
              active: singleActive,
              expired: singleStatus.expired,
              canceled: singleStatus.canceled,
              paymentStatus: singleStatus.paymentStatus,
              sessionStatus: singleStatus.sessionStatus
            },
            note: 'Проверяем актуальный статус в Stripe API, а не только в базе данных'
          });

          // Проверяем, все ли необходимые сессии созданы И оплачены
          let needToCreate = false;
          let missingSessions = [];

          if (paymentSchedule === '50/50') {
            // Для графика 50/50 нужны оба платежа: deposit и rest
            // Если deposit не существует ИЛИ не оплачен ИЛИ не активен → нужно создать
            if (!hasDeposit || !depositPaid || !depositActive) {
              needToCreate = true;
              if (!hasDeposit) {
                missingSessions.push('deposit');
              } else if (!depositPaid) {
                missingSessions.push('deposit (не оплачен)');
              } else if (!depositActive) {
                missingSessions.push(`deposit (${depositStatus.expired ? 'истек' : depositStatus.canceled ? 'отменен' : 'неактивен'})`);
              }
            }
            // Если rest не существует ИЛИ не оплачен ИЛИ не активен → нужно создать
            if (!hasRest || !restPaid || !restActive) {
              needToCreate = true;
              if (!hasRest) {
                missingSessions.push('rest');
              } else if (!restPaid) {
                missingSessions.push('rest (не оплачен)');
              } else if (!restActive) {
                missingSessions.push(`rest (${restStatus.expired ? 'истек' : restStatus.canceled ? 'отменен' : 'неактивен'})`);
              }
            }
          } else {
            // Для графика 100% нужен один платеж: single
            // Если single не существует ИЛИ не оплачен ИЛИ не активен → нужно создать
            if (!hasSingle || !singlePaid || !singleActive) {
              needToCreate = true;
              if (!hasSingle) {
                missingSessions.push('single');
              } else if (!singlePaid) {
                missingSessions.push('single (не оплачен)');
              } else if (!singleActive) {
                missingSessions.push(`single (${singleStatus.expired ? 'истек' : singleStatus.canceled ? 'отменен' : 'неактивен'})`);
              }
            }
          }

          // Получаем сумму сделки (используется как при создании платежей, так и при повторной отправке уведомлений)
          const dealProductsResult = await stripeProcessor.pipedriveClient.getDealProducts(dealId);
          let totalAmount = parseFloat(dealWithWebhookData.value) || 0;
          
          if (dealProductsResult.success && dealProductsResult.products && dealProductsResult.products.length > 0) {
            const firstProduct = dealProductsResult.products[0];
            const sumPrice = typeof firstProduct.sum === 'number' 
              ? firstProduct.sum 
              : parseFloat(firstProduct.sum) || 0;
            if (sumPrice > 0) {
              totalAmount = sumPrice;
            }
          }

          // Нормализуем валюту: преобразуем полные названия (например, "Polish Zloty") в ISO коды (например, "PLN")
          const rawCurrency = dealWithWebhookData.currency || 'PLN';
          const currency = normaliseCurrency(rawCurrency);
          
          if (rawCurrency !== currency) {
            logger.debug(`💰 Валюта нормализована | Deal: ${dealId} | Было: ${rawCurrency} | Стало: ${currency}`);
          }

          if (!needToCreate && existingPayments && existingPayments.length > 0) {
            logger.info(`✅ Все необходимые Stripe сессии уже существуют И оплачены | Deal: ${dealId} | График: ${paymentSchedule} | Количество: ${existingPayments.length}`, {
            dealId,
              paymentSchedule,
              existingCount: existingPayments.length,
              sessionIds: existingPayments.map(p => p.session_id).slice(0, 5),
              paymentTypes: existingPaymentTypes,
              paymentStatuses: existingPayments.map(p => ({
                type: p.payment_type,
                status: p.payment_status || p.status
              })),
              note: 'Все платежи созданы и оплачены, отправляем уведомление'
          });

            // Собираем существующие сессии для уведомления
            // ВАЖНО: Проверяем URL в следующем порядке:
            // 1. checkout_url в БД (новое поле)
            // 2. raw_payload.url (старое место, где мог сохраняться URL)
            // 3. Stripe API (если нет в БД)
            const existingSessions = [];
            for (const p of existingPayments) {
              if (!p.session_id) continue;
              
              let sessionUrl = p.checkout_url || null;
              
              // Если нет в checkout_url, проверяем raw_payload (старое место)
              if (!sessionUrl && p.raw_payload && p.raw_payload.url) {
                sessionUrl = p.raw_payload.url;
                logger.debug(`✅ URL найден в raw_payload | Deal: ${dealId} | Session ID: ${p.session_id}`);
              }
              
              // Если URL все еще нет, получаем из Stripe API
              if (!sessionUrl) {
                try {
                  const session = await stripeProcessor.stripe.checkout.sessions.retrieve(p.session_id);
                  if (session && session.url) {
                    sessionUrl = session.url;
                    // Сохраняем URL в БД для будущих использований
                    try {
                      await stripeProcessor.repository.savePayment({
                        session_id: p.session_id,
                        checkout_url: sessionUrl
                      });
                      logger.debug(`✅ URL сохранен в checkout_url | Deal: ${dealId} | Session ID: ${p.session_id}`);
                    } catch (saveError) {
                      logger.warn(`⚠️  Не удалось сохранить checkout_url в БД | Deal: ${dealId} | Session ID: ${p.session_id}`, {
                        error: saveError.message
                      });
                    }
                  }
                } catch (error) {
                  logger.warn(`⚠️  Не удалось получить URL сессии из Stripe | Deal: ${dealId} | Session ID: ${p.session_id} | Ошибка: ${error.message}`);
                }
              }
              
              if (sessionUrl) {
                existingSessions.push({
                  id: p.session_id,
                  url: sessionUrl,
                  type: p.payment_type,
                  amount: p.original_amount
                });
              } else {
                logger.warn(`⚠️  Сессия не имеет URL (ни в checkout_url, ни в raw_payload, ни в Stripe) | Deal: ${dealId} | Session ID: ${p.session_id}`);
              }
            }

            // Отправляем уведомление для существующих сессий только если есть сессии с валидными URL
            if (existingSessions.length === 0) {
              logger.warn(`⚠️  Не удалось получить URL для существующих сессий, уведомление не отправлено | Deal: ${dealId} | Всего сессий: ${existingPayments.length}`);
            } else {
              logger.info(`📧 Отправка уведомления для существующих сессий | Deal: ${dealId} | График: ${paymentSchedule} | Сессий с URL: ${existingSessions.length} из ${existingPayments.length}`);
              const notificationResult = await stripeProcessor.sendPaymentNotificationForDeal(dealId, {
                paymentSchedule,
                sessions: existingSessions,
                currency,
                totalAmount
              });

              logger.info(`📧 Результат отправки уведомления для существующих сессий | Deal: ${dealId} | Успех: ${notificationResult.success} | Ошибка: ${notificationResult.error || 'нет'}`);
            }

          return res.status(200).json({
              success: true,
              message: 'All required Stripe Checkout Sessions already exist and are paid',
              dealId,
              paymentSchedule,
              existingCount: existingPayments.length,
              sessionIds: existingPayments.map(p => p.session_id).slice(0, 5),
              notificationSent: notificationResult.success,
              allPaid: true
            });
          }

          if (needToCreate) {
            logger.info(`⚠️  Не все сессии созданы, создаем недостающие | Deal: ${dealId} | График: ${paymentSchedule} | Недостающие: ${missingSessions.join(', ')}`, {
              dealId,
              paymentSchedule,
              existingPaymentTypes,
              missingSessions,
              note: 'Создаем недостающие платежи'
            });
          } else {
            logger.info(`✅ Существующих сессий не найдено, создаем все | Deal: ${dealId} | График: ${paymentSchedule}`);
          }

          // Создаем только недостающие Stripe Checkout Sessions
          logger.info(`💳 Создание недостающих Stripe Checkout Sessions | Deal: ${dealId} | График: ${paymentSchedule} | Сумма: ${totalAmount} ${currency} | Недостающие: ${missingSessions.join(', ') || 'все'}`);
          const sessions = [];
          const runId = `webhook-${Date.now()}`;

          if (paymentSchedule === '50/50') {
            // Создаем недостающие платежи для графика 50/50
            // Дополнительная проверка: если есть активный (не оплаченный и не истекший) deposit, не создаем новый
            if (!hasDeposit) {
              // Перед созданием проверяем еще раз, не появился ли платеж (защита от race condition)
              const doubleCheckPayments = await stripeProcessor.repository.listPayments({
                dealId: String(dealId),
                paymentType: 'deposit'
              });
              const hasActiveDeposit = doubleCheckPayments?.some(p => 
                p.payment_status !== 'paid' && 
                p.payment_status !== 'refunded' &&
                p.status !== 'expired' &&
                p.status !== 'canceled'
              );
              
              if (hasActiveDeposit) {
                logger.warn(`⚠️  Обнаружен активный deposit при повторной проверке, пропускаем создание | Deal: ${dealId}`, {
                  dealId,
                  activePayments: doubleCheckPayments.filter(p => 
                    p.payment_status !== 'paid' && 
                    p.payment_status !== 'refunded' &&
                    p.status !== 'expired' &&
                    p.status !== 'canceled'
                  ).map(p => ({
                    sessionId: p.session_id,
                    paymentStatus: p.payment_status,
                    status: p.status
                  }))
                });
              } else {
                const depositAmount = totalAmount / 2;
                logger.info(`💳 Создание первого платежа (предоплата 50%) | Deal: ${dealId} | Сумма: ${depositAmount} ${currency}`);
                const depositResult = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                  trigger: 'pipedrive_webhook',
                  runId,
                  paymentType: 'deposit',
                  paymentSchedule: '50/50',
                  paymentIndex: 1
                });

              if (depositResult.success && depositResult.sessionId) {
                const depositSessionAmount =
                  typeof depositResult.amount === 'number'
                    ? depositResult.amount
                    : parseFloat(depositResult.amount) || depositAmount;
                sessions.push({
                  id: depositResult.sessionId,
                  url: depositResult.sessionUrl,
                  type: 'deposit',
                  amount: depositSessionAmount
                });
                logger.info(`✅ Первый платеж создан | Deal: ${dealId} | Session ID: ${depositResult.sessionId} | URL: ${depositResult.sessionUrl || 'нет'}`);
              } else {
                logger.error(`❌ Ошибка создания первого платежа | Deal: ${dealId} | Ошибка: ${depositResult.error || 'unknown'}`);
                throw new Error(`Failed to create deposit session: ${depositResult.error || 'unknown'}`);
              }
              }
            } else {
              if (depositPaid) {
                logger.info(`✅ Первый платеж уже существует И оплачен, пропускаем | Deal: ${dealId}`);
              } else {
                logger.info(`⚠️  Первый платеж существует, но не оплачен, создаем новый | Deal: ${dealId}`);
              }
            }

            // ВАЖНО: Второй платеж (rest) для графика 50/50 НЕ создается сразу в webhook
            // Он создается автоматически через крон (secondPaymentSchedulerService) когда:
            // 1. Первый платеж оплачен
            // 2. Дата второго платежа наступила (за 1 месяц до начала лагеря)
            // Это предотвращает создание сессий заранее и дублирование
            
            // Проверяем, нужно ли создавать второй платеж сейчас (Phase 0: Code Review Fixes)
            const schedule = PaymentScheduleService.determineScheduleFromDeal(dealWithWebhookData);
            const secondPaymentDate = schedule.secondPaymentDate;
            let shouldCreateSecondPayment = false;
            
            if (secondPaymentDate) {
              // Создаем второй платеж только если:
              // 1. Первый платеж оплачен (depositPaid)
              // 2. Дата второго платежа наступила
              shouldCreateSecondPayment = depositPaid && PaymentScheduleService.isSecondPaymentDateReached(secondPaymentDate);
              
              if (!depositPaid) {
                logger.info(`⏸️  Второй платеж не создается: первый платеж еще не оплачен | Deal: ${dealId}`);
              } else if (!shouldCreateSecondPayment) {
                logger.info(`⏸️  Второй платеж не создается: дата еще не наступила | Deal: ${dealId} | Дата: ${secondPaymentDate.toISOString().split('T')[0]}`);
                logger.info(`💡 Второй платеж будет создан автоматически через крон, когда дата наступит`);
              }
            }
            
            if (shouldCreateSecondPayment && (!hasRest || !restPaid)) {
              // Дополнительная проверка: если есть активный rest, не создаем новый
              const doubleCheckRestPayments = await stripeProcessor.repository.listPayments({
                dealId: String(dealId),
                paymentType: 'rest'
              });
              const hasActiveRest = doubleCheckRestPayments?.some(p => 
                p.payment_status !== 'paid' && 
                p.payment_status !== 'refunded' &&
                p.status !== 'expired' &&
                p.status !== 'canceled'
              );
              
              if (hasActiveRest) {
                logger.warn(`⚠️  Обнаружен активный rest при повторной проверке, пропускаем создание | Deal: ${dealId}`, {
                  dealId,
                  activePayments: doubleCheckRestPayments.filter(p => 
                    p.payment_status !== 'paid' && 
                    p.payment_status !== 'refunded' &&
                    p.status !== 'expired' &&
                    p.status !== 'canceled'
                  ).map(p => ({
                    sessionId: p.session_id,
                    paymentStatus: p.payment_status,
                    status: p.status
                  }))
                });
              } else {
                const restAmount = totalAmount / 2;
                logger.info(`💳 Создание второго платежа (остаток 50%) | Deal: ${dealId} | Сумма: ${restAmount} ${currency} | Дата наступила: ${secondPaymentDate?.toISOString().split('T')[0]}`);
                const restResult = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                  trigger: 'pipedrive_webhook',
                  runId,
                  paymentType: 'rest',
                  paymentSchedule: '50/50',
                  paymentIndex: 2
                });

                if (restResult.success && restResult.sessionId) {
                  const restSessionAmount =
                    typeof restResult.amount === 'number'
                      ? restResult.amount
                      : parseFloat(restResult.amount) || restAmount;
                  sessions.push({
                    id: restResult.sessionId,
                    url: restResult.sessionUrl,
                    type: 'rest',
                    amount: restSessionAmount
                  });
                  logger.info(`✅ Второй платеж создан | Deal: ${dealId} | Session ID: ${restResult.sessionId} | URL: ${restResult.sessionUrl || 'нет'}`);
                } else {
                  logger.error(`❌ Ошибка создания второго платежа | Deal: ${dealId} | Ошибка: ${restResult.error || 'unknown'}`);
                  throw new Error(`Failed to create rest session: ${restResult.error || 'unknown'}`);
                }
              }
            } else {
              if (restPaid) {
                logger.info(`✅ Второй платеж уже существует И оплачен, пропускаем | Deal: ${dealId}`);
              } else if (hasRest) {
                logger.info(`⚠️  Второй платеж существует, но не оплачен | Deal: ${dealId}`);
              } else if (!shouldCreateSecondPayment) {
                logger.info(`⏸️  Второй платеж не создается в webhook (будет создан через крон при наступлении даты) | Deal: ${dealId}`);
              }
            }
          } else {
            // Создаем один платеж на всю сумму (если его нет ИЛИ не оплачен)
            if (!hasSingle || !singlePaid) {
              // Дополнительная проверка: если есть активный single, не создаем новый
              const doubleCheckSinglePayments = await stripeProcessor.repository.listPayments({
                dealId: String(dealId),
                paymentType: 'single'
              });
              const hasActiveSingle = doubleCheckSinglePayments?.some(p => 
                p.payment_status !== 'paid' && 
                p.payment_status !== 'refunded' &&
                p.status !== 'expired' &&
                p.status !== 'canceled'
              );
              
              if (hasActiveSingle) {
                logger.warn(`⚠️  Обнаружен активный single при повторной проверке, пропускаем создание | Deal: ${dealId}`, {
                  dealId,
                  activePayments: doubleCheckSinglePayments.filter(p => 
                    p.payment_status !== 'paid' && 
                    p.payment_status !== 'refunded' &&
                    p.status !== 'expired' &&
                    p.status !== 'canceled'
                  ).map(p => ({
                    sessionId: p.session_id,
                    paymentStatus: p.payment_status,
                    status: p.status
                  }))
                });
              } else {
                logger.info(`💳 Создание единого платежа (100%) | Deal: ${dealId} | Сумма: ${totalAmount} ${currency}`);
                const result = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                  trigger: 'pipedrive_webhook',
                  runId,
                  paymentType: 'single',
                  paymentSchedule: '100%'
                });

                if (result.success && result.sessionId) {
                  const singleSessionAmount =
                    typeof result.amount === 'number'
                      ? result.amount
                      : parseFloat(result.amount) || totalAmount;
                  sessions.push({
                    id: result.sessionId,
                    url: result.sessionUrl,
                    type: 'single',
                    amount: singleSessionAmount
                  });
                  logger.info(`✅ Платеж создан | Deal: ${dealId} | Session ID: ${result.sessionId} | URL: ${result.sessionUrl || 'нет'}`);
                } else {
                  logger.error(`❌ Ошибка создания платежа | Deal: ${dealId} | Ошибка: ${result.error || 'unknown'}`);
                  throw new Error(`Failed to create checkout session: ${result.error || 'unknown'}`);
                }
              }
            } else {
              if (singlePaid) {
                logger.info(`✅ Платеж уже существует И оплачен, пропускаем | Deal: ${dealId}`);
              } else {
                logger.info(`⚠️  Платеж существует, но не оплачен, создаем новый | Deal: ${dealId}`);
              }
            }
          }
          
          if (sessions.length > 0) {
            logger.info(`✅ Создано новых Stripe сессий | Deal: ${dealId} | Количество: ${sessions.length} | График: ${paymentSchedule}`);
          } else {
            logger.info(`ℹ️  Новые сессии не созданы (все уже существуют) | Deal: ${dealId} | График: ${paymentSchedule}`);
          }

          if (sessions.length > 0) {
            const marker = formatStripeInvoiceMarker(sessions[0]?.id);
            if (marker) {
              await updateInvoiceNumberField(dealId, marker);
            }
          }

          // Отправляем уведомление в SendPulse с графиком платежей и ссылками на сессии
          logger.info(`📧 Отправка уведомления в SendPulse | Deal: ${dealId} | График: ${paymentSchedule} | Сессий: ${sessions.length}`);
          const notificationResult = await stripeProcessor.sendPaymentNotificationForDeal(dealId, {
            paymentSchedule,
            sessions: sessions.map(s => ({ 
              id: s.id, 
              url: s.url, 
              type: s.type, 
              amount: s.amount 
            })),
            currency,
            totalAmount
          });

          logger.info(`📧 Результат отправки уведомления | Deal: ${dealId} | Успех: ${notificationResult.success} | Ошибка: ${notificationResult.error || 'нет'}`);

          if (notificationResult.success) {
            logger.info(`✅ Stripe платежи созданы и уведомление отправлено | Deal: ${dealId} | График: ${paymentSchedule} | Сессий: ${sessions.length}`);
          } else {
            // Уведомление не критично: логируем предупреждение, но не считаем это ошибкой платёжного флоу
            logger.warn(`⚠️  Не удалось отправить уведомление в SendPulse | Deal: ${dealId} | Ошибка: ${notificationResult.error}`);
          }

          // Создаем заметку в сделке с графиком платежей и ссылками для мониторинга (даже если уведомление не ушло)
          try {
            const formatAmount = (amount) => parseFloat(amount).toFixed(2);
            const stripeMode = process.env.STRIPE_MODE || 'test';
            const stripeBaseUrl = stripeMode === 'live' 
              ? 'https://dashboard.stripe.com' 
              : 'https://dashboard.stripe.com/test';
            
            let noteContent = `💳 *График платежей: ${paymentSchedule}*\n\n`;
            
            if (paymentSchedule === '50/50' && sessions.length === 1) {
              // Только первый платеж (deposit) создан
              const firstSession = sessions[0];
              noteContent += `1️⃣ *Предоплата 50%:* ${formatAmount(firstSession.amount)} ${currency}\n`;
              noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${firstSession.id})\n\n`;
              noteContent += `2️⃣ *Остаток 50%:* будет создан позже\n\n`;
            } else if (paymentSchedule === '50/50' && sessions.length >= 2) {
              // Оба платежа созданы
              const depositSession = sessions.find(s => s.type === 'deposit');
              const restSession = sessions.find(s => s.type === 'rest');
              
              if (depositSession) {
                noteContent += `1️⃣ *Предоплата 50%:* ${formatAmount(depositSession.amount)} ${currency}\n`;
                noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${depositSession.id})\n\n`;
              }
              
              if (restSession) {
                noteContent += `2️⃣ *Остаток 50%:* ${formatAmount(restSession.amount)} ${currency}\n`;
                noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${restSession.id})\n\n`;
              }
            } else if (paymentSchedule === '100%' && sessions.length >= 1) {
              const singleSession = sessions[0];
              noteContent += `💳 *Полная оплата:* ${formatAmount(singleSession.amount)} ${currency}\n`;
              noteContent += `   [Мониторинг статуса](${stripeBaseUrl}/checkout_sessions/${singleSession.id})\n\n`;
            }
            
            noteContent += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n\n`;
            const searchLink = buildStripeSearchUrl(String(dealId));
            noteContent += `📊 [Мониторинг всех платежей по сделке](${searchLink})\n`;
            
            await stripeProcessor.pipedriveClient.addNoteToDeal(dealId, noteContent);
            logger.info(`✅ Заметка с графиком платежей добавлена в сделку | Deal: ${dealId}`);
          } catch (noteError) {
            logger.warn(`⚠️  Не удалось добавить заметку в сделку | Deal: ${dealId}`, { error: noteError.message });
          }
          
          // Сбрасываем invoice_type на пустое значение, чтобы избежать повторного срабатывания webhook'а
          try {
            const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
            logger.info(`🔄 Сброс invoice_type | Deal: ${dealId} | Было: Stripe (75) | Будет: null`);
            await stripeProcessor.pipedriveClient.updateDeal(dealId, {
              [INVOICE_TYPE_FIELD_KEY]: null
            });
            logger.info(`✅ invoice_type убран: Stripe (75) → null | Deal: ${dealId}`);
          } catch (resetError) {
            logger.warn(`⚠️  Не удалось сбросить invoice_type | Deal: ${dealId}`, { error: resetError.message });
          }
          
          // Снимаем блокировку после обработки (даже если уведомление не отправилось)
          stripeProcessingLocks.delete(dealId);

          return res.status(200).json({
            success: true,
            message: notificationResult.success
              ? 'Stripe Checkout Sessions created and notification sent'
              : 'Stripe Checkout Sessions created; notification failed (non-critical)',
            notificationError: notificationResult.success ? null : notificationResult.error,
            dealId,
            paymentSchedule,
            totalAmount,
            currency,
            sessions: sessions.map(s => ({ id: s.id, type: s.type }))
          });
        } catch (error) {
          logger.error(`❌ Ошибка создания Stripe платежей | Deal: ${dealId}`, { error: error.message });
          
          // Сбрасываем invoice_type при исключении, чтобы избежать повторных попыток
          try {
            const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
            logger.info(`🔄 Сброс invoice_type после исключения | Deal: ${dealId} | Было: Stripe (75) | Будет: null`);
            await stripeProcessor.pipedriveClient.updateDeal(dealId, {
              [INVOICE_TYPE_FIELD_KEY]: null
            });
            logger.info(`✅ invoice_type убран: Stripe (75) → null | Deal: ${dealId}`);
          } catch (resetError) {
            logger.warn(`⚠️  Не удалось сбросить invoice_type после исключения | Deal: ${dealId}`, { error: resetError.message });
          }
          
          // Снимаем блокировку после обработки (даже при исключении)
          stripeProcessingLocks.delete(dealId);
          
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }

      // Валидные типы инвойсов (70, 71, 72) - используем только ID
      // Примечание: проверка Delete (74) уже выполнена выше в секции "Обработка 2"
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      const isValidProformaType = VALID_INVOICE_TYPES.includes(currentInvoiceType);
      if (isValidProformaType) {
        logger.info(`📄 Создание проформы | Deal: ${dealId}`);

        try {
          const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId, currentDeal);
          if (result.success) {
            logger.info(`✅ Проформа создана | Deal: ${dealId}`);
      } else {
            logger.warn(`⚠️  Не удалось создать проформу | Deal: ${dealId}`);
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Invoice processed' : result.error,
          dealId,
            invoiceType: result.invoiceType
          });
        } catch (error) {
          logger.error(`❌ Ошибка создания проформы | Deal: ${dealId}`);
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      } else {
        // invoice_type найден, но не соответствует ни одному известному типу
        logger.info(`ℹ️  invoice_type найден, но не обрабатывается | Deal: ${dealId} | invoice_type: "${currentInvoiceType}" | Ожидаемые значения: Stripe (75), Proforma (70-72), Delete (74)`);
      }
    }


    // ========== Обработка 3: Workflow automation - проверка invoice_type при изменении стадии ==========
    // Если webhook пришел от workflow automation (изменение стадии), проверяем invoice_type
    // Используем только ID (основной метод)
    if (isWorkflowAutomation && currentInvoiceType) {
      // Stripe trigger - используем только ID "75" (основной метод)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      if (currentInvoiceType === STRIPE_TRIGGER_VALUE) {
        // Проверка Stripe платежей

        // Проверяем, есть ли уже Checkout Sessions для этой сделки
        try {
          const existingPayments = await stripeProcessor.repository.listPayments({
            dealId: String(dealId),
            limit: 10
          });

          if (!existingPayments || existingPayments.length === 0) {
            // Если нет Checkout Sessions, создаем их
            logger.info(`💳 Создание Stripe платежа | Deal: ${dealId}`);
            const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
            if (dealResult.success && dealResult.deal) {
              // Мержим данные из webhook в deal из API (чтобы сохранить все поля из webhook)
              const dealWithWebhookData = currentDeal ? { ...dealResult.deal, ...currentDeal } : dealResult.deal;
              
              const result = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                trigger: 'pipedrive_workflow_automation',
                runId: `workflow-${Date.now()}`
              });
              
              if (result.success) {
                if (result.sessionId) {
                  const marker = formatStripeInvoiceMarker(result.sessionId);
                  if (marker) {
                    await updateInvoiceNumberField(dealId, marker);
                  }
                }
                return res.status(200).json({
                  success: true,
                  message: 'Checkout Sessions created via workflow automation',
                  dealId,
                  sessionId: result.sessionId
                });
              }
            }
          } else {
            logger.debug('Checkout Sessions already exist, no action needed', {
              dealId,
              existingCount: existingPayments.length
            });
          }
        } catch (error) {
          logger.error(`❌ Ошибка создания Stripe платежа | Deal: ${dealId}`);
        }
      }

      // Валидные типы инвойсов (70, 71, 72) - используем только ID
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      if (VALID_INVOICE_TYPES.includes(currentInvoiceType)) {
        logger.info(`📄 Создание проформы | Deal: ${dealId}`);

        try {
          const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId, currentDeal);
          if (result.success) {
            return res.status(200).json({
              success: true,
              message: 'Invoice processed via workflow automation',
              dealId,
              invoiceType: result.invoiceType
            });
          }
        } catch (error) {
          logger.error(`❌ Ошибка создания проформы (workflow automation) | Deal ID: ${dealId} | Ошибка: ${error.message}`, {
            dealId,
            error: error.message
          });
        }
      }
    }

    // ========== Обработка 4: Изменение продукта в сделке ==========
    // Проверяем изменение продукта для всех webhook событий
    // Это необходимо, чтобы отслеживать изменения продукта и сохранять в кэш, когда проформы еще нет
    // Ошибка была исправлена: использовалась неопределенная переменная currentProductId вместо currentProductIdInDb
    try {
      const pipedriveClient = resolvePipedriveClient();
      if (pipedriveClient && dealId) {
        logger.debug(`🔍 Проверка изменения продукта | Deal: ${dealId}`);
        
        // Получаем текущие продукты сделки
        const currentProductsResult = await pipedriveClient.getDealProducts(dealId);
        logger.debug(`📦 Результат получения продуктов | Deal: ${dealId} | Success: ${currentProductsResult.success} | Products count: ${currentProductsResult.products?.length || 0}`);
        
        if (currentProductsResult.success && currentProductsResult.products) {
          const currentProducts = currentProductsResult.products;
          logger.debug(`📦 Обработка продуктов | Deal: ${dealId} | Count: ${currentProducts.length}`);
          const currentProductName = currentProducts.length > 0 
            ? (currentProducts[0].name || currentProducts[0].product?.name)
            : null;
          
          logger.debug(`📦 Текущий продукт из Pipedrive | Deal: ${dealId} | Name: ${currentProductName}`);
          
          // Получаем или создаем продукт в нашей базе по названию из Pipedrive
          let currentProductIdInDb = null;
          if (currentProductName) {
            try {
              currentProductIdInDb = await invoiceProcessing.proformaRepository.ensureProductId(currentProductName);
              logger.debug(`📦 Продукт найден/создан в базе | Deal: ${dealId} | Name: "${currentProductName}" | Product ID в базе: ${currentProductIdInDb}`);
            } catch (error) {
              logger.warn(`⚠️  Ошибка получения/создания продукта в базе | Deal: ${dealId} | Name: "${currentProductName}" | Ошибка: ${error.message}`);
            }
          }
          
          // Получаем сохраненный продукт из базы данных (из проформы) - сравниваем по product_id из нашей базы
          let previousProductId = null;
          let previousProductName = null;
          try {
            // Сначала находим проформу для сделки
            const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
            if (dealResult.success) {
              const existingProforma = await invoiceProcessing.findExistingProformaForDeal(dealResult.deal);
              
              if (existingProforma?.found && existingProforma.invoiceId && supabase) {
                // Получаем продукт из proforma_products для этой проформы
                const { data: proformaProductData, error: proformaProductError } = await supabase
                  .from('proforma_products')
                  .select(`
                    name,
                    product_id,
                    products (
                      id,
                      name,
                      normalized_name
                    )
                  `)
                  .eq('proforma_id', existingProforma.invoiceId)
                  .limit(1)
                  .single();
                
                if (!proformaProductError && proformaProductData) {
                  // Берем product_id из proforma_products (это ID из нашей таблицы products)
                  previousProductId = proformaProductData.product_id;
                  previousProductName = proformaProductData.products?.name || proformaProductData.name;
                  logger.info(`💾 Найден продукт из базы данных | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Product ID: ${previousProductId} | Name: "${previousProductName}"`);
                } else {
                  logger.debug(`💾 Проформа найдена, но продукт не найден в proforma_products | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                }
              }
            }
          } catch (error) {
            logger.warn(`⚠️  Ошибка получения продукта из базы данных | Deal: ${dealId} | Ошибка: ${error.message}`);
          }
          
          // Получаем normalized name для текущего и предыдущего продукта
          let currentProductNormalized = null;
          let previousProductNormalized = null;
          
          if (currentProductName) {
            try {
              // Нормализуем название продукта для сравнения (приводим к нижнему регистру и убираем лишние пробелы)
              currentProductNormalized = currentProductName.toLowerCase().trim().replace(/\s+/g, ' ');
            } catch (error) {
              logger.warn(`⚠️  Ошибка нормализации текущего продукта | Deal: ${dealId} | Ошибка: ${error.message}`);
            }
          }
          
          if (previousProductName) {
            try {
              previousProductNormalized = previousProductName.toLowerCase().trim().replace(/\s+/g, ' ');
            } catch (error) {
              logger.warn(`⚠️  Ошибка нормализации предыдущего продукта | Deal: ${dealId} | Ошибка: ${error.message}`);
            }
          }
          
          // Проверяем, изменился ли продукт (сравниваем по product_id из нашей базы)
          // ВАЖНО: Сравниваем ID продуктов из нашей базы данных
          // Если проформы нет (previousProductId === null) - это не изменение продукта, а создание новой проформы
          // Если проформы есть и product_id не совпадает - продукт изменился
          const productChanged = previousProductId !== null && currentProductIdInDb !== null && 
            String(previousProductId) !== String(currentProductIdInDb);
          
          if (previousProductId === null && currentProductIdInDb !== null) {
            logger.info(`ℹ️  Проформа не найдена, это будет создание новой проформы | Deal: ${dealId} | Product ID в базе: ${currentProductIdInDb} | Name: "${currentProductName}"`);
          } else {
            logger.info(`🔍 Сравнение продуктов по ID из базы | Deal: ${dealId} | Было (Product ID в базе): ${previousProductId} | Стало (Product ID в базе): ${currentProductIdInDb} | Изменился: ${productChanged}`);
          }
          
          if (productChanged) {
            logger.info(`🔄 Обнаружено изменение продукта | Deal: ${dealId} | Было (Product ID в базе): ${previousProductId} | Стало (Product ID в базе): ${currentProductIdInDb} | Было (Name): "${previousProductName}" | Стало (Name): "${currentProductName}"`);
            
            // Обрабатываем изменение продукта независимо от invoice_type
            logger.info(`📄 Обработка изменения продукта | Deal: ${dealId}`);
            try {
              // Получаем полные данные сделки для обновления проформы
              const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
              if (!dealResult.success) {
                logger.error(`❌ Не удалось получить данные сделки | Deal: ${dealId} | Ошибка: ${dealResult.error}`);
                // Продолжаем обработку других триггеров
              } else {
                const fullDeal = dealResult.deal;
                
                // Находим существующую проформу
                const existingProforma = await invoiceProcessing.findExistingProformaForDeal(fullDeal);
                
                if (existingProforma?.found && existingProforma.invoiceId) {
                  logger.info(`📝 Найдена существующая проформа | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                  
                  // Получаем продукты сделки
                  const dealProducts = await invoiceProcessing.getDealProducts(dealId);
                  let product;
                  const totalAmount = parseFloat(fullDeal.value) || 0;
                  
                  if (dealProducts.length > 0) {
                    const dealProduct = dealProducts[0];
                    const quantity = parseFloat(dealProduct.quantity) || 1;
                    const itemPrice = typeof dealProduct.item_price === 'number'
                      ? dealProduct.item_price
                      : parseFloat(dealProduct.item_price);
                    const sumPrice = typeof dealProduct.sum === 'number'
                      ? dealProduct.sum
                      : parseFloat(dealProduct.sum);
                    const productPrice = itemPrice || sumPrice || totalAmount;
                    const productName = dealProduct.name
                      || dealProduct.product?.name
                      || fullDeal.title || 'Camp / Tourist service';
                    const productUnit = dealProduct.unit
                      || dealProduct.product?.unit
                      || 'szt.';
                    
                    product = {
                      id: null,
                      name: productName,
                      price: productPrice,
                      unit: productUnit,
                      type: 'service',
                      quantity
                    };
                  } else {
                    product = {
                      id: null,
                      name: fullDeal.title || 'Camp / Tourist service',
                      price: totalAmount,
                      unit: 'szt.',
                      type: 'service',
                      quantity: 1
                    };
                  }
                  
                  // Получаем старую сумму проформы и уже оплаченные платежи для пересчета
                  let oldProformaTotal = 0;
                  let paidAmount = 0;
                  let paidAmountPln = 0;
                  
                  if (supabase) {
                    try {
                      // Получаем старую сумму проформы из базы данных
                      const { data: proformaData, error: proformaError } = await supabase
                        .from('proformas')
                        .select('total, currency, currency_exchange, payments_total, payments_total_pln')
                        .eq('id', existingProforma.invoiceId)
                        .single();
                      
                      if (!proformaError && proformaData) {
                        oldProformaTotal = parseFloat(proformaData.total) || 0;
                        logger.info(`💰 Старая сумма проформы | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Старая сумма: ${oldProformaTotal} ${proformaData.currency || fullDeal.currency}`);
                        
                        // Получаем уже оплаченные платежи для этой проформы
                        // Используем ту же логику, что и в PaymentService.updateProformaPaymentAggregates
                        const { data: paymentRows, error: paymentsError } = await supabase
                          .from('payments')
                          .select('amount, currency')
                          .eq('manual_status', 'approved')
                          .eq('manual_proforma_id', existingProforma.invoiceId);
                        
                        if (!paymentsError && paymentRows && paymentRows.length > 0) {
                          const proformaCurrency = proformaData.currency || fullDeal.currency;
                          const exchangeRate = parseFloat(proformaData.currency_exchange) || 1;
                          
                          // Собираем суммы по валютам (как в PaymentService)
                          const totalsByCurrency = {};
                          paymentRows.forEach((row) => {
                            const amount = parseFloat(row.amount) || 0;
                            if (!Number.isFinite(amount) || amount <= 0) {
                              return;
                            }
                            const currency = row.currency || proformaCurrency;
                            totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
                          });
                          
                          // Конвертируем в валюту проформы (логика из PaymentService)
                          paidAmount = totalsByCurrency[proformaCurrency] || 0;
                          
                          // Если платежей в валюте проформы нет, но есть в PLN, конвертируем
                          if (paidAmount === 0 && Number.isFinite(exchangeRate) && exchangeRate > 0 && totalsByCurrency.PLN) {
                            paidAmount = totalsByCurrency.PLN / exchangeRate;
                          }
                          
                          // Рассчитываем PLN эквивалент
                          if (proformaCurrency === 'PLN') {
                            paidAmountPln = paidAmount;
                          } else if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
                            paidAmountPln = paidAmount * exchangeRate;
                          } else if (totalsByCurrency.PLN) {
                            paidAmountPln = totalsByCurrency.PLN;
                          }
                          
                          logger.info(`💰 Уже оплаченные платежи | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Платежей: ${paymentRows.length} | Оплачено: ${paidAmount} ${proformaCurrency} (${paidAmountPln} PLN) | По валютам: ${JSON.stringify(totalsByCurrency)}`);
                        } else if (paymentsError) {
                          logger.warn(`⚠️  Ошибка получения платежей | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Ошибка: ${paymentsError.message}`);
                        } else {
                          logger.info(`💰 Платежи не найдены | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                        }
                      }
                    } catch (error) {
                      logger.warn(`⚠️  Ошибка получения данных проформы для пересчета | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Ошибка: ${error.message}`);
                    }
                  }
                  
                  // Рассчитываем график платежей с учетом пересчета суммы
                  const issueDate = new Date();
                  const issueDateStr = issueDate.toISOString().split('T')[0];
                  const paymentDate = new Date(issueDate);
                  paymentDate.setDate(paymentDate.getDate() + invoiceProcessing.PAYMENT_TERMS_DAYS);
                  const paymentDateStr = paymentDate.toISOString().split('T')[0];
                  
                  const totalAmountValue = parseFloat(fullDeal.value) || 0;
                  
                  // Пересчет: новая сумма - уже оплаченные платежи = остаток к оплате
                  // НЕ учитываем старую сумму проформы, сравниваем новую сумму напрямую с оплаченными платежами
                  const remainingAmount = Math.max(0, totalAmountValue - paidAmount);
                  logger.info(`💰 Расчет остатка к оплате | Deal: ${dealId} | Новая сумма: ${totalAmountValue} | Оплачено: ${paidAmount} | Остаток: ${remainingAmount} ${fullDeal.currency}`);
                  logger.info(`💰 Дополнительная информация | Deal: ${dealId} | Старая сумма проформы: ${oldProformaTotal} | Разница между новой и старой: ${totalAmountValue - oldProformaTotal} ${fullDeal.currency}`);
                  
                  const formatAmount = (value) => value.toFixed(2);
                  
                  // Определяем график платежей на основе остатка к оплате
                  // ВАЖНО: Если уже есть платежи, привязанные к проформе - НЕ дробим, весь остаток записываем как второй платеж
                  // Если платежей нет - можно дробить, но в этом кейсе (изменение продукта) это не применимо
                  let secondPaymentDateStr = paymentDateStr;
                  let use50_50Schedule = false;
                  const hasPayments = paymentRows && paymentRows.length > 0;
                  
                  // Если остаток к оплате > 0, рассчитываем график платежей
                  if (remainingAmount > 0) {
                    if (hasPayments) {
                      // Если уже есть платежи - НЕ дробим, весь остаток записываем как второй платеж
                      logger.info(`💰 График платежей | Deal: ${dealId} | Уже есть платежи (${paymentRows.length}), не дробим. Весь остаток: ${remainingAmount} ${fullDeal.currency} - второй платеж`);
                      use50_50Schedule = false;
                      
                      // Определяем дату второго платежа на основе expected_close_date
                      if (fullDeal.expected_close_date) {
                        try {
                          const expectedCloseDate = new Date(fullDeal.expected_close_date);
                          const balanceDueDate = new Date(expectedCloseDate);
                          balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);
                          secondPaymentDateStr = balanceDueDate.toISOString().split('T')[0];
                        } catch (error) {
                          logger.warn('Failed to calculate second payment date from expected close date', {
                            dealId: fullDeal.id,
                            expectedCloseDate: fullDeal.expected_close_date,
                            error: error.message
                          });
                        }
                      }
                    } else {
                      // Если платежей нет - можно дробить (но в этом кейсе не применимо)
                      if (fullDeal.expected_close_date) {
                        try {
                          const expectedCloseDate = new Date(fullDeal.expected_close_date);
                          const today = new Date(issueDateStr);
                          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
                          
                          // Если разница >= 30 дней (месяц), используем график 50/50 для остатка
                          if (daysDiff >= 30) {
                            use50_50Schedule = true;
                            // Вторая дата платежа - за 1 месяц до expected_close_date
                            const balanceDueDate = new Date(expectedCloseDate);
                            balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);
                            secondPaymentDateStr = balanceDueDate.toISOString().split('T')[0];
                          }
                        } catch (error) {
                          logger.warn('Failed to calculate payment schedule from expected close date', {
                            dealId: fullDeal.id,
                            expectedCloseDate: fullDeal.expected_close_date,
                            error: error.message
                          });
                        }
                      }
                    }
                  }
                  
                  // Рассчитываем суммы для графика платежей на основе остатка
                  let depositAmount = 0;
                  let balanceAmount = 0;
                  
                  if (remainingAmount > 0) {
                    if (hasPayments) {
                      // Если уже есть платежи - весь остаток записываем как второй платеж (не дробим)
                      depositAmount = 0;
                      balanceAmount = Math.round(remainingAmount * 100) / 100;
                    } else if (use50_50Schedule) {
                      // 50/50 от остатка (только если платежей нет)
                      depositAmount = Math.round((remainingAmount * invoiceProcessing.ADVANCE_PERCENT / 100) * 100) / 100;
                      balanceAmount = Math.round((remainingAmount - depositAmount) * 100) / 100;
                    } else {
                      // 100% остаток
                      depositAmount = 0;
                      balanceAmount = Math.round(remainingAmount * 100) / 100;
                    }
                  }
                  
                  logger.info(`💰 График платежей | Deal: ${dealId} | Есть платежи: ${hasPayments} | Остаток: ${remainingAmount} | Предоплата: ${depositAmount} | Остаток к оплате: ${balanceAmount} ${fullDeal.currency}`);
                  
                  // Получаем информацию о скидке из deal (та же логика, что и в createProformaInWfirma)
                  const getDiscount = (deal) => {
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
                  
                  const discountInfo = getDiscount(fullDeal);
                  const dealBaseAmount = parseFloat(fullDeal.value) || totalAmountValue;
                  let discountAmount = 0;
                  if (discountInfo) {
                    if (discountInfo.type === 'percent') {
                      discountAmount = Math.round((dealBaseAmount * discountInfo.value / 100) * 100) / 100;
                    } else {
                      discountAmount = discountInfo.value;
                    }
                  }
                  
                  let scheduleDescription;
                  
                  // Формируем описание графика платежей с учетом пересчета
                  // ВАЖНО: Сравниваем новую сумму напрямую с оплаченными платежами, не учитываем старую сумму проформы
                  // Если уже есть платежи - не дробим, весь остаток записываем как второй платеж
                  if (remainingAmount <= 0) {
                    // Если остаток <= 0, значит уже все оплачено или переплата
                    scheduleDescription = `График платежей: Изменение продукта. Новая сумма: ${formatAmount(totalAmountValue)} ${fullDeal.currency}. Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}. Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency}.`;
                  } else if (hasPayments) {
                    // Если уже есть платежи - весь остаток записываем как второй платеж (не дробим)
                    scheduleDescription = `График платежей: Изменение продукта. Новая сумма: ${formatAmount(totalAmountValue)} ${fullDeal.currency}. Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}. Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency} до ${secondPaymentDateStr}.`;
                  } else if (use50_50Schedule && secondPaymentDateStr && secondPaymentDateStr !== paymentDateStr) {
                    // 50/50 от остатка (только если платежей нет)
                    scheduleDescription = `График платежей: Изменение продукта. Новая сумма: ${formatAmount(totalAmountValue)} ${fullDeal.currency}. Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}. Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency} (50% предоплата ${formatAmount(depositAmount)} ${fullDeal.currency} оплачивается сейчас; 50% остаток ${formatAmount(balanceAmount)} ${fullDeal.currency} до ${secondPaymentDateStr}).`;
                  } else {
                    // 100% остаток
                    scheduleDescription = `График платежей: Изменение продукта. Новая сумма: ${formatAmount(totalAmountValue)} ${fullDeal.currency}. Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}. Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency} до ${paymentDateStr}.`;
                  }
                  
                  // Добавляем информацию о скидке, если она есть
                  if (discountInfo && discountAmount > 0) {
                    const discountText = discountInfo.type === 'percent'
                      ? `${discountInfo.value}% (${formatAmount(discountAmount)} ${fullDeal.currency})`
                      : `${formatAmount(discountAmount)} ${fullDeal.currency}`;
                    scheduleDescription += ` Скидка: ${discountText}.`;
                  }
                  
                  // Добавляем DEFAULT_DESCRIPTION, если он есть
                  const invoiceDescription = invoiceProcessing.DEFAULT_DESCRIPTION
                    ? `${invoiceProcessing.DEFAULT_DESCRIPTION.trim()} ${scheduleDescription}`.trim()
                    : scheduleDescription;
                  
                  // Обновляем проформу
                  // Если есть платежи, используем secondPaymentDateStr (дата второго платежа), иначе paymentDateStr
                  const finalDueDate = hasPayments && secondPaymentDateStr ? secondPaymentDateStr : paymentDateStr;
                  const updateResult = await invoiceProcessing.updateProformaLines(existingProforma.invoiceId, {
                    product,
                    totalAmount: totalAmountValue,
                    schedule: {
                      dueDate: finalDueDate,
                      scheduleText: invoiceDescription
                    }
                  });
                  
                  if (updateResult.success) {
                    logger.info(`✅ Проформа обновлена после изменения продукта | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                    
                    // Обновляем данные в базе данных (proforma_products)
                    try {
                      logger.info(`💾 Обновление proforma_products в базе данных | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                      await invoiceProcessing.persistProformaToDatabase(existingProforma.invoiceId, {
                        invoiceNumber: existingProforma.invoiceNumber,
                        issueDate: new Date(),
                        currency: fullDeal.currency,
                        totalAmount: totalAmountValue,
                        fallbackProduct: product,
                        dealId: dealId
                      });
                      logger.info(`✅ proforma_products обновлены в базе данных | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId}`);
                    } catch (persistError) {
                      logger.warn(`⚠️  Не удалось обновить proforma_products в базе данных | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Ошибка: ${persistError.message}`);
                      // Не прерываем процесс, так как проформа уже обновлена в wFirma
                    }
                    
                    // Добавляем задачу на проверку последнего платежа
                    try {
                      const formatAmount = (value) => value.toFixed(2);
                      const taskDueDate = new Date();
                      taskDueDate.setDate(taskDueDate.getDate() + 1); // Задача на завтра
                      
                      const taskResult = await pipedriveClient.createTask({
                        deal_id: dealId,
                        subject: `Проверить последний платеж по проформе ${existingProforma.invoiceNumber || existingProforma.invoiceId}`,
                        type: 'task',
                        due_date: taskDueDate.toISOString().split('T')[0],
                        note: `Проформа обновлена после изменения продукта. Проверить корректность последнего платежа.`
                      });
                      
                      if (taskResult.success) {
                        logger.info(`✅ Задача на проверку платежа создана | Deal: ${dealId} | Task ID: ${taskResult.task.id}`);
                      } else {
                        logger.warn(`⚠️  Не удалось создать задачу на проверку платежа | Deal: ${dealId} | Ошибка: ${taskResult.error}`);
                      }
                    } catch (taskError) {
                      logger.warn(`⚠️  Ошибка создания задачи на проверку платежа | Deal: ${dealId} | Ошибка: ${taskError.message}`);
                    }
                    
                    // Добавляем ноут в сделку со сводкой изменений
                    try {
                      const formatAmount = (value) => value.toFixed(2);
                      const oldTotal = oldProformaTotal || 0;
                      const noteContent = `🔄 Обновление проформы после изменения продукта

📋 Проформа: ${existingProforma.invoiceNumber || existingProforma.invoiceId}

📦 Изменение продукта:
   Было: "${previousProductName || 'N/A'}"
   Стало: "${currentProductName || 'N/A'}"

💰 Изменение суммы:
   Было: ${formatAmount(oldTotal)} ${fullDeal.currency}
   Стало: ${formatAmount(totalAmountValue)} ${fullDeal.currency}
   Разница: ${formatAmount(totalAmountValue - oldTotal)} ${fullDeal.currency}

💳 Платежи:
   Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}
   Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency}
   ${remainingAmount > 0 ? `Дата платежа: ${finalDueDate}` : 'Все оплачено'}

✅ Проформа успешно обновлена в wFirma.`;
                      
                      const noteResult = await pipedriveClient.addNoteToDeal(dealId, noteContent);
                      
                      if (noteResult.success) {
                        logger.info(`✅ Ноут добавлен в сделку | Deal: ${dealId} | Note ID: ${noteResult.note.id}`);
                      } else {
                        logger.warn(`⚠️  Не удалось добавить ноут в сделку | Deal: ${dealId} | Ошибка: ${noteResult.error}`);
                      }
                    } catch (noteError) {
                      logger.warn(`⚠️  Ошибка добавления ноута в сделку | Deal: ${dealId} | Ошибка: ${noteError.message}`);
                    }
                    
                    // Если есть остаток к оплате и дата второго платежа - отправляем сообщение клиенту и создаем напоминание
                    if (remainingAmount > 0 && secondPaymentDateStr && hasPayments) {
                      try {
                        logger.info(`📧 Отправка сообщения клиенту о втором платеже | Deal: ${dealId} | Остаток: ${remainingAmount} ${fullDeal.currency}`);
                        
                        // Получаем данные персоны для SendPulse
                        const dealWithRelated = await pipedriveClient.getDealWithRelatedData(dealId);
                        const person = dealWithRelated?.person;
                        const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
                        const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];
                        
                        if (sendpulseId) {
                          // Получаем банковский счет
                          const bankAccountResult = await invoiceProcessing.getBankAccountByCurrency(fullDeal.currency || 'PLN');
                          const bankAccount = bankAccountResult.success ? bankAccountResult.bankAccount : null;
                          
                          // Формируем сообщение о втором платеже с новым остатком
                          const customerFullName = person?.name || 'Клиент';
                          // Берем только имя (первое слово)
                          const customerName = customerFullName.split(' ')[0];
                          const formatAmount = (value) => value.toFixed(2);
                          
                          // Получаем название нового продукта
                          const newProductName = currentProductName || fullDeal.title;
                          
                          const message = `Привет, ${customerName}!

Обновили кемп на "${newProductName}".

Проформа пересчитана: ${existingProforma.invoiceNumber || existingProforma.invoiceId}

Расчет:
- Новая сумма: ${formatAmount(totalAmountValue)} ${fullDeal.currency}
- Уже оплачено: ${formatAmount(paidAmount)} ${fullDeal.currency}
- Остаток к оплате: ${formatAmount(remainingAmount)} ${fullDeal.currency}

Дата платежа: ${secondPaymentDateStr}
${bankAccount?.number ? `Счет: ${bankAccount.number}` : ''}

В назначении платежа укажите: "${existingProforma.invoiceNumber || existingProforma.invoiceId}"`;
                          
                          // Отправляем сообщение через SendPulse
                          const SendPulseClient = require('../services/sendpulse');
                          const sendpulseClient = new SendPulseClient();
                          const sendResult = await sendpulseClient.sendTelegramMessage(sendpulseId, message);
                          
                          if (sendResult.success) {
                            logger.info(`✅ Сообщение о втором платеже отправлено клиенту | Deal: ${dealId} | SendPulse ID: ${sendpulseId}`);
                            
                            // Записываем информацию для крон-задачи о напоминании
                            // Крон-задача сама найдет эту сделку через findAllUpcomingTasks
                            // если есть проформа, платежи и expected_close_date
                            try {
                              const ProformaSecondPaymentReminderService = require('../services/proformaSecondPaymentReminderService');
                              const reminderService = new ProformaSecondPaymentReminderService();
                              
                              // Проверяем, что все данные на месте для крон-задачи
                              const hasExpectedCloseDate = fullDeal.expected_close_date ? true : false;
                              const hasProformaInDb = existingProforma ? true : false;
                              const hasPaymentsInDb = hasPayments;
                              
                              logger.info(`📅 Напоминание для крон-задачи подготовлено | Deal: ${dealId}`, {
                                secondPaymentDate: secondPaymentDateStr,
                                hasExpectedCloseDate,
                                hasProformaInDb,
                                hasPaymentsInDb,
                                remainingAmount,
                                currency: fullDeal.currency,
                                proformaNumber: existingProforma.invoiceNumber || existingProforma.invoiceId
                              });
                              
                              logger.info(`ℹ️  Крон-задача автоматически отправит напоминание в дату платежа (${secondPaymentDateStr}) через ProformaSecondPaymentReminderService`);
                            } catch (reminderError) {
                              logger.warn(`⚠️  Ошибка подготовки напоминания для крон-задачи | Deal: ${dealId} | Ошибка: ${reminderError.message}`);
                            }
                          } else {
                            logger.warn(`⚠️  Не удалось отправить сообщение клиенту | Deal: ${dealId} | Ошибка: ${sendResult.error}`);
                          }
                        } else {
                          logger.warn(`⚠️  SendPulse ID не найден для персоны | Deal: ${dealId}`);
                        }
                      } catch (messageError) {
                        logger.warn(`⚠️  Ошибка отправки сообщения клиенту | Deal: ${dealId} | Ошибка: ${messageError.message}`);
                      }
                    } else if (remainingAmount > 0) {
                      logger.info(`ℹ️  Остаток к оплате есть, но нет даты второго платежа или платежей | Deal: ${dealId} | Остаток: ${remainingAmount} ${fullDeal.currency}`);
                    }
                    
                    // Логируем информацию для крон-задачи даже если нет немедленного сообщения
                    if (remainingAmount > 0 && secondPaymentDateStr) {
                      logger.info(`📅 Напоминание для крон-задачи подготовлено | Deal: ${dealId}`, {
                        secondPaymentDate: secondPaymentDateStr,
                        hasExpectedCloseDate: fullDeal.expected_close_date ? true : false,
                        hasProformaInDb: existingProforma ? true : false,
                        hasPaymentsInDb: hasPayments,
                        remainingAmount,
                        currency: fullDeal.currency,
                        proformaNumber: existingProforma.invoiceNumber || existingProforma.invoiceId
                      });
                      logger.info(`ℹ️  Крон-задача автоматически отправит напоминание в дату платежа (${secondPaymentDateStr}) через ProformaSecondPaymentReminderService`);
                    }
                    
                    return res.status(200).json({
                      success: true,
                      message: 'Proforma updated due to product change',
                      dealId,
                      invoiceId: existingProforma.invoiceId,
                      invoiceNumber: existingProforma.invoiceNumber,
                      productChange: {
                        fromProductId: previousProductId,
                        toProductId: currentProductIdInDb,
                        fromProductName: previousProductName,
                        toProductName: currentProductName
                      }
                    });
                  } else {
                    logger.error(`❌ Не удалось обновить проформу | Deal: ${dealId} | Invoice ID: ${existingProforma.invoiceId} | Ошибка: ${updateResult.error}`);
                    
                    // Добавляем задачу на проверку ошибки обновления продукта
                    try {
                      const taskDueDate = new Date();
                      taskDueDate.setDate(taskDueDate.getDate() + 1); // Задача на завтра
                      
                      const taskResult = await pipedriveClient.createTask({
                        deal_id: dealId,
                        subject: `Проверить - произошла ошибка обновления продукта`,
                        type: 'task',
                        due_date: taskDueDate.toISOString().split('T')[0],
                        note: `Ошибка при обновлении проформы после изменения продукта.

Проформа: ${existingProforma.invoiceNumber || existingProforma.invoiceId}
Ошибка: ${updateResult.error}

Требуется ручная проверка и исправление.`
                      });
                      
                      if (taskResult.success) {
                        logger.info(`✅ Задача на проверку ошибки создана | Deal: ${dealId} | Task ID: ${taskResult.task.id}`);
                      } else {
                        logger.warn(`⚠️  Не удалось создать задачу на проверку ошибки | Deal: ${dealId} | Ошибка: ${taskResult.error}`);
                      }
                    } catch (taskError) {
                      logger.warn(`⚠️  Ошибка создания задачи на проверку ошибки | Deal: ${dealId} | Ошибка: ${taskError.message}`);
                    }
                    
                    // Добавляем ноут об ошибке
                    try {
                      const noteContent = `❌ Ошибка обновления проформы после изменения продукта

📋 Проформа: ${existingProforma.invoiceNumber || existingProforma.invoiceId}

📦 Изменение продукта:
   Было: "${previousProductName || 'N/A'}"
   Стало: "${currentProductName || 'N/A'}"

💰 Новая сумма: ${totalAmountValue} ${fullDeal.currency}

❌ Ошибка: ${updateResult.error}

Требуется ручная проверка и исправление проформы.`;
                      
                      const noteResult = await pipedriveClient.addNoteToDeal(dealId, noteContent);
                      
                      if (noteResult.success) {
                        logger.info(`✅ Ноут об ошибке добавлен в сделку | Deal: ${dealId} | Note ID: ${noteResult.note.id}`);
                      } else {
                        logger.warn(`⚠️  Не удалось добавить ноут об ошибке | Deal: ${dealId} | Ошибка: ${noteResult.error}`);
                      }
                    } catch (noteError) {
                      logger.warn(`⚠️  Ошибка добавления ноута об ошибке | Deal: ${dealId} | Ошибка: ${noteError.message}`);
                    }
                  }
                } else {
                  logger.info(`ℹ️  Проформа не найдена для сделки | Deal: ${dealId} | Создаем новую`);
                  // Если проформы нет, создаем новую
                  const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId, currentDeal);
                  if (result.success) {
                    return res.status(200).json({
                      success: true,
                      message: 'Invoice created due to product change',
                      dealId,
                      invoiceType: result.invoiceType,
                      productChange: {
                        fromProductId: previousProductId,
                        toProductId: currentProductIdInDb,
                        fromProductName: previousProductName,
                        toProductName: currentProductName
                      }
                    });
                  } else {
                    logger.warn(`⚠️  Не удалось создать проформу | Deal: ${dealId} | Ошибка: ${result.error || 'unknown'}`);
                  }
                }
              }
            } catch (error) {
              logger.error(`❌ Ошибка обработки изменения продукта | Deal: ${dealId} | Ошибка: ${error.message}`);
            }
          } else if (!previousProductNormalized && currentProductNormalized) {
            // Проформы еще нет, но продукт есть - сохраняем в кэш для следующего раза
            productChangeCache.set(dealId, {
              productId: currentProductIdInDb,
              productName: currentProductName,
              normalizedName: currentProductNormalized,
              timestamp: Date.now()
            });
            logger.debug(`💾 Продукт сохранен в кэш (проформы еще нет) | Deal: ${dealId} | Product: ${currentProductName || currentProductIdInDb} | Normalized: "${currentProductNormalized}"`);
          } else if (!productChanged && previousProductNormalized && currentProductNormalized) {
            // Продукт не изменился - логируем для отладки
            logger.debug(`✅ Продукт не изменился | Deal: ${dealId} | Normalized: "${currentProductNormalized}"`);
          }
        } else {
          logger.warn(`⚠️  Не удалось получить продукты | Deal: ${dealId} | Success: ${currentProductsResult.success} | Has products: ${!!currentProductsResult.products}`);
        }
      } else {
        logger.warn(`⚠️  PipedriveClient недоступен для проверки изменения продукта | Deal: ${dealId}`);
      }
      } catch (error) {
        logger.error(`❌ Ошибка проверки изменения продукта | Deal: ${dealId} | Ошибка: ${error.message}`, {
          dealId,
          error: error.message,
          stack: error.stack
        });
        // Не прерываем обработку webhook из-за ошибки проверки продукта
      }
    } else {
      logger.debug(`⏭️  Пропуск проверки изменения продукта | Deal: ${dealId} | Reason: нет previousDeal и не workflow automation`);
    }

    // Если ни один триггер не сработал, возвращаем успех
    logger.info(`ℹ️  Webhook обработан, но триггеры не сработали | Deal: ${dealId} | invoice_type: ${currentInvoiceType || 'null'} | status: ${currentStatus} | stage_id: ${currentStageId || 'null'} | lost_reason: ${lostReason || 'null'} | isWorkflowAutomation: ${isWorkflowAutomation}`);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook processed, no actions needed',
      dealId,
      debug: {
        invoiceType: currentInvoiceType,
        status: currentStatus,
        stageId: currentStageId,
        lostReason: lostReason
      }
    });
  } catch (error) {
    logger.error('❌ Ошибка обработки webhook', {
      url: req.url,
      method: req.method,
      error: error.message,
      stack: error.stack
    });
    
    // Сохраняем ошибку в историю для отладки
    const errorEvent = {
      timestamp,
      event: 'error',
      dealId: req.body?.current?.id || req.body?.['Deal_id'] || req.body?.['Deal ID'] || null,
      bodyKeys: req.body ? Object.keys(req.body) : [],
      error: error.message,
      bodyPreview: req.body ? Object.fromEntries(
        Object.entries(req.body).slice(0, 5).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v).substring(0, 50) : String(v).substring(0, 50)])
      ) : {}
    };
    webhookHistory.unshift(errorEvent);
    if (webhookHistory.length > MAX_HISTORY_SIZE) {
      webhookHistory.pop();
    }

    // Return 200 to prevent Pipedrive from retrying on our errors
    return res.status(200).json({
      success: false,
      error: 'Webhook processing error',
      message: error.message
    });
  }
});

/**
 * GET /api/webhooks/pipedrive/history
 * Получить историю последних webhook событий (для отладки)
 */
router.get('/webhooks/pipedrive/history', (req, res) => {
  try {
  const limit = parseInt(req.query.limit, 10) || 20;
  const events = webhookHistory.slice(0, Math.min(limit, webhookHistory.length));
  
  res.json({
    success: true,
    total: webhookHistory.length,
    limit,
    events: events.map(event => ({
      timestamp: event.timestamp,
      event: event.event,
      dealId: event.dealId,
        bodyKeys: event.bodyKeys || [],
      // Показываем только ключи тела, не полное содержимое (может быть большим)
        bodyPreview: event.bodyPreview || (event.body ? Object.keys(event.body).reduce((acc, key) => {
        const value = event.body[key];
        if (typeof value === 'object' && value !== null) {
          acc[key] = Array.isArray(value) ? `[Array(${value.length})]` : '{...}';
        } else {
          acc[key] = String(value).substring(0, 100); // Ограничиваем длину
        }
        return acc;
        }, {}) : {})
    }))
  });
  } catch (error) {
    logger.error('Error getting webhook history', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * GET /api/webhooks/pipedrive/history/:index
 * Получить полное тело конкретного webhook события
 */
router.get('/webhooks/pipedrive/history/:index', (req, res) => {
  const index = parseInt(req.params.index, 10);
  
  if (index < 0 || index >= webhookHistory.length) {
    return res.status(404).json({
      success: false,
      error: 'Event not found',
      availableRange: `0-${webhookHistory.length - 1}`
    });
  }
  
  res.json({
    success: true,
    event: webhookHistory[index]
  });
});

/**
 * DELETE /api/webhooks/pipedrive/history
 * Очистить историю webhook событий
 */
router.delete('/webhooks/pipedrive/history', (req, res) => {
  const cleared = webhookHistory.length;
  webhookHistory.length = 0;
  
  res.json({
    success: true,
    message: `Cleared ${cleared} events`
  });
});

/**
 * GET /api/webhooks/pipedrive
 * Информация о webhook endpoint и его статусе
 */
router.get('/webhooks/pipedrive', (req, res) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  logger.info(`✅ Pipedrive Webhook Info Endpoint | Timestamp: ${timestamp} | IP: ${clientIP}`);
  
  res.json({
    success: true,
    message: 'Pipedrive webhook endpoint is available',
    endpoint: '/api/webhooks/pipedrive',
    methods: ['POST', 'GET'],
    timestamp,
    historyCount: webhookHistory.length,
    availableEndpoints: {
      main: 'POST /api/webhooks/pipedrive - Обработка webhook событий',
      history: 'GET /api/webhooks/pipedrive/history - История событий',
      historyItem: 'GET /api/webhooks/pipedrive/history/:index - Конкретное событие',
      test: 'GET /api/webhooks/pipedrive/test - Тест доступности',
      deleteHistory: 'DELETE /api/webhooks/pipedrive/history - Очистить историю'
    }
  });
});

/**
 * GET /api/webhooks/pipedrive/test
 * Тестовый endpoint для проверки доступности webhook роута
 */
router.get('/webhooks/pipedrive/test', (req, res) => {
  const timestamp = new Date().toISOString();
  const clientIP = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  
  logger.info(`✅ Pipedrive Webhook Test Endpoint | Timestamp: ${timestamp} | IP: ${clientIP}`);
  
  res.json({
    success: true,
    message: 'Pipedrive webhook endpoint is accessible',
    timestamp,
    endpoint: '/api/webhooks/pipedrive',
    method: 'POST',
    note: 'Use POST method to send webhook data from Pipedrive'
  });
});

module.exports = router;
