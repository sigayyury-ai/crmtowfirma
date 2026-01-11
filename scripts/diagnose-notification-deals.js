#!/usr/bin/env node

/**
 * Диагностика сделок, которым были отправлены уведомления об оплате
 * 
 * Использование:
 *   node scripts/diagnose-notification-deals.js [dealId1] [dealId2] ...
 * 
 * Примеры:
 *   node scripts/diagnose-notification-deals.js 1651 1882 1883
 *   node scripts/diagnose-notification-deals.js 1651
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

// Список deal_id из логов
const DEAL_IDS = process.argv.slice(2).map(id => parseInt(id, 10)).filter(id => !isNaN(id));

// Если не переданы аргументы, используем список из логов
const DEFAULT_DEAL_IDS = [
  1651, 1882, 1883, 1888, 1889, 1894, 1895, 1900, 1901, 1906, 1907,
  1912, 1913, 1918, 1919, 1924, 1925, 1930, 1931, 1936
];

const dealIdsToCheck = DEAL_IDS.length > 0 ? DEAL_IDS : DEFAULT_DEAL_IDS;

async function diagnoseDeal(dealId) {
  const processor = new StripeProcessorService();
  const repository = new StripeRepository();
  const pipedriveClient = new PipedriveClient();

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Диагностика Deal #${dealId}`);
    console.log('='.repeat(80));

    // 1. Получаем данные сделки
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Не удалось получить данные сделки: ${dealResult.error || 'unknown'}`);
      return { dealId, error: 'Failed to get deal data' };
    }

    const deal = dealResult.deal;
    const person = dealResult.person;
    const sendpulseId = person?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'] || null;

    console.log(`\n📋 Информация о сделке:`);
    console.log(`   Название: ${deal.title || 'N/A'}`);
    console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Стадия: ${deal.stage_id || 'N/A'}`);
    console.log(`   Клиент: ${person?.name || 'N/A'}`);
    console.log(`   Email: ${person?.email?.[0]?.value || person?.email || 'N/A'}`);
    console.log(`   SendPulse ID: ${sendpulseId || 'N/A'}`);

    // 2. Получаем все платежи
    const allPayments = await repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });

    console.log(`\n💳 Платежи (всего: ${allPayments.length}):`);
    
    if (allPayments.length === 0) {
      console.log(`   ⚠️  Платежей не найдено`);
      return { dealId, hasPayments: false };
    }

    // Подсчитываем статистику
    const paidPayments = allPayments.filter(p => 
      p.payment_status === 'paid' || p.status === 'processed'
    );
    
    const unpaidPayments = allPayments.filter(p => 
      p.payment_status !== 'paid' && p.status !== 'processed'
    );

    let totalPaidPln = 0;
    let totalUnpaidPln = 0;

    for (const payment of paidPayments) {
      const amountPln = payment.amount_pln !== null && payment.amount_pln !== undefined
        ? parseFloat(payment.amount_pln || 0)
        : parseFloat(payment.amount || 0);
      totalPaidPln += amountPln;
    }

    for (const payment of unpaidPayments) {
      const amountPln = payment.amount_pln !== null && payment.amount_pln !== undefined
        ? parseFloat(payment.amount_pln || 0)
        : parseFloat(payment.amount || 0);
      totalUnpaidPln += amountPln;
    }

    const dealValue = parseFloat(deal.value) || 0;
    const FINAL_THRESHOLD = 0.95;
    const paidRatio = dealValue > 0 ? totalPaidPln / dealValue : 0;
    const isFullyPaid = paidRatio >= FINAL_THRESHOLD;

    console.log(`   ✅ Оплачено: ${paidPayments.length} платежей, сумма: ${totalPaidPln.toFixed(2)} PLN`);
    console.log(`   ⏳ Не оплачено: ${unpaidPayments.length} платежей, сумма: ${totalUnpaidPln.toFixed(2)} PLN`);
    console.log(`   📊 Процент оплаты: ${(paidRatio * 100).toFixed(2)}%`);
    console.log(`   💰 Сумма сделки: ${dealValue.toFixed(2)} PLN`);
    console.log(`   ${isFullyPaid ? '✅' : '⚠️ '} Все оплачено: ${isFullyPaid ? 'ДА' : 'НЕТ'} (порог: ${(FINAL_THRESHOLD * 100)}%)`);

    // Детали по каждому платежу
    console.log(`\n📝 Детали платежей:`);
    for (const payment of allPayments) {
      const amountPln = payment.amount_pln !== null && payment.amount_pln !== undefined
        ? parseFloat(payment.amount_pln || 0)
        : parseFloat(payment.amount || 0);
      const isPaid = payment.payment_status === 'paid' || payment.status === 'processed';
      const statusIcon = isPaid ? '✅' : '⏳';
      console.log(`   ${statusIcon} Payment #${payment.id}: ${amountPln.toFixed(2)} ${payment.currency || 'PLN'} | ${payment.payment_type || 'N/A'} | ${payment.payment_status || payment.status || 'N/A'}`);
      if (payment.session_id) {
        console.log(`      Session: ${payment.session_id}`);
      }
    }

    // 3. Проверяем, должно ли было быть отправлено уведомление
    console.log(`\n📧 Анализ уведомлений:`);
    if (isFullyPaid) {
      console.log(`   ⚠️  ВНИМАНИЕ: Все платежи уже оплачены (${(paidRatio * 100).toFixed(2)}%)`);
      console.log(`   ✅ Уведомление НЕ должно было быть отправлено (благодаря новому исправлению)`);
    } else {
      console.log(`   ✅ Уведомление может быть отправлено (не все оплачено)`);
    }

    return {
      dealId,
      dealTitle: deal.title,
      dealValue,
      totalPaidPln,
      totalUnpaidPln,
      paidRatio,
      isFullyPaid,
      paidPaymentsCount: paidPayments.length,
      unpaidPaymentsCount: unpaidPayments.length,
      allPaymentsCount: allPayments.length,
      sendpulseId
    };

  } catch (error) {
    logger.error(`Ошибка диагностики Deal #${dealId}`, {
      dealId,
      error: error.message,
      stack: error.stack
    });
    console.log(`❌ Ошибка: ${error.message}`);
    return { dealId, error: error.message };
  }
}

async function main() {
  console.log('🔍 Диагностика сделок с отправленными уведомлениями об оплате\n');
  console.log(`Проверяем сделки: ${dealIdsToCheck.join(', ')}\n`);

  const results = [];

  for (const dealId of dealIdsToCheck) {
    const result = await diagnoseDeal(dealId);
    results.push(result);
    
    // Небольшая задержка между запросами, чтобы не перегружать API
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Итоговая сводка
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 ИТОГОВАЯ СВОДКА');
  console.log('='.repeat(80));

  const fullyPaid = results.filter(r => r.isFullyPaid === true);
  const notFullyPaid = results.filter(r => r.isFullyPaid === false);
  const errors = results.filter(r => r.error);

  console.log(`\n✅ Всего проверено: ${results.length} сделок`);
  console.log(`   ✅ Полностью оплачено: ${fullyPaid.length}`);
  console.log(`   ⏳ Не полностью оплачено: ${notFullyPaid.length}`);
  console.log(`   ❌ Ошибки: ${errors.length}`);

  if (fullyPaid.length > 0) {
    console.log(`\n⚠️  Сделки, которые полностью оплачены (уведомления не должны были отправляться):`);
    fullyPaid.forEach(r => {
      console.log(`   - Deal #${r.dealId}: ${r.dealTitle || 'N/A'} (${(r.paidRatio * 100).toFixed(2)}% оплачено)`);
    });
  }

  if (notFullyPaid.length > 0) {
    console.log(`\n✅ Сделки, которые не полностью оплачены (уведомления могут быть отправлены):`);
    notFullyPaid.forEach(r => {
      console.log(`   - Deal #${r.dealId}: ${r.dealTitle || 'N/A'} (${(r.paidRatio * 100).toFixed(2)}% оплачено)`);
    });
  }

  if (errors.length > 0) {
    console.log(`\n❌ Ошибки при диагностике:`);
    errors.forEach(r => {
      console.log(`   - Deal #${r.dealId}: ${r.error}`);
    });
  }
}

main().catch((error) => {
  logger.error('Script failed', { error: error.message, stack: error.stack });
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});


