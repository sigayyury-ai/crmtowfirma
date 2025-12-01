#!/usr/bin/env node

/**
 * Детальная информация о сделках, требующих напоминаний о вторых платежах
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function showDetailedReminders() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Детальная информация о сделках с проформами, требующих напоминаний...\n');

    // Получаем все открытые сделки из Pipedrive
    const dealsResult = await pipedriveClient.getDeals({
      filter_id: null,
      status: 'open',
      limit: 500,
      start: 0
    });

    if (!dealsResult.success || !dealsResult.deals) {
      console.log('❌ Не удалось получить сделки');
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const soon = [];
    const upcoming = [];

    // Проверяем каждую сделку
    for (const deal of dealsResult.deals) {
      try {
        const closeDate = deal.expected_close_date || deal.close_date;
        if (!closeDate) continue;

        const expectedCloseDate = new Date(closeDate);
        const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

        if (daysDiff < 30) continue;

        const secondPaymentDate = new Date(expectedCloseDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        secondPaymentDate.setHours(0, 0, 0, 0);

        const { data: proformas } = await supabase
          .from('proformas')
          .select('*')
          .eq('pipedrive_deal_id', deal.id)
          .is('deleted_at', null);

        if (!proformas || proformas.length === 0) continue;

        const proformaIds = proformas.map(p => p.id);
        const { data: payments } = await supabase
          .from('payments')
          .select('*')
          .in('proforma_id', proformaIds)
          .neq('manual_status', 'rejected')
          .order('payment_date', { ascending: true });

        if (!payments || payments.length === 0) continue;

        const dealValue = parseFloat(deal.value) || 0;
        const expectedFirstPayment = dealValue / 2;
        const expectedSecondPayment = dealValue / 2;

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

        const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
        const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
        const totalPaid = firstPaymentTotal + secondPaymentTotal;

        const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;
        const isSecondPaymentDateReached = secondPaymentDateObj <= today;
        let secondPaymentPaid = false;
        
        if (isSecondPaymentDateReached) {
          secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
        } else {
          secondPaymentPaid = totalPaid >= dealValue * 0.9;
        }

        if (!firstPaymentPaid || secondPaymentPaid) continue;

        const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
        const person = dealWithRelated?.person;
        const organization = dealWithRelated?.organization;
        const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';
        const personName = person?.name || 'N/A';
        const organizationName = organization?.name || 'N/A';

        const daysUntil = Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24));

        const taskInfo = {
          dealId: deal.id,
          dealTitle: deal.title,
          customerEmail,
          personName,
          organizationName,
          expectedCloseDate: closeDate,
          expectedCloseDateObj: expectedCloseDate,
          secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
          secondPaymentDateObj: secondPaymentDate,
          secondPaymentAmount: expectedSecondPayment,
          currency: deal.currency || 'PLN',
          daysUntilSecondPayment: daysUntil,
          daysUntilCamp: daysDiff,
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
          })),
          firstPayments: firstPayments.map(p => ({
            date: p.payment_date,
            amount: p.amount,
            currency: p.currency
          })),
          secondPayments: secondPayments.map(p => ({
            date: p.payment_date,
            amount: p.amount,
            currency: p.currency
          }))
        };

        if (daysUntil <= 7 && daysUntil >= 0) {
          soon.push(taskInfo);
        } else if (daysUntil > 7) {
          upcoming.push(taskInfo);
        }

      } catch (error) {
        logger.warn(`Ошибка при обработке Deal #${deal.id}`, { error: error.message });
      }
    }

    // Сортируем по дате второго платежа
    soon.sort((a, b) => new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate));
    upcoming.sort((a, b) => new Date(a.secondPaymentDate) - new Date(b.secondPaymentDate));

    // Выводим результаты
    console.log('='.repeat(120));
    console.log('📊 ДЕТАЛЬНАЯ ИНФОРМАЦИЯ О СДЕЛКАХ С ПРОФОРМАМИ');
    console.log('='.repeat(120) + '\n');

    console.log(`🟠 СКОРО (≤7 дней): ${soon.length}\n`);
    if (soon.length > 0) {
      soon.forEach((task, index) => {
        console.log(`${'─'.repeat(120)}`);
        console.log(`${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`${'─'.repeat(120)}`);
        console.log(`   👤 Клиент:`);
        console.log(`      Имя: ${task.personName}`);
        console.log(`      Email: ${task.customerEmail}`);
        if (task.organizationName !== 'N/A') {
          console.log(`      Организация: ${task.organizationName}`);
        }
        console.log(`\n   💰 Финансы:`);
        console.log(`      Сумма сделки: ${task.totalAmount.toFixed(2)} ${task.currency}`);
        console.log(`      Оплачено всего: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`      Первый платеж (50%): ${task.firstPaymentTotal.toFixed(2)} ${task.currency} (${task.firstPaymentsCount} платежей)`);
        console.log(`      Второй платеж (50%): ${task.secondPaymentAmount.toFixed(2)} ${task.currency} (оплачено: ${task.secondPaymentTotal.toFixed(2)} ${task.currency}, ${task.secondPaymentsCount} платежей)`);
        console.log(`      Остаток к оплате: ${(task.secondPaymentAmount - task.secondPaymentTotal).toFixed(2)} ${task.currency}`);
        
        if (task.firstPayments.length > 0) {
          console.log(`\n   💳 Первый платеж (детали):`);
          task.firstPayments.forEach((p, idx) => {
            console.log(`      ${idx + 1}. ${p.date || 'N/A'}: ${p.amount} ${p.currency || task.currency}`);
          });
        }
        
        if (task.secondPayments.length > 0) {
          console.log(`\n   💳 Второй платеж (детали):`);
          task.secondPayments.forEach((p, idx) => {
            console.log(`      ${idx + 1}. ${p.date || 'N/A'}: ${p.amount} ${p.currency || task.currency}`);
          });
        }
        
        console.log(`\n   📅 Даты:`);
        console.log(`      Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`      Дата начала лагеря: ${task.expectedCloseDate} (через ${task.daysUntilCamp} дн.)`);
        
        console.log(`\n   📋 Проформы (${task.proformasCount}):`);
        task.proformas.forEach((p, idx) => {
          console.log(`      ${idx + 1}. ${p.fullnumber}: ${p.amount || 'N/A'} ${task.currency}`);
        });
        
        console.log(`\n   🔗 Ссылки:`);
        console.log(`      Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
        if (task.personName !== 'N/A') {
          const personId = task.dealId; // Можно получить из dealWithRelated, но для простоты используем dealId
          console.log(`      Персона: https://comoon.pipedrive.com/person/${personId}`);
        }
        console.log('');
      });
    }

    console.log(`\n${'='.repeat(120)}`);
    console.log(`🔵 БУДУЩИЕ (>7 дней): ${upcoming.length}\n`);
    if (upcoming.length > 0) {
      upcoming.forEach((task, index) => {
        console.log(`${'─'.repeat(120)}`);
        console.log(`${index + 1}. Deal #${task.dealId}: ${task.dealTitle}`);
        console.log(`${'─'.repeat(120)}`);
        console.log(`   👤 Клиент:`);
        console.log(`      Имя: ${task.personName}`);
        console.log(`      Email: ${task.customerEmail}`);
        if (task.organizationName !== 'N/A') {
          console.log(`      Организация: ${task.organizationName}`);
        }
        console.log(`\n   💰 Финансы:`);
        console.log(`      Сумма сделки: ${task.totalAmount.toFixed(2)} ${task.currency}`);
        console.log(`      Оплачено всего: ${task.totalPaid.toFixed(2)} ${task.currency}`);
        console.log(`      Первый платеж (50%): ${task.firstPaymentTotal.toFixed(2)} ${task.currency} (${task.firstPaymentsCount} платежей)`);
        console.log(`      Второй платеж (50%): ${task.secondPaymentAmount.toFixed(2)} ${task.currency} (оплачено: ${task.secondPaymentTotal.toFixed(2)} ${task.currency}, ${task.secondPaymentsCount} платежей)`);
        console.log(`      Остаток к оплате: ${(task.secondPaymentAmount - task.secondPaymentTotal).toFixed(2)} ${task.currency}`);
        
        if (task.firstPayments.length > 0) {
          console.log(`\n   💳 Первый платеж (детали):`);
          task.firstPayments.forEach((p, idx) => {
            console.log(`      ${idx + 1}. ${p.date || 'N/A'}: ${p.amount} ${p.currency || task.currency}`);
          });
        }
        
        if (task.secondPayments.length > 0) {
          console.log(`\n   💳 Второй платеж (детали):`);
          task.secondPayments.forEach((p, idx) => {
            console.log(`      ${idx + 1}. ${p.date || 'N/A'}: ${p.amount} ${p.currency || task.currency}`);
          });
        }
        
        console.log(`\n   📅 Даты:`);
        console.log(`      Дата второго платежа: ${task.secondPaymentDate} (через ${task.daysUntilSecondPayment} дн.)`);
        console.log(`      Дата начала лагеря: ${task.expectedCloseDate} (через ${task.daysUntilCamp} дн.)`);
        
        console.log(`\n   📋 Проформы (${task.proformasCount}):`);
        task.proformas.forEach((p, idx) => {
          console.log(`      ${idx + 1}. ${p.fullnumber}: ${p.amount || 'N/A'} ${task.currency}`);
        });
        
        console.log(`\n   🔗 Ссылки:`);
        console.log(`      Сделка: https://comoon.pipedrive.com/deal/${task.dealId}`);
        console.log('');
      });
    }

    console.log('='.repeat(120));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(120));
    console.log(`Всего сделок, требующих второго платежа: ${soon.length + upcoming.length}`);
    console.log(`  🟠 Скоро (≤7 дней): ${soon.length}`);
    console.log(`  🔵 Будущие (>7 дней): ${upcoming.length}`);

  } catch (error) {
    logger.error('Ошибка:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

showDetailedReminders();
