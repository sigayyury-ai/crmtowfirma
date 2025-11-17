const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const StripeRepository = require('../services/stripe/repository');
const PipedriveClient = require('../services/pipedrive');
const logger = require('../utils/logger');
const { getStripeClient } = require('../services/stripe/client');

const stripeProcessor = new StripeProcessorService();
const stripeRepository = new StripeRepository();
const pipedriveClient = new PipedriveClient();
const stripe = getStripeClient();

/**
 * POST /api/webhooks/stripe
 * Webhook endpoint for Stripe payment events
 * Processes payments immediately when they are completed
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.warn('STRIPE_WEBHOOK_SECRET not configured, webhook verification skipped');
    // In development, allow without verification
    if (process.env.NODE_ENV === 'production') {
      return res.status(400).json({ error: 'Webhook secret not configured' });
    }
  }

  let event;

  try {
    // Verify webhook signature
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // In development without secret, parse body directly
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    logger.error('Webhook signature verification failed', {
      error: err.message,
      signature: sig ? 'present' : 'missing'
    });
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      
      case 'payment_intent.succeeded':
        await handlePaymentIntentSucceeded(event.data.object);
        break;
      
      default:
        logger.debug('Unhandled Stripe webhook event type', {
          type: event.type
        });
    }

    // Return a response to acknowledge receipt of the event
    res.json({ received: true });
  } catch (error) {
    logger.error('Error processing Stripe webhook', {
      eventType: event.type,
      error: error.message,
      stack: error.stack
    });

    // Create task in CRM to check the service
    await createErrorTask(event, error);

    // Still return 200 to Stripe to prevent retries
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutSessionCompleted(session) {
  logger.info('Processing checkout.session.completed webhook', {
    sessionId: session.id,
    dealId: session.metadata?.deal_id
  });

  try {
    // Check if session was already processed
    const existingPayment = await stripeRepository.findPaymentBySessionId(session.id);
    if (existingPayment) {
      logger.debug('Session already processed, skipping', {
        sessionId: session.id
      });
      return;
    }

    // Only process paid sessions
    if (session.payment_status !== 'paid') {
      logger.debug('Session not paid, skipping', {
        sessionId: session.id,
        paymentStatus: session.payment_status
      });
      return;
    }

    // Expand session to get full data including line_items
    const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'payment_intent']
    });

    // Process the session (persist payment, update CRM stage, etc.)
    await stripeProcessor.persistSession(expandedSession);

    logger.info('Successfully processed checkout session via webhook', {
      sessionId: session.id,
      dealId: session.metadata?.deal_id
    });
  } catch (error) {
    logger.error('Failed to process checkout session from webhook', {
      sessionId: session.id,
      dealId: session.metadata?.deal_id,
      error: error.message
    });
    throw error; // Re-throw to trigger error task creation
  }
}

/**
 * Handle payment_intent.succeeded event
 * This is a backup handler in case checkout.session.completed doesn't fire
 */
async function handlePaymentIntentSucceeded(paymentIntent) {
  logger.info('Processing payment_intent.succeeded webhook', {
    paymentIntentId: paymentIntent.id
  });

  try {
    // Find checkout session by payment_intent
    const sessions = await stripe.checkout.sessions.list({
      payment_intent: paymentIntent.id,
      limit: 1
    });

    if (sessions.data.length === 0) {
      logger.debug('No checkout session found for payment_intent', {
        paymentIntentId: paymentIntent.id
      });
      return;
    }

    const session = sessions.data[0];

    // Check if already processed
    const existingPayment = await stripeRepository.findPaymentBySessionId(session.id);
    if (existingPayment) {
      logger.debug('Session already processed via payment_intent, skipping', {
        sessionId: session.id,
        paymentIntentId: paymentIntent.id
      });
      return;
    }

    // Expand session to get full data
    const expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items', 'payment_intent']
    });

    // Only process paid sessions
    if (expandedSession.payment_status !== 'paid') {
      logger.debug('Session not paid, skipping', {
        sessionId: session.id,
        paymentStatus: expandedSession.payment_status
      });
      return;
    }

    // Process the session
    await stripeProcessor.persistSession(expandedSession);

    logger.info('Successfully processed payment_intent via webhook', {
      sessionId: session.id,
      paymentIntentId: paymentIntent.id,
      dealId: session.metadata?.deal_id
    });
  } catch (error) {
    logger.error('Failed to process payment_intent from webhook', {
      paymentIntentId: paymentIntent.id,
      error: error.message
    });
    throw error; // Re-throw to trigger error task creation
  }
}

/**
 * Create a task in CRM when webhook processing fails
 */
async function createErrorTask(event, error) {
  try {
    const dealId = event.data?.object?.metadata?.deal_id || null;
    
    if (!dealId) {
      logger.warn('Cannot create error task - no deal_id in webhook event', {
        eventType: event.type,
        eventId: event.id
      });
      return;
    }

    const errorMessage = error.message || 'Unknown error';
    const eventType = event.type || 'unknown';
    const sessionId = event.data?.object?.id || event.data?.object?.session_id || 'unknown';
    const paymentIntentId = event.data?.object?.payment_intent || event.data?.object?.id || 'unknown';

    // Build Stripe Dashboard links
    const stripeMode = process.env.STRIPE_MODE || 'live';
    const dashboardBase = stripeMode === 'test' 
      ? 'https://dashboard.stripe.com/test'
      : 'https://dashboard.stripe.com';
    const sessionLink = `${dashboardBase}/checkout_sessions/${sessionId}`;
    const paymentLink = `${dashboardBase}/payments/${paymentIntentId}`;

    const taskData = {
      subject: '⚠️ Ошибка обработки Stripe платежа',
      type: 'task',
      due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // через 24 часа
      deal_id: parseInt(dealId, 10),
      note: `Произошла ошибка при обработке Stripe webhook.\n\n` +
            `Тип события: ${eventType}\n` +
            `Session ID: ${sessionId}\n` +
            `Payment Intent: ${paymentIntentId}\n` +
            `Ошибка: ${errorMessage}\n\n` +
            `Пожалуйста, проверьте:\n` +
            `1. Статус платежа в Stripe Dashboard:\n` +
            `   - Session: ${sessionLink}\n` +
            `   - Payment: ${paymentLink}\n` +
            `2. Логи сервиса на наличие ошибок\n` +
            `3. Настройки webhook в Stripe Dashboard\n` +
            `4. Что платеж действительно был успешно оплачен\n\n` +
            `Webhook Event ID: ${event.id || 'unknown'}\n` +
            `Время: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Warsaw' })}`
    };

    const result = await pipedriveClient.createTask(taskData);

    if (result.success) {
      logger.info('Error task created in CRM', {
        dealId,
        taskId: result.task?.id || result.data?.id,
        eventType,
        sessionId
      });
    } else {
      logger.error('Failed to create error task in CRM', {
        dealId,
        error: result.error,
        eventType
      });
    }
  } catch (taskError) {
    logger.error('Failed to create error task', {
      error: taskError.message,
      originalError: error.message
    });
  }
}

module.exports = router;

