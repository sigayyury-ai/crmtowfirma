#!/usr/bin/env node

/**
 * Анализ логов на предмет обработки webhook'ов от Stripe, смены статусов и уведомлений
 * 
 * Использование:
 *   node scripts/analyze-stripe-webhooks-and-notifications.js [--lines=1000]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LINES = process.argv.includes('--lines') 
  ? parseInt(process.argv[process.argv.indexOf('--lines') + 1] || '1000', 10)
  : 1000;

async function fetchLogs() {
  try {
    console.log(`📥 Получение последних ${LINES} строк логов...\n`);
    const output = execSync(
      `node scripts/fetch-render-logs.js --lines=${LINES}`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return output;
  } catch (error) {
    console.error('❌ Ошибка получения логов:', error.message);
    process.exit(1);
  }
}

function analyzeLogs(logs) {
  const lines = logs.split('\n');
  
  const analysis = {
    webhooks: {
      total: 0,
      completed: 0,
      expired: 0,
      asyncSucceeded: 0,
      asyncFailed: 0,
      paymentIntentSucceeded: 0,
      refunded: 0,
      byDeal: new Map()
    },
    notifications: {
      paymentSuccess: 0,
      paymentCreation: 0,
      refund: 0,
      skipped: 0,
      byDeal: new Map()
    },
    statusUpdates: {
      total: 0,
      toCampWaiter: 0,
      toSecondPayment: 0,
      toFirstPayment: 0,
      unchanged: 0,
      byDeal: new Map()
    },
    errors: []
  };

  for (const line of lines) {
    // Анализ webhook'ов
    if (line.includes('Stripe webhook получен')) {
      analysis.webhooks.total++;
      
      if (line.includes('checkout.session.completed')) {
        analysis.webhooks.completed++;
        const dealMatch = line.match(/"dealId":([0-9]+)/);
        if (dealMatch) {
          const dealId = dealMatch[1];
          analysis.webhooks.byDeal.set(dealId, (analysis.webhooks.byDeal.get(dealId) || 0) + 1);
        }
      } else if (line.includes('checkout.session.expired')) {
        analysis.webhooks.expired++;
      } else if (line.includes('checkout.session.async_payment_succeeded')) {
        analysis.webhooks.asyncSucceeded++;
      } else if (line.includes('checkout.session.async_payment_failed')) {
        analysis.webhooks.asyncFailed++;
      } else if (line.includes('payment_intent.succeeded')) {
        analysis.webhooks.paymentIntentSucceeded++;
      } else if (line.includes('charge.refunded')) {
        analysis.webhooks.refunded++;
      }
    }

    // Анализ обработки webhook'ов
    if (line.includes('Обработка Checkout Session') || line.includes('Checkout Session обработан')) {
      const dealMatch = line.match(/Deal.*?([0-9]+)/);
      if (dealMatch) {
        const dealId = dealMatch[1];
        analysis.webhooks.byDeal.set(dealId, (analysis.webhooks.byDeal.get(dealId) || 0) + 1);
      }
    }

    // Анализ уведомлений
    if (line.includes('Payment success notification sent successfully')) {
      analysis.notifications.paymentSuccess++;
      const dealMatch = line.match(/"dealId":([0-9]+)/);
      if (dealMatch) {
        const dealId = dealMatch[1];
        const count = analysis.notifications.byDeal.get(dealId) || 0;
        analysis.notifications.byDeal.set(dealId, count + 1);
      }
    }

    if (line.includes('SendPulse payment notification sent successfully')) {
      analysis.notifications.paymentCreation++;
      const dealMatch = line.match(/"dealId":([0-9]+)/);
      if (dealMatch) {
        const dealId = dealMatch[1];
        const count = analysis.notifications.byDeal.get(dealId) || 0;
        analysis.notifications.byDeal.set(dealId, count + 1);
      }
    }

    if (line.includes('Refund notification sent via SendPulse')) {
      analysis.notifications.refund++;
    }

    if (line.includes('Пропуск уведомления') || line.includes('⏭️') || line.includes('skipped.*true')) {
      analysis.notifications.skipped++;
    }

    // Анализ смены статусов
    if (line.includes('CRM status automation: evaluating stage update')) {
      analysis.statusUpdates.total++;
      const dealMatch = line.match(/"dealId":"([0-9]+)"/);
      const targetMatch = line.match(/"targetStageId":([0-9]+)/);
      if (dealMatch && targetMatch) {
        const dealId = dealMatch[1];
        const targetStageId = parseInt(targetMatch[1], 10);
        
        // Стадии: 18 = First Payment, 32 = Second Payment, 27 = Camp Waiter
        if (targetStageId === 27 || targetStageId === 39) {
          analysis.statusUpdates.toCampWaiter++;
        } else if (targetStageId === 32 || targetStageId === 38) {
          analysis.statusUpdates.toSecondPayment++;
        } else if (targetStageId === 18 || targetStageId === 37) {
          analysis.statusUpdates.toFirstPayment++;
        }
        
        analysis.statusUpdates.byDeal.set(dealId, {
          targetStageId,
          count: (analysis.statusUpdates.byDeal.get(dealId)?.count || 0) + 1
        });
      }
    }

    if (line.includes('CRM status automation: stage unchanged')) {
      analysis.statusUpdates.unchanged++;
    }

    // Анализ ошибок
    if (line.includes('error') || line.includes('Error') || line.includes('❌')) {
      if (line.includes('Stripe') || line.includes('webhook') || line.includes('notification')) {
        analysis.errors.push(line.substring(0, 200));
      }
    }
  }

  return analysis;
}

function printReport(analysis) {
  console.log('='.repeat(80));
  console.log('📊 АНАЛИЗ ОБРАБОТКИ WEBHOOK\'ОВ ОТ STRIPE, СМЕНЫ СТАТУСОВ И УВЕДОМЛЕНИЙ');
  console.log('='.repeat(80));

  console.log('\n🔔 WEBHOOK\'И ОТ STRIPE:');
  console.log(`   Всего получено: ${analysis.webhooks.total}`);
  console.log(`   ✅ checkout.session.completed: ${analysis.webhooks.completed}`);
  console.log(`   ⏰ checkout.session.expired: ${analysis.webhooks.expired}`);
  console.log(`   ✅ checkout.session.async_payment_succeeded: ${analysis.webhooks.asyncSucceeded}`);
  console.log(`   ❌ checkout.session.async_payment_failed: ${analysis.webhooks.asyncFailed}`);
  console.log(`   ✅ payment_intent.succeeded: ${analysis.webhooks.paymentIntentSucceeded}`);
  console.log(`   💰 charge.refunded: ${analysis.webhooks.refunded}`);

  if (analysis.webhooks.byDeal.size > 0) {
    console.log(`\n   Сделки с webhook'ами (топ 10):`);
    const sortedDeals = Array.from(analysis.webhooks.byDeal.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    sortedDeals.forEach(([dealId, count]) => {
      console.log(`      Deal #${dealId}: ${count} webhook'ов`);
    });
  }

  console.log('\n📧 УВЕДОМЛЕНИЯ:');
  console.log(`   ✅ Успешная оплата: ${analysis.notifications.paymentSuccess}`);
  console.log(`   📝 Создание платежа: ${analysis.notifications.paymentCreation}`);
  console.log(`   💰 Возврат: ${analysis.notifications.refund}`);
  console.log(`   ⏭️  Пропущено (дубликаты/уже оплачено): ${analysis.notifications.skipped}`);

  if (analysis.notifications.byDeal.size > 0) {
    console.log(`\n   Сделки с уведомлениями (топ 10):`);
    const sortedDeals = Array.from(analysis.notifications.byDeal.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    sortedDeals.forEach(([dealId, count]) => {
      console.log(`      Deal #${dealId}: ${count} уведомлений`);
    });
  }

  console.log('\n🔄 СМЕНА СТАТУСОВ:');
  console.log(`   Всего попыток обновления: ${analysis.statusUpdates.total}`);
  console.log(`   ✅ → Camp Waiter: ${analysis.statusUpdates.toCampWaiter}`);
  console.log(`   ✅ → Second Payment: ${analysis.statusUpdates.toSecondPayment}`);
  console.log(`   ✅ → First Payment: ${analysis.statusUpdates.toFirstPayment}`);
  console.log(`   ⏸️  Без изменений: ${analysis.statusUpdates.unchanged}`);

  if (analysis.statusUpdates.byDeal.size > 0) {
    console.log(`\n   Сделки со сменой статусов (топ 10):`);
    const sortedDeals = Array.from(analysis.statusUpdates.byDeal.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10);
    sortedDeals.forEach(([dealId, data]) => {
      const stageName = data.targetStageId === 27 || data.targetStageId === 39 ? 'Camp Waiter' :
                       data.targetStageId === 32 || data.targetStageId === 38 ? 'Second Payment' :
                       data.targetStageId === 18 || data.targetStageId === 37 ? 'First Payment' : `Stage ${data.targetStageId}`;
      console.log(`      Deal #${dealId}: ${data.count} попыток → ${stageName}`);
    });
  }

  if (analysis.errors.length > 0) {
    console.log('\n❌ ОШИБКИ (первые 10):');
    analysis.errors.slice(0, 10).forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.substring(0, 150)}...`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Анализ завершен');
  console.log('='.repeat(80));
}

async function main() {
  try {
    const logs = await fetchLogs();
    const analysis = analyzeLogs(logs);
    printReport(analysis);
  } catch (error) {
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

main();


