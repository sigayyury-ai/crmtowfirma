#!/usr/bin/env node

/**
 * Анализ сделок с оплатами, которые могут быть в неправильных статусах
 * 
 * Использование:
 *   node scripts/analyze-deals-status-issues.js [dealId1] [dealId2] ...
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const { evaluatePaymentStatus } = require('../src/services/crm/statusCalculator');
const logger = require('../src/utils/logger');

const DEAL_IDS = process.argv.slice(2).map(id => parseInt(id, 10)).filter(id => !isNaN(id));

// Если не переданы аргументы, проверяем проблемные сделки
const DEFAULT_DEAL_IDS = [1678, 1707, 1769, 1818, 1734, 1732, 1735, 1775];

const dealIdsToCheck = DEAL_IDS.length > 0 ? DEAL_IDS : DEFAULT_DEAL_IDS;

async function analyzeDeal(dealId, pipedriveClient, repository) {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Анализ Deal #${dealId}`);
    console.log('='.repeat(80));

    // 1. Получаем данные сделки
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Не удалось получить данные сделки: ${dealResult.error || 'unknown'}`);
      return { dealId, error: 'Failed to get deal data' };
    }

    const deal = dealResult.deal;
    const pipelineId = deal.pipeline_id;
    const pipelineName = deal.pipeline?.name || null;

    console.log(`\n📋 Информация о сделке:`);
    console.log(`   Название: ${deal.title || 'N/A'}`);
    console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    console.log(`   Стадия ID: ${deal.stage_id || 'N/A'}`);
    console.log(`   Стадия: ${deal.stage?.name || 'N/A'}`);
    console.log(`   Пайплайн ID: ${pipelineId || 'N/A'}`);
    console.log(`   Пайплайн: ${pipelineName || 'N/A'}`);

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

    // 3. Определяем правильный статус через statusCalculator
    const paymentSchedule = deal.payment_schedule || '100%';
    const evaluation = evaluatePaymentStatus({
      expectedAmountPln: dealValue,
      paidAmountPln: totalPaidPln,
      scheduleType: paymentSchedule,
      manualPaymentsCount: paidPayments.length,
      pipelineId: pipelineId,
      pipelineName: pipelineName
    });

    console.log(`\n🎯 Правильный статус (по statusCalculator):`);
    console.log(`   Целевая стадия: ${evaluation.targetStageName} (ID: ${evaluation.targetStageId})`);
    console.log(`   Текущая стадия: ${deal.stage?.name || 'N/A'} (ID: ${deal.stage_id || 'N/A'})`);
    console.log(`   Причина: ${evaluation.reason}`);

    // 4. Проверяем, правильный ли статус
    const currentStageId = deal.stage_id;
    const targetStageId = evaluation.targetStageId;
    const isCorrectStage = currentStageId === targetStageId;

    console.log(`\n${isCorrectStage ? '✅' : '⚠️ '} Статус: ${isCorrectStage ? 'ПРАВИЛЬНЫЙ' : 'НЕПРАВИЛЬНЫЙ'}`);
    
    if (!isCorrectStage) {
      console.log(`   Текущий: ${currentStageId} (${deal.stage?.name || 'N/A'})`);
      console.log(`   Должен быть: ${targetStageId} (${evaluation.targetStageName})`);
    }

    return {
      dealId,
      dealTitle: deal.title,
      currentStageId,
      targetStageId,
      isCorrectStage,
      isFullyPaid,
      paidRatio,
      totalPaidPln,
      dealValue,
      evaluation
    };

  } catch (error) {
    logger.error(`Ошибка анализа Deal #${dealId}`, {
      dealId,
      error: error.message,
      stack: error.stack
    });
    console.log(`❌ Ошибка: ${error.message}`);
    return { dealId, error: error.message };
  }
}

async function main() {
  console.log('🔍 Анализ статусов сделок с оплатами\n');
  console.log(`Проверяем сделки: ${dealIdsToCheck.join(', ')}\n`);

  const repository = new StripeRepository();
  const pipedriveClient = new PipedriveClient();

  const results = [];

  for (const dealId of dealIdsToCheck) {
    const result = await analyzeDeal(dealId, pipedriveClient, repository);
    results.push(result);
    
    // Небольшая задержка между запросами
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Итоговая сводка
  console.log(`\n\n${'='.repeat(80)}`);
  console.log('📊 ИТОГОВАЯ СВОДКА');
  console.log('='.repeat(80));

  const correct = results.filter(r => r.isCorrectStage === true);
  const incorrect = results.filter(r => r.isCorrectStage === false);
  const fullyPaid = results.filter(r => r.isFullyPaid === true);
  const errors = results.filter(r => r.error);

  console.log(`\n✅ Всего проверено: ${results.length} сделок`);
  console.log(`   ✅ Правильный статус: ${correct.length}`);
  console.log(`   ⚠️  Неправильный статус: ${incorrect.length}`);
  console.log(`   ✅ Полностью оплачено: ${fullyPaid.length}`);
  console.log(`   ❌ Ошибки: ${errors.length}`);

  if (incorrect.length > 0) {
    console.log(`\n⚠️  Сделки с неправильным статусом:`);
    incorrect.forEach(r => {
      console.log(`   - Deal #${r.dealId}: ${r.dealTitle || 'N/A'}`);
      console.log(`     Текущий: ${r.currentStageId}, Должен быть: ${r.targetStageId}`);
      console.log(`     Оплачено: ${(r.paidRatio * 100).toFixed(2)}%`);
    });
  }

  if (fullyPaid.length > 0) {
    console.log(`\n✅ Полностью оплаченные сделки:`);
    fullyPaid.forEach(r => {
      const status = r.isCorrectStage ? '✅' : '⚠️';
      console.log(`   ${status} Deal #${r.dealId}: ${r.dealTitle || 'N/A'} - ${(r.paidRatio * 100).toFixed(2)}% оплачено`);
    });
  }
}

main().catch((error) => {
  logger.error('Script failed', { error: error.message, stack: error.stack });
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});



