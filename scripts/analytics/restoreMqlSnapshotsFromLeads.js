#!/usr/bin/env node

/**
 * Восстановление MQL snapshots из таблицы mql_leads
 * Пересчитывает данные по месяцам из исходных лидов
 */

require('dotenv').config();
const supabase = require('../../src/services/supabaseClient');
const mqlRepository = require('../../src/services/analytics/mqlRepository');
const logger = require('../../src/utils/logger');

const YEAR = Number(process.argv[2]) || 2025;

async function restoreSnapshotsFromLeads(year) {
  logger.info('Восстановление MQL snapshots из leads', { year });

  try {
    // Получаем все лиды за год
    const { data: leads, error: leadsError } = await supabase
      .from('mql_leads')
      .select('source, first_seen_month')
      .gte('first_seen_month', `${year}-01-01`)
      .lte('first_seen_month', `${year}-12-31`);

    if (leadsError) {
      throw new Error(`Failed to fetch leads: ${leadsError.message}`);
    }

    logger.info('Получено лидов из базы', { count: leads?.length || 0 });

    // Группируем по месяцам и источникам
    const byMonth = {};
    leads?.forEach(lead => {
      const month = lead.first_seen_month.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) {
        byMonth[month] = { sendpulse: 0, pipedrive: 0 };
      }
      byMonth[month][lead.source] = (byMonth[month][lead.source] || 0) + 1;
    });

    // Обновляем snapshots
    let updated = 0;
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      const sendpulseMql = byMonth[monthKey]?.sendpulse || 0;
      const pipedriveMql = byMonth[monthKey]?.pipedrive || 0;
      const combinedMql = sendpulseMql + pipedriveMql;

      // Получаем существующий snapshot для сохранения других полей
      const existing = await mqlRepository.fetchSnapshot(year, month);

      await mqlRepository.upsertSnapshot(year, month, {
        sendpulseMql,
        pipedriveMql,
        combinedMql,
        // Сохраняем остальные поля из существующего snapshot
        wonDeals: existing?.won_deals || 0,
        repeatDeals: existing?.repeat_deals || 0,
        closedDeals: existing?.closed_deals || 0,
        marketingExpense: existing?.marketing_expense || 0,
        subscribers: existing?.subscribers || 0,
        newSubscribers: existing?.new_subscribers || 0,
        costPerSubscriber: existing?.cost_per_subscriber || null,
        costPerMql: existing?.cost_per_mql || null,
        costPerDeal: existing?.cost_per_deal || null,
        retentionRate: existing?.retention_rate || null,
        channelBreakdown: existing?.channel_breakdown || {},
        // Сохраняем даты синхронизации
        pipedriveSyncAt: existing?.pipedrive_sync_at,
        sendpulseSyncAt: existing?.sendpulse_sync_at,
        pnlSyncAt: existing?.pnl_sync_at
      });

      logger.info('Обновлен snapshot', {
        year,
        month,
        sendpulseMql,
        pipedriveMql,
        combinedMql
      });

      updated++;
    }

    logger.info('Восстановление завершено', { year, updated });
    return { success: true, updated };
  } catch (error) {
    logger.error('Ошибка восстановления', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  restoreSnapshotsFromLeads(YEAR)
    .then(() => {
      logger.info('Скрипт завершен успешно');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Критическая ошибка', { error: error.message });
      process.exit(1);
    });
}

module.exports = { restoreSnapshotsFromLeads };
