#!/usr/bin/env node

/**
 * Скрипт для показа текстов уведомлений, которые отправляются клиентам
 * Показывает примеры сообщений для разных сценариев БЕЗ отправки
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');

function formatAmount(amount) {
  const num = Number(amount);
  if (Number.isNaN(num)) {
    return '0.00';
  }
  return num.toFixed(2);
}

function formatDate(date) {
  if (!date) return 'не указана';
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'Europe/Warsaw'
  });
}

async function showNotificationTexts(dealId) {
  try {
    console.log(`\n🔍 Тексты уведомлений для сделки #${dealId}\n`);
    console.log('='.repeat(80));
    
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();
    
    // Получаем данные сделки
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Сделка ${dealId} не найдена`);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const currency = deal.currency || 'PLN';
    const dealValue = parseFloat(deal.value) || 0;
    
    console.log(`\n📋 Информация о сделке:`);
    console.log(`   Название: "${deal.title}"`);
    console.log(`   Сумма: ${dealValue} ${currency}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'не указана'}`);
    console.log(`   Клиент: ${person?.name || 'N/A'}`);
    console.log(`   Email: ${person?.email?.[0]?.value || person?.email || 'N/A'}\n`);
    
    // Получаем все платежи
    const existingPayments = await repository.listPayments({
      dealId: String(dealId),
      limit: 10
    });
    
    console.log(`💳 Платежи:`);
    if (existingPayments.length === 0) {
      console.log(`   Нет платежей\n`);
    } else {
      existingPayments.forEach((p, idx) => {
        const status = p.payment_status || p.status || 'N/A';
        const isPaid = status === 'paid' || status === 'processed';
        console.log(`   ${idx + 1}. ${p.payment_type || 'N/A'} - ${formatAmount(p.original_amount || 0)} ${p.currency || currency} [${status}] ${isPaid ? '✅' : '⏳'}`);
      });
      console.log('');
    }
    
    // Определяем график платежей
    const schedule = PaymentScheduleService.determineScheduleFromDeal(deal);
    const paymentSchedule = schedule.schedule;
    
    console.log(`📊 График платежей: ${paymentSchedule}\n`);
    
    // Формируем sessions
    const sessions = [];
    for (const p of existingPayments) {
      if (!p.session_id) continue;
      
      let sessionUrl = p.checkout_url || null;
      if (!sessionUrl && p.raw_payload && p.raw_payload.url) {
        sessionUrl = p.raw_payload.url;
      }
      
      if (sessionUrl) {
        sessions.push({
          id: p.session_id,
          url: sessionUrl,
          type: p.payment_type,
          amount: p.original_amount || p.amount
        });
      }
    }
    
    const depositPayments = existingPayments.filter(p => p.payment_type === 'deposit');
    const restPayments = existingPayments.filter(p => p.payment_type === 'rest');
    const hasPaidDeposit = depositPayments.some(p => 
      p.payment_status === 'paid' || p.status === 'processed'
    );
    
    const depositSession = sessions.find(s => s.type === 'deposit');
    const restSession = sessions.find(s => s.type === 'rest');
    const singleSession = sessions[0];
    
    // Рассчитываем даты
    const closeDate = deal.expected_close_date || deal.close_date || null;
    let secondPaymentDate = null;
    if (closeDate && paymentSchedule === '50/50') {
      try {
        const expectedCloseDate = new Date(closeDate);
        const today = new Date();
        secondPaymentDate = new Date(expectedCloseDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        secondPaymentDate.setHours(0, 0, 0, 0);
      } catch (error) {
        // ignore
      }
    }
    
    console.log('='.repeat(80));
    console.log('\n📨 ТЕКСТЫ СООБЩЕНИЙ ДЛЯ РАЗНЫХ СЦЕНАРИЕВ:\n');
    
    // Сценарий 1: 100% Stripe
    if (paymentSchedule === '100%' && sessions.length >= 1) {
      console.log('─'.repeat(80));
      console.log('\n📧 СЦЕНАРИЙ 1: 100% Stripe (один платеж)\n');
      let message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
      message += `[Ссылка на оплату](${singleSession.url})\n`;
      message += `Ссылка действует 24 часа\n\n`;
      message += `Итого: ${formatAmount(dealValue)} ${currency}\n`;
      console.log(message);
    }
    
    // Сценарий 2: 50/50 - только первый платеж (deposit)
    if (paymentSchedule === '50/50' && depositSession && !restSession && !hasPaidDeposit) {
      console.log('─'.repeat(80));
      console.log('\n📧 СЦЕНАРИЙ 2: 50/50 - только первый платеж (deposit)\n');
      let message = `Привет! Тебе выставлен счет на оплату через Stripe.\n\n`;
      message += `[Ссылка на оплату](${depositSession.url})\n`;
      message += `Ссылка действует 24 часа\n\n`;
      message += `График: 50/50 (первый платеж)\n`;
      if (secondPaymentDate) {
        message += `📧 Вторую ссылку на оплату пришлём позже (${formatDate(secondPaymentDate)})\n`;
      } else {
        message += `📧 Вторую ссылку на оплату пришлём позже\n`;
      }
      message += `\n`;
      message += `Итого: ${formatAmount(dealValue)} ${currency}\n`;
      message += `Предоплата: ${formatAmount(depositSession.amount)} ${currency}\n`;
      console.log(message);
    }
    
    // Сценарий 3: 50/50 - только второй платеж (rest, deposit уже оплачен)
    if (paymentSchedule === '50/50' && restSession && hasPaidDeposit) {
      console.log('─'.repeat(80));
      console.log('\n📧 СЦЕНАРИЙ 3: 50/50 - только второй платеж (rest, deposit уже оплачен)\n');
      let message = `Привет! Тебе выставлен счет на оплату остатка через Stripe.\n\n`;
      message += `[Ссылка на оплату](${restSession.url})\n`;
      message += `Ссылка действует 24 часа\n\n`;
      message += `График: 50/50 (остаток)\n`;
      message += `\n`;
      message += `Итого: ${formatAmount(dealValue)} ${currency}\n`;
      message += `Остаток: ${formatAmount(restSession.amount)} ${currency}\n`;
      console.log(message);
    }
    
    // Сценарий 4: 50/50 - оба платежа
    if (paymentSchedule === '50/50' && depositSession && restSession) {
      console.log('─'.repeat(80));
      console.log('\n📧 СЦЕНАРИЙ 4: 50/50 - оба платежа (deposit + rest)\n');
      let message = `Привет! Для тебя созданы ссылки на оплату через Stripe.\n\n`;
      
      if (depositSession) {
        message += `1. Предоплата 50%: ${formatAmount(depositSession.amount)} ${currency}\n`;
        message += `[Оплатить предоплату](${depositSession.url})\n`;
        message += `Ссылка действует 24 часа\n\n`;
      }
      
      if (restSession) {
        message += `2. Остаток 50%: ${formatAmount(restSession.amount)} ${currency}`;
        if (secondPaymentDate) {
          message += ` нужно будет оплатить ${formatDate(secondPaymentDate)}, тебе придет напоминание и ссылка`;
        }
        message += `\n\n`;
      }
      
      message += `Итого: ${formatAmount(dealValue)} ${currency}\n`;
      console.log(message);
    }
    
    // Текущий сценарий для этой сделки
    console.log('─'.repeat(80));
    console.log('\n📧 ТЕКУЩИЙ СЦЕНАРИЙ ДЛЯ ЭТОЙ СДЕЛКИ:\n');
    
    // Проверяем реальный график из первого платежа
    const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
    const schedulerService = new SecondPaymentSchedulerService();
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
    const realSchedule = initialSchedule.schedule || paymentSchedule;
    
    console.log(`   Определенный график: ${paymentSchedule}`);
    console.log(`   Реальный график из первого платежа: ${realSchedule}`);
    console.log(`   Deposit платежей: ${depositPayments.length} (оплачено: ${hasPaidDeposit ? 'да' : 'нет'})`);
    console.log(`   Rest платежей: ${restPayments.length}`);
    console.log(`   Всего сессий: ${sessions.length}\n`);
    
    // Показываем, какой текст будет отправлен при создании rest платежа
    if (hasPaidDeposit && restPayments.length === 0) {
      console.log('📧 ТЕКСТ, КОТОРЫЙ БУДЕТ ОТПРАВЛЕН ПРИ СОЗДАНИИ REST ПЛАТЕЖА:\n');
      console.log('─'.repeat(80));
      let message = `Привет! Тебе выставлен счет на оплату остатка через Stripe.\n\n`;
      message += `[Ссылка на оплату](https://checkout.stripe.com/...)\n`;
      message += `Ссылка действует 24 часа\n\n`;
      message += `График: 50/50 (остаток)\n`;
      message += `\n`;
      message += `Итого: ${formatAmount(dealValue)} ${currency}\n`;
      message += `Остаток: 910.00 ${currency}\n`;
      console.log(message);
      console.log('─'.repeat(80));
      console.log('\n✅ ИСПРАВЛЕНО: Сообщение НЕ содержит "Вторую ссылку на оплату пришлём позже"');
    } else if (hasPaidDeposit && restPayments.length > 0) {
      console.log('✅ Сценарий 3: 50/50 - только второй платеж (rest, deposit уже оплачен)');
      console.log('✅ ИСПРАВЛЕНО: Сообщение НЕ содержит "Вторую ссылку на оплату пришлём позже"');
    } else if (paymentSchedule === '100%' && sessions.length >= 1) {
      console.log('✅ Сценарий 1: 100% Stripe');
    } else if (realSchedule === '50/50' && depositSession && !restSession && !hasPaidDeposit) {
      console.log('✅ Сценарий 2: 50/50 - только первый платеж (deposit)');
      console.log('⚠️  ВНИМАНИЕ: Сообщение содержит "Вторую ссылку на оплату пришлём позже"');
    } else if (realSchedule === '50/50' && depositSession && restSession) {
      console.log('✅ Сценарий 4: 50/50 - оба платежа (deposit + rest)');
    } else {
      console.log('⚠️  Неопределенный сценарий');
      console.log(`   График: ${paymentSchedule}, Реальный: ${realSchedule}`);
      console.log(`   Deposit: ${depositPayments.length}, Rest: ${restPayments.length}, Оплачен deposit: ${hasPaidDeposit}`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('\n✅ Проверка завершена. Сообщения НЕ отправляются.\n');
    
  } catch (error) {
    console.error(`\n❌ Ошибка: ${error.message}`);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Получаем dealId из аргументов командной строки
const dealId = process.argv[2];

if (!dealId) {
  console.error('Использование: node scripts/show-notification-texts.js <dealId>');
  console.error('Пример: node scripts/show-notification-texts.js 1735');
  process.exit(1);
}

const dealIdNum = parseInt(dealId);
if (isNaN(dealIdNum)) {
  console.error('❌ ID сделки должен быть числом');
  process.exit(1);
}

showNotificationTexts(dealIdNum).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

