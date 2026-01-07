const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const StripeProcessorService = require('../services/stripe/processor');
const { getStripeClient, canRetrieveSession } = require('../services/stripe/client');
const CashPaymentsRepository = require('../services/cash/cashPaymentsRepository');
const { ensureCashStatus } = require('../services/cash/cashStatusSync');
const { fromMinorUnit } = require('../utils/currency');

const stripeProcessor = new StripeProcessorService();
const stripe = getStripeClient();
const cashPaymentsRepository = new CashPaymentsRepository();
const { createCashReminder } = require('../services/cash/cashReminderService');

/**
 * GET /api/webhooks/stripe
 * Проверка доступности webhook endpoint
 */
router.get('/webhooks/stripe', (req, res) => {
  res.json({
    success: true,
    message: 'Stripe webhook endpoint is available',
    method: 'POST',
    url: '/api/webhooks/stripe',
    note: 'Stripe sends POST requests to this endpoint. Use POST method to receive webhook events.'
  });
});

/**
 * Middleware для получения raw body для Stripe webhook
 * Получает тело запроса напрямую из stream, минуя все парсеры
 * ВАЖНО: Этот middleware должен быть применен ДО express.json() или express.raw()
 * 
 * Проблема: Render/Cloudflare могут изменять body, поэтому мы читаем напрямую из stream
 */
function getRawBody(req, res, next) {
  // Проверяем, не был ли body уже прочитан
  // Если body уже был прочитан как Buffer (express.raw() уже сработал), используем его
  if (Buffer.isBuffer(req.body)) {
    req.rawBody = req.body;
    logger.debug('Using req.body as rawBody (already Buffer)', {
      bodyLength: req.body.length
    });
    return next();
  }
  
  // Если body уже был прочитан как объект (express.json()), это ошибка
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    logger.error('Stripe webhook body was already parsed as JSON. This should not happen.', {
      hint: 'Ensure webhook routes are registered BEFORE express.json() in src/index.js',
      bodyType: typeof req.body,
      bodyKeys: Object.keys(req.body || {}).slice(0, 5)
    });
    return res.status(400).json({ 
      error: 'Request body was already parsed',
      hint: 'Webhook routes must be registered before express.json() middleware'
    });
  }
  
  // Читаем body напрямую из stream
  // Это гарантирует, что мы получаем оригинальное тело без изменений
  const chunks = [];
  let hasError = false;
  let bodyRead = false;
  
  // Проверяем, не был ли stream уже прочитан
  if (req.readableEnded) {
    logger.error('Request stream already ended, cannot read body', {
      hint: 'Body may have been read by another middleware'
    });
    return res.status(400).json({ 
      error: 'Request body stream already consumed',
      hint: 'Ensure no other middleware reads the body before this webhook handler'
    });
  }
  
  req.on('data', (chunk) => {
    if (!bodyRead) {
      chunks.push(chunk);
    }
  });
  
  req.on('end', () => {
    if (!hasError && !bodyRead) {
      bodyRead = true;
      req.rawBody = Buffer.concat(chunks);
      logger.debug('Raw body read from stream', {
        bodyLength: req.rawBody.length,
        chunksCount: chunks.length
      });
      next();
    }
  });
  
  req.on('error', (err) => {
    hasError = true;
    logger.error('Error reading raw body for Stripe webhook', { 
      error: err.message,
      stack: err.stack
    });
    if (!res.headersSent) {
      res.status(400).json({ error: 'Failed to read request body' });
    }
  });
  
  // Таймаут для чтения body (на случай, если stream зависнет)
  const timeout = setTimeout(() => {
    if (!bodyRead && !hasError) {
      hasError = true;
      logger.error('Timeout reading raw body for Stripe webhook', {
        timeout: 10000
      });
      if (!res.headersSent) {
        res.status(400).json({ error: 'Timeout reading request body' });
      }
    }
  }, 10000);
  
  req.on('end', () => {
    clearTimeout(timeout);
  });
  
  req.on('error', () => {
    clearTimeout(timeout);
  });
}

/**
 * POST /api/webhooks/stripe
 * Обработка webhook событий от Stripe
 * Отслеживает invoice_type = Stripe и обновляет статус в Pipedrive
 */
