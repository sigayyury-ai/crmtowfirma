#!/usr/bin/env node

/**
 * Поиск сделок с проформами, требующих напоминаний о вторых платежах
 * 
 * Логика:
 * 1. Получаем все открытые сделки из Pipedrive
 * 2. Фильтруем сделки с графиком 50/50 (>30 дней до expected_close_date)
 * 3. Проверяем наличие проформ для этих сделок
 * 4. Проверяем платежи по проформам
 * 5. Определяем, оплачен ли первый платеж и не оплачен ли второй
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function findProformaSecondPaymentReminders() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Поиск сделок с проформами, требующих напоминаний о вторых платежах...\n');

    // Получаем все открытые сделки из Pipedrive
    const dealsResult = await pipedriveClient.getDeals({
      filter_id: null,
      status: 'open', // Только открытые сделки
      limit: 500,
      start: 0
    });

    if (!dealsResult.success || !dealsResult.deals) {
      console.log('❌ Не удалось получить сделки');
      return;
    }

    console.log(`📊 Всего открытых сделок получено: ${dealsResult.deals.length}\n`);

    const eligibleDeals = [];
    const overdue = [];
    const soon = [];
    const upcoming = [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Проверяем каждую сделку
    for (const deal of dealsResult.deals) {
      try {
        // Проверяем наличие даты начала лагеря
        const closeDate = deal.expected_close_date || deal.close_date;
        if (!closeDate) {
          continue; // Пропускаем сделки без даты
        }

        const expectedCloseDate = new Date(closeDate);
        const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

        // Проверяем, что график 50/50 (>30 дней до начала лагеря)
        if (daysDiff < 30) {
          continue; // Пропускаем сделки с графиком 100%
        }

        // Вычисляем дату второго платежа (за месяц до начала лагеря)
        const secondPaymentDate = new Date(expectedCloseDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        secondPaymentDate.setHours(0, 0, 0, 0);

        // Ищем проформы для этой сделки
        const { data: proformas, error: proformasError } = await supabase
          .from('proformas')
          .select('*')
          .eq('pipedrive_deal_id', deal.id)
          .is('deleted_at', null) // Только активные проформы
          .order('created_at', { ascending: false });

        if (proformasError) {
          logger.warn(`Ошибка при получении проформ для Deal #${deal.id}`, { error: proformasError.message });
          continue;
        }

        if (!proformas || proformas.length === 0) {
          continue; // Пропускаем сделки без проформ
        }

        // Ищем платежи, связанные с проформами этой сделки
        const proformaIds = proformas.map(p => p.id);
        
        const { data: payments, error: paymentsError } = await supabase
          .from('payments')
          .select('*')
          .in('proforma_id', proformaIds)
          .neq('manual_status', 'rejected') // Исключаем отклоненные платежи
          .order('payment_date', { ascending: true });

        if (paymentsError) {
          logger.warn(`Ошибка при получении платежей для Deal #${deal.id}`, { error: paymentsError.message });
          continue;
        }

        if (!payments || payments.length === 0) {
          continue; // Пропускаем сделки без платежей
        }

        // Анализируем платежи
        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';
        const expectedFirstPayment = dealValue / 2; // 50% для первого платежа
        const expectedSecondPayment = dealValue / 2; // 50% для второго платежа

        // Разделяем платежи по дате второго платежа
        const firstPayments = payments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate < secondPaymentDate;
        });

        const secondPayments = payments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate >= secondPaymentDate;
        });

        // Суммируем платежи
        const firstPaymentTotal = firstPayments.reduce((sum, p) => {
          const amount = parseFloat(p.amount || 0);
          return sum + amount;
        }, 0);

        const secondPaymentTotal = secondPayments.reduce((sum, p) => {
          const amount = parseFloat(p.amount || 0);
          return sum + amount;
        }, 0);

        const totalPaid = firstPaymentTotal + secondPaymentTotal;

        // Определяем, оплачен ли первый платеж
        // Первый платеж считается оплаченным, если оплачено >= 90% от ожидаемого первого платежа
        const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;

        // Определяем, оплачен ли второй платеж
        const isSecondPaymentDateReached = secondPaymentDate <= today;
        let secondPaymentPaid = false;
        
        if (isSecondPaymentDateReached) {
          // Если дата второго платежа уже наступила, проверяем платежи после этой даты
          secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
        } else {
          // Если дата еще не наступила, проверяем общую сумму (может быть оплачено заранее)
          secondPaymentPaid = totalPaid >= dealValue * 0.9;
        }

        // Если первый платеж не оплачен или второй уже оплачен, пропускаем
        if (!firstPaymentPaid || secondPaymentPaid) {
          continue;
        }

        // Получаем данные персоны для email
        const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
        const person = dealWithRelated?.person;
        const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

        const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));

        const taskInfo = {
          dealId: deal.id,
          dealTitle: deal.title,
          customerEmail,
          expectedCloseDate: closeDate,
          secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
          secondPaymentAmount: expectedSecondPayment,
          currency,
          daysUntilSecondPayment: daysUntil,
          isDateReached: isSecondPaymentDateReached,
          totalPaid,
          firstPaymentTotal,
          secondPaymentTotal,
          totalAmount: dealValue,
          proformasCount: proformas.length,
          paymentsCount: payments.length,
          firstPaymentsCount: firstPayments.length,
          secondPaymentsCount: secondPayments.length,
          proformas: proformas.map(p => ({
            id: p.id,
            fullnumber: p.fullnumber,
            amount: p.total_amount || p.amount
          }))
        };

        eligibleDeals.push(taskInfo);

        if (daysUntil < 0) {
          overdue.push(taskInfo);
        } else if (daysUntil <= 7) { // Скоро = в ближайшие 7 дней
          soon.push(taskInfo);
        } else {
          upcoming.push(taskInfo);
        }

      } catch (error) {
        logger.warn(`Ошибка при обработке Deal #${deal.id}`, { error: error.message });
      }
    }

    // Выводим результаты
    console.log('='.repeat(100));
    console.log('📊 РЕЗУЛЬТАТЫ ПОИСКА СДЕЛОК С ПРОФОРМАМИ');
    console.log('='.repeat(100) + '\n');

    console.log(`🔴 ПРОСРОЧЕНО (дата уже прошла): ${overdue.length}`);
    if (overdue.length > 0) {
      overdue.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма сделки: ${task.totalAmount.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Оплачено всего: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Первый платеж: ${task.firstPaymentTotal.toFixed(2)} ${task.currency} (${task.firstPaymentsCount} платежей)`);
        console.log(`   💰 Второй платеж: ${task.secondPaymentTotal.toFixed(2)} ${task.currency} (${task.secondPaymentsCount} платежей)`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (просрочено на ${Math.abs(task.daysUntilSecondPayment)} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount || 'N/A'} ${task.currency}`);
        });
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🟠 СКОРО (≤7 дней): ${soon.length}`);
    if (soon.length > 0) {
      soon.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма сделки: ${task.totalAmount.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Оплачено всего: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Первый платеж: ${task.firstPaymentTotal.toFixed(2)} ${task.currency} (${task.firstPaymentsCount} платежей)`);
        console.log(`   💰 Второй платеж: ${task.secondPaymentTotal.toFixed(2)} ${task.currency} (${task.secondPaymentsCount} платежей)`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount || 'N/A'} ${task.currency}`);
        });
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log(`\n🔵 БУДУЩИЕ (>7 дней): ${upcoming.length}`);
    if (upcoming.length > 0) {
      upcoming.forEach((task, index) => {
        console.log(`\n${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`   📧 Клиент: ${task.customerEmail}`);
        console.log(`   💰 Сумма сделки: ${task.totalAmount.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Оплачено всего: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Первый платеж: ${task.firstPaymentTotal.toFixed(2)} ${task.currency} (${task.firstPaymentsCount} платежей)`);
        console.log(`   💰 Второй платеж: ${task.secondPaymentTotal.toFixed(2)} ${task.currency} (${task.secondPaymentsCount} платежей)`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount || 'N/A'} ${task.currency}`);
        });
        console.log(`   🔗 Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(100));
    console.log(`Всего сделок с проформами, требующих второго платежа: ${eligibleDeals.length}`);
    console.log(`  🔴 Просрочено: ${overdue.length}`);
    console.log(`  🟠 Скоро (≤7 дней): ${soon.length}`);
    console.log(`  🔵 Будущие (>7 дней): ${upcoming.length}`);

    console.log('\n💡 РЕКОМЕНДАЦИИ:');
    if (overdue.length > 0) {
      console.log(`\n⚠️  СРОЧНО: ${overdue.length} сделок с просроченной датой второго платежа!`);
      console.log('   Нужно немедленно напомнить клиентам об оплате.');
    }
    if (soon.length > 0) {
      console.log(`\n📅 В ближайшие 7 дней: ${soon.length} сделок требуют внимания`);
      console.log('   Рекомендуется отправить напоминания заранее.');
    }
    if (upcoming.length > 0) {
      console.log(`\n✅ Запланировано: ${upcoming.length} сделок в будущем`);
      console.log('   Эти сделки можно добавить в систему напоминаний.');
    }

  } catch (error) {
    logger.error('Ошибка при поиске сделок:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

findProformaSecondPaymentReminders();
