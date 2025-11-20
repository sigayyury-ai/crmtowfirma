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
    logger.warn('Stripe webhook secret not configured', {
      hint: 'Add STRIPE_WEBHOOK_SECRET environment variable in Render Dashboard',
      documentation: 'See docs/render-stripe-webhook-secret.md for instructions'
    });
    return res.status(400).json({ 
      error: 'Webhook secret not configured',
      hint: 'STRIPE_WEBHOOK_SECRET environment variable is missing. Add it in Render Dashboard → Environment → Environment Variables'
    });
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
          // Обновляем статус платежа в базе данных
          await stripeProcessor.repository.updatePaymentStatus(session.id, session.payment_status || 'paid');
          
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

    // Обрабатываем события асинхронных платежей (банковские переводы и т.д.)
    if (event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        logger.info(`💳 Обработка асинхронного платежа (успешно) | Deal: ${dealId} | Session: ${session.id}`);
        
        try {
          // Обновляем статус платежа в базе данных
          await stripeProcessor.repository.updatePaymentStatus(session.id, session.payment_status || 'paid');
          
          // Обрабатываем платеж через processor (автоматически обновляет стадии)
          await stripeProcessor.persistSession(session);
          
          logger.info(`✅ Асинхронный платеж обработан | Deal: ${dealId} | Session: ${session.id}`);
        } catch (error) {
          logger.error(`❌ Ошибка обработки асинхронного платежа | Deal: ${dealId} | Session: ${session.id}`, { error: error.message });
        }
      } else {
        logger.warn(`⚠️  Deal ID не найден в Checkout Session | Session: ${session.id}`);
      }
    }

    // Обрабатываем события неудачных асинхронных платежей
    if (event.type === 'checkout.session.async_payment_failed') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        logger.info(`❌ Обработка неудачного асинхронного платежа | Deal: ${dealId} | Session: ${session.id}`);
        
        try {
          // Обновляем статус платежа в базе данных
          await stripeProcessor.repository.updatePaymentStatus(session.id, session.payment_status || 'unpaid');
          
          logger.info(`✅ Статус неудачного платежа обновлен | Deal: ${dealId} | Session: ${session.id}`);
        } catch (error) {
          logger.error(`❌ Ошибка обновления статуса неудачного платежа | Deal: ${dealId} | Session: ${session.id}`, { error: error.message });
        }
      } else {
        logger.warn(`⚠️  Deal ID не найден в Checkout Session | Session: ${session.id}`);
      }
    }

    // Обрабатываем события истечения сессии
    if (event.type === 'checkout.session.expired') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        logger.info(`⏰ Обработка истечения сессии | Deal: ${dealId} | Session: ${session.id}`);
        
        try {
          // Обновляем статус платежа в базе данных
          await stripeProcessor.repository.updatePaymentStatus(session.id, session.payment_status || 'unpaid');
          
          logger.info(`✅ Статус истекшей сессии обновлен | Deal: ${dealId} | Session: ${session.id}`);
        } catch (error) {
          logger.error(`❌ Ошибка обновления статуса истекшей сессии | Deal: ${dealId} | Session: ${session.id}`, { error: error.message });
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
            
            // Обновляем статус платежа в базе данных
            await stripeProcessor.repository.updatePaymentStatus(sessionId, session.payment_status || 'paid');
            
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

    // Обрабатываем события неудачных платежей
    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      const sessionId = paymentIntent.metadata?.session_id;
      
      if (sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const dealId = session.metadata?.deal_id;
          
          if (dealId) {
            logger.info(`❌ Платеж не удался | Deal: ${dealId} | Session: ${sessionId} | PaymentIntent: ${paymentIntent.id}`);
            
            // Обновляем статус платежа в базе данных
            await stripeProcessor.repository.updatePaymentStatus(sessionId, session.payment_status || 'unpaid');
            
            logger.info(`✅ Статус неудачного платежа обновлен | Deal: ${dealId} | Session: ${sessionId}`);
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

    // Обрабатываем события Charge Updated (обновление статуса платежа)
    // Это событие приходит когда charge обновляется (например, когда мы добавляем receipt_email или VAT breakdown)
    if (event.type === 'charge.updated') {
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
              logger.info(`🔄 Обработка обновления платежа | Deal: ${dealId} | Charge: ${charge.id} | Status: ${charge.status}`);
              
              // Обновляем статус платежа в базе данных на основе статуса charge
              const paymentStatus = charge.status === 'succeeded' ? 'paid' : 
                                   charge.status === 'pending' ? 'pending' : 
                                   charge.status === 'failed' ? 'unpaid' : 'unpaid';
              
              await stripeProcessor.repository.updatePaymentStatus(sessionId, paymentStatus);
              
              // Если платеж успешен, обрабатываем через persistSession для отправки email и добавления VAT breakdown
              if (charge.status === 'succeeded' && session.payment_status === 'paid') {
                logger.info(`📧 Обработка успешного платежа через persistSession для отправки email/VAT | Deal: ${dealId} | Charge: ${charge.id}`);
                await stripeProcessor.persistSession(session);
              }
              
              logger.info(`✅ Статус платежа обновлен | Deal: ${dealId} | Charge: ${charge.id} | Status: ${paymentStatus}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Ошибка обработки обновления платежа | Charge: ${charge.id}`, { error: error.message });
        }
      }
    }

    // Обрабатываем события Charge Succeeded (успешный платеж)
    if (event.type === 'charge.succeeded') {
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
              logger.info(`✅ Обработка успешного платежа | Deal: ${dealId} | Charge: ${charge.id} | Amount: ${charge.amount / 100} ${charge.currency.toUpperCase()}`);
              
              // Обновляем статус платежа в базе данных
              await stripeProcessor.repository.updatePaymentStatus(sessionId, 'paid');
              
              // Обрабатываем платеж через processor (если еще не обработан)
              await stripeProcessor.persistSession(session);
              
              logger.info(`✅ Успешный платеж обработан | Deal: ${dealId} | Charge: ${charge.id}`);
            }
          }
        } catch (error) {
          logger.error(`❌ Ошибка обработки успешного платежа | Charge: ${charge.id}`, { error: error.message });
        }
      }
    }

    // Обрабатываем события Payment Intent Created (создание платежа)
    if (event.type === 'payment_intent.created') {
      const paymentIntent = event.data.object;
      const sessionId = paymentIntent.metadata?.session_id;
      
      if (sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          const dealId = session.metadata?.deal_id;
          
          if (dealId) {
            logger.info(`🆕 Создан новый платеж | Deal: ${dealId} | PaymentIntent: ${paymentIntent.id} | Amount: ${paymentIntent.amount / 100} ${paymentIntent.currency.toUpperCase()}`);
            
            // Логируем создание платежа (статус еще не обновляем, так как платеж еще не завершен)
            logger.debug(`📋 Payment Intent создан для Deal #${dealId}`, {
              paymentIntentId: paymentIntent.id,
              sessionId,
              amount: paymentIntent.amount,
              currency: paymentIntent.currency,
              status: paymentIntent.status
            });
          }
        } catch (error) {
          logger.error(`❌ Ошибка обработки создания платежа | PaymentIntent: ${paymentIntent.id}`, { error: error.message });
        }
      }
    }

    // Обрабатываем события Invoice Sent (отправка инвойса)
    if (event.type === 'invoice.sent') {
      const invoice = event.data.object;
      const subscriptionId = invoice.subscription;
      const customerId = invoice.customer;
      
      logger.info(`📧 Инвойс отправлен | Invoice: ${invoice.id} | Customer: ${customerId} | Amount: ${invoice.amount_due / 100} ${invoice.currency.toUpperCase()}`);
      
      // Логируем отправку инвойса (для B2B сделок)
      logger.debug(`📋 Invoice sent event`, {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerId,
        subscriptionId,
        amountDue: invoice.amount_due,
        currency: invoice.currency,
        hostedInvoiceUrl: invoice.hosted_invoice_url
      });
    }

    // Логируем необработанные события (для отладки)
    const handledEvents = [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.created',
      'charge.refunded',
      'charge.updated',
      'charge.succeeded',
      'invoice.sent'
    ];
    
    if (!handledEvents.includes(event.type)) {
      logger.debug(`ℹ️  Необработанное событие Stripe | Тип: ${event.type} | ID: ${event.id}`);
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
