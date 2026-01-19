#!/usr/bin/env node

require('dotenv').config();

const supabase = require('../../src/services/supabaseClient');
const logger = require('../../src/utils/logger');

async function checkMqlDataIntegrity() {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  
  logger.info('Проверка целостности данных MQL', { year });

  try {
    // Получаем все snapshots за год
    const { data: snapshots, error: snapshotsError } = await supabase
      .from('mql_monthly_snapshots')
      .select('*')
      .eq('year', year)
      .order('month', { ascending: true });

    if (snapshotsError) {
      throw new Error(`Failed to fetch snapshots: ${snapshotsError.message}`);
    }

    logger.info('Найдено snapshots', { count: snapshots?.length || 0 });

    // Проверяем каждую запись
    const issues = [];
    const summary = {
      totalMonths: snapshots?.length || 0,
      monthsWithPipedriveData: 0,
      monthsWithWonDeals: 0,
      monthsWithMissingData: [],
      monthsWithZeroButHasLeads: []
    };

    for (const snapshot of snapshots || []) {
      const monthKey = `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
      
      // Проверяем наличие данных из Pipedrive
      if (snapshot.pipedrive_mql > 0) {
        summary.monthsWithPipedriveData++;
      }

      // Проверяем наличие won deals
      if (snapshot.won_deals > 0) {
        summary.monthsWithWonDeals++;
      }

      // Проверяем, есть ли лиды из Pipedrive для этого месяца, но snapshot показывает 0
      // Используем правильные границы месяца
      const lastDayOfMonth = new Date(snapshot.year, snapshot.month, 0).getDate();
      const { data: leads, error: leadsError } = await supabase
        .from('mql_leads')
        .select('id')
        .eq('source', 'pipedrive')
        .gte('first_seen_month', `${monthKey}-01`)
        .lte('first_seen_month', `${monthKey}-${String(lastDayOfMonth).padStart(2, '0')}`)
        .limit(1);

      if (leadsError) {
        logger.warn('Ошибка при проверке лидов', { monthKey, error: leadsError.message });
        continue;
      }

      const hasLeads = (leads?.length || 0) > 0;
      
      if (hasLeads && snapshot.pipedrive_mql === 0) {
        issues.push({
          type: 'zero_mql_but_has_leads',
          month: monthKey,
          snapshot: {
            pipedrive_mql: snapshot.pipedrive_mql,
            combined_mql: snapshot.combined_mql,
            won_deals: snapshot.won_deals
          },
          leadsCount: leads.length
        });
        summary.monthsWithZeroButHasLeads.push(monthKey);
      }

      // Проверяем, есть ли данные из CRM, но они нулевые
      if (snapshot.pipedrive_sync_at && snapshot.pipedrive_mql === 0 && hasLeads) {
        issues.push({
          type: 'sync_but_zero_mql',
          month: monthKey,
          pipedrive_sync_at: snapshot.pipedrive_sync_at,
          leadsCount: leads.length
        });
      }

      // Проверяем, есть ли won deals, но нет данных из Pipedrive
      if (snapshot.won_deals > 0 && snapshot.pipedrive_mql === 0) {
        issues.push({
          type: 'won_deals_but_no_pipedrive_mql',
          month: monthKey,
          won_deals: snapshot.won_deals,
          pipedrive_mql: snapshot.pipedrive_mql
        });
      }

      // Проверяем даты синхронизации
      const now = new Date();
      const pipedriveSyncAt = snapshot.pipedrive_sync_at ? new Date(snapshot.pipedrive_sync_at) : null;
      const daysSinceSync = pipedriveSyncAt 
        ? Math.floor((now - pipedriveSyncAt) / (1000 * 60 * 60 * 24))
        : null;

      if (pipedriveSyncAt && daysSinceSync > 7) {
        issues.push({
          type: 'stale_sync',
          month: monthKey,
          daysSinceSync,
          pipedrive_sync_at: snapshot.pipedrive_sync_at
        });
      }
    }

    // Выводим результаты
    console.log('\n=== Сводка ===');
    console.log(`Год: ${year}`);
    console.log(`Всего месяцев: ${summary.totalMonths}`);
    console.log(`Месяцев с данными из Pipedrive: ${summary.monthsWithPipedriveData}`);
    console.log(`Месяцев с won deals: ${summary.monthsWithWonDeals}`);
    console.log(`Месяцев с нулевыми данными, но есть лиды: ${summary.monthsWithZeroButHasLeads.length}`);

    if (issues.length > 0) {
      console.log('\n=== Найдены проблемы ===');
      issues.forEach((issue, idx) => {
        console.log(`\n${idx + 1}. ${issue.type}`);
        console.log(`   Месяц: ${issue.month}`);
        if (issue.snapshot) {
          console.log(`   Snapshot:`, issue.snapshot);
        }
        if (issue.leadsCount !== undefined) {
          console.log(`   Лидов в базе: ${issue.leadsCount}`);
        }
        if (issue.daysSinceSync !== undefined) {
          console.log(`   Дней с последней синхронизации: ${issue.daysSinceSync}`);
        }
        if (issue.won_deals !== undefined) {
          console.log(`   Won deals: ${issue.won_deals}, Pipedrive MQL: ${issue.pipedrive_mql}`);
        }
      });
    } else {
      console.log('\n✅ Проблем не найдено');
    }

    // Выводим детальную информацию по каждому месяцу
    console.log('\n=== Детальная информация по месяцам ===');
    for (const snapshot of snapshots || []) {
      const monthKey = `${snapshot.year}-${String(snapshot.month).padStart(2, '0')}`;
      console.log(`\n${monthKey}:`);
      console.log(`  Pipedrive MQL: ${snapshot.pipedrive_mql}`);
      console.log(`  SendPulse MQL: ${snapshot.sendpulse_mql}`);
      console.log(`  Combined MQL: ${snapshot.combined_mql}`);
      console.log(`  Won deals: ${snapshot.won_deals}`);
      console.log(`  Closed deals: ${snapshot.closed_deals}`);
      console.log(`  Pipedrive sync: ${snapshot.pipedrive_sync_at || 'нет'}`);
      console.log(`  SendPulse sync: ${snapshot.sendpulse_sync_at || 'нет'}`);
      console.log(`  PNL sync: ${snapshot.pnl_sync_at || 'нет'}`);
    }

    return {
      success: true,
      summary,
      issues,
      issuesCount: issues.length
    };
  } catch (error) {
    logger.error('Ошибка при проверке данных', { error: error.message, stack: error.stack });
    throw error;
  }
}

if (require.main === module) {
  checkMqlDataIntegrity()
    .then((result) => {
      console.log('\n=== Результат проверки ===');
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.issuesCount > 0 ? 1 : 0);
    })
    .catch((error) => {
      console.error('Ошибка:', error.message);
      process.exit(1);
    });
}

module.exports = { checkMqlDataIntegrity };
