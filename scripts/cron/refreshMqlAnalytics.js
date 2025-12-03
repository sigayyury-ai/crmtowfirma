#!/usr/bin/env node

require('dotenv').config();

const logger = require('../../src/utils/logger');
const mqlConfig = require('../../src/config/mql');
const MqlSyncService = require('../../src/services/analytics/mqlSyncService');

async function main() {
  try {
    const service = new MqlSyncService();
    const years = determineYears(process.argv[2]);

    for (const year of years) {
      logger.info('Running MQL sync for year', { year });
      await service.run({ year });
    }

    logger.info('MQL analytics refresh completed', { years });
    process.exit(0);
  } catch (error) {
    logger.error('MQL analytics refresh failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

function determineYears(yearArg) {
  if (yearArg) {
    return [Number(yearArg)];
  }

  const monthsBack = Math.max(Number(mqlConfig.syncLookbackMonths) || 12, 12);
  const now = new Date();
  const years = new Set([now.getUTCFullYear()]);
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  for (let i = 1; i < monthsBack; i += 1) {
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    years.add(cursor.getUTCFullYear());
  }

  return Array.from(years).sort((a, b) => a - b);
}

main();


