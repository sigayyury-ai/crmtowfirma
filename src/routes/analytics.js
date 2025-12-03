const express = require('express');
const router = express.Router();
const MqlReportService = require('../services/analytics/mqlReportService');
const mqlRepository = require('../services/analytics/mqlRepository');

const mqlReportService = new MqlReportService();

router.get('/mql-summary', async (req, res) => {
  try {
    const { year } = req.query;
    const summary = await mqlReportService.getMonthlySummary({ year });
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load MQL summary',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/mql-subscribers', async (req, res) => {
  try {
    const { year, month, subscribers } = req.body || {};
    const targetYear = Number(year) || new Date().getFullYear();
    const targetMonth = Number(month);
    const totalSubscribers = Number(subscribers);

    if (!Number.isInteger(targetMonth) || targetMonth < 1 || targetMonth > 12) {
      return res.status(400).json({
        success: false,
        error: 'Month must be an integer between 1 and 12'
      });
    }

    if (!Number.isFinite(totalSubscribers) || totalSubscribers < 0) {
      return res.status(400).json({
        success: false,
        error: 'Subscribers must be a non-negative number'
      });
    }

    const currentSnapshot = await mqlRepository.fetchSnapshot(targetYear, targetMonth);
    if (!currentSnapshot) {
      return res.status(404).json({
        success: false,
        error: 'Snapshot not found for specified year/month'
      });
    }

    let prevSubscribers = 0;
    if (targetMonth > 1) {
      const prevSnapshot = await mqlRepository.fetchSnapshot(targetYear, targetMonth - 1);
      prevSubscribers = prevSnapshot?.subscribers || 0;
    }

    const newSubscribers = Math.max(totalSubscribers - prevSubscribers, 0);
    const budget = currentSnapshot.marketing_expense || 0;
    const costPerSubscriber =
      budget > 0 && newSubscribers > 0 ? budget / newSubscribers : null;

    await mqlRepository.updateSnapshot(targetYear, targetMonth, {
      subscribers: totalSubscribers,
      new_subscribers: newSubscribers,
      cost_per_subscriber: costPerSubscriber
    });

    res.json({
      success: true,
      data: {
        year: targetYear,
        month: targetMonth,
        subscribers: totalSubscribers,
        newSubscribers,
        costPerSubscriber
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update subscribers',
      message: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;


