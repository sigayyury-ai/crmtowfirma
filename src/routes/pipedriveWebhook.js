const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const InvoiceProcessingService = require('../services/invoiceProcessing');
const logger = require('../utils/logger');

const stripeProcessor = new StripeProcessorService();
const invoiceProcessing = new InvoiceProcessingService();

/**
 * POST /api/webhooks/pipedrive
 * Webhook endpoint for Pipedrive deal updates
 * Обрабатывает триггеры:
 * 1. Изменение invoice_type → создание инвойса или Stripe Checkout Session
 * 2. Изменение статуса на "lost" с reason "Refund" → обработка рефандов
 * 3. Изменение invoice_type на "delete"/"74" → удаление инвойсов
 */
router.post('/webhooks/pipedrive', express.json(), async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Log webhook received
    logger.info('Pipedrive webhook received', {
      event: webhookData.event,
      dealId: webhookData.current?.id || 
              webhookData.previous?.id || 
              webhookData['Deal ID'] || 
              webhookData['Deal_id'] ||
              webhookData.dealId ||
              webhookData.deal_id,
      bodyKeys: Object.keys(webhookData),
      timestamp: new Date().toISOString()
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
        logger.info('Webhook from workflow automation with full data, using provided data', {
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
                      webhookData['lostReason']
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
        logger.info('Webhook from workflow automation with partial data, fetching full deal data', {
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
      // Check if this is a deal update event
      if (!webhookData.event || (!webhookData.event.includes('deal') && !webhookData.event.includes('updated'))) {
        logger.debug('Webhook event is not a deal update, skipping', {
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
    const previousInvoiceType = previousDeal?.[INVOICE_TYPE_FIELD_KEY];
    
    // Get status
    const currentStatus = currentDeal.status;
    const previousStatus = previousDeal?.status;
    
    // Get lost_reason
    const lostReason = currentDeal.lost_reason || currentDeal.lostReason || currentDeal['lost_reason'];

    // ========== Обработка 1: Изменение invoice_type ==========
    // Для workflow automation проверяем только текущее значение (без сравнения с предыдущим)
    const invoiceTypeChanged = isWorkflowAutomation 
      ? !!currentInvoiceType  // Если пришел webhook от workflow, проверяем наличие invoice_type
      : (currentInvoiceType !== previousInvoiceType && previousInvoiceType !== undefined);
    
    if (invoiceTypeChanged && currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      
      // Stripe trigger (75)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      if (normalizedInvoiceType === STRIPE_TRIGGER_VALUE) {
        logger.info('Invoice type changed to Stripe trigger, creating Checkout Session', {
          dealId,
          previousInvoiceType,
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
            logger.info('Checkout Session created via webhook', {
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
            logger.error('Failed to create Checkout Session via webhook', {
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
        logger.info('Invoice type changed to delete trigger, processing deletion', {
          dealId,
          previousInvoiceType,
          currentInvoiceType
        });

        try {
          const result = await invoiceProcessing.processDealDeletionByWebhook(dealId, currentDeal);
          logger.info('Deal deletion processed via webhook', {
            dealId,
            success: result.success
          });
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
        logger.info('Invoice type changed to valid type, processing invoice creation', {
          dealId,
          previousInvoiceType,
          currentInvoiceType
        });

        try {
          const result = await invoiceProcessing.processDealInvoiceByWebhook(dealId);
          logger.info('Invoice processed via webhook', {
            dealId,
            success: result.success
          });
          return res.status(200).json({
            success: result.success,
            message: result.success ? 'Invoice processed' : result.error,
            dealId,
            invoiceType: result.invoiceType
          });
        } catch (error) {
          logger.error('Error processing invoice via webhook', {
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

    // ========== Обработка 2: Изменение статуса на "lost" с reason "Refund" ==========
    // Проверяем два случая:
    // 1. Стандартный webhook: статус изменился с "open" на "lost"
    // 2. Workflow automation: webhook приходит с Deal_status = "lost" и Deal_lost_reason = "Refund"
    const statusChangedToLost = 
      currentStatus === 'lost' && 
      previousStatus !== 'lost' &&
      previousStatus !== undefined &&
      previousStatus !== null;

    // Для workflow automation: если статус уже "lost" и есть reason "Refund"
    const isLostWithRefund = 
      currentStatus === 'lost' && 
      (isWorkflowAutomation || previousStatus === undefined || previousStatus === null);

    if (statusChangedToLost || isLostWithRefund) {
      const normalizedLostReason = lostReason ? String(lostReason).trim().toLowerCase() : '';
      const isRefundReason = normalizedLostReason === 'refund' || normalizedLostReason === 'refound';

      if (isRefundReason) {
        logger.info('Deal status is lost with Refund reason, processing refunds', {
          dealId,
          previousStatus,
          currentStatus,
          lostReason: normalizedLostReason,
          isWorkflowAutomation,
          trigger: statusChangedToLost ? 'status_changed' : 'workflow_automation'
        });

        const summary = {
          totalDeals: 1,
          refundsCreated: 0,
          errors: []
        };

        try {
          await stripeProcessor.refundDealPayments(dealId, summary);
          
          logger.info('Refunds processed for lost deal via webhook', {
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
        logger.debug('Deal lost but reason is not "Refund", skipping refund processing', {
          dealId,
          lostReason: normalizedLostReason,
          currentStatus
        });
      }
    }

    // ========== Обработка 3: Workflow automation - проверка invoice_type при изменении стадии ==========
    // Если webhook пришел от workflow automation (изменение стадии), проверяем invoice_type
    if (isWorkflowAutomation && currentInvoiceType) {
      const normalizedInvoiceType = String(currentInvoiceType).trim().toLowerCase();
      
      // Stripe trigger (75)
      const STRIPE_TRIGGER_VALUE = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75').trim();
      if (normalizedInvoiceType === STRIPE_TRIGGER_VALUE) {
        logger.info('Workflow automation: Deal in payment stage with Stripe trigger, checking Checkout Sessions', {
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
            logger.info('No Checkout Sessions found, creating them', { dealId });
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
          logger.error('Error processing Stripe trigger from workflow automation', {
            dealId,
            error: error.message
          });
        }
      }

      // Валидные типы инвойсов (70, 71, 72)
      const VALID_INVOICE_TYPES = ['70', '71', '72'];
      if (VALID_INVOICE_TYPES.includes(normalizedInvoiceType)) {
        logger.info('Workflow automation: Deal in payment stage with invoice type, processing invoice', {
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
          logger.error('Error processing invoice from workflow automation', {
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
      statusChangedToLost,
      currentInvoiceType,
      currentStatus,
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

module.exports = router;

