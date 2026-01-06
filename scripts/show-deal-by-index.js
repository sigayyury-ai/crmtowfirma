#!/usr/bin/env node

/**
 * Показать сделку по индексу из списка сделок, которым нужен второй платеж
 * 
 * Использование:
 *   node scripts/show-deal-by-index.js <index>
 *   node scripts/show-deal-by-index.js 3  # Показать третью сделку
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

  for (const dealId of dealsMap.keys()) {
    const dealPayments = dealsMap.get(dealId);
    const hasPaidDeposit = dealPayments.some(p => (p.payment_type === 'deposit' || p.payment_type === 'first') && p.payment_status === 'paid');
    const hasPaidRest = dealPayments.some(p => (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') && p.payment_status === 'paid');
    const hasUnpaidRest = dealPayments.some(p => (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') && p.payment_status === 'unpaid');

    if (hasPaidDeposit && !hasPaidRest) {
      const dealResult = await pipedrive.getDeal(dealId);
      if (dealResult.success && dealResult.deal) {
        const deal = dealResult.deal;
        const schedule = PaymentScheduleService.determineScheduleFromDeal(deal);
        const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);

        if (initialSchedule.schedule === '50/50' && schedule.secondPaymentDate && PaymentScheduleService.isSecondPaymentDateReached(schedule.secondPaymentDate)) {
          const totalAmount = parseFloat(deal.value);
          const paidAmount = dealPayments
            .filter(p => p.payment_status === 'paid')
            .reduce((sum, p) => sum + p.original_amount, 0);
          const remainingAmount = totalAmount - paidAmount;

          if (remainingAmount > 0) {
            dealsNeedingSecondPayment.push({
              dealId: deal.id,
              title: deal.title,
              totalAmount,
              paidAmount,
              remainingAmount,
              currency: deal.currency,
              expectedCloseDate: deal.expected_close_date,
              secondPaymentDate: schedule.secondPaymentDate.toISOString().split('T')[0],
              initialSchedule: initialSchedule.schedule,
              currentSchedule: schedule.schedule,
              status: deal.status,
              stageId: deal.stage_id,
              hasUnpaidRest: hasUnpaidRest
            });
          }
        }
      }
    }
  }

  return dealsNeedingSecondPayment.sort((a, b) => 
    new Date(a.secondPaymentDate || 0) - new Date(b.secondPaymentDate || 0)
  );
}

async function main() {
  const index = parseInt(process.argv[2]) || 1;
  const deals = await getDealsNeedingSecondPayment();

  if (deals.length === 0) {
    console.log('✅ Все сделки, требующие второго платежа, обработаны или не найдены.');
    return;
  }

  if (index < 1 || index > deals.length) {
    console.error(`Ошибка: индекс должен быть от 1 до ${deals.length}`);
    process.exit(1);
  }

  const deal = deals[index - 1];

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

