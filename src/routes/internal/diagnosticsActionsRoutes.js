/**
 * Внутренние API для диагностических действий (create-stripe-session и т.д.).
 * Авторизация по INTERNAL_API_KEY (заголовок X-Internal-Key или Authorization: Bearer <key>).
 * Подключается ДО requireAuth в index.js, чтобы вызывать без сессии.
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

function requireInternalKey(req, res, next) {
  if (!INTERNAL_API_KEY) {
    logger.warn('INTERNAL_API_KEY not set, internal diagnostics actions disabled');
    return res.status(503).json({
      success: false,
      error: 'Internal API key not configured'
    });
  }
  const key = req.headers['x-internal-key'] ||
    (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7)
      : null);
  if (key !== INTERNAL_API_KEY) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or missing internal API key (X-Internal-Key or Authorization: Bearer)'
    });
  }
  next();
}

router.use(requireInternalKey);

/**
 * POST /api/internal/pipedrive/deals/:id/diagnostics/actions/create-stripe-session
 * То же, что POST /api/pipedrive/deals/:id/diagnostics/actions/create-stripe-session,
 * но с авторизацией по INTERNAL_API_KEY (без Google OAuth).
 */
router.post('/pipedrive/deals/:id/diagnostics/actions/create-stripe-session', async (req, res) => {
  try {
    const dealId = parseInt(req.params.id);

    if (isNaN(dealId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid deal ID'
      });
    }

    const StripeProcessorService = require('../../services/stripe/processor');
    const stripeProcessor = new StripeProcessorService();

    const dealResult = await stripeProcessor.pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      return res.status(404).json({
        success: false,
        error: 'Deal not found'
      });
    }

    const deal = dealResult.deal;
    const { paymentType, paymentSchedule, customAmount, sendNotification = true } = req.body;

    const sessionContext = {
      trigger: 'manual_diagnostics',
      runId: `diagnostics_${Date.now()}`,
      paymentType: paymentType || null,
      paymentSchedule: paymentSchedule || null,
      customAmount: customAmount || null,
      skipNotification: !sendNotification,
      setInvoiceTypeDone: false
    };

    const sessionResult = await stripeProcessor.createCheckoutSessionForDeal(deal, sessionContext);

    if (!sessionResult.success) {
      return res.status(500).json({
        success: false,
        error: sessionResult.error || 'Failed to create Stripe session'
      });
    }

    let notificationResult = null;
    if (sendNotification) {
      try {
        const StripeRepository = require('../../services/stripe/repository');
        const repository = new StripeRepository();
        const existingPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 10
        });

        const sessions = [];
        for (const p of existingPayments) {
          if (!p.session_id) continue;
          let sessionUrl = p.checkout_url || null;
          if (!sessionUrl && p.raw_payload && p.raw_payload.url) sessionUrl = p.raw_payload.url;
          if (!sessionUrl) {
            try {
              const { canRetrieveSession } = require('../../services/stripe/client');
              if (canRetrieveSession(p.session_id)) {
                const session = await stripeProcessor.stripe.checkout.sessions.retrieve(p.session_id);
                if (session && session.url) {
                  sessionUrl = session.url;
                  try {
                    await repository.savePayment({ session_id: p.session_id, checkout_url: sessionUrl });
                  } catch (e) {
                    logger.warn('Failed to save checkout_url', { dealId, sessionId: p.session_id });
                  }
                }
              }
            } catch (e) {
              logger.warn('Failed to retrieve session URL', { dealId, sessionId: p.session_id });
            }
          }
          if (sessionUrl) {
            sessions.push({
              id: p.session_id,
              url: sessionUrl,
              type: p.payment_type,
              amount: p.original_amount
            });
          }
        }

        sessions.push({
          id: sessionResult.sessionId,
          url: sessionResult.sessionUrl,
          type: sessionContext.paymentType || 'payment',
          amount: sessionResult.amount
        });

        const effectivePaymentSchedule = paymentSchedule ||
          (deal.expected_close_date ? '50/50' : '100%');

        notificationResult = await stripeProcessor.sendPaymentNotificationForDeal(dealId, {
          paymentSchedule: effectivePaymentSchedule,
          sessions,
          currency: sessionResult.currency,
          totalAmount: parseFloat(deal.value) || 0
        });
      } catch (notifyError) {
        logger.warn('Failed to send notification after creating session', {
          dealId,
          error: notifyError.message
        });
      }
    }

    res.json({
      success: true,
      session: {
        id: sessionResult.sessionId,
        url: sessionResult.sessionUrl,
        amount: sessionResult.amount,
        currency: sessionResult.currency
      },
      notification: notificationResult ? {
        sent: notificationResult.success,
        error: notificationResult.error || null
      } : null
    });
  } catch (error) {
    logger.error('Error creating Stripe session via internal API:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: error.message
    });
  }
});

module.exports = router;
