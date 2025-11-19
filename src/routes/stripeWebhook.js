const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const StripeProcessorService = require('../services/stripe/processor');
const { getStripeClient } = require('../services/stripe/client');

const stripeProcessor = new StripeProcessorService();
const stripe = getStripeClient();

/**
 * POST /api/webhooks/stripe
 * Обработка webhook событий от Stripe
 * Отслеживает invoice_type = Stripe и обновляет статус в Pipedrive
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('Stripe webhook secret not configured');
    return res.status(400).json({ error: 'Webhook secret not configured' });
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    logger.info(`📥 Stripe webhook получен | Тип: ${event.type}`);

    // ВРЕМЕННО: Только создаем задачу для тестирования webhook'ов
    // Весь остальной код закомментирован для постепенной разработки
    
    let dealId = null;
    
    // Извлекаем deal_id из разных типов событий
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      dealId = session.metadata?.deal_id;
    } else if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const sessionId = paymentIntent.metadata?.session_id;
      if (sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          dealId = session.metadata?.deal_id;
        } catch (sessionError) {
          logger.error(`❌ Ошибка получения Session | PaymentIntent: ${paymentIntent.id}`, { error: sessionError.message });
        }
      }
    }
    
    // Создаем задачу в сделке, для которой пришел webhook
    if (dealId) {
      try {
        await stripeProcessor.pipedriveClient.createTask({
          deal_id: parseInt(dealId),
          subject: 'Сработал хук',
          due_date: new Date().toISOString().split('T')[0]
        });
        logger.info(`✅ Задача создана | Deal: ${dealId}`);
      } catch (taskError) {
        logger.error(`❌ Ошибка создания задачи | Deal: ${dealId}`, { error: taskError.message });
      }
    }

    /* ЗАКОММЕНТИРОВАНО: Полная обработка Stripe webhook событий
    // Обрабатываем события Checkout Session
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        // Проверяем, что invoice_type = Stripe перед обработкой
        try {
          const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
          if (dealResult.success && dealResult.deal) {
            const currentInvoiceType = String(dealResult.deal[stripeProcessor.invoiceTypeFieldKey] || '').trim();
            const stripeTriggerValue = stripeProcessor.stripeTriggerValue;
            
            // Обрабатываем только если invoice_type = Stripe
            if (currentInvoiceType === stripeTriggerValue) {
              logger.info(`💳 Обработка Checkout Session | Deal: ${dealId} | Session: ${session.id}`);
              
              // Обрабатываем платеж через processor
              await stripeProcessor.persistSession(session);
              
              // Если платеж оплачен, обновляем invoice_type на "Done"
              if (session.payment_status === 'paid') {
                try {
                  await stripeProcessor.pipedriveClient.updateDeal(dealId, {
                    [stripeProcessor.invoiceTypeFieldKey]: stripeProcessor.invoiceDoneValue
                  });
                  logger.info(`✅ invoice_type обновлен на Done | Deal: ${dealId}`);
                } catch (updateError) {
                  logger.error(`❌ Ошибка обновления invoice_type на Done | Deal: ${dealId}`, { error: updateError.message });
                }
              }
            } else {
              logger.info(`⏭️  Пропуск Checkout Session | Deal: ${dealId} | invoice_type: ${currentInvoiceType} (ожидается: ${stripeTriggerValue})`);
            }
          } else {
            logger.warn(`⚠️  Сделка не найдена | Deal: ${dealId}`);
          }
        } catch (dealError) {
          logger.error(`❌ Ошибка получения сделки | Deal: ${dealId}`, { error: dealError.message });
        }
      }
    }

    // Обрабатываем события Payment Intent (оплата завершена)
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const sessionId = paymentIntent.metadata?.session_id;
      
      if (sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const dealId = session.metadata?.deal_id;
          
          if (dealId) {
            // Проверяем, что invoice_type = Stripe перед обработкой
            try {
              const dealResult = await stripeProcessor.pipedriveClient.getDeal(dealId);
              if (dealResult.success && dealResult.deal) {
                const currentInvoiceType = String(dealResult.deal[stripeProcessor.invoiceTypeFieldKey] || '').trim();
                const stripeTriggerValue = stripeProcessor.stripeTriggerValue;
                
                // Обрабатываем только если invoice_type = Stripe
                if (currentInvoiceType === stripeTriggerValue) {
                  logger.info(`✅ Платеж успешен | Deal: ${dealId} | Session: ${sessionId}`);
                  
                  // Обрабатываем платеж (если еще не обработан)
                  await stripeProcessor.persistSession(session);
                  
                  // Обновляем invoice_type на "Done" (73) после успешной оплаты
                  try {
                    await stripeProcessor.pipedriveClient.updateDeal(dealId, {
                      [stripeProcessor.invoiceTypeFieldKey]: stripeProcessor.invoiceDoneValue
                    });
                    logger.info(`✅ invoice_type обновлен на Done | Deal: ${dealId}`);
                  } catch (updateError) {
                    logger.error(`❌ Ошибка обновления invoice_type на Done | Deal: ${dealId}`, { error: updateError.message });
                  }
                } else {
                  logger.info(`⏭️  Пропуск Payment Intent | Deal: ${dealId} | invoice_type: ${currentInvoiceType} (ожидается: ${stripeTriggerValue})`);
                }
              } else {
                logger.warn(`⚠️  Сделка не найдена | Deal: ${dealId}`);
              }
            } catch (dealError) {
              logger.error(`❌ Ошибка получения сделки | Deal: ${dealId}`, { error: dealError.message });
            }
          }
        } catch (sessionError) {
          logger.error(`❌ Ошибка получения Session | PaymentIntent: ${paymentIntent.id}`, { error: sessionError.message });
        }
      }
    }
    */

    res.status(200).json({ received: true });
  } catch (error) {
    logger.error('❌ Ошибка обработки Stripe webhook', { 
      eventType: event.type, 
      error: error.message 
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
