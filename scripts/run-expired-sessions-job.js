#!/usr/bin/env node
/**
 * Запуск крона обработки истекших Stripe-сессий (то же, что каждые 4 часа).
 * Находит истекшие неоплаченные сессии и пересоздаёт их, отправляет уведомления.
 *
 * Использование: node scripts/run-expired-sessions-job.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getScheduler } = require('../src/services/scheduler');

async function main() {
  console.log('\n🔄 Запуск цикла истекших Stripe-сессий (manual trigger)...\n');
  const scheduler = getScheduler();
  const result = await scheduler.runExpiredSessionsCycle({ trigger: 'manual', dryRun: false });
  console.log('\nРезультат:', JSON.stringify(result, null, 2));
  console.log('\nГотово.\n');
  process.exit(result.success ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
