#!/usr/bin/env node

/**
 * Диагностика сделки 1697 - почему пришло напоминание об оплате, если оплата была сделана
 * Проверяет:
 * 1. Все платежи в базе данных (Stripe и проформы)
 * 2. Платежи в Stripe API (возможно на второй кабинет)
 * 3. Задачи-напоминания в cron
 * 4. Логику определения оплаченности второго платежа
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = 1697;

async function diagnoseDeal1697() {
  console.log('🔍 ДИАГНОСТИКА СДЕЛКИ #1697\n');
  console.log('='.repeat(100));
  console.log('Проверка: Почему пришло напоминание об оплате, если оплата была сделана\n');
  console.log('='.repeat(100) + '\n');

  try {
    const repository = new StripeRepository();
    const processor = new StripeProcessorService();
    const pipedriveClient = new PipedriveClient();
    const schedulerService = new SecondPaymentSchedulerService();

    // 1. Получаем данные сделки
    console.log('📋 1. ДАННЫЕ СДЕЛКИ');
    console.log('-'.repeat(100));
    const dealResult = await pipedriveClient.getDeal(DEAL_ID);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Не удалось получить данные сделки: ${dealResult.error}`);
      return;
    }

    const deal = dealResult.deal;
    const dealWithRelated = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    const person = dealWithRelated?.person;
    const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';
    const customerName = person?.name || 'N/A';

    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title}`);
    console.log(`   Клиент: ${customerName} (${customerEmail})`);
    console.log(`   Сумма: ${deal.value} ${deal.currency}`);
    console.log(`   Статус: ${deal.status}`);
    console.log(`   Стадия: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'не указана'}`);
    console.log();

    // 2. Определяем график платежей
    console.log('📅 2. ГРАФИК ПЛАТЕЖЕЙ');
    console.log('-'.repeat(100));
    const schedule = schedulerService.determinePaymentSchedule(deal);
    console.log(`   Текущий график: ${schedule.schedule}`);
    console.log(`   Дата второго платежа: ${schedule.secondPaymentDate ? schedule.secondPaymentDate.toISOString().split('T')[0] : 'не указана'}`);
    
    // Проверяем первичный график из первого платежа
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(DEAL_ID);
    console.log(`   Первичный график (из первого платежа): ${initialSchedule.schedule || 'не найден'}`);
    
    const closeDate = deal.expected_close_date || deal.close_date;
    if (closeDate && initialSchedule.schedule === '50/50') {
      const secondPaymentDate = schedulerService.calculateSecondPaymentDate(closeDate);
      console.log(`   Дата второго платежа (расчетная): ${secondPaymentDate ? secondPaymentDate.toISOString().split('T')[0] : 'не рассчитана'}`);
    }
    console.log();

    // 3. Получаем все платежи из базы данных
    console.log('💳 3. ПЛАТЕЖИ В БАЗЕ ДАННЫХ');
    console.log('-'.repeat(100));
    const stripePayments = await repository.listPayments({ dealId: String(DEAL_ID), limit: 100 });
    console.log(`   Найдено Stripe платежей: ${stripePayments.length}`);
    
    if (stripePayments.length > 0) {
      stripePayments.forEach((p, index) => {
        console.log(`\n   Платеж #${index + 1}:`);
        console.log(`      ID: ${p.id}`);
        console.log(`      Тип: ${p.payment_type}`);
        console.log(`      Статус: ${p.payment_status || p.status}`);
        console.log(`      Сумма: ${p.original_amount || p.amount} ${p.currency}`);
        console.log(`      Session ID: ${p.session_id || 'нет'}`);
        console.log(`      График: ${p.payment_schedule || 'не указан'}`);
        console.log(`      Создан: ${p.created_at || 'не указано'}`);
        console.log(`      Обработан: ${p.processed_at || 'не обработан'}`);
      });
    }
    console.log();

    // 4. Проверяем проформы и платежи по проформам
    console.log('📄 4. ПРОФОРМЫ И ПЛАТЕЖИ ПО ПРОФОРМАМ');
    console.log('-'.repeat(100));
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (proformasError) {
      console.log(`   ❌ Ошибка получения проформ: ${proformasError.message}`);
    } else {
      console.log(`   Найдено проформ: ${proformas?.length || 0}`);
      
      if (proformas && proformas.length > 0) {
        for (const proforma of proformas) {
          console.log(`\n   Проформа: ${proforma.fullnumber || proforma.id}`);
          console.log(`      Сумма: ${proforma.total_amount || proforma.amount} ${proforma.currency || 'PLN'}`);
          
          // Получаем платежи по проформе
          const { data: proformaPayments, error: paymentsError } = await supabase
            .from('payments')
            .select('*')
            .eq('proforma_id', proforma.id)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: false });

          if (paymentsError) {
            console.log(`      ❌ Ошибка получения платежей: ${paymentsError.message}`);
          } else {
            console.log(`      Платежей по проформе: ${proformaPayments?.length || 0}`);
            if (proformaPayments && proformaPayments.length > 0) {
              proformaPayments.forEach((p, index) => {
                console.log(`\n      Платеж #${index + 1}:`);
                console.log(`         ID: ${p.id}`);
                console.log(`         Дата: ${p.payment_date || 'не указана'}`);
                console.log(`         Сумма: ${p.amount} ${p.currency || 'PLN'}`);
                console.log(`         Статус: ${p.manual_status || 'не обработан'}`);
                console.log(`         Источник: ${p.source || 'не указан'}`);
                console.log(`         Комментарий: ${p.comment || 'нет'}`);
              });
            }
          }
        }
      }
    }
    console.log();

    // 5. Анализ платежей - разделяем на первый и второй
    console.log('📊 5. АНАЛИЗ ПЛАТЕЖЕЙ (ПЕРВЫЙ/ВТОРОЙ)');
    console.log('-'.repeat(100));
    
    const dealValue = parseFloat(deal.value) || 0;
    const currency = deal.currency || 'PLN';
    const expectedFirstPayment = dealValue / 2;
    const expectedSecondPayment = dealValue / 2;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let secondPaymentDate = null;
    if (closeDate && initialSchedule.schedule === '50/50') {
      secondPaymentDate = schedulerService.calculateSecondPaymentDate(closeDate);
    } else if (schedule.secondPaymentDate) {
      secondPaymentDate = schedule.secondPaymentDate;
    }
    
    console.log(`   Ожидаемый первый платеж: ${expectedFirstPayment.toFixed(2)} ${currency}`);
    console.log(`   Ожидаемый второй платеж: ${expectedSecondPayment.toFixed(2)} ${currency}`);
    console.log(`   Дата второго платежа: ${secondPaymentDate ? secondPaymentDate.toISOString().split('T')[0] : 'не определена'}`);
    console.log();

    // Анализируем Stripe платежи
    const firstStripePayments = stripePayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );
    
    const secondStripePayments = stripePayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );
    
    const firstStripeTotal = firstStripePayments.reduce((sum, p) => 
      sum + parseFloat(p.original_amount || p.amount || 0), 0
    );
    const secondStripeTotal = secondStripePayments.reduce((sum, p) => 
      sum + parseFloat(p.original_amount || p.amount || 0), 0
    );
    
    console.log(`   Stripe платежи:`);
    console.log(`      Первый платеж: ${firstStripeTotal.toFixed(2)} ${currency} (${firstStripePayments.length} платеж(ей))`);
    console.log(`      Второй платеж: ${secondStripeTotal.toFixed(2)} ${currency} (${secondStripePayments.length} платеж(ей))`);
    
    // Анализируем платежи по проформам
    if (proformas && proformas.length > 0) {
      let allProformaPayments = [];
      for (const proforma of proformas) {
        const { data: proformaPayments } = await supabase
          .from('payments')
          .select('*')
          .eq('proforma_id', proforma.id)
          .neq('manual_status', 'rejected');
        
        if (proformaPayments) {
          allProformaPayments = allProformaPayments.concat(proformaPayments);
        }
      }
      
      if (secondPaymentDate) {
        const secondPaymentDateObj = new Date(secondPaymentDate);
        secondPaymentDateObj.setHours(0, 0, 0, 0);
        
        const firstProformaPayments = allProformaPayments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate < secondPaymentDateObj;
        });
        
        const secondProformaPayments = allProformaPayments.filter(p => {
          if (!p.payment_date) return false;
          const paymentDate = new Date(p.payment_date);
          paymentDate.setHours(0, 0, 0, 0);
          return paymentDate >= secondPaymentDateObj;
        });
        
        const firstProformaTotal = firstProformaPayments.reduce((sum, p) => 
          sum + parseFloat(p.amount || 0), 0
        );
        const secondProformaTotal = secondProformaPayments.reduce((sum, p) => 
          sum + parseFloat(p.amount || 0), 0
        );
        
        console.log(`\n   Платежи по проформам:`);
        console.log(`      Первый платеж: ${firstProformaTotal.toFixed(2)} ${currency} (${firstProformaPayments.length} платеж(ей))`);
        console.log(`      Второй платеж: ${secondProformaTotal.toFixed(2)} ${currency} (${secondProformaPayments.length} платеж(ей))`);
        
        // Общая сумма
        const totalFirst = firstStripeTotal + firstProformaTotal;
        const totalSecond = secondStripeTotal + secondProformaTotal;
        const totalPaid = totalFirst + totalSecond;
        
        console.log(`\n   ИТОГО:`);
        console.log(`      Первый платеж: ${totalFirst.toFixed(2)} ${currency}`);
        console.log(`      Второй платеж: ${totalSecond.toFixed(2)} ${currency}`);
        console.log(`      Общая сумма: ${totalPaid.toFixed(2)} ${currency}`);
        
        // Проверка, оплачен ли второй платеж
        const isSecondPaymentDateReached = secondPaymentDateObj <= today;
        let secondPaymentPaid = false;
        
        if (isSecondPaymentDateReached) {
          secondPaymentPaid = totalSecond >= expectedSecondPayment * 0.9;
          console.log(`\n   Дата второго платежа наступила: ✅ ДА`);
          console.log(`   Второй платеж оплачен: ${secondPaymentPaid ? '✅ ДА' : '❌ НЕТ'} (ожидается >= ${(expectedSecondPayment * 0.9).toFixed(2)}, оплачено ${totalSecond.toFixed(2)})`);
        } else {
          secondPaymentPaid = totalPaid >= dealValue * 0.9;
          console.log(`\n   Дата второго платежа НЕ наступила: ❌ НЕТ`);
          console.log(`   Общая оплата достаточна (>= 90%): ${secondPaymentPaid ? '✅ ДА' : '❌ НЕТ'} (ожидается >= ${(dealValue * 0.9).toFixed(2)}, оплачено ${totalPaid.toFixed(2)})`);
        }
      }
    }
    console.log();

    // 6. Проверка задач-напоминаний
    console.log('🔔 6. ЗАДАЧИ-НАПОМИНАНИЯ В CRON');
    console.log('-'.repeat(100));
    
    const reminderTasks = await schedulerService.findReminderTasks();
    const dealReminderTask = reminderTasks.find(t => t.dealId === DEAL_ID);
    
    if (dealReminderTask) {
      console.log(`   ❌ НАЙДЕНА ЗАДАЧА-НАПОМИНАНИЕ ДЛЯ ЭТОЙ СДЕЛКИ!`);
      console.log(`      Дата второго платежа: ${dealReminderTask.secondPaymentDate.toISOString().split('T')[0]}`);
      console.log(`      Сумма: ${dealReminderTask.secondPaymentAmount} ${dealReminderTask.currency}`);
      console.log(`      Session ID: ${dealReminderTask.sessionId || 'нет'}`);
      console.log(`      Session URL: ${dealReminderTask.sessionUrl || 'нет (просрочена)'}`);
      console.log(`      Дней до второго платежа: ${dealReminderTask.daysUntilSecondPayment}`);
    } else {
      console.log(`   ✅ Задача-напоминание для этой сделки НЕ найдена`);
    }
    
    const upcomingTasks = await schedulerService.findAllUpcomingTasks();
    const dealUpcomingTask = upcomingTasks.find(t => t.deal.id === DEAL_ID);
    
    if (dealUpcomingTask) {
      console.log(`\n   ⚠️  НАЙДЕНА ЗАДАЧА В ОЧЕРЕДИ СОЗДАНИЯ СЕССИИ:`);
      console.log(`      Дата второго платежа: ${dealUpcomingTask.secondPaymentDate.toISOString().split('T')[0]}`);
      console.log(`      Дата наступила: ${dealUpcomingTask.isDateReached ? '✅ ДА' : '❌ НЕТ'}`);
    }
    console.log();

    // 7. Проверка платежей в Stripe API напрямую (возможно на второй кабинет)
    console.log('🔍 7. ПРОВЕРКА ПЛАТЕЖЕЙ В STRIPE API');
    console.log('-'.repeat(100));
    
    console.log(`   Проверяем сессии в Stripe для deal_id=${DEAL_ID}...`);
    
    try {
      // Проверяем, есть ли вторая сессия
      const hasSecondSession = await schedulerService.hasSecondPaymentSession(DEAL_ID);
      console.log(`   Вторая сессия найдена в Stripe: ${hasSecondSession ? '✅ ДА' : '❌ НЕТ'}`);
      
      // Проверяем просроченные сессии
      const expiredSessions = await schedulerService.findExpiredUnpaidSessionsFromStripe();
      const dealExpiredSession = expiredSessions.find(s => String(s.dealId) === String(DEAL_ID));
      
      if (dealExpiredSession) {
        console.log(`\n   ⚠️  НАЙДЕНА ПРОСРОЧЕННАЯ СЕССИЯ:`);
        console.log(`      Session ID: ${dealExpiredSession.sessionId}`);
        console.log(`      Тип: ${dealExpiredSession.paymentType}`);
        console.log(`      Сумма: ${dealExpiredSession.amount} ${dealExpiredSession.currency}`);
        console.log(`      Статус: ${dealExpiredSession.status}`);
        console.log(`      График: ${dealExpiredSession.paymentSchedule}`);
      }
    } catch (error) {
      console.log(`   ❌ Ошибка проверки Stripe: ${error.message}`);
    }
    console.log();

    // 8. ИТОГОВЫЙ ВЫВОД
    console.log('🎯 8. ИТОГОВЫЙ ВЫВОД');
    console.log('='.repeat(100));
    
    const firstPaid = await schedulerService.isFirstPaymentPaid(DEAL_ID);
    console.log(`   Первый платеж оплачен: ${firstPaid ? '✅ ДА' : '❌ НЕТ'}`);
    
    if (secondPaymentDate) {
      const isDateReached = schedulerService.isDateReached(secondPaymentDate);
      console.log(`   Дата второго платежа наступила: ${isDateReached ? '✅ ДА' : '❌ НЕТ'}`);
      
      // Проверяем, почему могло прийти напоминание
      if (dealReminderTask) {
        console.log(`\n   ⚠️  ПРОБЛЕМА ОБНАРУЖЕНА:`);
        console.log(`      Система считает, что второй платеж НЕ оплачен, поэтому создана задача-напоминание.`);
        console.log(`\n   Возможные причины:`);
        console.log(`      1. Платеж был сделан на второй кабинет Stripe (Events account)`);
        console.log(`      2. Платеж был сделан вручную и не был зарегистрирован в системе`);
        console.log(`      3. Платеж по проформе не был связан со сделкой`);
        console.log(`      4. Платеж был сделан после даты второго платежа, но система его не видит`);
      }
    }
    
    console.log('\n' + '='.repeat(100));

  } catch (error) {
    console.error('\n❌ ОШИБКА:');
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   ${error.stack}`);
    }
    process.exit(1);
  }
}

// Запуск
diagnoseDeal1697().then(() => {
  console.log('\n✅ Диагностика завершена\n');
  process.exit(0);
}).catch(error => {
  console.error('\n❌ Критическая ошибка:', error);
  process.exit(1);
});

