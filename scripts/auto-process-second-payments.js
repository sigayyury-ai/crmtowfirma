#!/usr/bin/env node

/**
 * Автоматическая обработка всех сделок, которым нужен второй платеж
 * 
 * Правила:
 * - Если схема была 50/50 - создаем второй платеж на остаток
 * - Если дата закрытия меньше 30 дней - все равно создаем по исходной схеме 50/50
 * - Сделки, которые уже обработаны - пропускаем
 * 
 * Использование:
 *   node scripts/auto-process-second-payments.js
 *   node scripts/auto-process-second-payments.js --dry-run  # Только показать, что будет сделано
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeProcessorService = require('../src/services/stripe/processor');
const logger = require('../src/utils/logger');

async function getDealsNeedingSecondPayment() {
  const repository = new StripeRepository();
  const pipedrive = new PipedriveClient();
  const schedulerService = new SecondPaymentSchedulerService();

  const allPayments = await repository.listPayments({ limit: 10000 });
  
  const paidDepositPayments = allPayments.filter(p => 
    (p.payment_type === 'deposit' || p.payment_type === 'first') &&
    p.payment_status === 'paid' &&
    (p.payment_schedule === '50/50' || !p.payment_schedule)
  );

  const dealsMap = new Map();
  for (const payment of paidDepositPayments) {
    const dealId = payment.deal_id;
    if (!dealsMap.has(dealId)) {
      dealsMap.set(dealId, []);
    }
    dealsMap.get(dealId).push(payment);
  }

  const dealsNeedingSecondPayment = [];
  
  for (const [dealId, payments] of dealsMap.entries()) {
    try {
      const allDealPayments = await repository.listPayments({ dealId: String(dealId) });
      
      // Пропускаем, если второй платеж уже оплачен
      const hasPaidRest = allDealPayments.some(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status === 'paid'
      );

      if (hasPaidRest) continue;

      const dealResult = await pipedrive.getDealWithRelatedData(parseInt(dealId, 10));
      if (!dealResult.success || !dealResult.deal) continue;

      const deal = dealResult.deal;
      const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
      
      // Только сделки с исходной схемой 50/50
      if (initialSchedule.schedule !== '50/50') continue;

      const currentSchedule = PaymentScheduleService.determineScheduleFromDeal(deal);
      const secondPaymentDate = currentSchedule.secondPaymentDate || 
                                PaymentScheduleService.calculateSecondPaymentDate(deal.expected_close_date);
      const isDateReached = PaymentScheduleService.isSecondPaymentDateReached(secondPaymentDate);

      const paidAmount = allDealPayments
        .filter(p => p.payment_status === 'paid')
        .reduce((sum, p) => sum + (parseFloat(p.original_amount) || 0), 0);
      const totalAmount = parseFloat(deal.value) || 0;
      const remainingAmount = totalAmount - paidAmount;

      // Проверяем, есть ли уже неоплаченный rest платеж
      const hasUnpaidRest = allDealPayments.some(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status === 'unpaid'
      );

      // Если дата наступила или уже прошла - добавляем в список
      if (isDateReached && remainingAmount > 0) {
        dealsNeedingSecondPayment.push({
          dealId: parseInt(dealId, 10),
          title: deal.title,
          totalAmount,
          paidAmount,
          remainingAmount,
          currency: deal.currency || 'PLN',
          expectedCloseDate: deal.expected_close_date,
          secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null,
          initialSchedule: initialSchedule.schedule,
          currentSchedule: currentSchedule.schedule,
          status: deal.status,
          stageId: deal.stage_id,
          hasUnpaidRest,
          isDateReached
        });
      }
    } catch (error) {
      logger.warn(`Ошибка при обработке сделки ${dealId}`, { error: error.message });
      continue;
    }
  }

  return dealsNeedingSecondPayment.sort((a, b) => 
    new Date(a.secondPaymentDate || 0) - new Date(b.secondPaymentDate || 0)
  );
}

async function processDeal(deal, processor, dryRun = false) {
  console.log(`\n${'='.repeat(100)}`);
  console.log(`\n📋 Deal #${deal.dealId}: ${deal.title}`);
  console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
  console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
  console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
  console.log(`   📊 Исходная схема: ${deal.initialSchedule}`);
  console.log(`   📊 Текущая схема: ${deal.currentSchedule}`);
  
  if (deal.hasUnpaidRest) {
    console.log(`   ⚠️  ВНИМАНИЕ: Есть неоплаченные rest сессии. Пропускаем.`);
    return { success: false, reason: 'has_unpaid_rest', skipped: true };
  }

  if (dryRun) {
    console.log(`   🔍 DRY RUN: Будет создан второй платеж на ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
    return { success: true, dryRun: true };
  }

  try {
    console.log(`\n   🔄 Создаю второй платеж...`);
    
    const result = await processor.createCheckoutSessionForDeal(
      { id: deal.dealId },
      {
        trigger: 'auto_process_second_payments',
        runId: `auto_${Date.now()}`,
        paymentType: 'rest',
        paymentSchedule: deal.initialSchedule, // Используем исходную схему 50/50
        customAmount: deal.remainingAmount, // Создаем сессию на оставшуюся сумму
        paymentIndex: 2,
        skipNotification: false, // Отправляем уведомление
        setInvoiceTypeDone: true // Ставим invoice_type в Done
      }
    );

    if (result.success) {
      console.log(`   ✅ Второй платеж успешно создан!`);
      console.log(`   🔗 URL: ${result.sessionUrl}`);
      console.log(`   💰 Сумма: ${result.amount} ${result.currency}`);
      return { success: true, sessionId: result.sessionId, sessionUrl: result.sessionUrl };
    } else {
      console.error(`   ❌ Ошибка при создании платежа: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error(`   ❌ Непредвиденная ошибка: ${error.message}`);
    logger.error('Unexpected error during second payment creation', {
      dealId: deal.dealId,
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - изменения не будут применены\n');
  }

  console.log('🚀 Автоматическая обработка сделок, которым нужен второй платеж...\n');
  console.log('📋 Правила:');
  console.log('   - Схема должна быть 50/50 (исходная из первого платежа)');
  console.log('   - Дата второго платежа должна быть достигнута');
  console.log('   - Сделки с уже созданными (но неоплаченными) rest сессиями - пропускаются');
  console.log('   - Сделки с оплаченными rest платежами - пропускаются\n');

  const processor = new StripeProcessorService();
  const deals = await getDealsNeedingSecondPayment();

  if (deals.length === 0) {
    console.log('✅ Все сделки, требующие второго платежа, обработаны или не найдены.');
    return;
  }

  console.log(`📊 Найдено сделок: ${deals.length}\n`);

  const results = {
    total: deals.length,
    processed: 0,
    skipped: 0,
    failed: 0,
    details: []
  };

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];
    console.log(`\n[${i + 1}/${deals.length}]`);
    
    const result = await processDeal(deal, processor, dryRun);
    
    if (result.success) {
      results.processed++;
      results.details.push({
        dealId: deal.dealId,
        title: deal.title,
        status: 'processed',
        sessionId: result.sessionId,
        sessionUrl: result.sessionUrl
      });
    } else if (result.skipped) {
      results.skipped++;
      results.details.push({
        dealId: deal.dealId,
        title: deal.title,
        status: 'skipped',
        reason: result.reason
      });
    } else {
      results.failed++;
      results.details.push({
        dealId: deal.dealId,
        title: deal.title,
        status: 'failed',
        error: result.error
      });
    }

    // Небольшая задержка между обработкой сделок
    if (i < deals.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`\n${'='.repeat(100)}`);
  console.log('\n📊 ИТОГОВАЯ СВОДКА:');
  console.log('='.repeat(100));
  console.log(`   Всего сделок: ${results.total}`);
  console.log(`   ✅ Обработано: ${results.processed}`);
  console.log(`   ⏭️  Пропущено: ${results.skipped}`);
  console.log(`   ❌ Ошибок: ${results.failed}`);
  console.log('');

  if (results.failed > 0) {
    console.log('❌ Сделки с ошибками:');
    results.details.filter(d => d.status === 'failed').forEach(d => {
      console.log(`   - Deal #${d.dealId}: ${d.title} - ${d.error}`);
    });
    console.log('');
  }

  if (dryRun) {
    console.log('🔍 DRY RUN: Изменения не были применены.\n');
  } else {
    console.log('✅ Автоматическая обработка завершена.\n');
  }
}

main().catch(error => {
  logger.error('Script failed:', error);
  console.error('❌ Произошла ошибка:', error.message);
  process.exit(1);
});

