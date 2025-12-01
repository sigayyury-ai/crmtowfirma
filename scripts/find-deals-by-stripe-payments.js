#!/usr/bin/env node

/**
 * Найти сделки по наличию Stripe платежей в базе данных
 * Это более надежный способ найти сделки, требующие вторых платежей
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function findDealsByStripePayments() {
  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Поиск сделок по Stripe платежам в базе данных...\n');

    // Получаем все платежи из базы данных
    // Нужно получить все платежи с типом deposit/first и статусом paid
    const allPayments = await repository.listPayments({
      limit: 1000 // Увеличиваем лимит
    });

    console.log(`📊 Всего платежей в базе: ${allPayments.length}\n`);

    // Фильтруем оплаченные депозиты
    const depositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid' &&
      p.deal_id
    );

    console.log(`✅ Оплаченных депозитов: ${depositPayments.length}\n`);

    if (depositPayments.length === 0) {
      console.log('⚠️  Нет оплаченных депозитов');
      return;
    }

    // Группируем по deal_id
    const dealsMap = new Map();
    for (const payment of depositPayments) {
      const dealId = payment.deal_id;
      if (!dealsMap.has(dealId)) {
        dealsMap.set(dealId, []);
      }
      dealsMap.get(dealId).push(payment);
    }

    console.log(`📋 Уникальных сделок с оплаченными депозитами: ${dealsMap.size}\n`);

    const eligibleDeals = [];
    const overdue = [];
    const soon = [];
    const upcoming = [];

    // Проверяем каждую сделку
    for (const [dealId, payments] of dealsMap) {
      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult || !dealResult.success) {
          continue;
        }

        const deal = dealResult.deal;
        const person = dealResult.person;
        const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

        // Определяем график платежей
        const closeDate = deal.expected_close_date || deal.close_date;
        let schedule = '100%';
        let secondPaymentDate = null;

        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 30) {
            schedule = '50/50';
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          }
        }

        // Если график не 50/50, пропускаем
        if (schedule !== '50/50' || !secondPaymentDate) {
          continue;
        }

        // Проверяем, есть ли второй платеж
        const allDealPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 100
        });

        const restPayments = allDealPayments.filter(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'paid'
        );

        // Если второй платеж уже есть, пропускаем
        if (restPayments.length > 0) {
          continue;
        }

        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';
        const secondPaymentAmount = dealValue / 2;
        const daysUntil = Math.ceil((secondPaymentDate - new Date()) / (1000 * 60 * 60 * 24));

        const taskInfo = {
          dealId: deal.id,
          dealTitle: deal.title,
          customerEmail,
          expectedCloseDate: closeDate,
          secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
          secondPaymentAmount,
          currency,
          daysUntilSecondPayment: daysUntil,
          isDateReached: secondPaymentDate <= new Date()
        };

        eligibleDeals.push(taskInfo);

        if (daysUntil < 0) {
          overdue.push(taskInfo);
        } else if (daysUntil <= 3) {
          soon.push(taskInfo);
        } else {
          upcoming.push(taskInfo);
        }

      } catch (error) {
        logger.warn(`Ошибка при обработке Deal #${dealId}`, { error: error.message });
      }
    }

    // Выводим результаты
    console.log('='.repeat(100));
    console.log('📊 РЕЗУЛЬТАТЫ ПОИСКА');
    console.log('='.repeat(100) + '\n');

    console.log(`🔴 ПРОСРОЧЕНО (дата уже прошла): ${overdue.length}`);
    if (overdue.length > 0) {
      overdue.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (просрочено на ${Math.abs(task.daysUntilSecondPayment)} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🟠 СКОРО (≤3 дня): ${soon.length}`);
    if (soon.length > 0) {
      soon.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🔵 БУДУЩИЕ (>3 дня): ${upcoming.length}`);
    if (upcoming.length > 0) {
      upcoming.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма второго платежа: ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate || 'N/A'}`);
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(100));
    console.log(`Всего сделок, требующих напоминания: ${eligibleDeals.length}`);
    console.log(`  🔴 Просрочено: ${overdue.length}`);
    console.log(`  🟠 Скоро (≤3 дня): ${soon.length}`);
    console.log(`  🔵 Будущие (>3 дня): ${upcoming.length}`);

  } catch (error) {
    logger.error('Ошибка при поиске:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

findDealsByStripePayments();
