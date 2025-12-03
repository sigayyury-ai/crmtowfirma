#!/usr/bin/env node
require('dotenv').config();

const supabase = require('../../src/services/supabaseClient');
const logger = require('../../src/utils/logger');

const YEAR = Number(process.argv[2]) || 2025;
const SUBSCRIBERS = {
  1: 5000,
  2: 5392,
  3: 6050,
  4: 6549,
  5: 6771,
  6: 7476,
  7: 8058,
  8: 8419,
  9: 8500,
  10: 8600,
  11: 8813
};

(async () => {
  try {
    let prev = 0;
    for (const [monthStr, value] of Object.entries(SUBSCRIBERS)) {
      const month = Number(monthStr);
      const subscribers = Number(value);
      const newSubscribers = subscribers - prev;
      prev = subscribers;

      const { error } = await supabase
        .from('mql_monthly_snapshots')
        .update({
          subscribers,
          new_subscribers: newSubscribers,
          updated_at: new Date().toISOString()
        })
        .eq('year', YEAR)
        .eq('month', month);

      if (error) {
        throw error;
      }

      logger.info('Updated subscribers', { year: YEAR, month, subscribers, newSubscribers });
    }

    logger.info('Subscriber backfill completed', { year: YEAR, months: Object.keys(SUBSCRIBERS).length });
  } catch (error) {
    logger.error('Subscriber backfill failed', { error: error.message });
    process.exit(1);
  }
})();
