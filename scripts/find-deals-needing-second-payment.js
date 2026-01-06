#!/usr/bin/env node

/**
 * Поиск сделок с первыми оплаченными Stripe платежами, которым нужен второй платеж
 * 
 * Показывает для каждой сделки:
 * - ID сделки
 * - Название
 * - Общая сумма сделки
 * - Сумма уже оплаченная
 * - Дата закрытия (expected_close_date)
 * - Дата второго платежа
 * - Статус (нужен ли второй платеж)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function findDealsNeedingSecondPayment() {
  try {
    console.log('\n🔍 Поиск сделок, которым нужен второй платеж...\n');
    console.log('='.repeat(100));

    const repository = new StripeRepository();
    const pipedrive = new PipedriveClient();
    const schedulerService = new SecondPaymentSchedulerService();

    // Получаем все оплаченные deposit платежи
    const allPayments = await repository.listPayments({ limit: 10000 });
    
    // Фильтруем оплаченные deposit платежи
    const paidDepositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid' &&
      p.payment_schedule === '50/50' // Только для схемы 50/50
    );

    console.log(`Найдено оплаченных deposit платежей: ${paidDepositPayments.length}\n`);

    // Группируем по deal_id
    const dealsMap = new Map();
    
    for (const payment of paidDepositPayments) {
      const dealId = payment.deal_id;
      
      if (!dealsMap.has(dealId)) {
        dealsMap.set(dealId, {
          dealId,
          payments: [],
          depositPayment: null
        });
      }
      
      const dealData = dealsMap.get(dealId);
      dealData.payments.push(payment);
      
      if (payment.payment_type === 'deposit' || payment.payment_type === 'first') {
        dealData.depositPayment = payment;
      }
    }

    console.log(`Уникальных сделок с оплаченными deposit: ${dealsMap.size}\n`);

    // Для каждой сделки проверяем, нужен ли второй платеж
    const dealsNeedingSecondPayment = [];
    
    for (const [dealId, dealData] of dealsMap.entries()) {
      try {
        // Получаем данные сделки
        const dealResult = await pipedrive.getDealWithRelatedData(parseInt(dealId, 10));
        
        if (!dealResult.success || !dealResult.deal) {
          logger.warn(`Failed to fetch deal ${dealId}`, { error: dealResult.error });
          continue;
        }

        const deal = dealResult.deal;
        
        // Проверяем, есть ли уже оплаченный rest платеж
        const allDealPayments = await repository.listPayments({ dealId: String(dealId) });
        const hasPaidRest = allDealPayments.some(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'paid'
        );

        if (hasPaidRest) {
          // Уже есть оплаченный rest платеж - пропускаем
          continue;
        }

        // Получаем исходную схему из первого платежа
        const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
        
        if (initialSchedule.schedule !== '50/50') {
          // Схема не 50/50 - пропускаем
          continue;
        }

        // Определяем текущую схему на основе expected_close_date
        const currentSchedule = PaymentScheduleService.determineScheduleFromDeal(deal);
        
        // Проверяем, наступила ли дата второго платежа
        const secondPaymentDate = currentSchedule.secondPaymentDate || 
                                  PaymentScheduleService.calculateSecondPaymentDate(deal.expected_close_date);
        
        const isDateReached = PaymentScheduleService.isSecondPaymentDateReached(secondPaymentDate);

        // Считаем оплаченную сумму
        const paidAmount = allDealPayments
          .filter(p => p.payment_status === 'paid')
          .reduce((sum, p) => sum + (parseFloat(p.original_amount) || 0), 0);

        // Общая сумма сделки
        const totalAmount = parseFloat(deal.value) || 0;

        dealsNeedingSecondPayment.push({
          dealId: parseInt(dealId, 10),
          title: deal.title,
          totalAmount,
          paidAmount,
          remainingAmount: totalAmount - paidAmount,
          currency: deal.currency || 'PLN',
          expectedCloseDate: deal.expected_close_date,
          secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null,
          isDateReached,
          currentSchedule: currentSchedule.schedule,
          initialSchedule: initialSchedule.schedule,
          depositPaymentDate: dealData.depositPayment?.created_at || null,
          status: deal.status,
          stageId: deal.stage_id,
          hasRestSession: allDealPayments.some(p => 
            (p.payment_type === 'rest' || p.payment_type === 'second') &&
            p.payment_status === 'unpaid'
          )
        });
      } catch (error) {
        logger.error(`Error processing deal ${dealId}`, { error: error.message });
        continue;
      }
    }

    // Сортируем по дате второго платежа (сначала те, кому уже нужно)
    dealsNeedingSecondPayment.sort((a, b) => {
      if (a.isDateReached !== b.isDateReached) {
        return a.isDateReached ? -1 : 1; // Сначала те, кому уже нужно
      }
      if (a.secondPaymentDate && b.secondPaymentDate) {
        return new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate);
      }
      return 0;
    });

    // Выводим результаты
    console.log(`\n📊 Найдено сделок, которым нужен второй платеж: ${dealsNeedingSecondPayment.length}\n`);
    console.log('='.repeat(100));

    if (dealsNeedingSecondPayment.length === 0) {
      console.log('✅ Нет сделок, которым нужен второй платеж\n');
      return;
    }

    dealsNeedingSecondPayment.forEach((deal, index) => {
      console.log(`\n${index + 1}. Deal #${deal.dealId}: ${deal.title}`);
      console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
      console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
      console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
      console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
      console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
      console.log(`   ${deal.isDateReached ? '✅' : '⏳'} Дата наступила: ${deal.isDateReached ? 'ДА' : 'НЕТ'}`);
      console.log(`   📊 Исходная схема: ${deal.initialSchedule}`);
      console.log(`   📊 Текущая схема: ${deal.currentSchedule}`);
      console.log(`   📋 Статус: ${deal.status}, Stage: ${deal.stageId}`);
      if (deal.hasRestSession) {
        console.log(`   ⚠️  Есть неоплаченная rest сессия`);
      }
      console.log(`   🔗 Команда для создания: node scripts/create-session-for-deal.js ${deal.dealId}`);
    });

    console.log('\n' + '='.repeat(100));
    console.log(`\n📋 Сводка:`);
    console.log(`   Всего сделок: ${dealsNeedingSecondPayment.length}`);
    console.log(`   Дата наступила: ${dealsNeedingSecondPayment.filter(d => d.isDateReached).length}`);
    console.log(`   Дата еще не наступила: ${dealsNeedingSecondPayment.filter(d => !d.isDateReached).length}`);
    console.log(`   Есть неоплаченные rest сессии: ${dealsNeedingSecondPayment.filter(d => d.hasRestSession).length}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

findDealsNeedingSecondPayment().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

