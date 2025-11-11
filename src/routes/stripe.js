const express = require('express');
const logger = require('../utils/logger');
const stripeService = require('../services/stripe/service');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    const data = await stripeService.checkHealth();
    res.json({
      success: true,
      data
    });
  } catch (error) {
    logger.error('Stripe health check failed', { message: error.message });
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'StripeError',
      message: error.message
    });
  }
});

router.get('/checkout-sessions', async (req, res) => {
  try {
    const sessions = await stripeService.listCheckoutSessions({
      limit: req.query.limit
    });
    res.json({
      success: true,
      data: sessions
    });
  } catch (error) {
    logger.error('Failed to list Stripe checkout sessions', { message: error.message });
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'StripeError',
      message: error.message
    });
  }
});

router.get('/checkout-sessions/:sessionId', async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'sessionId is required'
    });
  }

  try {
    const session = await stripeService.getCheckoutSession(sessionId);
    return res.json({
      success: true,
      data: session
    });
  } catch (error) {
    logger.error('Failed to load Stripe checkout session', {
      message: error.message,
      sessionId
    });
    return res.status(error.statusCode || 500).json({
      success: false,
      error: 'StripeError',
      message: error.message
    });
  }
});

module.exports = router;

