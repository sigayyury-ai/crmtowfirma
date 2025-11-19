const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const { STAGES } = require('../services/stripe/crmSync');
const logger = require('../utils/logger');
const { normaliseCurrency } = require('../utils/currency');

const stripeProcessor = new StripeProcessorService();
const invoiceProcessing = new InvoiceProcessingService();

/**
 * Нормализует invoice_type к числовому ID
 * Преобразует строковые значения в числовые ID для единообразной обработки
 * @param {string|number} invoiceType - Значение invoice_type из webhook или deal
 * @returns {string|null} - Нормализованное значение (ID) или null
 */
function normalizeInvoiceTypeToId(invoiceType) {
  if (!invoiceType) return null;
  
  const normalized = String(invoiceType).trim().toLowerCase();
  
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
    return normalized;
  }
  
  // Если есть маппинг, возвращаем ID
  if (typeMapping[normalized]) {
    return typeMapping[normalized];
  }
  
  // Если не найдено, возвращаем оригинальное значение (может быть кастомное)
  return String(invoiceType).trim();
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
    logger.info(`🔍 Поля Invoice в webhook | Deal: ${dealIdForHash || 'неизвестен'} | Поля: ${invoiceFields || 'нет'}`);
    
    webhookHistory.unshift(webhookEvent); // Добавляем в начало
    if (webhookHistory.length > MAX_HISTORY_SIZE) {
      webhookHistory.pop(); // Удаляем старые события
    }
    
    // Log webhook received
    const eventType = webhookData.event || 'workflow_automation';
    logger.info(`📥 Webhook получен | Deal: ${webhookEvent.dealId || 'неизвестен'}`);
    logger.info(`🔍 Начало обработки webhook | Deal: ${webhookEvent.dealId || 'неизвестен'} | Event type: ${eventType}`);

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
          // Invoice поля
          [INVOICE_TYPE_FIELD_KEY]: webhookData['Invoice type'] || 
                                    webhookData['Invoice'] ||
                                    webhookData['invoice_type'] || 
                                    webhookData['invoice'] ||
                                    webhookData[INVOICE_TYPE_FIELD_KEY],
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
        logger.debug('Webhook event is not a deal update or delete, skipping', {
          event: webhookData.event
        });
        return res.status(200).json({ success: true, message: 'Event ignored' });
      }

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
    const invoiceTypeFromWebhook1 = webhookData?.['Invoice type'];
    const invoiceTypeFromWebhook2 = webhookData?.['Invoice'];
    const invoiceTypeFromWebhook3 = webhookData?.['invoice_type'];
    const invoiceTypeFromWebhook4 = webhookData?.['invoice'];
    const invoiceTypeFromWebhook5 = webhookData?.[INVOICE_TYPE_FIELD_KEY];
    const invoiceFromWebhook = invoiceTypeFromWebhook1 || invoiceTypeFromWebhook2 || invoiceTypeFromWebhook3 || invoiceTypeFromWebhook4 || invoiceTypeFromWebhook5;
    const invoiceFromDeal = currentDeal?.[INVOICE_TYPE_FIELD_KEY];
    const rawInvoiceType = invoiceFromWebhook || invoiceFromDeal || null;
    
    // Нормализуем invoice_type к ID (основной метод)
    const currentInvoiceType = normalizeInvoiceTypeToId(rawInvoiceType);
    
    // Логируем извлечение invoice_type для диагностики
    logger.info(`🔍 Извлечение invoice_type | Deal: ${dealId} | Сырое значение: ${rawInvoiceType || 'null'} | Нормализовано к ID: ${currentInvoiceType || 'null'}`);
    
    // Get status - проверяем сначала webhookData для workflow automation, потом currentDeal
    const currentStatus = (webhookData && (webhookData['Deal status'] || webhookData['Deal_status'] || webhookData['deal_status'] || webhookData['status'])) ||
                         currentDeal?.status ||
                         'open';
    
    logger.info(`🔍 Извлечение статуса | Deal: ${dealId} | Status: ${currentStatus}`);
    
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
        // Если lost_reason не "Refund", удаляем проформы
        logger.info(`🗑️  Удаление проформ | Deal: ${dealId}`);

        try {
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
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
    }

    // ========== Обработка 2: invoice_type = "Delete" (приоритет перед стадией) ==========
    // Проверяем удаление ПЕРЕД обработкой стадии, чтобы удаление имело приоритет
    // Используем только ID "74" для удаления
    if (currentInvoiceType === '74') {
      logger.info(`🗑️  Удаление проформ | Deal: ${dealId}`);

      try {
        const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
        if (result.success) {
          logger.info(`✅ Проформы удалены | Deal: ${dealId}`);
        } else {
          logger.warn(`⚠️  Не удалось удалить проформы | Deal: ${dealId}`);
        }
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
    
    if (currentInvoiceType) {
      // Stripe trigger - используем только ID "75" (основной метод)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      
      logger.info(`🔍 Сравнение invoice_type | Deal: ${dealId} | currentInvoiceType (ID): "${currentInvoiceType}" | STRIPE_TRIGGER_VALUE: "${STRIPE_TRIGGER_VALUE}" | Совпадает: ${currentInvoiceType === STRIPE_TRIGGER_VALUE}`);
      
        if (currentInvoiceType === STRIPE_TRIGGER_VALUE) {
          logger.info(`✅ Webhook сработал: invoice_type = Stripe (75) | Deal: ${dealId}`);
          
          // Проверяем блокировку обработки для этой сделки
          const lockKey = `stripe-${dealId}`;
          const lockTimestamp = processingLocks.get(lockKey);
          const now = Date.now();
          
          if (lockTimestamp && (now - lockTimestamp) < LOCK_TTL_MS) {
            logger.info(`⏸️  Обработка Stripe платежей уже выполняется для этой сделки, пропускаем | Deal: ${dealId} | Блокировка до: ${new Date(lockTimestamp + LOCK_TTL_MS).toISOString()}`);
            return res.status(200).json({
              success: true,
              message: 'Stripe processing already in progress for this deal',
              dealId
            });
          }
          
          // Устанавливаем блокировку
          processingLocks.set(lockKey, now);
          
          // Очищаем устаревшие блокировки
          for (const [key, timestamp] of processingLocks.entries()) {
            if (now - timestamp > LOCK_TTL_MS) {
              processingLocks.delete(key);
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
          const dealWithWebhookData = currentDeal ? { ...deal, ...currentDeal } : deal;

          // Рассчитываем график платежей на основе expected_close_date
          // Проверяем все возможные варианты названий полей
          const closeDate = dealWithWebhookData.expected_close_date || 
                           dealWithWebhookData.close_date ||
                           dealWithWebhookData['expected_close_date'] ||
                           dealWithWebhookData['close_date'] ||
                           webhookData?.['Expected close date'] ||
                           webhookData?.['Deal_close_date'] ||
                           webhookData?.['expected_close_date'] ||
                           webhookData?.['close_date'] ||
                           null;
          
          logger.info(`📅 Расчет графика платежей | Deal: ${dealId}`, {
            dealId,
            closeDate: closeDate || 'не указана',
            fromDeal: deal.expected_close_date || deal.close_date || 'нет',
            fromCurrentDeal: currentDeal?.expected_close_date || currentDeal?.close_date || 'нет',
            fromWebhook: webhookData?.['Deal_close_date'] || webhookData?.['Expected close date'] || 'нет',
            allDealKeys: Object.keys(deal).filter(k => k.toLowerCase().includes('close') || k.toLowerCase().includes('date')).join(', ')
          });
          
          let paymentSchedule = '100%';
          
          if (closeDate) {
            try {
              const expectedCloseDate = new Date(closeDate);
              const today = new Date();
              const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
              
              logger.info(`📅 Расчет количества платежей | Deal: ${dealId} | Дней до закрытия: ${daysDiff} | Сегодня: ${today.toISOString().split('T')[0]} | Дата закрытия: ${expectedCloseDate.toISOString().split('T')[0]}`);
              
              if (daysDiff >= 30) {
                paymentSchedule = '50/50';
                logger.info(`📅 ✅ Определен график 50/50 (два платежа) | Deal: ${dealId} | Дней до закрытия: ${daysDiff} | Условие: >= 30 дней`);
              } else {
                paymentSchedule = '100%';
                logger.info(`📅 ✅ Определен график 100% (один платеж) | Deal: ${dealId} | Дней до закрытия: ${daysDiff} | Условие: < 30 дней`);
              }
            } catch (error) {
              logger.warn(`⚠️  Ошибка расчета графика платежей, используем 100% | Deal: ${dealId}`, { error: error.message });
              paymentSchedule = '100%';
            }
          } else {
            logger.warn(`⚠️  Нет даты закрытия, используем график 100% (по умолчанию) | Deal: ${dealId}`);
            paymentSchedule = '100%';
          }
          
          logger.info(`📅 Итоговый график платежей | Deal: ${dealId} | График: ${paymentSchedule}`);

          // Проверяем, какие сессии уже существуют
          logger.info(`🔍 Проверка существующих Stripe сессий | Deal: ${dealId} | Ожидаемый график: ${paymentSchedule}`);
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

          logger.info(`🔍 Проверка статуса сессий в Stripe API | Deal: ${dealId}`, {
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
              note: 'Все платежи созданы и оплачены, пропускаем создание новых'
            });
            return res.status(200).json({
              success: true,
              message: 'All required Stripe Checkout Sessions already exist and are paid',
              dealId,
              paymentSchedule,
              existingCount: existingPayments.length,
              sessionIds: existingPayments.map(p => p.session_id).slice(0, 5),
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

          // Получаем сумму сделки
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
            logger.info(`💰 Валюта нормализована | Deal: ${dealId} | Было: ${rawCurrency} | Стало: ${currency}`);
          }

          // Создаем только недостающие Stripe Checkout Sessions
          logger.info(`💳 Создание недостающих Stripe Checkout Sessions | Deal: ${dealId} | График: ${paymentSchedule} | Сумма: ${totalAmount} ${currency} | Недостающие: ${missingSessions.join(', ') || 'все'}`);
          const sessions = [];
          const runId = `webhook-${Date.now()}`;

          if (paymentSchedule === '50/50') {
            // Создаем недостающие платежи для графика 50/50
            if (!hasDeposit) {
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
                sessions.push({
                  id: depositResult.sessionId,
                  url: depositResult.sessionUrl,
                  type: 'deposit',
                  amount: depositAmount
                });
                logger.info(`✅ Первый платеж создан | Deal: ${dealId} | Session ID: ${depositResult.sessionId} | URL: ${depositResult.sessionUrl || 'нет'}`);
              } else {
                logger.error(`❌ Ошибка создания первого платежа | Deal: ${dealId} | Ошибка: ${depositResult.error || 'unknown'}`);
                throw new Error(`Failed to create deposit session: ${depositResult.error || 'unknown'}`);
              }
            } else {
              if (depositPaid) {
                logger.info(`✅ Первый платеж уже существует И оплачен, пропускаем | Deal: ${dealId}`);
              } else {
                logger.info(`⚠️  Первый платеж существует, но не оплачен, создаем новый | Deal: ${dealId}`);
              }
            }

            if (!hasRest || !restPaid) {
              const restAmount = totalAmount / 2;
              logger.info(`💳 Создание второго платежа (остаток 50%) | Deal: ${dealId} | Сумма: ${restAmount} ${currency}`);
              const restResult = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                trigger: 'pipedrive_webhook',
                runId,
                paymentType: 'rest',
                paymentSchedule: '50/50',
                paymentIndex: 2
              });

              if (restResult.success && restResult.sessionId) {
                sessions.push({
                  id: restResult.sessionId,
                  url: restResult.sessionUrl,
                  type: 'rest',
                  amount: restAmount
                });
                logger.info(`✅ Второй платеж создан | Deal: ${dealId} | Session ID: ${restResult.sessionId} | URL: ${restResult.sessionUrl || 'нет'}`);
              } else {
                logger.error(`❌ Ошибка создания второго платежа | Deal: ${dealId} | Ошибка: ${restResult.error || 'unknown'}`);
                throw new Error(`Failed to create rest session: ${restResult.error || 'unknown'}`);
              }
            } else {
              if (restPaid) {
                logger.info(`✅ Второй платеж уже существует И оплачен, пропускаем | Deal: ${dealId}`);
              } else {
                logger.info(`⚠️  Второй платеж существует, но не оплачен, создаем новый | Deal: ${dealId}`);
              }
            }
          } else {
            // Создаем один платеж на всю сумму (если его нет ИЛИ не оплачен)
            if (!hasSingle || !singlePaid) {
              logger.info(`💳 Создание единого платежа (100%) | Deal: ${dealId} | Сумма: ${totalAmount} ${currency}`);
              const result = await stripeProcessor.createCheckoutSessionForDeal(dealWithWebhookData, {
                trigger: 'pipedrive_webhook',
                runId,
                paymentType: 'single',
                paymentSchedule: '100%'
              });

              if (result.success && result.sessionId) {
                sessions.push({
                  id: result.sessionId,
                  url: result.sessionUrl,
                  type: 'single',
                  amount: totalAmount
                });
                logger.info(`✅ Платеж создан | Deal: ${dealId} | Session ID: ${result.sessionId} | URL: ${result.sessionUrl || 'нет'}`);
              } else {
                logger.error(`❌ Ошибка создания платежа | Deal: ${dealId} | Ошибка: ${result.error || 'unknown'}`);
                throw new Error(`Failed to create checkout session: ${result.error || 'unknown'}`);
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
            
            // Создаем заметку в сделке с графиком платежей и ссылками
            try {
              const formatAmount = (amount) => parseFloat(amount).toFixed(2);
              const stripeMode = process.env.STRIPE_MODE || 'test';
              const stripeBaseUrl = stripeMode === 'live' 
                ? 'https://dashboard.stripe.com' 
                : 'https://dashboard.stripe.com/test';
              
              let noteContent = `💳 *График платежей: ${paymentSchedule}*\n\n`;
              
              if (paymentSchedule === '50/50' && sessions.length >= 2) {
                const depositSession = sessions.find(s => s.type === 'deposit');
                const restSession = sessions.find(s => s.type === 'rest');
                
                if (depositSession) {
                  noteContent += `1️⃣ *Предоплата 50%:* ${formatAmount(depositSession.amount)} ${currency}\n`;
                  noteContent += `   Stripe: ${stripeBaseUrl}/checkout_sessions/${depositSession.id}\n\n`;
                }
                
                if (restSession) {
                  noteContent += `2️⃣ *Остаток 50%:* ${formatAmount(restSession.amount)} ${currency}\n`;
                  noteContent += `   Stripe: ${stripeBaseUrl}/checkout_sessions/${restSession.id}\n\n`;
                }
              } else if (paymentSchedule === '100%' && sessions.length >= 1) {
                const singleSession = sessions[0];
                noteContent += `💳 *Полная оплата:* ${formatAmount(singleSession.amount)} ${currency}\n`;
                noteContent += `   Stripe: ${stripeBaseUrl}/checkout_sessions/${singleSession.id}\n\n`;
              }
              
              noteContent += `*Итого:* ${formatAmount(totalAmount)} ${currency}\n\n`;
              noteContent += `📊 Мониторинг статусов: ${stripeBaseUrl}/payments`;
              
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
            
            // Снимаем блокировку после успешной обработки
            stripeProcessingLocks.delete(dealId);
          
          return res.status(200).json({
            success: true,
            message: 'Stripe Checkout Sessions created and notification sent',
            dealId,
            paymentSchedule,
            totalAmount,
            currency,
            sessions: sessions.map(s => ({ id: s.id, type: s.type }))
          });
          } else {
            logger.error(`❌ Не удалось отправить уведомление | Deal: ${dealId} | Ошибка: ${notificationResult.error}`);
            
            // Сбрасываем invoice_type даже при ошибке, чтобы избежать повторных попыток
            try {
              const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
              logger.info(`🔄 Сброс invoice_type после ошибки | Deal: ${dealId} | Было: Stripe (75) | Будет: null`);
              await stripeProcessor.pipedriveClient.updateDeal(dealId, {
                [INVOICE_TYPE_FIELD_KEY]: null
              });
            logger.info(`✅ invoice_type убран: Stripe (75) → null | Deal: ${dealId}`);
          } catch (resetError) {
            logger.warn(`⚠️  Не удалось сбросить invoice_type после ошибки | Deal: ${dealId}`, { error: resetError.message });
          }
          
          // Снимаем блокировку после обработки (даже при ошибке)
          stripeProcessingLocks.delete(dealId);
          
          return res.status(200).json({
            success: false,
            error: notificationResult.error,
            dealId,
            sessions: sessions.map(s => ({ id: s.id, type: s.type }))
          });
          }
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

    // Если ни один триггер не сработал, возвращаем успех
    logger.debug('No trigger conditions met, webhook processed successfully', {
      dealId,
      currentInvoiceType,
      currentStatus,
      lostReason,
      isWorkflowAutomation
    });
    
    return res.status(200).json({ 
      success: true, 
      message: 'Webhook processed, no actions needed',
      dealId
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

module.exports = router;

