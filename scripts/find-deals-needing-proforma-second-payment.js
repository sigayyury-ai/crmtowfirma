#!/usr/bin/env node

/**
 * Найти сделки, у которых скоро наступит график второго платежа по флоу проформ
 * 
 * Логика:
 * 1. Найти сделки с графиком 50/50 (>30 дней до начала лагеря)
 * 2. Проверить наличие проформ для этих сделок
 * 3. Проверить, оплачен ли первый платеж по проформе
 * 4. Проверить, не оплачен ли второй платеж
 * 5. Определить дату второго платежа (expected_close_date - 1 месяц)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function findDealsNeedingProformaSecondPayment() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Поиск сделок с проформами, требующих второго платежа...\n');

    // Получаем все сделки из Pipedrive
    const dealsResult = await pipedriveClient.getDeals({
      filter_id: null,
      status: 'all_not_deleted',
      limit: 500,
      start: 0
    });

    if (!dealsResult.success || !dealsResult.deals) {
      console.log('❌ Не удалось получить сделки');
      return;
    }

    console.log(`📊 Всего сделок получено: ${dealsResult.deals.length}\n`);

    const eligibleDeals = [];
    const overdue = [];
    const soon = [];
    const upcoming = [];

    // Проверяем каждую сделку
    for (const deal of dealsResult.deals) {
      try {
        // Определяем график платежей
        const closeDate = deal.expected_close_date || deal.close_date;
        if (!closeDate) {
          continue; // Пропускаем сделки без даты начала лагеря
        }

        const expectedCloseDate = new Date(closeDate);
        const today = new Date();
        const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

        // Проверяем, что график 50/50 (>30 дней до начала лагеря)
        if (daysDiff < 30) {
          continue; // Пропускаем сделки с графиком 100%
        }

        // Вычисляем дату второго платежа
        const secondPaymentDate = new Date(expectedCloseDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);

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

        // Получаем данные персоны для email (делаем это раньше, чтобы не делать лишние запросы)
        let customerEmail = 'N/A';
        try {
          const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
          if (dealWithRelated && dealWithRelated.success) {
            const person = dealWithRelated.person;
            customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';
          }
        } catch (emailError) {
          // Если не удалось получить email, продолжаем с N/A
          logger.warn(`Не удалось получить email для Deal #${deal.id}`, { error: emailError.message });
        }

        // Ищем платежи, связанные с проформами этой сделки
        const proformaIds = proformas.map(p => p.id);
        
        const { data: payments, error: paymentsError } = await supabase
          .from('payments')
          .select('*')
          .in('proforma_id', proformaIds)
          .neq('manual_status', 'rejected') // Исключаем отклоненные платежи
          .order('payment_date', { ascending: false });

        if (paymentsError) {
          logger.warn(`Ошибка при получении платежей для Deal #${deal.id}`, { error: paymentsError.message });
          continue;
        }

        // Анализируем платежи
        // Разделяем платежи на те, что до даты второго платежа (первый платеж) и после (второй платеж)
        
        const totalAmount = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';
        const expectedFirstPayment = totalAmount / 2; // 50% для первого платежа
        const expectedSecondPayment = totalAmount / 2; // 50% для второго платежа

        if (!payments || payments.length === 0) {
          continue; // Пропускаем сделки без платежей
        }

        // Разделяем платежи по дате второго платежа
        const secondPaymentDateObj = new Date(secondPaymentDate);
        secondPaymentDateObj.setHours(0, 0, 0, 0);

        const firstPayments = payments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate < secondPaymentDateObj;
        });

        const secondPayments = payments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate >= secondPaymentDateObj;
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
        // Первый платеж считается оплаченным, если оплачено >= 50% от суммы сделки ДО даты второго платежа
        const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9; // 90% от первого платежа (с учетом округлений)

        // Определяем, оплачен ли второй платеж
        // Второй платеж считается оплаченным, если:
        // 1. Общая сумма оплаты >= 90% от суммы сделки ИЛИ
        // 2. Есть платежи после даты второго платежа И сумма этих платежей >= 90% от ожидаемого второго платежа
        const todayObj = new Date();
        todayObj.setHours(0, 0, 0, 0);
        const isSecondPaymentDateReached = secondPaymentDateObj <= todayObj;

        let secondPaymentPaid = false;
        if (isSecondPaymentDateReached) {
          // Если дата второго платежа уже наступила, проверяем платежи после этой даты
          secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
        } else {
          // Если дата еще не наступила, проверяем общую сумму (может быть оплачено заранее)
          secondPaymentPaid = totalPaid >= totalAmount * 0.9;
        }

        // Если первый платеж не оплачен или второй уже оплачен, пропускаем
        if (!firstPaymentPaid || secondPaymentPaid) {
          continue;
        }

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
          isDateReached: secondPaymentDate <= today,
          totalPaid,
          firstPaymentTotal,
          secondPaymentTotal,
          totalAmount,
          proformasCount: proformas.length,
          paymentsCount: payments ? payments.length : 0,
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
        console.log(`   💰 Оплачено: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (просрочено на ${Math.abs(task.daysUntilSecondPayment)} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount} ${task.currency}`);
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
        console.log(`   💰 Оплачено: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount} ${task.currency}`);
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
        console.log(`   💰 Оплачено: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`   💰 Остаток (второй платеж): ${task.secondPaymentAmount.toFixed(2)} ${task.currency}`);
        console.log(`   📅 Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`   📅 Начало лагеря: ${task.expectedCloseDate}`);
        console.log(`   📋 Проформ: ${task.proformasCount}`);
        console.log(`   💳 Платежей: ${task.paymentsCount}`);
        task.proformas.forEach(p => {
          console.log(`      - ${p.fullnumber}: ${p.amount} ${task.currency}`);
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

findDealsNeedingProformaSecondPayment();