router.post('/webhooks/stripe', getRawBody, async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  // Ожидаемый webhook endpoint ID: we_1SXMcUBXP7ZF0H8RKWUimiqC
  // Endpoint URL: https://invoices.comoon.io/api/webhooks/stripe
  const expectedEndpointId = 'we_1SXMcUBXP7ZF0H8RKWUimiqC';
  const expectedEndpointUrl = 'https://invoices.comoon.io/api/webhooks/stripe';
  
  // Детальное логирование для отладки
  logger.debug('Stripe webhook received', {
    hasSignature: !!sig,
    signatureLength: sig?.length || 0,
    signaturePreview: sig ? `${sig.substring(0, 20)}...` : 'N/A',
    bodyLength: req.rawBody?.length || 0,
    bodyType: req.rawBody?.constructor?.name || typeof req.rawBody,
    contentType: req.headers['content-type'],
    userAgent: req.headers['user-agent'],
    expectedEndpointId,
    expectedEndpointUrl
  });

  if (!webhookSecret) {
    logger.warn('Stripe webhook secret not configured', {
      hint: 'Add STRIPE_WEBHOOK_SECRET environment variable in Render Dashboard',
      documentation: 'See docs/render-stripe-webhook-secret.md for instructions',
      expectedEndpointId,
      expectedEndpointUrl,
      note: `This endpoint expects webhook from endpoint ID: ${expectedEndpointId}`
    });
    return res.status(400).json({ 
      error: 'Webhook secret not configured',
      hint: 'STRIPE_WEBHOOK_SECRET environment variable is missing. Add it in Render Dashboard → Environment → Environment Variables',
      expectedEndpointId,
      expectedEndpointUrl
    });
  }

  let event;

  try {
    // ВАЖНО: используем rawBody, полученный напрямую из stream
    // Это гарантирует, что тело запроса не было изменено middleware или прокси
    if (!req.rawBody || !Buffer.isBuffer(req.rawBody)) {
      logger.error('Stripe webhook rawBody is not a Buffer', {
        bodyType: typeof req.rawBody,
        bodyConstructor: req.rawBody?.constructor?.name,
        hint: 'getRawBody middleware may not be working correctly'
      });
      return res.status(400).json({ 
        error: 'Invalid request body format',
        hint: 'Request body must be raw Buffer for signature verification'
      });
    }

    // Дополнительная диагностика: проверяем первые байты body для отладки
    const bodyPreview = req.rawBody.toString('utf8', 0, Math.min(100, req.rawBody.length));
    logger.debug('Stripe webhook body preview', {
      bodyLength: req.rawBody.length,
      bodyPreview: bodyPreview.substring(0, 50) + '...',
      bodyStartsWith: bodyPreview.startsWith('{') ? 'JSON object' : 'Not JSON object',
      signaturePreview: sig ? `${sig.substring(0, 30)}...` : 'N/A',
      expectedEndpointId,
      expectedEndpointUrl
    });

    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    // Логируем детали для отладки проблем с верификацией
    // Проверяем длину подписи - если она необычно длинная (148 символов), это может быть другой endpoint
    const signatureLength = sig?.length || 0;
    const isUnusualSignatureLength = signatureLength > 100; // Обычно подпись ~80 символов
    
    // Извлекаем timestamp из подписи для диагностики
    let signatureTimestamp = null;
    if (sig) {
      const timestampMatch = sig.match(/t=(\d+)/);
      if (timestampMatch) {
        signatureTimestamp = parseInt(timestampMatch[1], 10);
        const timestampAge = Math.floor(Date.now() / 1000) - signatureTimestamp;
        logger.debug('Signature timestamp analysis', {
          signatureTimestamp,
          timestampAge,
          isRecent: timestampAge < 300, // 5 минут
          hint: timestampAge > 300 ? 'Signature may be too old (Stripe allows 5 minutes)' : 'Signature timestamp is recent'
        });
      }
    }
    
    // Проверяем, что webhook secret правильный формат
    const isWebhookSecretValid = webhookSecret && (
      webhookSecret.startsWith('whsec_') || 
      webhookSecret.startsWith('whsec_test_') || 
      webhookSecret.startsWith('whsec_live_')
    );
    
    logger.warn('Stripe webhook signature verification failed', { 
      error: err.message,
      errorType: err.type,
      hasSignature: !!sig,
      signatureLength,
      signaturePreview: sig ? `${sig.substring(0, 30)}...` : 'N/A',
      signatureTimestamp,
      bodyLength: req.rawBody?.length || 0,
      bodyType: req.rawBody?.constructor?.name || typeof req.rawBody,
      contentType: req.headers['content-type'],
      userAgent: req.headers['user-agent'],
      webhookSecretLength: webhookSecret?.length || 0,
      webhookSecretPrefix: webhookSecret ? webhookSecret.substring(0, 15) : 'N/A',
      isWebhookSecretValid: webhookSecret && (
        webhookSecret.startsWith('whsec_') || 
        webhookSecret.startsWith('whsec_test_') || 
        webhookSecret.startsWith('whsec_live_')
      ),
      expectedEndpointId,
      expectedEndpointUrl,
      isUnusualSignatureLength,
      hint: !webhookSecret || !(webhookSecret.startsWith('whsec_') || webhookSecret.startsWith('whsec_test_') || webhookSecret.startsWith('whsec_live_'))
        ? 'STRIPE_WEBHOOK_SECRET format is invalid. It should start with whsec_, whsec_test_, or whsec_live_. Check Stripe Dashboard → Developers → Webhooks → Signing secret.'
        : isUnusualSignatureLength 
        ? 'Signature length is unusual - may be from different Stripe account or endpoint. Check if webhook is configured for correct Stripe account.'
        : `Check STRIPE_WEBHOOK_SECRET matches the webhook endpoint in Stripe Dashboard. Expected endpoint ID: ${expectedEndpointId}, URL: ${expectedEndpointUrl}. Verify: 1) You are in Live mode in Stripe Dashboard, 2) The endpoint URL matches exactly (${expectedEndpointUrl}), 3) The signing secret is from endpoint ID ${expectedEndpointId}`
    });
    // Возвращаем 401 для неавторизованных запросов (неправильная подпись)
    return res.status(401).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  try {
    logger.info(`📥 Stripe webhook получен | Тип: ${event.type}`);

    // Обрабатываем события Checkout Session (создание сессии)
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const dealId = session.metadata?.deal_id;

      if (dealId) {
        logger.info(`💳 Обработка Checkout Session | Deal: ${dealId} | Session: ${session.id} | Payment Status: ${session.payment_status} | Status: ${session.status}`);
        
        try {
          // Обновляем статус платежа в базе данных
          await stripeProcessor.repository.updatePaymentStatus(session.id, session.payment_status || 'paid');
          
          // Обрабатываем платеж через processor (автоматически обновляет стадии)
          // persistSession обрабатывает платеж и обновляет стадии сделки на основе типа платежа:
          // - Первый платеж (deposit) → Second Payment (ID: 32) или Camp Waiter (ID: 27) если один платеж
          // - Второй платеж (rest) → Camp Waiter (ID: 27)
          // - Единый платеж (single) → Camp Waiter (ID: 27)
          await stripeProcessor.persistSession(session);
          
          // Синхронизируем ожидания наличных платежей
          await syncCashExpectationFromStripeSession(session);
          
          // Отправляем уведомление клиенту через SendPulse
          try {
            const existingPayments = await stripeProcessor.repository.listPayments({
              dealId: String(dealId),
              limit: 10
            });
            
            // Используем график платежей из метаданных сессии или определяем по существующим платежам
            const paymentScheduleFromMetadata = session.metadata?.payment_schedule || '100%';
            const sessions = existingPayments.filter(p => p.session_id).map(p => ({
              session_id: p.session_id,
              amount: p.original_amount,
              currency: p.currency,
              url: p.checkout_url || null, // Используем url для совместимости с sendPaymentNotificationForDeal
              checkout_url: p.checkout_url || null
            }));
            
            // Добавляем текущую сессию, если её еще нет в списке (может быть еще не сохранена в БД)
            const currentSessionInList = sessions.find(s => s.session_id === session.id);
            
            // Получаем URL сессии (может быть null для завершенных сессий, нужно получить из Stripe)
            let sessionUrl = session.url;
            if (!sessionUrl && session.id) {
              try {
                const retrievedSession = await stripe.checkout.sessions.retrieve(session.id);
                sessionUrl = retrievedSession.url || null;
              } catch (error) {
                logger.warn('Failed to retrieve session URL from Stripe', {
                  sessionId: session.id,
                  error: error.message
                });
              }
            }
            
            if (!currentSessionInList) {
              sessions.push({
                session_id: session.id,
                amount: fromMinorUnit(session.amount_total || 0, session.currency),
                currency: session.currency,
                url: sessionUrl, // Используем URL из webhook события или полученный из Stripe
                checkout_url: sessionUrl
              });
            } else if (!currentSessionInList.url && sessionUrl) {
              // Если сессия есть в списке, но нет URL, добавляем из webhook события или Stripe
              currentSessionInList.url = sessionUrl;
              currentSessionInList.checkout_url = sessionUrl;
            }
            
            // Для checkout.session.completed событие приходит ПОСЛЕ успешной оплаты
            // Поэтому всегда отправляем уведомление об успешной оплате, а не о выставлении счета
            // Уведомление о выставлении счета отправляется при создании сессии (через Pipedrive webhook)
            
            logger.info(`🔍 Отправка уведомления об успешной оплате | Deal: ${dealId} | Session: ${session.id} | Payment Status: ${session.payment_status} | Status: ${session.status}`);
            
            try {
              await stripeProcessor.sendPaymentSuccessNotificationForDeal(dealId, session);
              logger.info(`✅ Уведомление об успешной оплате отправлено | Deal: ${dealId} | Session: ${session.id}`);
            } catch (successNotificationError) {
              logger.warn(`⚠️  Ошибка отправки уведомления об успешной оплате | Deal: ${dealId} | Session: ${session.id}`, { 
                error: successNotificationError.message 
              });
            }
          } catch (notificationError) {
            // Логируем ошибку, но не прерываем обработку платежа
            logger.warn(`⚠️  Ошибка отправки уведомления о платеже | Deal: ${dealId} | Session: ${session.id}`, { 
              error: notificationError.message 
            });
          }
          
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
        // Проверяем что можем получить сессию в текущем режиме
        if (!canRetrieveSession(sessionId)) {
          logger.debug('Skipping payment_intent.succeeded - session from different Stripe mode', {
            sessionId,
            eventId: event.id
          });
        } else {
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId);
          const dealId = session.metadata?.deal_id;
          
          if (dealId) {
            logger.info(`✅ Платеж успешен | Deal: ${dealId} | Session: ${sessionId}`);
            
            // Обновляем статус платежа в базе данных
            await stripeProcessor.repository.updatePaymentStatus(sessionId, session.payment_status || 'paid');
            
            // Обрабатываем платеж через processor (автоматически обновляет стадии)
            await stripeProcessor.persistSession(session);
            await syncCashExpectationFromStripeSession(session);
            
            logger.info(`✅ Payment Intent обработан | Deal: ${dealId} | Session: ${sessionId}`);
          } else {
            logger.warn(`⚠️  Deal ID не найден в Session | Session: ${sessionId}`);
          }
        } catch (sessionError) {
          logger.error(`❌ Ошибка получения Session | PaymentIntent: ${paymentIntent.id}`, { error: sessionError.message });
        }
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
        // Проверяем что можем получить сессию в текущем режиме
        if (!canRetrieveSession(sessionId)) {
          logger.debug('Skipping payment_intent.payment_failed - session from different Stripe mode', {
            sessionId,
            eventId: event.id
          });
        } else {
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
        }
      } else {
        logger.warn(`⚠️  Session ID не найден в Payment Intent | PaymentIntent: ${paymentIntent.id}`);
      }
    }

    // Обрабатываем события Charge Refunded (возврат платежа)
    if (event.type === 'charge.refunded') {
      const charge = event.data.object;
      const paymentIntentId = charge.payment_intent;
      
      logger.info(`💰 Обработка возврата платежа | Charge: ${charge.id} | PaymentIntent: ${paymentIntentId || 'N/A'}`);
      
      let dealId = null;
      
      // Пробуем найти deal_id из разных источников
      try {
        // 1. Из charge metadata
        if (charge.metadata?.deal_id) {
          dealId = charge.metadata.deal_id;
          logger.debug('Deal ID найден в charge metadata', { dealId, chargeId: charge.id });
        }
        
        // 2. Из payment в БД по payment_intent
        if (!dealId && paymentIntentId) {
          try {
            const payment = await stripeProcessor.repository.findPaymentByPaymentIntent(paymentIntentId);
            if (payment && payment.deal_id) {
              dealId = payment.deal_id;
              logger.debug('Deal ID найден в БД по payment_intent', { dealId, paymentIntentId });
            }
          } catch (dbError) {
            logger.debug('Не удалось найти payment в БД', { paymentIntentId, error: dbError.message });
          }
        }
        
        // 3. Из paymentIntent metadata (если доступен)
        if (!dealId && paymentIntentId) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
            if (paymentIntent.metadata?.deal_id) {
              dealId = paymentIntent.metadata.deal_id;
              logger.debug('Deal ID найден в paymentIntent metadata', { dealId, paymentIntentId });
            }
            
            // 4. Из session через paymentIntent (если session_id есть)
            if (!dealId && paymentIntent.metadata?.session_id) {
              const sessionId = paymentIntent.metadata.session_id;
              if (canRetrieveSession(sessionId)) {
                try {
                  const session = await stripe.checkout.sessions.retrieve(sessionId);
                  if (session.metadata?.deal_id) {
                    dealId = session.metadata.deal_id;
                    logger.debug('Deal ID найден в session metadata', { dealId, sessionId });
                  }
                } catch (sessionError) {
                  logger.debug('Не удалось получить session', { sessionId, error: sessionError.message });
                }
              }
            }
          } catch (piError) {
            logger.debug('Не удалось получить paymentIntent', { paymentIntentId, error: piError.message });
          }
        }
        
        // 5. Из refund объекта (если есть в event.data.object.refunds)
        if (!dealId && charge.refunds && charge.refunds.data && charge.refunds.data.length > 0) {
          const refund = charge.refunds.data[0];
          if (refund.metadata?.deal_id) {
            dealId = refund.metadata.deal_id;
            logger.debug('Deal ID найден в refund metadata', { dealId, refundId: refund.id });
          }
        }
        
        // Если deal_id найден - обрабатываем возврат
        if (dealId) {
          logger.info(`💰 Обработка возврата платежа | Deal: ${dealId} | Charge: ${charge.id}`);
          
          // Получаем refund объект из Stripe для полной обработки
          let refund = null;
          try {
            // Пробуем получить refund из charge.refunds или из Stripe API
            if (charge.refunds && charge.refunds.data && charge.refunds.data.length > 0) {
              refund = charge.refunds.data[0];
            } else {
              // Получаем последний refund для этого charge
              const refunds = await stripe.refunds.list({
                charge: charge.id,
                limit: 1
              });
              if (refunds.data && refunds.data.length > 0) {
                refund = refunds.data[0];
              }
            }
            
            // Если refund найден, обрабатываем через persistRefund для полной обработки
            if (refund) {
              // Убеждаемся что deal_id есть в refund metadata
              if (!refund.metadata || !refund.metadata.deal_id) {
                try {
                  await stripe.refunds.update(refund.id, {
                    metadata: {
                      ...(refund.metadata || {}),
                      deal_id: String(dealId)
                    }
                  });
                  logger.debug('Обновлен deal_id в refund metadata', { refundId: refund.id, dealId });
                } catch (updateError) {
                  logger.warn('Не удалось обновить refund metadata', { refundId: refund.id, error: updateError.message });
                }
              }
              
              // Обрабатываем возврат через persistRefund (сохраняет в БД, обновляет планы платежей)
              await stripeProcessor.persistRefund(refund);
              logger.debug('Refund обработан через persistRefund', { refundId: refund.id, dealId });
            }
          } catch (refundError) {
            logger.warn('Не удалось получить/обработать refund объект', { 
              chargeId: charge.id, 
              error: refundError.message 
            });
          }
          
          // Пересчитываем стадию сделки через новый сервис автоматизации
          await stripeProcessor.triggerCrmStatusAutomation(dealId, {
            reason: 'stripe:webhook-refund'
          });
          
          logger.info(`✅ Возврат обработан | Deal: ${dealId} | Charge: ${charge.id}`);
        } else {
          logger.warn(`⚠️  Deal ID не найден для возврата | Charge: ${charge.id} | PaymentIntent: ${paymentIntentId || 'N/A'}`);
          logger.debug('Попробуйте найти deal_id вручную и обновить metadata в Stripe', {
            chargeId: charge.id,
            paymentIntentId,
            chargeMetadata: charge.metadata
          });
        }
      } catch (error) {
        logger.error(`❌ Ошибка обработки возврата | Charge: ${charge.id}`, { 
          error: error.message,
          stack: error.stack,
          chargeId: charge.id,
          paymentIntentId
        });
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
            // Проверяем что можем получить сессию в текущем режиме
            if (!canRetrieveSession(sessionId)) {
              logger.debug('Skipping charge.updated - session from different Stripe mode', {
                sessionId,
                chargeId: charge.id
              });
            } else {
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
            // Проверяем что можем получить сессию в текущем режиме
            if (!canRetrieveSession(sessionId)) {
              logger.debug('Skipping charge.succeeded - session from different Stripe mode', {
                sessionId,
                chargeId: charge.id
              });
            } else {
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
        // Проверяем что можем получить сессию в текущем режиме
        if (!canRetrieveSession(sessionId)) {
          logger.debug('Skipping payment_intent.created - session from different Stripe mode', {
            sessionId,
            paymentIntentId: paymentIntent.id
          });
        } else {
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

async function syncCashExpectationFromStripeSession(session) {
  if (!cashPaymentsRepository.isEnabled() || !session?.metadata) {
    return;
  }

  const metadata = session.metadata || {};
  const dealId = metadata.deal_id || metadata.dealId;
  const cashAmountRaw =
    metadata.cash_amount_expected ||
    metadata.cashAmountExpected ||
    metadata.cash_expected_amount;

  const cashAmount = parseCashAmount(cashAmountRaw);

  if (!dealId || !Number.isFinite(cashAmount) || cashAmount <= 0) {
    return;
  }

  const normalizedDealId = Number(dealId);
  if (!Number.isFinite(normalizedDealId)) {
    return;
  }

  const currency = normalizeCurrencyCode(metadata.cash_currency || session.currency || 'PLN');
  const expectedDate = normalizeDateInput(metadata.cash_expected_date);

  const existing = await cashPaymentsRepository.findByStripeSession(session.id);
  const isNewExpectation = !existing;
  const payload = {
    cash_expected_amount: roundCurrency(cashAmount),
    currency,
    amount_pln: currency === 'PLN'
      ? roundCurrency(cashAmount)
      : existing?.amount_pln ?? null,
    expected_date: expectedDate,
    status: existing?.status || 'pending_confirmation',
    source: 'stripe',
    note: metadata.cash_note || 'Ожидание наличного остатка после Stripe',
    metadata: {
      ...(existing?.metadata || {}),
      session_id: session.id,
      payment_type: metadata.payment_type || null,
      stripe_checkout_mode: session.mode || null
    }
  };

  let record;
  if (existing) {
    record = await cashPaymentsRepository.updatePayment(existing.id, payload);
  } else {
    record = await cashPaymentsRepository.createPayment({
      deal_id: normalizedDealId,
      proforma_id: null,
      product_id: null,
      created_by: 'stripe_webhook',
      ...payload
    });
  }

  if (record && record.id) {
    await cashPaymentsRepository.logEvent(record.id, existing ? 'stripe:update' : 'stripe:create', {
      source: 'stripe_webhook',
      payload: {
        session_id: session.id,
        cash_amount: payload.cash_expected_amount
      },
      createdBy: 'stripe_webhook'
    });

    await ensureCashStatus({
      pipedriveClient: stripeProcessor.pipedriveClient,
      dealId: normalizedDealId,
      currentStatus: metadata.cash_status || null,
      targetStatus: 'PENDING'
    });

    if (isNewExpectation) {
      await createCashReminder(stripeProcessor.pipedriveClient, {
        dealId: normalizedDealId,
        amount: payload.cash_expected_amount,
        currency: payload.currency,
        expectedDate: payload.expected_date,
        closeDate: metadata.close_date || metadata.expected_close_date,
        source: 'Stripe',
        buyerName: metadata.customer_name || metadata.buyer_name || `Deal #${normalizedDealId}`,
        personId: metadata.person_id || metadata.personId || null,
        sendpulseClient: stripeProcessor.sendpulseClient
      });
    }
  }
}

function parseCashAmount(value) {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const sanitized = value.replace(/,/g, '.').replace(/[^\d.-]/g, '');
    const parsed = parseFloat(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCurrencyCode(value) {
  if (typeof value !== 'string') {
    return 'PLN';
  }
  const trimmed = value.trim().toUpperCase();
  return trimmed || 'PLN';
}

function normalizeDateInput(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function roundCurrency(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

module.exports = router;
