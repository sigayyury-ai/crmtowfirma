#!/usr/bin/env node

/**
 * Восстановление данных по сделкам (won_deals, closed_deals, repeat_deals) из mql_leads
 */

require('dotenv').config();
const supabase = require('../../src/services/supabaseClient');
const mqlRepository = require('../../src/services/analytics/mqlRepository');
const logger = require('../../src/utils/logger');

const YEAR = Number(process.argv[2]) || 2025;

function getMonthKey(timestamp) {
  if (!timestamp) return null;
  try {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function isWonDeal(deal = {}) {
  const status = (deal.status || '').toLowerCase();
  if (status === 'won') return true;
  if (deal.wonTime || deal.won_time) return true;
  if (deal.closeTime || deal.close_time) {
    return status === 'won';
  }
  return false;
}

function extractPersonId(deal = {}) {
  if (deal.personId) return String(deal.personId);
  if (deal.person_id) return String(deal.person_id);
  return null;
}

async function restoreDealsData(year) {
  logger.info('Восстановление данных по сделкам', { year });

  try {
    // Получаем все лиды Pipedrive за год
    const { data: leads, error: leadsError } = await supabase
      .from('mql_leads')
      .select('id, first_seen_month, payload')
      .eq('source', 'pipedrive')
      .gte('first_seen_month', `${year}-01-01`)
      .lte('first_seen_month', `${year}-12-31`);

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    logger.info('Получено Pipedrive лидов', { count: leads?.length || 0 });

    // Собираем все person_id из выигранных сделок для определения repeat deals
    const wonDealsByPerson = new Map(); // person_id -> [deal1, deal2, ...]
    const wonDealsByMonth = {}; // monthKey -> count
    const closedDealsByMonth = {}; // monthKey -> count
    const countedWonDeals = new Set(); // для дедупликации

    leads?.forEach(lead => {
      const deal = lead?.payload || {};
      if (!deal || typeof deal !== 'object') return;

      const dealId = deal.id || deal.dealId;
      if (!dealId) return;

      // Won deals
      if (isWonDeal(deal)) {
        const wonMonth = getMonthKey(deal.wonTime || deal.won_time || deal.updateTime || deal.update_time);
        if (wonMonth && wonMonth.startsWith(`${year}-`)) {
          const key = `${dealId}-${wonMonth}`;
          if (!countedWonDeals.has(key)) {
            countedWonDeals.add(key);
            wonDealsByMonth[wonMonth] = (wonDealsByMonth[wonMonth] || 0) + 1;

            // Сохраняем для определения repeat deals
            const personId = extractPersonId(deal);
            if (personId) {
              if (!wonDealsByPerson.has(personId)) {
                wonDealsByPerson.set(personId, []);
              }
              wonDealsByPerson.get(personId).push({
                dealId,
                wonMonth,
                deal
              });
            }
          }
        }
      }

      // Closed deals
      const closedTime = deal.closeTime || deal.close_time || deal.wonTime || deal.won_time || deal.lostTime || deal.lost_time;
      if (closedTime) {
        const closedMonth = getMonthKey(closedTime);
        if (closedMonth && closedMonth.startsWith(`${year}-`)) {
          closedDealsByMonth[closedMonth] = (closedDealsByMonth[closedMonth] || 0) + 1;
        }
      }
    });

    // Определяем repeat deals (если у персоны было больше одной выигранной сделки)
    const repeatDealsByMonth = {};
    const customerIds = new Set();
    
    wonDealsByPerson.forEach((deals, personId) => {
      if (deals.length > 1) {
        customerIds.add(personId);
        // Все сделки кроме первой считаются repeat
        deals.slice(1).forEach(({ wonMonth }) => {
          repeatDealsByMonth[wonMonth] = (repeatDealsByMonth[wonMonth] || 0) + 1;
        });
      }
    });

    // Обновляем snapshots
    let updated = 0;
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const wonDeals = wonDealsByMonth[monthKey] || 0;
      const closedDeals = closedDealsByMonth[monthKey] || 0;
      const repeatDeals = repeatDealsByMonth[monthKey] || 0;
      const retentionRate = wonDeals > 0 ? repeatDeals / wonDeals : null;

      // Получаем существующий snapshot
      const existing = await mqlRepository.fetchSnapshot(year, month);
      if (!existing) {
        logger.warn('Snapshot не найден, пропускаем', { year, month });
        continue;
      }

      await mqlRepository.upsertSnapshot(year, month, {
        wonDeals,
        closedDeals,
        repeatDeals,
        retentionRate,
        // Сохраняем остальные поля
        sendpulseMql: existing.sendpulse_mql || 0,
        pipedriveMql: existing.pipedrive_mql || 0,
        combinedMql: existing.combined_mql || 0,
        marketingExpense: existing.marketing_expense || 0,
        subscribers: existing.subscribers || 0,
        newSubscribers: existing.new_subscribers || 0,
        costPerSubscriber: existing.cost_per_subscriber || null,
        costPerMql: existing.cost_per_mql || null,
        costPerDeal: existing.cost_per_deal || null,
        channelBreakdown: existing.channel_breakdown || {},
        pipedriveSyncAt: existing.pipedrive_sync_at,
        sendpulseSyncAt: existing.sendpulse_sync_at,
        pnlSyncAt: existing.pnl_sync_at
      });

      logger.info('Обновлены данные по сделкам', {
        year,
        month,
        wonDeals,
        closedDeals,
        repeatDeals,
        retentionRate: retentionRate ? (retentionRate * 100).toFixed(1) + '%' : null
      });

      updated++;
    }

    logger.info('Восстановление данных по сделкам завершено', { year, updated, customerIds: customerIds.size });
    return { success: true, updated, customerIds: customerIds.size };
  } catch (error) {
    logger.error('Ошибка восстановления данных по сделкам', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  restoreDealsData(YEAR)
    .then(() => {
      logger.info('Скрипт завершен успешно');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Критическая ошибка', { error: error.message });
      process.exit(1);
    });
}

module.exports = { restoreDealsData };
