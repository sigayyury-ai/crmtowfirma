#!/usr/bin/env node

/**
 * Детальный анализ алгоритма напоминаний для конкретной сделки
 * Показывает каждый шаг алгоритма и результаты проверок
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const ProformaSecondPaymentReminderService = require('../src/services/proformaSecondPaymentReminderService');
const logger = require('../src/utils/logger');

async function debugAlgorithm(dealId) {
  try {
    const pipedriveClient = new PipedriveClient();
    const reminderService = new ProformaSecondPaymentReminderService();

    console.log(`🔍 ДЕТАЛЬНЫЙ АНАЛИЗ АЛГОРИТМА НАПОМИНАНИЙ`);
    console.log(`📦 Deal #${dealId}\n`);
    console.log('='.repeat(100));

    // ШАГ 1: Получаем данные сделки
    console.log(`\n📋 ШАГ 1: Получение данных сделки`);
    console.log('-'.repeat(100));
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Сделка #${dealId} не найдена`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`✅ Сделка найдена: ${deal.title}`);
    console.log(`   Статус: ${deal.status}`);
    console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);
    console.log(`   Дата начала лагеря: ${deal.expected_close_date || deal.close_date || 'N/A'}`);

    // Проверка условия 1: Сделка открыта
    const isOpen = deal.status === 'open';
    console.log(`\n   ✅ Условие 1: Сделка открыта = ${isOpen ? '✅ ДА' : '❌ НЕТ'}`);
    if (!isOpen) {
      console.log(`   ⚠️  Сделка закрыта, напоминания не должны отправляться`);
    }

    // ШАГ 2: Проверка графика 50/50
    console.log(`\n📋 ШАГ 2: Проверка графика платежей`);
    console.log('-'.repeat(100));
    const closeDate = deal.expected_close_date || deal.close_date;
    if (!closeDate) {
      console.log(`❌ Дата начала лагеря не указана`);
      return;
    }

    const expectedCloseDate = new Date(closeDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
    const isSchedule5050 = daysDiff >= 30;

    console.log(`   Дата начала лагеря: ${closeDate}`);
    console.log(`   Дней до лагеря: ${daysDiff}`);
    console.log(`   ✅ Условие 2: График 50/50 (>30 дней) = ${isSchedule5050 ? '✅ ДА' : '❌ НЕТ'}`);

    if (!isSchedule5050) {
      console.log(`   ⚠️  График не 50/50, напоминания не должны отправляться`);
    }

    // ШАГ 3: Вычисление даты второго платежа
    console.log(`\n📋 ШАГ 3: Вычисление даты второго платежа`);
    console.log('-'.repeat(100));
    const secondPaymentDate = reminderService.calculateSecondPaymentDate(closeDate);
    if (!secondPaymentDate) {
      console.log(`❌ Не удалось вычислить дату второго платежа`);
      return;
    }

    secondPaymentDate.setHours(0, 0, 0, 0);
    const secondPaymentDateStr = reminderService.normalizeDate(secondPaymentDate);
    const isDateReached = secondPaymentDate <= today;

    console.log(`   Дата второго платежа: ${secondPaymentDateStr}`);
    console.log(`   Дата наступила: ${isDateReached ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`   ✅ Условие 3: Дата второго платежа наступила = ${isDateReached ? '✅ ДА' : '❌ НЕТ'}`);

    // ШАГ 4: Проверка проформ
    console.log(`\n📋 ШАГ 4: Проверка проформ`);
    console.log('-'.repeat(100));
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', dealId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (proformasError) {
      console.log(`❌ Ошибка при получении проформ: ${proformasError.message}`);
      return;
    }

    const hasProformas = proformas && proformas.length > 0;
    console.log(`   Проформ найдено: ${proformas?.length || 0}`);
    if (hasProformas) {
      proformas.forEach((p, idx) => {
        console.log(`   ${idx + 1}. ${p.fullnumber || p.id}: ${p.total_amount || p.amount || 'N/A'} ${deal.currency || 'PLN'}`);
      });
    }
    console.log(`   ✅ Условие 4: Есть проформы = ${hasProformas ? '✅ ДА' : '❌ НЕТ'}`);

    // ШАГ 5: Проверка платежей
    console.log(`\n📋 ШАГ 5: Проверка платежей`);
    console.log('-'.repeat(100));
    if (!hasProformas) {
      console.log(`⚠️  Проформы не найдены, пропускаем проверку платежей`);
      return;
    }

    const proformaIds = proformas.map(p => p.id);
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('*')
      .in('proforma_id', proformaIds)
      .neq('manual_status', 'rejected')
      .order('payment_date', { ascending: true });

    if (paymentsError) {
      console.log(`❌ Ошибка при получении платежей: ${paymentsError.message}`);
      return;
    }

    const hasPayments = payments && payments.length > 0;
    console.log(`   Платежей найдено: ${payments?.length || 0}`);
    if (hasPayments) {
      payments.forEach((p, idx) => {
        console.log(`   ${idx + 1}. ${p.payment_date || 'N/A'}: ${p.amount || 0} ${p.currency || deal.currency || 'PLN'} (статус: ${p.manual_status || 'N/A'})`);
      });
    }
    console.log(`   ✅ Условие 5: Есть платежи = ${hasPayments ? '✅ ДА' : '❌ НЕТ'}`);

    // ШАГ 6: Анализ платежей
    console.log(`\n📋 ШАГ 6: Анализ платежей`);
    console.log('-'.repeat(100));
    if (!hasPayments) {
      console.log(`⚠️  Платежи не найдены, пропускаем анализ`);
      return;
    }

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
    let secondPaymentPaid = false;

    if (isDateReached) {
      secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
    } else {
      secondPaymentPaid = totalPaid >= dealValue * 0.9;
    }

    console.log(`   Первый платеж:`);
    console.log(`      Ожидается: ${expectedFirstPayment.toFixed(2)} ${deal.currency || 'PLN'}`);
    console.log(`      Оплачено: ${firstPaymentTotal.toFixed(2)} ${deal.currency || 'PLN'} (${firstPayments.length} платежей)`);
    console.log(`      Статус: ${firstPaymentPaid ? '✅ Оплачен' : '❌ Не оплачен'}`);
    console.log(`   Второй платеж:`);
    console.log(`      Ожидается: ${expectedSecondPayment.toFixed(2)} ${deal.currency || 'PLN'}`);
    console.log(`      Оплачено: ${secondPaymentTotal.toFixed(2)} ${deal.currency || 'PLN'} (${secondPayments.length} платежей)`);
    console.log(`      Статус: ${secondPaymentPaid ? '✅ Оплачен' : '❌ Не оплачен'}`);
    console.log(`   Всего оплачено: ${totalPaid.toFixed(2)} ${deal.currency || 'PLN'}`);

    console.log(`\n   ✅ Условие 6: Первый платеж оплачен = ${firstPaymentPaid ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`   ✅ Условие 7: Второй платеж НЕ оплачен = ${!secondPaymentPaid ? '✅ ДА' : '❌ НЕТ'}`);

    // ШАГ 7: Проверка истории напоминаний
    console.log(`\n📋 ШАГ 7: Проверка истории напоминаний`);
    console.log('-'.repeat(100));
    
    // Проверка через wasReminderSentEver()
    const wasSentEver = await reminderService.wasReminderSentEver(dealId, secondPaymentDate);
    console.log(`   wasReminderSentEver(${dealId}, ${secondPaymentDateStr}) = ${wasSentEver ? '✅ TRUE (уже отправлялось)' : '❌ FALSE (не отправлялось)'}`);

    // Проверка через wasReminderSentRecently()
    const wasSentRecently = await reminderService.wasReminderSentRecently(dealId, secondPaymentDate);
    const todayStr = reminderService.normalizeDate(new Date());
    console.log(`   wasReminderSentRecently(${dealId}, ${secondPaymentDateStr}) = ${wasSentRecently ? '✅ TRUE (отправлялось сегодня)' : '❌ FALSE (не отправлялось сегодня)'}`);

    // Прямой запрос к базе
    const { data: reminderLogs } = await supabase
      .from('proforma_reminder_logs')
      .select('*')
      .eq('deal_id', dealId)
      .eq('second_payment_date', secondPaymentDateStr)
      .order('sent_at', { ascending: false });

    console.log(`\n   📨 Записи в базе данных:`);
    console.log(`      Всего записей: ${reminderLogs?.length || 0}`);
    if (reminderLogs && reminderLogs.length > 0) {
      reminderLogs.forEach((log, idx) => {
        console.log(`\n      ${idx + 1}. Запись #${log.id}:`);
        console.log(`         Дата отправки: ${log.sent_date} (${new Date(log.sent_at).toLocaleString('ru-RU')})`);
        console.log(`         Дата второго платежа: ${log.second_payment_date}`);
        console.log(`         SendPulse ID: ${log.sendpulse_id || 'N/A'}`);
        console.log(`         Проформа: ${log.proforma_number || 'N/A'}`);
        console.log(`         Триггер: ${log.trigger_source || 'N/A'}`);
        console.log(`         Run ID: ${log.run_id || 'N/A'}`);
      });
    } else {
      console.log(`      ⚠️  Записей не найдено`);
    }

    // Проверка запроса wasReminderSentEver вручную
    console.log(`\n   🔍 Детальная проверка запроса wasReminderSentEver:`);
    const { data: manualCheck, error: manualCheckError } = await supabase
      .from('proforma_reminder_logs')
      .select('id')
      .match({
        deal_id: dealId,
        second_payment_date: secondPaymentDateStr
      })
      .limit(1);

    if (manualCheckError) {
      console.log(`      ❌ Ошибка запроса: ${manualCheckError.message}`);
    } else {
      console.log(`      Результат запроса: ${manualCheck && manualCheck.length > 0 ? `✅ Найдено ${manualCheck.length} записей` : '❌ Записей не найдено'}`);
      if (manualCheck && manualCheck.length > 0) {
        console.log(`      ID записи: ${manualCheck[0].id}`);
      }
    }

    // ИТОГОВЫЙ ВЫВОД
    console.log(`\n${'='.repeat(100)}`);
    console.log(`📊 ИТОГОВЫЙ АНАЛИЗ АЛГОРИТМА`);
    console.log('='.repeat(100));

    const allConditionsMet = isOpen && isSchedule5050 && hasProformas && hasPayments && firstPaymentPaid && !secondPaymentPaid && isDateReached;
    
    console.log(`\n✅ Все условия для отправки напоминания:`);
    console.log(`   1. Сделка открыта: ${isOpen ? '✅' : '❌'}`);
    console.log(`   2. График 50/50: ${isSchedule5050 ? '✅' : '❌'}`);
    console.log(`   3. Есть проформы: ${hasProformas ? '✅' : '❌'}`);
    console.log(`   4. Есть платежи: ${hasPayments ? '✅' : '❌'}`);
    console.log(`   5. Первый платеж оплачен: ${firstPaymentPaid ? '✅' : '❌'}`);
    console.log(`   6. Второй платеж НЕ оплачен: ${!secondPaymentPaid ? '✅' : '❌'}`);
    console.log(`   7. Дата второго платежа наступила: ${isDateReached ? '✅' : '❌'}`);
    console.log(`\n   ИТОГО: ${allConditionsMet ? '✅ ВСЕ УСЛОВИЯ ВЫПОЛНЕНЫ' : '❌ НЕ ВСЕ УСЛОВИЯ ВЫПОЛНЕНЫ'}`);

    console.log(`\n📨 Статус напоминаний:`);
    console.log(`   Было отправлено когда-либо: ${wasSentEver ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`   Было отправлено сегодня: ${wasSentRecently ? '✅ ДА' : '❌ НЕТ'}`);
    console.log(`   Всего записей в логах: ${reminderLogs?.length || 0}`);

    console.log(`\n🎯 ВЫВОД:`);
    if (!allConditionsMet) {
      console.log(`   ⚠️  Напоминание НЕ должно отправляться - не все условия выполнены`);
    } else if (wasSentEver) {
      console.log(`   ⚠️  Напоминание НЕ должно отправляться - уже было отправлено ранее`);
      if (reminderLogs && reminderLogs.length > 1) {
        console.log(`   ⚠️  ВНИМАНИЕ: Найдено ${reminderLogs.length} записей - возможны дубликаты!`);
      }
    } else {
      console.log(`   ✅ Напоминание ДОЛЖНО быть отправлено`);
    }

    console.log(`\n🔗 Ссылка: https://comoon.pipedrive.com/deal/${dealId}`);

  } catch (error) {
    logger.error('Ошибка при анализе алгоритма:', error);
    console.error(`❌ Критическая ошибка: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Получаем dealId из аргументов командной строки
const dealId = process.argv[2];

if (!dealId) {
  console.error('❌ Укажите ID сделки: node scripts/debug-reminder-algorithm.js <dealId>');
  console.error('Пример: node scripts/debug-reminder-algorithm.js 1585');
  process.exit(1);
}

debugAlgorithm(parseInt(dealId, 10));

