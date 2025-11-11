const express = require('express');
const logger = require('../utils/logger');
const stripeEventReportService = require('../services/stripe/eventReportService');

const router = express.Router();

function parseSummaryQuery(query) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  return {
    limit,
    startingAfter: query.startingAfter || query.cursor || null,
    from: query.from || null,
    to: query.to || null
  };
}

router.get('/summary', async (req, res) => {
  try {
    const params = parseSummaryQuery(req.query);
    const data = await stripeEventReportService.listEvents(params);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('Failed to load Stripe events summary', { error: error.message });
    res.status(502).json({
      success: false,
      error: 'StripeUnavailable',
      message: error.message || 'Unable to load Stripe events summary'
    });
  }
});

router.get('/:eventKey', async (req, res) => {
  const { eventKey } = req.params;
  if (!eventKey) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'eventKey is required'
    });
  }

  try {
    const report = await stripeEventReportService.getEventReport(eventKey, {
      from: req.query.from,
      to: req.query.to
    });
    res.json({
      success: true,
      data: { eventReport: report }
    });
  } catch (error) {
    const status = error.statusCode || 502;
    logger.error('Failed to load Stripe event report', { eventKey, error: error.message });
    res.status(status).json({
      success: false,
      error: error.code || 'StripeUnavailable',
      message: error.message || 'Unable to load event report'
    });
  }
});

router.get('/:eventKey/export', async (req, res) => {
  const { eventKey } = req.params;
  if (!eventKey) {
    return res.status(400).json({
      success: false,
      error: 'BadRequest',
      message: 'eventKey is required'
    });
  }

  try {
    const csv = await stripeEventReportService.generateExportCsv(eventKey, {
      from: req.query.from,
      to: req.query.to
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${eventKey}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export Stripe event report', { eventKey, error: error.message });
    res.status(error.statusCode || 502).json({
      success: false,
      error: error.code || 'StripeUnavailable',
      message: error.message || 'Unable to export event report'
    });
  }
});

module.exports = router;

