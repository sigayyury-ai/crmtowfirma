const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

/**
 * POST /api/webhooks/stripe
 * Temporary stub: Stripe payment processing is completely disabled.
 */
router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  logger.warn('Stripe webhook received but payment processing is disabled');
  res.status(200).json({ received: true, disabled: true });
});

module.exports = router;
