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
router.post('/webhooks/pipedrive', express.json(), async (req, res) => {
  try {
    const webhookData = req.body;
    const timestamp = new Date().toISOString();
    
    // Сохраняем событие в историю для отладки
    const webhookEvent = {
      timestamp,
      event: webhookData.event,
      dealId: webhookData.current?.id || 
              webhookData.previous?.id || 
              webhookData['Deal ID'] || 
              webhookData['Deal_id'] ||
              webhookData.dealId ||
              webhookData.deal_id,
      bodyKeys: Object.keys(webhookData),
      body: webhookData // Сохраняем полное тело для отладки
    };
    
    webhookHistory.unshift(webhookEvent); // Добавляем в начало
    if (webhookHistory.length > MAX_HISTORY_SIZE) {
      webhookHistory.pop(); // Удаляем старые события
    }
    
    // Log webhook received
    const eventType = webhookData.event || 'workflow_automation';
    logger.info(`📥 Webhook получен: ${eventType} | Deal ID: ${webhookEvent.dealId}`, {
      event: webhookData.event,
      dealId: webhookEvent.dealId,
      bodyKeys: webhookEvent.bodyKeys,
      timestamp
    });

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
      const hasStage = webhookData['Deal stage'] !== undefined || 
                      webhookData['Deal_stage'] !== undefined ||
                      webhookData['deal_stage'] !== undefined ||
                      webhookData['stage_id'] !== undefined;
      const hasStatus = webhookData['Deal status'] !== undefined || 
                       webhookData['Deal_status'] !== undefined ||
                       webhookData['deal_status'] !== undefined ||
                       webhookData['status'] !== undefined;
      
      // Если есть все необходимые данные, используем их без запроса к API
      if (hasInvoiceType && hasStage && hasStatus) {
        logger.info(`✅ Webhook содержит все данные, используем без запроса к API | Deal ID: ${dealId}`, {
          dealId,
          hasInvoiceType,
          hasStage,
          hasStatus
        });
        
        // Собираем данные сделки из webhook
        // Поддержка разных форматов названий полей из Pipedrive workflow automation
        currentDeal = {
          id: dealId,
          stage_id: webhookData['Deal stage'] || 
                   webhookData['Deal_stage'] || 
                   webhookData['deal_stage'] || 
                   webhookData['stage_id'],
          stage_name: webhookData['Deal stage'] || 
                     webhookData['Deal_stage'] || 
                     webhookData['deal_stage'] || 
                     webhookData['stage_name'],
          status: webhookData['Deal status'] || 
                 webhookData['Deal_status'] || 
                 webhookData['deal_status'] || 
                 webhookData['status'],
          [INVOICE_TYPE_FIELD_KEY]: webhookData['Invoice type'] || 
                                    webhookData['Invoice'] ||
                                    webhookData['invoice_type'] || 
                                    webhookData['invoice'] ||
                                    webhookData[INVOICE_TYPE_FIELD_KEY],
          value: webhookData['Deal value'] || 
                webhookData['Deal_value'] ||
                webhookData['deal_value'] || 
                webhookData['value'],
          currency: webhookData['Deal currency'] || 
                   webhookData['Deal_currency'] ||
                   webhookData['deal_currency'] || 
                   webhookData['currency'] ||
                   webhookData['Currency'],
          expected_close_date: webhookData['Expected close date'] || 
                               webhookData['Deal_close_date'] ||
                               webhookData['expected_close_date'] || 
                               webhookData['expectedCloseDate'],
          close_date: webhookData['Deal_close_date'] ||
                     webhookData['Deal closed date'] ||
                     webhookData['close_date'],
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
          lost_reason: webhookData['Deal_lost_reason'] ||
                      webhookData['Deal lost reason'] ||
                      webhookData['lost_reason'] ||
                      webhookData['lostReason'],
          [INVOICE_NUMBER_FIELD_KEY]: webhookData['Invoice number'] ||
                                     webhookData['Invoice_number'] ||
                                     webhookData['invoice_number'] ||
                                     webhookData['invoiceNumber'] ||
                                     webhookData[INVOICE_NUMBER_FIELD_KEY] ||
                                     webhookData['Invoice'] // Fallback на поле Invoice, если там номер
        };
        
        // Предыдущая стадия (если доступна)
        const previousStageId = webhookData['Previous deal stage'] || 
                                webhookData['Previous_deal_stage'] ||
                                webhookData['previous_deal_stage'] || 
                                webhookData['previous_stage_id'];
        if (previousStageId) {
          previousDeal = {
            stage_id: previousStageId
          };
        } else {
          previousDeal = null;
        }
        
        logger.debug('Parsed deal data from workflow automation webhook', {
          dealId,
          stageId: currentDeal.stage_id,
          status: currentDeal.status,
          invoiceType: currentDeal[INVOICE_TYPE_FIELD_KEY],
          personId: currentDeal.person_id,
          organizationId: currentDeal.organization_id
        });
      } else {
        // Если данных недостаточно, получаем полные данные сделки из Pipedrive API
        logger.info(`📡 Webhook содержит неполные данные, запрашиваем полные данные сделки | Deal ID: ${dealId}`, {
          dealId,
          hasInvoiceType,
          hasStage,
          hasStatus
        });

        try {
          const dealResult = await invoiceProcessing.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            logger.error('Failed to fetch deal data from workflow automation webhook', {
              dealId,
              error: dealResult.error
            });
            return res.status(400).json({ 
              success: false, 
              error: `Failed to fetch deal: ${dealResult.error || 'unknown'}` 
            });
          }
          currentDeal = dealResult.deal;
          // Для workflow automation нет previousDeal, так как мы не знаем предыдущее состояние
          previousDeal = null;
        } catch (error) {
          logger.error('Error fetching deal data from workflow automation webhook', {
            dealId,
            error: error.message
          });
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
        
        logger.info(`🗑️  Сделка удалена, начинаем удаление проформ | Deal ID: ${dealId}`, {
          dealId,
          event: webhookData.event
        });
        
        try {
          // Получаем данные сделки перед удалением для поиска проформ
          const dealResult = await invoiceProcessing.pipedriveClient.getDeal(dealId);
          const deal = dealResult.success && dealResult.deal ? dealResult.deal : deletedDeal;
          
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, deal);
          if (result.success) {
            logger.info(`✅ Проформы удалены для удаленной сделки | Deal ID: ${dealId}`, {
              dealId,
              success: result.success
            });
          } else {
            logger.warn(`⚠️  Не удалось удалить проформы для удаленной сделки | Deal ID: ${dealId} | Ошибка: ${result.error || 'неизвестная'}`, {
              dealId,
              success: result.success,
              error: result.error
            });
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Proformas deleted' : result.error,
            dealId
          });
        } catch (error) {
          logger.error('Failed to delete proformas for deleted deal via webhook', {
            dealId,
            error: error.message,
            stack: error.stack
          });
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
    
    // Get invoice_type values
    const currentInvoiceType = currentDeal[INVOICE_TYPE_FIELD_KEY];
    
    // Get status
    const currentStatus = currentDeal.status;
    
    // Get stage
    const currentStageId = currentDeal.stage_id;
    // Проверяем все возможные варианты названия стадии из webhook'а и из currentDeal
    // Сначала проверяем webhookData (оригинальные данные), потом currentDeal
    const currentStageName = (webhookData && (webhookData['Deal stage'] || webhookData['Deal_stage'] || webhookData['deal_stage'])) ||
                            currentDeal.stage_name || 
                            currentDeal['Deal stage'] || 
                            currentDeal['Deal_stage'] ||
                            currentDeal['deal_stage'];
    
    // Get lost_reason
    const lostReason = currentDeal.lost_reason || currentDeal.lostReason || currentDeal['lost_reason'];
    
    // Debug logging
    const statusEmoji = currentStatus === 'lost' ? '❌' : currentStatus === 'won' ? '✅' : '🔄';
    logger.info(`${statusEmoji} Проверка статуса сделки | Deal ID: ${dealId} | Статус: ${currentStatus || 'не указан'} | Причина потери: ${lostReason || 'нет'} | Invoice Type: ${currentInvoiceType || 'не указан'}`, {
      dealId,
      currentStatus,
      lostReason,
      currentInvoiceType,
      isWorkflowAutomation,
      currentDealKeys: currentDeal ? Object.keys(currentDeal) : [],
      hasStatus: !!currentDeal?.status,
      statusValue: currentDeal?.status
    });

    // ========== Обработка 1: Статус "lost" (приоритет) ==========
    // Проверяем статус lost ПЕРЕД обработкой invoice_type, так как это более критично
    if (currentStatus === 'lost') {
      const normalizedLostReason = lostReason ? String(lostReason).trim().toLowerCase() : '';
      const isRefundReason = normalizedLostReason === 'refund' || normalizedLostReason === 'refound';
      
      const reasonText = normalizedLostReason || 'не указана';
      logger.info(`❌ Сделка закрыта как потерянная | Deal ID: ${dealId} | Причина: ${reasonText} | Рефанд: ${isRefundReason ? 'да' : 'нет'}`, {
        dealId,
        currentStatus,
        lostReason: normalizedLostReason,
        isRefundReason,
        isWorkflowAutomation
      });

      if (isRefundReason) {
        logger.info(`💰 Обработка рефандов для потерянной сделки | Deal ID: ${dealId} | Причина: ${normalizedLostReason}`, {
          dealId,
          currentStatus,
          lostReason: normalizedLostReason,
          isWorkflowAutomation
        });

        const summary = {
          totalDeals: 1,
          refundsCreated: 0,
          errors: []
        };

        try {
          await stripeProcessor.refundDealPayments(dealId, summary);
          
          logger.info(`✅ Рефанды обработаны | Deal ID: ${dealId} | Создано рефандов: ${summary.refundsCreated}${summary.errors.length > 0 ? ` | Ошибки: ${summary.errors.length}` : ''}`, {
            dealId,
            refundsCreated: summary.refundsCreated,
            errors: summary.errors
          });

          return res.status(200).json({
            success: true,
            message: 'Refunds processed',
            dealId,
            refundsCreated: summary.refundsCreated,
            errors: summary.errors
          });
        } catch (error) {
          logger.error('Failed to process refunds for lost deal via webhook', {
            dealId,
            error: error.message,
            stack: error.stack
          });
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
        } else {
        // Если lost_reason не "Refund", удаляем проформы
        logger.info(`🗑️  Удаление проформ для потерянной сделки (не рефанд) | Deal ID: ${dealId} | Причина: ${normalizedLostReason || 'не указана'}`, {
          dealId,
          currentStatus,
          lostReason: normalizedLostReason,
          isWorkflowAutomation
        });

        try {
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
          if (result.success) {
            logger.info(`✅ Проформы удалены | Deal ID: ${dealId}`, {
              dealId,
              success: result.success
            });
          } else {
            logger.warn(`⚠️  Не удалось удалить проформы | Deal ID: ${dealId} | Ошибка: ${result.error || 'неизвестная'}`, {
              dealId,
              success: result.success,
              error: result.error
            });
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Proformas deleted' : result.error,
            dealId
          });
        } catch (error) {
          logger.error('Failed to delete proformas for lost deal via webhook', {
            dealId,
            error: error.message,
            stack: error.stack
          });
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }
    }

    // ========== Обработка 2: Стадия "First payment" (триггер для Stripe) ==========
    // Если сделка попадает в стадию "First payment", создаем Stripe Checkout Session
    const isFirstPaymentStage = String(currentStageId) === String(STAGES.FIRST_PAYMENT_ID);
    
    if (isFirstPaymentStage && currentStatus !== 'lost') {
      logger.info(`💳 Триггер: стадия "First payment" | Deal ID: ${dealId} | Stage: ${currentStageName || currentStageId}`, {
        dealId,
        stageId: currentStageId,
        stageName: currentStageName,
        status: currentStatus
      });

      try {
        // Проверяем, есть ли уже Checkout Sessions для этой сделки
        const existingPayments = await stripeProcessor.repository.listPayments({
          dealId: String(dealId),
          limit: 10
        });

        if (!existingPayments || existingPayments.length === 0) {
          // Если нет Checkout Sessions, создаем их
          logger.info(`💳 Создание Stripe Checkout Sessions для стадии "First payment" | Deal ID: ${dealId}`, { 
            dealId 
          });
          
          const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            throw new Error(`Failed to fetch deal: ${dealResult.error || 'unknown'}`);
          }

          const result = await stripeProcessor.createCheckoutSessionForDeal(dealResult.deal, {
            trigger: 'first_payment_stage',
            runId: `first-payment-${Date.now()}`
          });

          if (result.success) {
            logger.info(`✅ Stripe Checkout Session создана для стадии "First payment" | Deal ID: ${dealId} | Session ID: ${result.sessionId}`, {
              dealId,
              sessionId: result.sessionId
            });
            return res.status(200).json({
              success: true,
              message: 'Stripe Checkout Session created for First payment stage',
              dealId,
              sessionId: result.sessionId
            });
          } else {
            logger.error(`❌ Не удалось создать Stripe Checkout Session для стадии "First payment" | Deal ID: ${dealId} | Ошибка: ${result.error}`, {
              dealId,
              error: result.error,
              resultKeys: Object.keys(result || {})
            });
            return res.status(200).json({
              success: false,
              error: result.error,
              dealId
            });
          }
        } else {
          logger.info(`ℹ️  Stripe Checkout Sessions уже существуют для стадии "First payment" | Deal ID: ${dealId} | Существующих: ${existingPayments.length}`, {
            dealId,
            existingCount: existingPayments.length
          });
          return res.status(200).json({
            success: true,
            message: 'Checkout Sessions already exist',
            dealId,
            existingCount: existingPayments.length
          });
        }
      } catch (error) {
        logger.error(`❌ Ошибка обработки триггера "First payment" | Deal ID: ${dealId} | Ошибка: ${error.message}`, {
          dealId,
          error: error.message,
          stack: error.stack
        });
        return res.status(200).json({
          success: false,
          error: error.message,
          dealId
        });
      }
    }

    // ========== Обработка 3: invoice_type ==========
    // Упрощенная логика: обрабатываем invoice_type всегда, когда он установлен
    // Не проверяем previousInvoiceType, так как он может быть недостоверным
    if (currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      
      // Stripe trigger (75)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      if (normalizedInvoiceType === STRIPE_TRIGGER_VALUE) {
        logger.info(`💳 Создание Stripe Checkout Session | Deal ID: ${dealId} | Invoice Type: ${currentInvoiceType}`, {
          dealId,
          currentInvoiceType
        });

        try {
          // Получаем сделку для создания Checkout Session
          const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
          if (!dealResult.success || !dealResult.deal) {
            throw new Error(`Failed to fetch deal: ${dealResult.error || 'unknown'}`);
          }

          // Создаем Checkout Session для этой сделки
          const result = await stripeProcessor.createCheckoutSessionForDeal(dealResult.deal, {
            trigger: 'pipedrive_webhook',
            runId: `webhook-${Date.now()}`
          });

          if (result.success) {
            logger.info(`✅ Stripe Checkout Session создана | Deal ID: ${dealId} | Session ID: ${result.sessionId}`, {
              dealId,
              sessionId: result.sessionId
            });
            return res.status(200).json({
              success: true,
              message: 'Checkout Session created',
              dealId,
              sessionId: result.sessionId
            });
          } else {
            logger.error(`❌ Не удалось создать Stripe Checkout Session | Deal ID: ${dealId} | Ошибка: ${result.error}`, {
              dealId,
              error: result.error
            });
            return res.status(200).json({
              success: false,
              error: result.error,
              dealId
            });
          }
        } catch (error) {
          logger.error('Error creating Checkout Session via webhook', {
            dealId,
            error: error.message,
            stack: error.stack
          });
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }

      // Delete trigger (74 или "delete")
      const DELETE_TRIGGER_VALUES = new Set(['delete', '74']);
      if (DELETE_TRIGGER_VALUES.has(normalizedInvoiceType)) {
        logger.info(`🗑️  Удаление проформ по invoice_type | Deal ID: ${dealId} | Invoice Type: ${currentInvoiceType}`, {
          dealId,
          currentInvoiceType
        });

        try {
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
          if (result.success) {
            logger.info(`✅ Проформы удалены по invoice_type | Deal ID: ${dealId}`, {
              dealId,
              success: result.success
            });
          } else {
            logger.warn(`⚠️  Не удалось удалить проформы по invoice_type | Deal ID: ${dealId} | Ошибка: ${result.error || 'неизвестная'}`, {
              dealId,
              success: result.success,
              error: result.error
            });
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Deletion processed' : result.error,
            dealId
          });
        } catch (error) {
          logger.error('Error processing deal deletion via webhook', {
            dealId,
            error: error.message,
            stack: error.stack
          });
          return res.status(200).json({
            success: false,
            error: error.message,
            dealId
          });
        }
      }

      // Валидные типы инвойсов (70, 71, 72)
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      if (VALID_INVOICE_TYPES.includes(normalizedInvoiceType)) {
        logger.info(`📄 Создание проформы | Deal ID: ${dealId} | Invoice Type: ${currentInvoiceType}`, {
          dealId,
          currentInvoiceType
        });

        try {
          const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId);
          if (result.success) {
            logger.info(`✅ Проформа создана | Deal ID: ${dealId} | Invoice Type: ${result.invoiceType || currentInvoiceType}`, {
              dealId,
              success: result.success,
              invoiceType: result.invoiceType
            });
          } else {
            logger.warn(`⚠️  Не удалось создать проформу | Deal ID: ${dealId} | Ошибка: ${result.error || 'неизвестная'}`, {
              dealId,
              success: result.success,
              error: result.error
            });
          }
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Invoice processed' : result.error,
            dealId,
            invoiceType: result.invoiceType
          });
        } catch (error) {
          logger.error(`❌ Ошибка при создании проформы | Deal ID: ${dealId} | Ошибка: ${error.message}`, {
            dealId,
            error: error.message,
            stack: error.stack
          });
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
        logger.info(`💳 Workflow automation: проверка Stripe Checkout Sessions | Deal ID: ${dealId} | Invoice Type: ${currentInvoiceType} | Stage: ${currentDeal.stage_id}`, {
          dealId,
          currentInvoiceType,
          stageId: currentDeal.stage_id
        });

        // Проверяем, есть ли уже Checkout Sessions для этой сделки
        try {
          const existingPayments = await stripeProcessor.repository.listPayments({
            dealId: String(dealId),
            limit: 10
          });

          if (!existingPayments || existingPayments.length === 0) {
            // Если нет Checkout Sessions, создаем их
            logger.info(`💳 Создание Stripe Checkout Sessions (workflow automation) | Deal ID: ${dealId}`, { dealId });
            const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
            if (dealResult.success && dealResult.deal) {
              const result = await stripeProcessor.createCheckoutSessionForDeal(dealResult.deal, {
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
          logger.error(`❌ Ошибка обработки Stripe триггера (workflow automation) | Deal ID: ${dealId} | Ошибка: ${error.message}`, {
            dealId,
            error: error.message
          });
        }
      }

      // Валидные типы инвойсов (70, 71, 72)
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      if (VALID_INVOICE_TYPES.includes(normalizedInvoiceType)) {
        logger.info(`📄 Workflow automation: создание проформы | Deal ID: ${dealId} | Invoice Type: ${currentInvoiceType} | Stage: ${currentDeal.stage_id}`, {
          dealId,
          currentInvoiceType,
          stageId: currentDeal.stage_id
        });

        try {
          const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId);
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
      invoiceTypeChanged,
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
    logger.error('Error processing Pipedrive webhook', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });

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
      bodyKeys: event.bodyKeys,
      // Показываем только ключи тела, не полное содержимое (может быть большим)
      bodyPreview: Object.keys(event.body).reduce((acc, key) => {
        const value = event.body[key];
        if (typeof value === 'object' && value !== null) {
          acc[key] = Array.isArray(value) ? `[Array(${value.length})]` : '{...}';
        } else {
          acc[key] = String(value).substring(0, 100); // Ограничиваем длину
        }
        return acc;
      }, {})
    }))
  });
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

