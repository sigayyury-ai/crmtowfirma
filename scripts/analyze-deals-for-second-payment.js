#!/usr/bin/env node

/**
 * Анализ сделок для определения необходимости второго платежа
 * 
 * Показывает для каждой сделки:
 * - ID сделки
 * - Название
 * - Общая сумма сделки
 * - Сумма уже оплаченная
 * - Дата закрытия (expected_close_date)
 * - Дата второго платежа
 * - Статус (нужен ли второй платеж)
 * - Проблемы (дубликаты, несоответствия)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function analyzeDeals() {
  try {
    console.log('\n🔍 Анализ сделок для второго платежа...\n');
    console.log('='.repeat(120));

    const repository = new StripeRepository();
    const pipedrive = new PipedriveClient();
    const schedulerService = new SecondPaymentSchedulerService();

    // Получаем все оплаченные deposit платежи
    const allPayments = await repository.listPayments({ limit: 10000 });
    
    // Фильтруем оплаченные deposit платежи со схемой 50/50
    const paidDepositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid' &&
      (p.payment_schedule === '50/50' || !p.payment_schedule) // Включаем те, где схема не указана (старые платежи)
    );

    console.log(`Найдено оплаченных deposit платежей: ${paidDepositPayments.length}\n`);

    // Группируем по deal_id
    const dealsMap = new Map();
    
    for (const payment of paidDepositPayments) {
      const dealId = payment.deal_id;
      
      if (!dealsMap.has(dealId)) {
        dealsMap.set(dealId, {
          dealId,
          payments: []
        });
      }
      
      dealsMap.get(dealId).payments.push(payment);
    }

    console.log(`Уникальных сделок с оплаченными deposit: ${dealsMap.size}\n`);

    // Для каждой сделки анализируем ситуацию
    const dealsAnalysis = [];
    
    for (const [dealId, dealData] of dealsMap.entries()) {
      try {
        // Получаем все платежи для сделки
        const allDealPayments = await repository.listPayments({ dealId: String(dealId) });
        
        // Получаем данные сделки
        const dealResult = await pipedrive.getDealWithRelatedData(parseInt(dealId, 10));
        
        if (!dealResult.success || !dealResult.deal) {
          continue;
        }

        const deal = dealResult.deal;
        
        // Анализируем платежи
        const depositPayments = allDealPayments.filter(p => 
          p.payment_type === 'deposit' || p.payment_type === 'first'
        );
        const restPayments = allDealPayments.filter(p => 
          p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
        );
        
        const paidDeposits = depositPayments.filter(p => p.payment_status === 'paid');
        const paidRests = restPayments.filter(p => p.payment_status === 'paid');
        const unpaidRests = restPayments.filter(p => p.payment_status === 'unpaid' || p.payment_status === 'open');
        
        // Считаем суммы
        const totalAmount = parseFloat(deal.value) || 0;
        const paidAmount = allDealPayments
          .filter(p => p.payment_status === 'paid')
          .reduce((sum, p) => sum + (parseFloat(p.original_amount) || 0), 0);
        const remainingAmount = totalAmount - paidAmount;
        
        // Получаем исходную схему из первого оплаченного платежа
        const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
        
        // Определяем текущую схему на основе expected_close_date
        const currentSchedule = PaymentScheduleService.determineScheduleFromDeal(deal);
        
        // Проверяем, наступила ли дата второго платежа
        const secondPaymentDate = currentSchedule.secondPaymentDate || 
                                  PaymentScheduleService.calculateSecondPaymentDate(deal.expected_close_date);
        
        const isDateReached = PaymentScheduleService.isSecondPaymentDateReached(secondPaymentDate);
        
        // Определяем проблемы
        const issues = [];
        
        if (paidAmount >= totalAmount && unpaidRests.length > 0) {
          issues.push('⚠️  Полностью оплачено, но есть неоплаченные rest сессии (дубликаты?)');
        }
        
        if (paidDeposits.length > 1) {
          issues.push(`⚠️  Несколько оплаченных deposit платежей (${paidDeposits.length})`);
        }
        
        if (paidRests.length > 1) {
          issues.push(`⚠️  Несколько оплаченных rest платежей (${paidRests.length})`);
        }
        
        if (initialSchedule.schedule && initialSchedule.schedule !== currentSchedule.schedule) {
          issues.push(`⚠️  Схема изменилась: было ${initialSchedule.schedule}, стало ${currentSchedule.schedule}`);
        }
        
        if (paidDeposits.length > 0 && paidRests.length === 0 && unpaidRests.length === 0 && 
            initialSchedule.schedule === '50/50' && isDateReached) {
          issues.push('✅ НУЖЕН ВТОРОЙ ПЛАТЕЖ');
        }
        
        if (paidDeposits.length > 0 && unpaidRests.length > 0 && isDateReached) {
          issues.push('⚠️  Есть неоплаченная rest сессия, дата наступила');
        }

        dealsAnalysis.push({
          dealId: parseInt(dealId, 10),
          title: deal.title,
          totalAmount,
          paidAmount,
          remainingAmount,
          currency: deal.currency || 'PLN',
          expectedCloseDate: deal.expected_close_date,
          secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null,
          isDateReached,
          currentSchedule: currentSchedule.schedule,
          initialSchedule: initialSchedule.schedule || 'не найдена',
          status: deal.status,
          stageId: deal.stage_id,
          paidDepositsCount: paidDeposits.length,
          paidRestsCount: paidRests.length,
          unpaidRestsCount: unpaidRests.length,
          issues,
          needsSecondPayment: paidDeposits.length > 0 && 
                              paidRests.length === 0 && 
                              unpaidRests.length === 0 &&
                              initialSchedule.schedule === '50/50' &&
                              isDateReached
        });
      } catch (error) {
        logger.error(`Error processing deal ${dealId}`, { error: error.message });
        continue;
      }
    }

    // Сортируем: сначала те, кому нужен второй платеж, потом по проблемам
    dealsAnalysis.sort((a, b) => {
      if (a.needsSecondPayment !== b.needsSecondPayment) {
        return a.needsSecondPayment ? -1 : 1;
      }
      if (a.issues.length !== b.issues.length) {
        return b.issues.length - a.issues.length; // Больше проблем - выше
      }
      if (a.isDateReached !== b.isDateReached) {
        return a.isDateReached ? -1 : 1;
      }
      return 0;
    });

    // Выводим результаты
    console.log(`\n📊 Проанализировано сделок: ${dealsAnalysis.length}\n`);
    
    const needingSecondPayment = dealsAnalysis.filter(d => d.needsSecondPayment);
    const withIssues = dealsAnalysis.filter(d => d.issues.length > 0);
    
    console.log(`   Нужен второй платеж: ${needingSecondPayment.length}`);
    console.log(`   С проблемами: ${withIssues.length}`);
    console.log('');

    if (needingSecondPayment.length > 0) {
      console.log('='.repeat(120));
      console.log('✅ СДЕЛКИ, КОТОРЫМ НУЖЕН ВТОРОЙ ПЛАТЕЖ:\n');
      
      needingSecondPayment.forEach((deal, index) => {
        console.log(`${index + 1}. Deal #${deal.dealId}: ${deal.title}`);
        console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
        console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
        console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
        console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
        console.log(`   📅 Дата второго платежа: ${deal.secondPaymentDate || 'не определена'}`);
        console.log(`   📊 Схема: ${deal.initialSchedule}`);
        console.log(`   🔗 Команда: node scripts/create-session-for-deal.js ${deal.dealId}`);
        console.log('');
      });
    }

    if (withIssues.length > 0) {
      console.log('='.repeat(120));
      console.log('⚠️  СДЕЛКИ С ПРОБЛЕМАМИ:\n');
      
      withIssues.forEach((deal, index) => {
        console.log(`${index + 1}. Deal #${deal.dealId}: ${deal.title}`);
        console.log(`   💰 Общая сумма: ${deal.totalAmount} ${deal.currency}`);
        console.log(`   ✅ Оплачено: ${deal.paidAmount.toFixed(2)} ${deal.currency}`);
        console.log(`   ⏳ Осталось: ${deal.remainingAmount.toFixed(2)} ${deal.currency}`);
        console.log(`   📅 Дата закрытия: ${deal.expectedCloseDate || 'не указана'}`);
        console.log(`   💳 Deposit (paid): ${deal.paidDepositsCount}, Rest (paid): ${deal.paidRestsCount}, Rest (unpaid): ${deal.unpaidRestsCount}`);
        deal.issues.forEach(issue => console.log(`   ${issue}`));
        console.log('');
      });
    }

    console.log('='.repeat(120));
    console.log(`\n📋 Итоговая сводка:`);
    console.log(`   Всего проанализировано: ${dealsAnalysis.length}`);
    console.log(`   Нужен второй платеж: ${needingSecondPayment.length}`);
    console.log(`   С проблемами: ${withIssues.length}`);
    console.log(`   Дата наступила: ${dealsAnalysis.filter(d => d.isDateReached).length}`);
    console.log('');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

analyzeDeals().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

