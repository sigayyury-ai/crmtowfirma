const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

/**
 * Service for matching receipts with bank payments
 */
class ReceiptMatchingService {
  constructor() {
    this.AMOUNT_TOLERANCE_PERCENT = 3; // 3% tolerance from receipt amount
    this.MIN_AMOUNT_TOLERANCE = 0.01; // Minimum tolerance (for very small amounts)
    this.DATE_WINDOW_DAYS = 3; // ±3 days window
  }

  /**
   * Find candidate payments for a receipt based on extracted data
   * @param {Object} extracted - Extracted receipt data {amount, currency, date, vendor}
   * @param {Object} options - Options {maxCandidates: 10, amountTolerancePercent: 3, dateWindowDays: 3}
   * @returns {Promise<Array>} Array of candidate payments with scores
   */
  async findCandidates(extracted, options = {}) {
    const {
      maxCandidates = 10,
      amountTolerancePercent = this.AMOUNT_TOLERANCE_PERCENT,
      dateWindowDays = this.DATE_WINDOW_DAYS
    } = options;

    try {
      if (!extracted.amount && !extracted.date) {
        logger.warn('Receipt matching: insufficient data (no amount or date)');
        return [];
      }

      // Calculate amount tolerance (3% of receipt amount, minimum 0.01)
      let amountTolerance = 0;
      let amountMin = null;
      let amountMax = null;
      
      if (extracted.amount) {
        amountTolerance = Math.max(
          extracted.amount * (amountTolerancePercent / 100),
          this.MIN_AMOUNT_TOLERANCE
        );
        amountMin = extracted.amount - amountTolerance;
        amountMax = extracted.amount + amountTolerance;
        
        logger.info('Amount filter for matching', {
          receiptAmount: extracted.amount,
          tolerancePercent: amountTolerancePercent,
          tolerance: amountTolerance,
          range: `${amountMin.toFixed(2)} - ${amountMax.toFixed(2)}`
        });
      }

      // Build query filters
      let query = supabase
        .from('payments')
        .select('id, operation_date, amount, currency, description, payer_name, direction')
        .is('deleted_at', null);

      // Filter by currency if available
      if (extracted.currency) {
        query = query.eq('currency', extracted.currency);
      }

      // Filter by amount range (CRITICAL: filter in SQL to avoid processing irrelevant payments)
      if (extracted.amount && amountMin !== null && amountMax !== null) {
        query = query
          .gte('amount', amountMin)
          .lte('amount', amountMax);
      }

      // Filter by date window if available
      if (extracted.date) {
        const dateFrom = new Date(extracted.date);
        dateFrom.setDate(dateFrom.getDate() - dateWindowDays);
        
        const dateTo = new Date(extracted.date);
        dateTo.setDate(dateTo.getDate() + dateWindowDays);

        query = query
          .gte('operation_date', dateFrom.toISOString().split('T')[0])
          .lte('operation_date', dateTo.toISOString().split('T')[0]);
      }

      const { data: payments, error } = await query;

      if (error) {
        logger.error('Error fetching payments for matching', { error });
        return [];
      }

      if (!payments || payments.length === 0) {
        return [];
      }

      // Score each payment
      const candidates = payments.map(payment => {
        const score = this.calculateScore(extracted, payment, {
          amountTolerance,
          amountTolerancePercent,
          dateWindowDays
        });
        return {
          payment_id: payment.id,
          operation_date: payment.operation_date,
          amount: payment.amount,
          currency: payment.currency,
          description: payment.description,
          payer_name: payment.payer_name,
          direction: payment.direction,
          score: score.total,
          reasons: score.reasons
        };
      });

      // Sort by score (descending) and return top N
      return candidates
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCandidates);

    } catch (error) {
      logger.error('Error in receipt matching', {
        error: error.message,
        stack: error.stack
      });
      return [];
    }
  }

  /**
   * Calculate matching score between receipt and payment
   * @param {Object} extracted - Extracted receipt data
   * @param {Object} payment - Payment record
   * @param {Object} options - Matching options
   * @returns {Object} {total: number, reasons: string[]}
   */
  calculateScore(extracted, payment, options = {}) {
    const { 
      amountTolerance = 0,
      amountTolerancePercent = this.AMOUNT_TOLERANCE_PERCENT,
      dateWindowDays = this.DATE_WINDOW_DAYS 
    } = options;
    let score = 0;
    const reasons = [];

    // Amount matching (40 points max)
    // Since we already filtered by amount in SQL, all payments here are within tolerance
    if (extracted.amount && payment.amount) {
      const amountDiff = Math.abs(extracted.amount - payment.amount);
      const percentDiff = (amountDiff / extracted.amount) * 100;
      
      if (amountDiff === 0) {
        score += 40;
        reasons.push('Точная сумма');
      } else if (percentDiff <= amountTolerancePercent) {
        // Score based on percentage difference (more accurate for different amount ranges)
        const toleranceScore = Math.max(0, 40 - (percentDiff / amountTolerancePercent) * 20);
        score += toleranceScore;
        reasons.push(`Сумма ±${amountDiff.toFixed(2)} ${payment.currency || ''} (${percentDiff.toFixed(1)}%)`);
      }
    }

    // Date matching (30 points max)
    if (extracted.date && payment.operation_date) {
      const receiptDate = new Date(extracted.date);
      const paymentDate = new Date(payment.operation_date);
      const daysDiff = Math.abs((receiptDate - paymentDate) / (1000 * 60 * 60 * 24));

      if (daysDiff === 0) {
        score += 30;
        reasons.push('Точная дата');
      } else if (daysDiff <= dateWindowDays) {
        const dateScore = Math.max(0, 30 - (daysDiff / dateWindowDays) * 15);
        score += dateScore;
        reasons.push(`Дата ±${Math.round(daysDiff)} дн.`);
      }
    }

    // Currency matching (20 points max)
    if (extracted.currency && payment.currency) {
      if (extracted.currency === payment.currency) {
        score += 20;
        reasons.push('Валюта совпадает');
      }
    }

    // Vendor/description matching (10 points max)
    if (extracted.vendor) {
      const vendorLower = extracted.vendor.toLowerCase();
      const descriptionLower = (payment.description || '').toLowerCase();
      const payerLower = (payment.payer_name || '').toLowerCase();

      if (descriptionLower.includes(vendorLower) || payerLower.includes(vendorLower)) {
        score += 10;
        reasons.push('Совпадение по названию');
      }
    }

    return {
      total: Math.round(score),
      reasons
    };
  }
}

module.exports = new ReceiptMatchingService();

