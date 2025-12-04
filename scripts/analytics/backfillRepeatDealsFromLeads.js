#!/usr/bin/env node

require('dotenv').config();

const logger = require('../../src/utils/logger');
const supabase = require('../../src/services/supabaseClient');
const mqlRepository = require('../../src/services/analytics/mqlRepository');
const { getMonthKey } = require('../../src/services/analytics/mqlNormalizer');

async function main() {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  logger.info('Backfilling repeat deals from mql_leads history', { year });

  const wonDeals = await fetchWonDeals();
  logger.info('Fetched won deals from Supabase', { count: wonDeals.length });

  const repeatsByMonth = calculateRepeatsByMonth(wonDeals, year);
  await persistRepeats(year, repeatsByMonth);

  logger.info('Repeat deals backfill via leads completed', {
    year,
    repeats: repeatsByMonth
  });
}

async function fetchWonDeals() {
  const { data, error } = await supabase
    .from('mql_leads')
    .select('payload')
    .eq('source', 'pipedrive');

  if (error) {
    throw new Error(`Failed to fetch mql_leads: ${error.message}`);
  }

  return data
    .map((row) => row.payload || {})
    .filter((deal) => isWonDeal(deal) && extractPersonId(deal) && extractDealId(deal))
    .map((deal) => ({
      id: extractDealId(deal),
      personId: extractPersonId(deal),
      wonAt:
        deal.wonTime ||
        deal.won_time ||
        deal.closeTime ||
        deal.close_time ||
        deal.updateTime ||
        deal.update_time ||
        deal.addTime ||
        deal.add_time,
      raw: deal
    }))
    .filter((deal) => Boolean(deal.wonAt));
}

function calculateRepeatsByMonth(deals, targetYear) {
  const perPerson = new Map();

  deals.forEach((deal) => {
    if (!perPerson.has(deal.personId)) {
      perPerson.set(deal.personId, []);
    }
    perPerson.get(deal.personId).push(deal);
  });

  const repeats = {};

  perPerson.forEach((personDeals) => {
    personDeals.sort((a, b) => {
      const ta = new Date(a.wonAt).getTime();
      const tb = new Date(b.wonAt).getTime();
      return ta - tb;
    });

    personDeals.forEach((deal, index) => {
      if (index === 0) {
        return; // first win is initial purchase
      }

      const monthKey = getMonthKey(deal.wonAt);
      if (!monthKey || !monthKey.startsWith(`${targetYear}-`)) {
        return;
      }

      repeats[monthKey] = (repeats[monthKey] || 0) + 1;
    });
  });

  return repeats;
}

async function persistRepeats(year, repeatsByMonth) {
  const snapshots = await mqlRepository.fetchSnapshots(year);
  const monthsWithSnapshots = new Set(
    snapshots.map((snapshot) => `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`)
  );
  const snapshotMap = new Map(
    snapshots.map((snapshot) => [`${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`, snapshot])
  );

  for (let month = 1; month <= 12; month += 1) {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (!monthsWithSnapshots.has(monthKey)) {
      logger.warn('Skipping repeat update, snapshot missing', { monthKey });
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
    logger.info('Updated repeat deals via leads', { monthKey, repeatCount });
  }
}

function extractPersonId(deal = {}) {
  return (
    normalize(deal.personId) ||
    normalize(deal.person_id) ||
    normalize(deal.person?.id) ||
    normalize(deal.person?.value)
  );
}

function extractDealId(deal = {}) {
  return normalize(deal.id || deal.deal_id);
}

function normalize(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length ? str : null;
}

function isWonDeal(deal = {}) {
  const status = (deal.status || '').toLowerCase();
  return status === 'won' || Boolean(deal.wonTime || deal.won_time);
}

main().catch((error) => {
  logger.error('Failed to backfill repeat deals via leads', { error: error.message });
  process.exit(1);
});

