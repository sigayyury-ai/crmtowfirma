#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const logger = require('../../src/utils/logger');
const supabase = require('../../src/services/supabaseClient');
const mqlRepository = require('../../src/services/analytics/mqlRepository');
const { getMonthKey } = require('../../src/services/analytics/mqlNormalizer');

async function main() {
  const yearArg = process.argv[2];
  const targetYear = Number(yearArg) || new Date().getFullYear();
  const csvPath = path.join(__dirname, '../../tests/people-20141095-10.csv');

  logger.info('Backfilling repeat deals from CSV', { csvPath, targetYear });

  const customerIds = loadCustomerIds(csvPath);
  logger.info('Loaded customer IDs', { count: customerIds.size });

  const repeatsByMonth = await calculateRepeats(targetYear, customerIds);
  await persistRepeats(targetYear, repeatsByMonth);

  logger.info('Repeat deals backfill completed', {
    year: targetYear,
    repeats: repeatsByMonth
  });
  process.exit(0);
}

function loadCustomerIds(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parse(content, { columns: true, skip_empty_lines: true });
  const ids = new Set();

  rows.forEach((row) => {
    const value = String(row['Person - ID'] || '').trim();
    const wins = Number(row['Person - Won deals'] || 0);
    if (value.length && Number.isFinite(wins) && wins >= 2) {
      ids.add(value);
    }
  });

  return ids;
}

async function calculateRepeats(year, customerIds) {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { data, error } = await supabase
    .from('mql_leads')
    .select('first_seen_month,payload')
    .eq('source', 'pipedrive')
    .gte('first_seen_month', startDate)
    .lte('first_seen_month', endDate);

  if (error) {
    throw new Error(`Failed to fetch MQL leads: ${error.message}`);
  }

  const repeats = {};
  const countedDeals = new Set();

  data.forEach((lead) => {
    const deal = lead?.payload || {};
    const dealId = extractDealId(deal);
    if (!dealId || countedDeals.has(dealId)) {
      return;
    }

    if (!isWonDeal(deal)) {
      return;
    }

    const personId = extractPersonId(deal);
    if (!personId || !customerIds.has(personId)) {
      return;
    }

    const repeatMonth =
      getMonthKey(deal.wonTime || deal.won_time) ||
      getMonthKey(deal.closeTime || deal.close_time);

    if (!repeatMonth || !repeatMonth.startsWith(`${year}-`)) {
      return;
    }

    countedDeals.add(dealId);
    repeats[repeatMonth] = (repeats[repeatMonth] || 0) + 1;
  });

  return repeats;
}

async function persistRepeats(year, repeatsByMonth) {
  const snapshots = await mqlRepository.fetchSnapshots(year);
  const monthExists = new Set(
    snapshots.map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`)
  );
  const snapshotMap = new Map(
    snapshots.map((row) => [`${row.year}-${String(row.month).padStart(2, '0')}`, row])
  );

  for (let month = 1; month <= 12; month += 1) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (!monthExists.has(monthKey)) {
      logger.warn('Skipping repeat update (snapshot missing)', { monthKey });
      continue;
    }

    const repeatCount = repeatsByMonth[monthKey] || 0;
    const snapshot = snapshotMap.get(monthKey);
    const wonDeals = snapshot?.won_deals || 0;
    const retentionRate = wonDeals > 0 ? repeatCount / wonDeals : null;
    await mqlRepository.updateSnapshot(year, month, {
      repeat_deals: repeatCount,
      retention_rate: retentionRate
    });
    logger.info('Updated repeat deals', { monthKey, repeatCount });
  }
}

function extractPersonId(deal = {}) {
  if (deal.personId) {
    return String(deal.personId);
  }
  if (deal.person_id) {
    return String(deal.person_id);
  }
  if (deal.person?.id) {
    return String(deal.person.id);
  }
  if (deal.person?.value) {
    return String(deal.person.value);
  }
  return null;
}

function extractDealId(deal = {}) {
  if (deal.id) {
    return String(deal.id);
  }
  if (deal.deal_id) {
    return String(deal.deal_id);
  }
  return null;
}

function isWonDeal(deal = {}) {
  const status = (deal.status || '').toLowerCase();
  if (status === 'won') {
    return true;
  }
  if (deal.wonTime || deal.won_time) {
    return true;
  }
  if (deal.closeTime || deal.close_time) {
    return status === 'won';
  }
  return false;
}

main().catch((error) => {
  logger.error('Repeat deals backfill failed', { error: error.message, stack: error.stack });
  process.exit(1);
});

