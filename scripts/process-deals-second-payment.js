#!/usr/bin/env node

/**
 * Интерактивная обработка сделок для создания второго платежа
 * 
 * Проходит по каждой сделке и позволяет принять решение:
 * - Создать второй платеж
 * - Пропустить
 * - Показать детали
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeProcessorService = require('../src/services/stripe/processor');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

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
          stageId: deal.stage_id
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

async function processDeal(deal, processor) {
  console.log('\n' + '='.repeat(100));
  console.log(`\n📋 Deal #${deal.dealId}: ${deal.title}`);
  console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
  console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
  console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
  console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
  console.log(`   📊 Исходная схема: ${deal.initialSchedule}`);
  console.log(`   📊 Текущая схема: ${deal.currentSchedule}`);
  console.log(`   📋 Статус: ${deal.status}, Stage: ${deal.stageId}`);
  console.log('');

  const answer = await question('Действие: [c] создать платеж, [s] пропустить, [d] детали, [q] выйти: ');

  if (answer.toLowerCase() === 'q') {
    return 'quit';
  }

  if (answer.toLowerCase() === 's') {
    console.log('   ⏭️  Пропущено\n');
    return 'skip';
  }

  if (answer.toLowerCase() === 'd') {
    const repository = new StripeRepository();
    const allPayments = await repository.listPayments({ dealId: String(deal.dealId) });
    console.log('\n   💳 Все платежи:');
    allPayments.forEach(p => {
      console.log(`      - ${p.payment_type} (${p.payment_status}): ${p.original_amount} ${p.currency} | Schedule: ${p.payment_schedule || 'N/A'} | Created: ${p.created_at?.split('T')[0] || 'N/A'}`);
    });
    console.log('');
    return processDeal(deal, processor); // Повторяем вопрос
  }

  if (answer.toLowerCase() === 'c') {
    try {
      console.log(`\n   🔄 Создаю второй платеж для Deal #${deal.dealId}...`);
      
      const result = await processor.createCheckoutSessionForDeal(
        { id: deal.dealId },
        {
          trigger: 'manual_second_payment',
          runId: `manual_second_${deal.dealId}_${Date.now()}`,
          paymentType: 'rest',
          paymentSchedule: deal.initialSchedule, // Используем исходную схему
          paymentIndex: 2,
          skipNotification: false
        }
      );

      if (result.success) {
        console.log(`   ✅ Платеж создан успешно!`);
        console.log(`   📋 Session ID: ${result.sessionId}`);
        console.log(`   🔗 URL: ${result.sessionUrl}`);
        console.log(`   💰 Сумма: ${result.amount} ${result.currency}\n`);
        return 'created';
      } else {
        console.log(`   ❌ Ошибка: ${result.error}\n`);
        return 'error';
      }
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}\n`);
      return 'error';
    }
  }

  return 'skip';
}

async function main() {
  try {
    console.log('\n🔍 Поиск сделок, которым нужен второй платеж...\n');
    
    const deals = await getDealsNeedingSecondPayment();
    
    if (deals.length === 0) {
      console.log('✅ Нет сделок, которым нужен второй платеж\n');
      rl.close();
      return;
    }

    console.log(`\n📊 Найдено сделок: ${deals.length}\n`);

    const processor = new StripeProcessorService();
    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < deals.length; i++) {
      const deal = deals[i];
      console.log(`\n[${i + 1}/${deals.length}]`);
      
      const result = await processDeal(deal, processor);
      
      if (result === 'quit') {
        console.log('\n👋 Выход из программы\n');
        break;
      } else if (result === 'created') {
        created++;
      } else if (result === 'error') {
        errors++;
      } else {
        skipped++;
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n📊 Итоговая сводка:');
    console.log(`   Обработано: ${deals.length}`);
    console.log(`   Создано платежей: ${created}`);
    console.log(`   Пропущено: ${skipped}`);
    console.log(`   Ошибок: ${errors}`);
    console.log('');

    rl.close();
  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    rl.close();
    process.exit(1);
  }
}

main();

