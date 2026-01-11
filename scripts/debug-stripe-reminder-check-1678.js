#!/usr/bin/env node

/**
 * Реальная проверка почему напоминания отправлялись после оплаты для Deal #1678
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');

async function debugCheck() {
  try {
    const dealId = 1678;
    
    console.log(`🔍 РЕАЛЬНАЯ ПРОВЕРКА ПРОВЕРКИ ОПЛАТЫ ДЛЯ DEAL #${dealId}\n`);
    console.log('='.repeat(100));

    const repository = new StripeRepository();
    const schedulerService = new SecondPaymentSchedulerService();

    // 1. Получаем ВСЕ платежи для этой сделки
    console.log(`\n1️⃣  ВСЕ ПЛАТЕЖИ В БАЗЕ:`);
    console.log('-'.repeat(100));
    const allPayments = await repository.listPayments({ dealId: String(dealId) });
    console.log(`   Всего платежей: ${allPayments.length}`);
    
    allPayments.forEach((p, idx) => {
      console.log(`\n   ${idx + 1}. Платеж:`);
      console.log(`      ID: ${p.id}`);
      console.log(`      Тип: ${p.payment_type}`);
      console.log(`      Статус платежа: ${p.payment_status}`);
      console.log(`      Статус сессии: ${p.status}`);
      console.log(`      Сумма: ${p.original_amount || p.amount || 0} ${p.currency || 'PLN'}`);
      console.log(`      Сессия: ${p.session_id || 'N/A'}`);
      console.log(`      Создан: ${p.created_at ? new Date(p.created_at).toLocaleString('ru-RU') : 'N/A'}`);
      console.log(`      Обработан: ${p.processed_at ? new Date(p.processed_at).toLocaleString('ru-RU') : 'N/A'}`);
    });

    // 2. Проверяем как работает фильтр неоплаченных вторых платежей
    console.log(`\n2️⃣  ФИЛЬТР НЕОПЛАЧЕННЫХ ВТОРЫХ ПЛАТЕЖЕЙ:`);
    console.log('-'.repeat(100));
    const unpaidSecondPayments = allPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status !== 'paid' &&
      p.deal_id
    );
    console.log(`   Неоплаченных вторых платежей: ${unpaidSecondPayments.length}`);
    unpaidSecondPayments.forEach((p, idx) => {
      console.log(`   ${idx + 1}. ${p.payment_type} - статус: ${p.payment_status}, сессия: ${p.session_id}`);
    });

    // 3. Проверяем как работает проверка оплаченного второго платежа
    console.log(`\n3️⃣  ПРОВЕРКА ОПЛАЧЕННОГО ВТОРОГО ПЛАТЕЖА:`);
    console.log('-'.repeat(100));
    const paidSecondPayment = allPayments.find(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );
    
    if (paidSecondPayment) {
      console.log(`   ✅ НАЙДЕН ОПЛАЧЕННЫЙ ВТОРОЙ ПЛАТЕЖ:`);
      console.log(`      ID: ${paidSecondPayment.id}`);
      console.log(`      Тип: ${paidSecondPayment.payment_type}`);
      console.log(`      Статус: ${paidSecondPayment.payment_status}`);
      console.log(`      Сессия: ${paidSecondPayment.session_id}`);
      console.log(`      Сумма: ${paidSecondPayment.original_amount || paidSecondPayment.amount || 0}`);
      console.log(`      Обработан: ${paidSecondPayment.processed_at ? new Date(paidSecondPayment.processed_at).toLocaleString('ru-RU') : 'N/A'}`);
    } else {
      console.log(`   ❌ ОПЛАЧЕННЫЙ ВТОРОЙ ПЛАТЕЖ НЕ НАЙДЕН!`);
      console.log(`   ⚠️  ВОТ В ЧЕМ ПРОБЛЕМА!`);
      
      // Проверяем все вторые платежи
      const allSecondPayments = allPayments.filter(p => 
        p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
      );
      console.log(`\n   Все вторые платежи (${allSecondPayments.length}):`);
      allSecondPayments.forEach((p, idx) => {
        console.log(`   ${idx + 1}. Тип: ${p.payment_type}, Статус: ${p.payment_status}, Статус сессии: ${p.status}`);
      });
    }

    // 4. Проверяем что возвращает findReminderTasks
    console.log(`\n4️⃣  ЧТО ВОЗВРАЩАЕТ findReminderTasks():`);
    console.log('-'.repeat(100));
    const reminderTasks = await schedulerService.findReminderTasks();
    const dealReminderTasks = reminderTasks.filter(t => t.dealId === dealId);
    console.log(`   Задач напоминаний для Deal #${dealId}: ${dealReminderTasks.length}`);
    
    if (dealReminderTasks.length > 0) {
      console.log(`   ⚠️  ПРОБЛЕМА: Задачи найдены, хотя платеж оплачен!`);
      dealReminderTasks.forEach((task, idx) => {
        console.log(`\n   ${idx + 1}. Задача:`);
        console.log(`      Deal ID: ${task.dealId}`);
        console.log(`      Сессия: ${task.sessionId || 'N/A'}`);
        console.log(`      Дата второго платежа: ${task.secondPaymentDate ? new Date(task.secondPaymentDate).toISOString().split('T')[0] : 'N/A'}`);
      });
    } else {
      console.log(`   ✅ Задач не найдено - правильно`);
    }

    // 5. Проверяем просроченные сессии из Stripe
    console.log(`\n5️⃣  ПРОСРОЧЕННЫЕ СЕССИИ ИЗ STRIPE:`);
    console.log('-'.repeat(100));
    const expiredSessions = await schedulerService.findExpiredUnpaidSessionsFromStripe();
    const dealExpiredSessions = expiredSessions.filter(s => String(s.dealId) === String(dealId));
    console.log(`   Просроченных сессий для Deal #${dealId}: ${dealExpiredSessions.length}`);
    
    if (dealExpiredSessions.length > 0) {
      console.log(`   ⚠️  ВОЗМОЖНАЯ ПРОБЛЕМА: Найдены просроченные сессии в Stripe!`);
      dealExpiredSessions.forEach((s, idx) => {
        console.log(`\n   ${idx + 1}. Сессия:`);
        console.log(`      ID: ${s.sessionId}`);
        console.log(`      Тип: ${s.paymentType}`);
        console.log(`      Сумма: ${s.amount || 0} ${s.currency || 'PLN'}`);
        console.log(`      Истекла: ${s.expiresAt ? new Date(s.expiresAt * 1000).toLocaleString('ru-RU') : 'N/A'}`);
      });
    }

    // 6. ИТОГОВЫЙ АНАЛИЗ
    console.log(`\n${'='.repeat(100)}`);
    console.log(`📊 ИТОГОВЫЙ АНАЛИЗ:`);
    console.log('='.repeat(100));

    if (!paidSecondPayment) {
      console.log(`\n❌ ПРОБЛЕМА НАЙДЕНА:`);
      console.log(`   Проверка оплаты НЕ НАХОДИТ оплаченный платеж!`);
      console.log(`   Возможные причины:`);
      
      const secondPayments = allPayments.filter(p => 
        p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
      );
      
      if (secondPayments.length > 0) {
        console.log(`\n   Проверяем статусы вторых платежей:`);
        secondPayments.forEach(p => {
          console.log(`      - Тип: ${p.payment_type}`);
          console.log(`        payment_status: "${p.payment_status}"`);
          console.log(`        status: "${p.status}"`);
          console.log(`        Проверка (payment_status === 'paid'): ${p.payment_status === 'paid' ? '✅' : '❌'}`);
        });
        
        // Проверяем альтернативные варианты
        const paidByStatus = secondPayments.find(p => p.status === 'processed' || p.status === 'complete');
        if (paidByStatus) {
          console.log(`\n   ⚠️  ВОЗМОЖНО: Платеж оплачен, но payment_status не 'paid'!`);
          console.log(`      Найден платеж со статусом сессии: ${paidByStatus.status}`);
          console.log(`      Нужно проверять не только payment_status, но и status!`);
        }
      }
    } else {
      console.log(`\n✅ Проверка оплаты работает правильно`);
      console.log(`   Но напоминания все равно отправлялись - значит проблема в другом месте`);
    }

  } catch (error) {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

debugCheck();

