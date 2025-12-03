#!/usr/bin/env node

require('dotenv').config();

const logger = require('../../src/utils/logger');
const MqlSyncService = require('../../src/services/analytics/mqlSyncService');

async function main() {
  const yearArg = process.argv[2];
  const targetYear = Number(yearArg) || new Date().getFullYear();

  try {
    const service = new MqlSyncService();
    const result = await service.updateMarketingExpensesOnly(targetYear);
    logger.info('Marketing expenses backfill completed', result);
    process.exit(0);
  } catch (error) {
    logger.error('Marketing expenses backfill failed', { error: error.message });
    process.exit(1);
  }
}

main();


