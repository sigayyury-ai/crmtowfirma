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

    // Обрабатываем события Checkout Session (создание сессии)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        logger.info(`💳 Обработка Checkout Session | Deal: ${dealId} | Session: ${session.id}`);
        
        try {
          // Обрабатываем платеж через processor (автоматически обновляет стадии)
          // persistSession обрабатывает платеж и обновляет стадии сделки на основе типа платежа:
          // - Первый платеж (deposit) → Second Payment (ID: 32) или Camp Waiter (ID: 27) если один платеж
          // - Второй платеж (rest) → Camp Waiter (ID: 27)
          // - Единый платеж (single) → Camp Waiter (ID: 27)
          await stripeProcessor.persistSession(session);
          
          logger.info(`✅ Checkout Session обработан | Deal: ${dealId} | Session: ${session.id}`);
        } catch (error) {
          logger.error(`❌ Ошибка обработки Checkout Session | Deal: ${dealId} | Session: ${session.id}`, { error: error.message });
        }
      } else {
        logger.warn(`⚠️  Deal ID не найден в Checkout Session | Session: ${session.id}`);
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
            logger.info(`✅ Платеж успешен | Deal: ${dealId} | Session: ${sessionId}`);
            
            // Обрабатываем платеж через processor (автоматически обновляет стадии)
            await stripeProcessor.persistSession(session);
            
            logger.info(`✅ Payment Intent обработан | Deal: ${dealId} | Session: ${sessionId}`);
          } else {
            logger.warn(`⚠️  Deal ID не найден в Session | Session: ${sessionId}`);
          }
        } catch (sessionError) {
          logger.error(`❌ Ошибка получения Session | PaymentIntent: ${paymentIntent.id}`, { error: sessionError.message });
        }
      } else {
        logger.warn(`⚠️  Session ID не найден в Payment Intent | PaymentIntent: ${paymentIntent.id}`);
      }
    }

    // Обрабатываем события Charge Refunded (возврат платежа)
    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const paymentIntentId = charge.payment_intent;
      
      if (paymentIntentId) {
        try {
          const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
          const sessionId = paymentIntent.metadata?.session_id;
          
          if (sessionId) {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
            const dealId = session.metadata?.deal_id;
            
            if (dealId) {
              logger.info(`💰 Обработка возврата платежа | Deal: ${dealId} | Charge: ${charge.id}`);
              
              // Обрабатываем возврат через CRM sync (автоматически обновляет стадии)
              await stripeProcessor.crmSyncService.handleRefund({
                id: charge.id,
                amount: charge.amount,
                metadata: session.metadata
              });
              
              logger.info(`✅ Возврат обработан | Deal: ${dealId} | Charge: ${charge.id}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Ошибка обработки возврата | Charge: ${charge.id}`, { error: error.message });
        }
      }
    }

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
