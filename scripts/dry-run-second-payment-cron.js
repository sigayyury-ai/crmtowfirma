#!/usr/bin/env node

/**
 * Dry run для cron задачи проверки вторых платежей
 * 
 * Показывает все сделки, которым нужно выставить вторые платежи,
 * БЕЗ реального создания сессий (dry run)
 * 
 * Использование:
 *   node scripts/dry-run-second-payment-cron.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

async function dryRunSecondPaymentCron() {
  try {
    console.log('\n🔍 DRY RUN: Проверка сделок для вторых платежей\n');
    console.log('='.repeat(100));
    console.log('⚠️  Это DRY RUN - сессии НЕ будут созданы\n');

    const schedulerService = new SecondPaymentSchedulerService();
    const repository = new StripeRepository();

    // Сначала получаем все сделки с оплаченными deposit платежами (как в findDealsNeedingSecondPayment)
    const allPayments = await repository.listPayments({ limit: 1000 });
    const depositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid' &&
      p.payment_schedule === '50/50' &&
      p.deal_id
    );

    const dealIds = [...new Set(depositPayments.map(p => p.deal_id))];

    console.log(`📊 Найдено оплаченных deposit платежей (50/50): ${depositPayments.length}`);
    console.log(`📊 Уникальных сделок: ${dealIds.length}\n`);

    // Используем тот же метод, что и cron задача
    const eligibleDeals = await schedulerService.findDealsNeedingSecondPayment();

    console.log(`✅ Сделок, которым нужен второй платеж: ${eligibleDeals.length}\n`);

    if (dealIds.length === 0) {
      console.log('✅ Нет сделок с оплаченными deposit платежами\n');
      return;
    }

    console.log('='.repeat(100));
    console.log('\n📋 Детальная информация по ВСЕМ сделкам с оплаченными deposit платежами:\n');

    const PipedriveClient = require('../src/services/pipedrive');
    const pipedrive = new PipedriveClient();

    const allDealsInfo = [];
    const eligibleDealIds = new Set(eligibleDeals.map(d => d.deal.id));

    // Анализируем все сделки
    for (const dealId of dealIds) {
      try {
        const dealResult = await pipedrive.getDeal(dealId);
        if (!dealResult.success || !dealResult.deal) {
          continue;
        }

        const deal = dealResult.deal;
        const allDealPayments = await repository.listPayments({ dealId: String(dealId) });
        
        // Получаем первичный график
        const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
        
        let schedule = null;
        let secondPaymentDate = null;
        let reason = '';

        if (initialSchedule.schedule === '50/50') {
          schedule = '50/50';
          const closeDate = deal.expected_close_date || deal.close_date;
          if (closeDate) {
            secondPaymentDate = schedulerService.calculateSecondPaymentDate(closeDate);
          }
        } else {
          const currentSchedule = schedulerService.determinePaymentSchedule(deal);
          schedule = currentSchedule.schedule;
          secondPaymentDate = currentSchedule.secondPaymentDate;
        }

        // Проверяем причины, почему сделка не попала в финальный список
        const reasons = [];
        let isEligible = true;

        if (schedule !== '50/50' || !secondPaymentDate) {
          isEligible = false;
          reasons.push(`График не 50/50 (${schedule}) или дата не определена`);
        }

        if (secondPaymentDate && !schedulerService.isDateReached(secondPaymentDate)) {
          isEligible = false;
          reasons.push(`Дата второго платежа еще не наступила (${secondPaymentDate.toISOString().split('T')[0]})`);
        }

        const hasSecond = await schedulerService.hasSecondPaymentSession(dealId);
        if (hasSecond) {
          isEligible = false;
          reasons.push('Уже есть активная rest сессия');
        }

        const paidPayments = allDealPayments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
        
        // ВАЖНО: Считаем оплаченную сумму ТОЛЬКО в валюте сделки из CRM
        const dealCurrency = deal.currency || 'PLN';
        let totalPaid = 0;
        for (const payment of paidPayments) {
          // Суммируем только платежи в валюте сделки
          if (payment.currency === dealCurrency) {
            // Используем original_amount (сумма в оригинальной валюте платежа)
            const amount = parseFloat(payment.original_amount || payment.amount || 0);
            totalPaid += amount;
          }
          // Платежи в других валютах игнорируем
        }

        const dealValue = parseFloat(deal.value) || 0;
        const expectedSecondPayment = dealValue / 2;

        allDealsInfo.push({
          deal,
          dealId,
          isEligible,
          reasons,
          schedule,
          secondPaymentDate,
          initialSchedule: initialSchedule.schedule,
          hasSecond,
          totalPaid,
          dealValue,
          expectedSecondPayment
        });
      } catch (error) {
        logger.error(`Error processing deal ${dealId}`, { error: error.message });
      }
    }

    // Сначала показываем eligible сделки
    if (eligibleDeals.length > 0) {
      console.log('✅ СДЕЛКИ, КОТОРЫМ НУЖЕН ВТОРОЙ ПЛАТЕЖ:\n');
      for (let i = 0; i < eligibleDeals.length; i++) {
        const { deal, secondPaymentDate } = eligibleDeals[i];
        const dealInfo = allDealsInfo.find(d => d.dealId === deal.id);
        
        try {
          // Получаем информацию о платежах
          const allDealPayments = await repository.listPayments({ dealId: String(deal.id) });
          const paidPayments = allDealPayments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
          const unpaidPayments = allDealPayments.filter(p => 
            (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
            (p.payment_status === 'unpaid' || !p.payment_status)
          );

          // Считаем суммы в валюте сделки
          const dealValue = parseFloat(deal.value) || 0;
          const dealCurrency = deal.currency || 'PLN';
          let totalPaid = 0;
          for (const payment of paidPayments) {
            // Суммируем только платежи в валюте сделки
            if (payment.currency === dealCurrency) {
              // Используем original_amount (сумма в оригинальной валюте платежа)
              const amount = parseFloat(payment.original_amount || payment.amount || 0);
              totalPaid += amount;
            }
            // Платежи в других валютах игнорируем
          }

          const expectedSecondPayment = dealValue / 2;
          const remainingAmount = dealValue - totalPaid;

          // Проверяем, есть ли уже активная сессия
          const hasSecondSession = await schedulerService.hasSecondPaymentSession(deal.id);

          // Получаем первичный график
          const initialSchedule = await schedulerService.getInitialPaymentSchedule(deal.id);

          const isDateReached = schedulerService.isDateReached(secondPaymentDate);

          console.log(`${i + 1}. Deal #${deal.id}: ${deal.title}`);
          console.log(`   💰 Общая сумма: ${dealValue.toFixed(2)} ${deal.currency || 'PLN'}`);
          console.log(`   ✅ Оплачено: ${totalPaid.toFixed(2)} ${deal.currency || 'PLN'}`);
          console.log(`   ⏳ Осталось: ${remainingAmount.toFixed(2)} ${deal.currency || 'PLN'}`);
          console.log(`   📅 Дата закрытия: ${deal.expected_close_date || deal.close_date || 'не указана'}`);
          console.log(`   📅 Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);
          console.log(`   ${isDateReached ? '✅' : '⏳'} Дата наступила: ${isDateReached ? 'ДА' : 'НЕТ'}`);
          console.log(`   📊 Первичный график: ${initialSchedule.schedule || 'не определен'}`);
          console.log(`   📋 Статус: ${deal.status || 'не указан'}, Stage ID: ${deal.stage_id || 'не указан'}`);
          console.log(`   💳 Оплаченных платежей: ${paidPayments.length}`);
          console.log(`   💳 Неоплаченных rest сессий: ${unpaidPayments.length}`);
          console.log(`   🔗 Есть активная rest сессия: ${hasSecondSession ? 'ДА ⚠️' : 'НЕТ ✅'}`);
          
          if (hasSecondSession) {
            const activeSessions = allDealPayments.filter(p => 
              (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
              p.session_id &&
              (p.payment_status === 'unpaid' || !p.payment_status)
            );
            if (activeSessions.length > 0) {
              console.log(`   ⚠️  Активные сессии: ${activeSessions.map(s => s.session_id).join(', ')}`);
            }
          }

          console.log(`   🎯 Ожидаемая сумма второго платежа: ${expectedSecondPayment.toFixed(2)} ${deal.currency || 'PLN'}`);
          console.log(`   🔗 Ссылка на сделку: https://app.pipedrive.com/deal/${deal.id}`);
          console.log('');
        } catch (error) {
          console.error(`   ❌ Ошибка при обработке сделки ${deal.id}: ${error.message}`);
          console.log('');
        }
      }
      console.log('\n' + '='.repeat(100) + '\n');
    }

    // Показываем сделки, которые не попали в финальный список
    const nonEligibleDeals = allDealsInfo.filter(d => !d.isEligible);
    if (nonEligibleDeals.length > 0) {
      console.log('⏸️  СДЕЛКИ, КОТОРЫЕ НЕ ПОПАЛИ В ФИНАЛЬНЫЙ СПИСОК:\n');
      for (let i = 0; i < nonEligibleDeals.length; i++) {
        const dealInfo = nonEligibleDeals[i];
        const { deal, reasons, schedule, secondPaymentDate, hasSecond, totalPaid, dealValue, expectedSecondPayment } = dealInfo;

        console.log(`${i + 1}. Deal #${deal.id}: ${deal.title}`);
        console.log(`   💰 Общая сумма: ${dealValue.toFixed(2)} ${deal.currency || 'PLN'}`);
        console.log(`   ✅ Оплачено: ${totalPaid.toFixed(2)} ${deal.currency || 'PLN'}`);
        console.log(`   📅 Дата закрытия: ${deal.expected_close_date || deal.close_date || 'не указана'}`);
        console.log(`   📅 Дата второго платежа: ${secondPaymentDate ? secondPaymentDate.toISOString().split('T')[0] : 'не определена'}`);
        console.log(`   📊 Первичный график: ${dealInfo.initialSchedule || 'не определен'}`);
        console.log(`   📊 Текущий график: ${schedule || 'не определен'}`);
        console.log(`   🔗 Есть активная rest сессия: ${hasSecond ? 'ДА' : 'НЕТ'}`);
        console.log(`   ❌ Причины исключения:`);
        reasons.forEach(reason => {
          console.log(`      - ${reason}`);
        });
        console.log(`   🔗 Ссылка: https://app.pipedrive.com/deal/${deal.id}`);
        console.log('');
      }
    }

    // Сводка
    console.log('='.repeat(100));
    console.log('\n📊 СВОДКА:\n');
    console.log(`   Всего сделок с оплаченными deposit (50/50): ${dealIds.length}`);
    console.log(`   ✅ Нужен второй платеж: ${eligibleDeals.length}`);
    console.log(`   ⏸️  Не нужен второй платеж: ${nonEligibleDeals.length}`);
    
    if (eligibleDeals.length > 0) {
      const dateReachedCount = eligibleDeals.filter(({ secondPaymentDate }) => 
        schedulerService.isDateReached(secondPaymentDate)
      ).length;
      console.log(`   📅 Дата наступила: ${dateReachedCount}`);
      console.log(`   📅 Дата еще не наступила: ${eligibleDeals.length - dateReachedCount}`);
    }

    // Статистика по причинам исключения
    if (nonEligibleDeals.length > 0) {
      const reasonsStats = {};
      nonEligibleDeals.forEach(d => {
        d.reasons.forEach(r => {
          reasonsStats[r] = (reasonsStats[r] || 0) + 1;
        });
      });
      console.log(`\n   📋 Причины исключения:`);
      Object.entries(reasonsStats).forEach(([reason, count]) => {
        console.log(`      - ${reason}: ${count}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n💡 Что произойдет при реальном запуске cron:');
    console.log('   - Для каждой сделки будет создана новая Stripe Checkout Session');
    console.log('   - Клиенту будет отправлено уведомление о втором платеже');
    console.log('   - Сессия будет сохранена в базу данных');
    console.log('\n⚠️  ВНИМАНИЕ: Это DRY RUN - никакие действия не были выполнены!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Dry run failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

dryRunSecondPaymentCron().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

