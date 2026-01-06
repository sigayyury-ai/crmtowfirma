#!/usr/bin/env node

/**
 * Показать третью сделку из списка сделок, которым нужен второй платеж
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');

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
      const hasPaidRest = allDealPayments.some(p => 
        (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
        p.payment_status === 'paid'
      );

      if (hasPaidRest) continue;

      const dealResult = await pipedrive.getDealWithRelatedData(parseInt(dealId, 10));
      if (!dealResult.success || !dealResult.deal) continue;

      const deal = dealResult.deal;
      const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
      
      if (initialSchedule.schedule !== '50/50') continue;

      const currentSchedule = PaymentScheduleService.determineScheduleFromDeal(deal);
      const secondPaymentDate = currentSchedule.secondPaymentDate || 
                                PaymentScheduleService.calculateSecondPaymentDate(deal.expected_close_date);
      const isDateReached = PaymentScheduleService.isSecondPaymentDateReached(secondPaymentDate);

      const paidAmount = allDealPayments
        .filter(p => p.payment_status === 'paid')
        .reduce((sum, p) => sum + (parseFloat(p.original_amount) || 0), 0);
      const totalAmount = parseFloat(deal.value) || 0;

      if (isDateReached) {
        const hasUnpaidRest = allDealPayments.some(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'unpaid'
        );

        dealsNeedingSecondPayment.push({
          dealId: parseInt(dealId, 10),
          title: deal.title,
          totalAmount,
          paidAmount,
          remainingAmount: totalAmount - paidAmount,
          currency: deal.currency || 'PLN',
          expectedCloseDate: deal.expected_close_date,
          secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null,
          initialSchedule: initialSchedule.schedule,
          currentSchedule: currentSchedule.schedule,
          status: deal.status,
          stageId: deal.stage_id,
          hasUnpaidRest
        });
      }
    } catch (error) {
      continue;
    }
  }

  return dealsNeedingSecondPayment.sort((a, b) => 
    new Date(a.secondPaymentDate || 0) - new Date(b.secondPaymentDate || 0)
  );
}

async function main() {
  const deals = await getDealsNeedingSecondPayment();

  if (deals.length === 0) {
    console.log('✅ Все сделки, требующие второго платежа, обработаны или не найдены.');
    return;
  }

  if (deals.length < 3) {
    console.log(`⚠️  Найдено только ${deals.length} сделок. Показываю последнюю:\n`);
    const deal = deals[deals.length - 1];
    const index = deals.length;
    console.log(`[${index}/${deals.length}]\n`);
    console.log('='.repeat(100));
    console.log(`\n📋 Deal #${deal.dealId}: ${deal.title}`);
    console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
    console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
    console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
    console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
    console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
    console.log(`   📊 Исходная схема: ${deal.initialSchedule}`);
    console.log(`   📊 Текущая схема: ${deal.currentSchedule}`);
    console.log(`   📋 Статус: ${deal.status}, Stage: ${deal.stageId}`);
    if (deal.hasUnpaidRest) {
      console.log('   ⚠️  ВНИМАНИЕ: Есть неоплаченные rest сессии для этой сделки. Возможно, это дубликаты.');
    }
    console.log('');
    return;
  }

  const index = parseInt(process.argv[2]) || 3; // По умолчанию третья, но можно указать другую
  const dealIndex = index - 1;
  
  if (dealIndex < 0 || dealIndex >= deals.length) {
    console.log(`⚠️  Индекс ${index} вне диапазона (1-${deals.length})`);
    return;
  }
  
  const deal = deals[dealIndex];

  console.log(`\n[${index}/${deals.length}]\n`);
  console.log('='.repeat(100));
  console.log(`\n📋 Deal #${deal.dealId}: ${deal.title}`);
  console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
  console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
  console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
  console.log(`   📊 Исходная схема: ${deal.initialSchedule}`);
  console.log(`   📊 Текущая схема: ${deal.currentSchedule}`);
  console.log(`   📋 Статус: ${deal.status}, Stage: ${deal.stageId}`);
  if (deal.hasUnpaidRest) {
    console.log('   ⚠️  ВНИМАНИЕ: Есть неоплаченные rest сессии для этой сделки. Возможно, это дубликаты.');
  }
  console.log('');
}

main().catch(error => {
  console.error('❌ Произошла ошибка:', error.message);
  process.exit(1);
});

