const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const { STAGES } = require('../services/stripe/crmSync');
const logger = require('../utils/logger');

const stripeProcessor = new StripeProcessorService();
const invoiceProcessing = new InvoiceProcessingService();

// Хранилище последних webhook событий для отладки (в памяти, последние 50)
const webhookHistory = [];
const MAX_HISTORY_SIZE = 50;

// Защита от дублирующихся webhooks (последние 500 событий, храним 60 секунд)
const recentWebhookHashes = new Map(); // Map<hash, timestamp>
const MAX_HASH_SIZE = 500;
const HASH_TTL_MS = 60000; // 60 секунд

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
  
  try {
    const webhookData = req.body;
    
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
    
    webhookHistory.unshift(webhookEvent); // Добавляем в начало
    if (webhookHistory.length > MAX_HISTORY_SIZE) {
      webhookHistory.pop(); // Удаляем старые события
    }
    
    // Log webhook received
    const eventType = webhookData.event || 'workflow_automation';
    logger.info(`📥 Webhook получен | Deal: ${webhookEvent.dealId || 'неизвестен'}`);

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
    const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Get invoice_type values - проверяем сначала webhookData для workflow automation, потом currentDeal
    const currentInvoiceType = (webhookData && (webhookData['Invoice type'] || webhookData['Invoice'] || webhookData['invoice_type'] || webhookData['invoice'] || webhookData[INVOICE_TYPE_FIELD_KEY])) ||
                              currentDeal?.[INVOICE_TYPE_FIELD_KEY] ||
                              null;
    
    // Get status - проверяем сначала webhookData для workflow automation, потом currentDeal
    const currentStatus = (webhookData && (webhookData['Deal status'] || webhookData['Deal_status'] || webhookData['deal_status'] || webhookData['status'])) ||
                         currentDeal?.status ||
                         'open';
    
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
    if (currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      const DELETE_TRIGGER_VALUES = new Set(['delete', '74']);
      
      if (DELETE_TRIGGER_VALUES.has(normalizedInvoiceType)) {
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
    }

    // ========== Обработка 3: Стадия "First payment" (триггер для Stripe) ==========
    // ВРЕМЕННО ОТКЛЮЧЕНО: создание Stripe Checkout Sessions через стадию "First payment"
    // Используется только триггер через invoice_type = "Stripe" (75)
    // const isFirstPaymentStage = String(currentStageId) === String(STAGES.FIRST_PAYMENT_ID);
    // 
    // if (isFirstPaymentStage && currentStatus !== 'lost') {
    //   // Логика создания Checkout Sessions отключена
    // }

    // ========== Обработка 3: invoice_type ==========
    // Упрощенная логика: обрабатываем invoice_type всегда, когда он установлен
    // Не проверяем previousInvoiceType, так как он может быть недостоверным
    logger.debug('Проверка invoice_type', {
      dealId,
      currentInvoiceType,
      normalizedInvoiceType: currentInvoiceType ? String(currentInvoiceType).trim().toLowerCase() : null
    });
    
    if (currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      
      // Stripe trigger (75)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      logger.debug('Сравнение invoice_type', {
        dealId,
        normalizedInvoiceType,
        STRIPE_TRIGGER_VALUE,
        matches: normalizedInvoiceType === STRIPE_TRIGGER_VALUE
      });
      
      if (normalizedInvoiceType === STRIPE_TRIGGER_VALUE) {
        logger.info(`✅ Webhook сработал: invoice_type = Stripe (75) | Deal: ${dealId}`);
        logger.info(`💳 Начало расчета графика платежей и отправки в SendPulse | Deal: ${dealId}`);

        try {
          // Получаем полные данные сделки
          const dealResult = await stripeProcessor.pipedriveClient.getDealWithRelatedData(dealId);
          if (!dealResult.success || !dealResult.deal) {
            throw new Error(`Failed to fetch deal: ${dealResult.error || 'unknown'}`);
          }

          const deal = dealResult.deal;
          // Мержим данные из webhook в deal из API (чтобы сохранить все поля из webhook)
          const dealWithWebhookData = currentDeal ? { ...deal, ...currentDeal } : deal;

          // Рассчитываем график платежей на основе expected_close_date
          const closeDate = dealWithWebhookData.expected_close_date || dealWithWebhookData.close_date;
          let paymentSchedule = '100%';
          
          logger.info(`📅 Расчет графика платежей | Deal: ${dealId} | Дата закрытия: ${closeDate || 'не указана'}`);
          
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

          const currency = dealWithWebhookData.currency || 'PLN';

          // Отправляем уведомление в SendPulse с графиком платежей (без создания Stripe сессий)
          logger.info(`📧 Отправка уведомления в SendPulse | Deal: ${dealId} | График: ${paymentSchedule} | Сумма: ${totalAmount} ${currency}`);
          const notificationResult = await stripeProcessor.sendPaymentNotificationForDeal(dealId, {
            paymentSchedule,
            sessions: [], // Пустой массив - только график без ссылок
            currency,
            totalAmount
          });

          logger.info(`📧 Результат отправки уведомления | Deal: ${dealId} | Успех: ${notificationResult.success} | Ошибка: ${notificationResult.error || 'нет'}`);

          if (notificationResult.success) {
            logger.info(`✅ Уведомление о графике платежей отправлено | Deal: ${dealId} | График: ${paymentSchedule}`);
            
            // Сбрасываем invoice_type на пустое значение, чтобы избежать повторного срабатывания webhook'а
            try {
              const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
              await stripeProcessor.pipedriveClient.updateDeal(dealId, {
                [INVOICE_TYPE_FIELD_KEY]: null
              });
              logger.info(`✅ invoice_type сброшен | Deal: ${dealId}`);
            } catch (resetError) {
              logger.warn(`⚠️  Не удалось сбросить invoice_type | Deal: ${dealId}`, { error: resetError.message });
            }
            
            return res.status(200).json({
              success: true,
              message: 'Payment schedule calculated and notification sent',
              dealId,
              paymentSchedule,
              totalAmount,
              currency
            });
          } else {
            logger.error(`❌ Не удалось отправить уведомление | Deal: ${dealId} | Ошибка: ${notificationResult.error}`);
            
            // Сбрасываем invoice_type даже при ошибке, чтобы избежать повторных попыток
            try {
              const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
              await stripeProcessor.pipedriveClient.updateDeal(dealId, {
                [INVOICE_TYPE_FIELD_KEY]: null
              });
              logger.info(`✅ invoice_type сброшен после ошибки | Deal: ${dealId}`);
            } catch (resetError) {
              logger.warn(`⚠️  Не удалось сбросить invoice_type после ошибки | Deal: ${dealId}`, { error: resetError.message });
            }
            
            return res.status(200).json({
              success: false,
              error: notificationResult.error,
              dealId
            });
          }
        } catch (error) {
          logger.error(`❌ Ошибка расчета графика платежей | Deal: ${dealId}`);
          
          // Сбрасываем invoice_type при исключении, чтобы избежать повторных попыток
          try {
            const INVOICE_TYPE_FIELD_KEY = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
            await stripeProcessor.pipedriveClient.updateDeal(dealId, {
              [INVOICE_TYPE_FIELD_KEY]: null
            });
            logger.info(`✅ invoice_type сброшен после исключения | Deal: ${dealId}`);
          } catch (resetError) {
            logger.warn(`⚠️  Не удалось сбросить invoice_type после исключения | Deal: ${dealId}`, { error: resetError.message });
          }
          
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }

      // Валидные типы инвойсов (70, 71, 72) - поддерживаем как числовые, так и строковые значения
      // Примечание: проверка Delete (74 или "delete") уже выполнена выше в секции "Обработка 2"
      const VALID_INVOICE_TYPES = ['70', '71', '72', 'proforma'];
      const isValidProformaType = VALID_INVOICE_TYPES.includes(normalizedInvoiceType);
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
    if (isWorkflowAutomation && currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      
      // Stripe trigger (75)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      if (normalizedInvoiceType === STRIPE_TRIGGER_VALUE) {
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

      // Валидные типы инвойсов (70, 71, 72)
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      if (VALID_INVOICE_TYPES.includes(normalizedInvoiceType)) {
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

