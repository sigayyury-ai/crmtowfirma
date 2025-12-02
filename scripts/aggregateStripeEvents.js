#!/usr/bin/env node

/**
 * Aggregate Stripe events from Supabase line items into summary tables.
 *
 * Usage:
 *   node scripts/aggregateStripeEvents.js
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const logger = require('../src/utils/logger');
const StripeEventAggregationService = require('../src/services/stripe/eventAggregationService');

async function main() {
  const service = new StripeEventAggregationService();
  try {
    await service.aggregateAll();
    logger.info('Stripe events aggregation finished successfully');
  } catch (error) {
    logger.error('Stripe events aggregation failed', { error: error.message });
    process.exitCode = 1;
  }
}

main();

