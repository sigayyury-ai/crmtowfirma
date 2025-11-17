const express = require('express');
const router = express.Router();
const StripeProcessorService = require('../services/stripe/processor');
const logger = require('../utils/logger');

const stripeProcessor = new StripeProcessorService();

/**
 * POST /api/webhooks/pipedrive
 * Webhook endpoint for Pipedrive deal updates
 * Triggers refund processing when deal status changes to "lost"
 */
router.post('/webhooks/pipedrive', express.json(), async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Log webhook received
    logger.info('Pipedrive webhook received', {
      event: webhookData.event,
      dealId: webhookData.current?.id || webhookData.previous?.id,
      timestamp: new Date().toISOString()
    });

    // Check if this is a deal update event
    // Pipedrive webhook format: { event: "updated.deal", current: {...}, previous: {...} }
    if (!webhookData.event || (!webhookData.event.includes('deal') && !webhookData.event.includes('updated'))) {
      logger.debug('Webhook event is not a deal update, skipping', {
        event: webhookData.event
      });
      return res.status(200).json({ success: true, message: 'Event ignored' });
    }

    const currentDeal = webhookData.current || webhookData.data?.current;
    const previousDeal = webhookData.previous || webhookData.data?.previous;

    if (!currentDeal || !currentDeal.id) {
      logger.warn('Webhook missing deal data', { 
        event: webhookData.event,
        hasCurrent: !!currentDeal,
        hasPrevious: !!previousDeal
      });
      return res.status(400).json({ success: false, error: 'Missing deal data' });
    }

    const dealId = currentDeal.id;
    // Pipedrive status: "open" or "lost" (string)
    const currentStatus = currentDeal.status;
    const previousStatus = previousDeal?.status;
    
    // Get lost_reason from current deal (can be in different formats)
    const lostReason = currentDeal.lost_reason || currentDeal.lostReason || currentDeal['lost_reason'];

    // Check if status changed to "lost"
    // previousStatus can be undefined for new deals, so we check it exists
    const statusChangedToLost = 
      currentStatus === 'lost' && 
      previousStatus !== 'lost' &&
      previousStatus !== undefined && // undefined means it's a new deal, not a status change
      previousStatus !== null;

    if (!statusChangedToLost) {
      logger.debug('Deal status did not change to lost, skipping refund', {
        dealId,
        currentStatus,
        previousStatus
      });
      return res.status(200).json({ 
        success: true, 
        message: 'Status not changed to lost, no refund needed' 
      });
    }

    // Check if lost_reason is "Refund" (case-insensitive)
    // Only process refunds if the lost reason is specifically "Refund"
    const normalizedLostReason = lostReason ? String(lostReason).trim() : '';
    const isRefundReason = normalizedLostReason.toLowerCase() === 'refund';

    if (!isRefundReason) {
      logger.debug('Deal lost but reason is not "Refund", skipping refund processing', {
        dealId,
        lostReason: normalizedLostReason,
        currentStatus
      });
      return res.status(200).json({ 
        success: true, 
        message: 'Lost reason is not "Refund", no refund needed',
        lostReason: normalizedLostReason
      });
    }

    logger.info('Deal status changed to lost with Refund reason, processing refunds', {
      dealId,
      previousStatus,
      currentStatus,
      lostReason: normalizedLostReason
    });

    // Process refunds for this specific deal
    const summary = {
      totalDeals: 1,
      refundsCreated: 0,
      errors: []
    };

    try {
      await stripeProcessor.refundDealPayments(dealId, summary);
      
      logger.info('Refunds processed for lost deal via webhook', {
        dealId,
        refundsCreated: summary.refundsCreated,
        errors: summary.errors
      });

      return res.status(200).json({
        success: true,
        message: 'Refunds processed',
        dealId,
        refundsCreated: summary.refundsCreated,
        errors: summary.errors
      });
    } catch (error) {
      logger.error('Failed to process refunds for lost deal via webhook', {
        dealId,
        error: error.message,
        stack: error.stack
      });

      // Still return 200 to Pipedrive to avoid retries for processing errors
      // Log the error for manual review
      return res.status(200).json({
        success: false,
        error: error.message,
        dealId
      });
    }
  } catch (error) {
    logger.error('Error processing Pipedrive webhook', {
      error: error.message,
      stack: error.stack,
      body: req.body
    });

    // Return 200 to prevent Pipedrive from retrying on our errors
    // But log for manual investigation
    return res.status(200).json({
      success: false,
      error: 'Webhook processing error',
      message: error.message
    });
  }
});

module.exports = router;

