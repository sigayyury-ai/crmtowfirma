const express = require('express');
const logger = require('../utils/logger');
const stripeService = require('../services/stripe/service');
const StripeProcessorService = require('../services/stripe/processor');
const StripeAnalyticsService = require('../services/stripe/analyticsService');

const stripeProcessor = new StripeProcessorService();

const router = express.Router();

function parseDateParam(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

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

router.get('/payments', async (req, res) => {
  try {
    const {
      from,
      to,
      productId,
      productIds,
      dealId,
      limit
    } = req.query || {};

    const filters = {
      dateFrom: parseDateParam(from),
      dateTo: parseDateParam(to)
    };

    if (productId) {
      filters.productIds = [productId];
    } else if (productIds) {
      const ids = String(productIds)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
      if (ids.length) {
        filters.productIds = ids;
      }
    }

    if (dealId) {
      filters.dealId = dealId;
    }

    if (limit) {
      filters.limit = limit;
    }

    const analytics = await StripeAnalyticsService.listPayments(filters);
    res.json({
      success: true,
      data: analytics.items,
      summary: analytics.summary,
      filters: {
        from: filters.dateFrom,
        to: filters.dateTo,
        productIds: filters.productIds || null,
        dealId: filters.dealId || null,
        limit: analytics.items.length
      }
    });
  } catch (error) {
    logger.error('Failed to list stored Stripe payments', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'StripeRepositoryError',
      message: error.message
    });
  }
});

router.get('/payments/export', async (req, res) => {
  try {
    const analytics = await StripeAnalyticsService.listPayments({
      dateFrom: parseDateParam(req.query.from),
      dateTo: parseDateParam(req.query.to),
      productIds: req.query.productId
        ? [req.query.productId]
        : req.query.productIds
          ? String(req.query.productIds)
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
          : undefined,
      dealId: req.query.dealId
    });

    const header = [
      'Session ID',
      'Deal ID',
      'Product ID',
      'Product Name',
      'CRM Product ID',
      'Stripe Product ID',
      'Camp Product ID',
      'Payment Type',
      'Customer Type',
      'Customer Name',
      'Customer Email',
      'Customer Country',
      'Company Name',
      'Company Tax ID',
      'Company Country',
      'Currency',
      'Amount',
      'Amount (PLN)',
      'VAT',
      'VAT (PLN)',
      'Expected VAT',
      'Address Validated',
      'Exchange Rate',
      'Created At',
      'Processed At'
    ];

    const rows = analytics.items.map((item) => [
      item.sessionId || '',
      item.dealId || '',
      item.productId || '',
      item.productName || '',
      item.crmProductId || '',
      item.stripeProductId || '',
      item.campProductId || '',
      item.paymentType || '',
      item.customerType || '',
      item.customerName || '',
      item.customerEmail || '',
      item.customerCountry || '',
      item.companyName || '',
      item.companyTaxId || '',
      item.companyCountry || '',
      item.currency || '',
      item.amount,
      item.amountPln,
      item.amountTax,
      item.amountTaxPln,
      item.expectedVat ? 'yes' : 'no',
      item.addressValidated ? 'yes' : 'no',
      item.exchangeRate ?? '',
      item.createdAt || '',
      item.processedAt || ''
    ]);

    const csv = [
      header.map(buildCsvValue).join(','),
      ...rows.map((row) => row.map(buildCsvValue).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stripe-payments.csv"');
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export stored Stripe payments', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'StripeRepositoryError',
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

/**
 * GET /api/stripe/checkout-sessions/:sessionId/in-db
 * Проверить, есть ли Stripe Checkout Session в нашей БД (таблица stripe_payments).
 * Session ID можно взять из ссылки checkout.stripe.com/c/pay/cs_live_... или cs_test_...
 */
router.get('/checkout-sessions/:sessionId/in-db', async (req, res) => {
  const { sessionId } = req.params;
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'sessionId is required'
    });
  }

  try {
    const StripeRepository = require('../services/stripe/repository');
    const repo = new StripeRepository();
    if (!repo.isEnabled()) {
      return res.status(503).json({
        success: false,
        inDb: false,
        error: 'Database not configured (stripe_payments unavailable)'
      });
    }

    const payment = await repo.findPaymentBySessionId(sessionId);
    if (!payment) {
      return res.json({
        success: true,
        inDb: false,
        sessionId,
        message: 'Session not found in stripe_payments'
      });
    }

    return res.json({
      success: true,
      inDb: true,
      sessionId,
      payment: {
        deal_id: payment.deal_id,
        session_id: payment.session_id,
        payment_type: payment.payment_type,
        payment_status: payment.payment_status,
        original_amount: payment.original_amount,
        currency: payment.currency,
        checkout_url: payment.checkout_url ? true : false,
        created_at: payment.created_at,
        updated_at: payment.updated_at
      }
    });
  } catch (error) {
    logger.error('Failed to check session in DB', { sessionId, message: error.message });
    return res.status(500).json({
      success: false,
      inDb: false,
      error: error.message
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

router.post('/processors/runs', async (req, res) => {
  try {
    const { from, to } = req.body || {};
    // Всегда live режим, mode игнорируется
    const runId = `api-${Date.now()}`;
    const result = await stripeProcessor.processPendingPayments({
      trigger: 'api',
      runId,
      from,
      to
    });
    res.status(202).json({
      success: true,
      runId,
      result
    });
  } catch (error) {
    logger.error('Failed to trigger Stripe processor run', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'StripeProcessorError',
      message: error.message
    });
  }
});

router.post('/processors/refunds/lost-deals', async (req, res) => {
  try {
    // Всегда live режим, mode игнорируется
    const runId = `api-refund-${Date.now()}`;
    const result = await stripeProcessor.processLostDealRefunds({
      trigger: 'api',
      runId
    });
    res.status(202).json({
      success: true,
      runId,
      result
    });
  } catch (error) {
    logger.error('Failed to process lost deal refunds', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'StripeRefundError',
      message: error.message
    });
  }
});

module.exports = router;






