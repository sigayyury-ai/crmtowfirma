#!/usr/bin/env node
/**
 * Запуск крона обработки истекших сессий в dry-run режиме.
 * Показывает список сделок, для которых крон пересоздал бы Stripe сессии (без реального пересоздания).
 *
 * Использование: node scripts/run-expired-sessions-dry-run.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getScheduler } = require('../src/services/scheduler');

async function main() {
  console.log('\n🔍 Запуск цикла истекших сессий в dry-run режиме...\n');

  const scheduler = getScheduler();
  const result = await scheduler.runExpiredSessionsCycle({
    trigger: 'manual',
    dryRun: true
  });

  const summary = result.summary || {};
  const rawByDeal = summary.rawByDeal || {};
  const rawDealIds = Object.keys(rawByDeal);
  const tasks = summary.tasks || [];
  const totalFound = summary.totalFound ?? tasks.length;

  // 1) Сырой список: сделки с истекшими сессиями в Stripe (до фильтров)
  console.log('='.repeat(100));
  console.log('1) СДЕЛКИ С ИСТЕКШИМИ СЕССИЯМИ В STRIPE (сырой список, до фильтров)');
  console.log('='.repeat(100));
  console.log(`Сделок с истекшими неоплаченными сессиями: ${rawDealIds.length}`);
  console.log(`Всего истекших сессий: ${summary.rawSessions?.length ?? 0}`);
  console.log('');

  if (rawDealIds.length > 0) {
    console.log(
      'deal_id'.padEnd(10) + ' | ' + 'сессий'.padEnd(8) + ' | ' + 'типы (deposit/rest/single)'
    );
    console.log('-'.repeat(100));
    for (const dealId of rawDealIds.sort((a, b) => Number(a) - Number(b))) {
      const info = rawByDeal[dealId];
      const count = info?.count ?? 0;
      const types = [...new Set((info?.sessions ?? []).map((s) => s.paymentType).filter(Boolean))].join(', ') || '-';
      console.log(`${String(dealId).padEnd(10)} | ${String(count).padEnd(8)} | ${types}`);
    }
    console.log('-'.repeat(100));
  } else {
    console.log('Нет сделок с истекшими неоплаченными сессиями в Stripe.\n');
  }

  // 2) Список задач: для каких сделок крон пересоздал бы сессии (после фильтров)
  console.log('');
  console.log('='.repeat(100));
  console.log('2) СДЕЛКИ, ДЛЯ КОТОРЫХ КРОН ПЕРЕСОЗДАЛ БЫ СЕССИИ (после фильтров)');
  console.log('='.repeat(100));
  console.log(`Задач (будут пересозданы): ${totalFound}`);
  console.log('');

  if (tasks.length === 0) {
    console.log('Нет задач для пересоздания (все отфильтрованы: полностью оплачены, есть активная сессия и т.д.).\n');
    return;
  }

  console.log(
    'deal_id'.padEnd(10) +
      ' | ' +
      'title'.padEnd(28) +
      ' | ' +
      'type'.padEnd(8) +
      ' | ' +
      'amount'.padEnd(12) +
      ' | ' +
      'currency'.padEnd(8) +
      ' | ' +
      'customer'.padEnd(24) +
      ' | ' +
      'days_expired'
  );
  console.log('-'.repeat(100));

  for (const t of tasks) {
    const dealId = String(t.dealId || '-').padEnd(10);
    const title = (t.dealTitle || '-').slice(0, 28).padEnd(28);
    const type = (t.paymentType || '-').padEnd(8);
    const amount = String(t.paymentAmount ?? '-').padEnd(12);
    const currency = (t.currency || '-').padEnd(8);
    const customer = (t.customerName || t.customerEmail || '-').slice(0, 24).padEnd(24);
    const daysExpired = t.daysExpired != null ? String(t.daysExpired) : '-';
    console.log(`${dealId} | ${title} | ${type} | ${amount} | ${currency} | ${customer} | ${daysExpired}`);
  }

  console.log('-'.repeat(100));
  console.log(`\nИтого: ${tasks.length} сделок. В обычном режиме крон пересоздал бы для них Stripe сессии и отправил уведомления.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
