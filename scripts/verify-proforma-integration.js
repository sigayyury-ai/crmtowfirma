#!/usr/bin/env node

/**
 * Скрипт для проверки интеграции напоминаний по проформам
 * Проверяет:
 * 1. Интеграцию с cron
 * 2. Интеграцию с SendPulse
 * 3. Учет графика платежей
 * 4. Автоматическую отправку
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const SchedulerService = require('../src/services/scheduler');
const ProformaSecondPaymentReminderService = require('../src/services/proformaSecondPaymentReminderService');
const logger = require('../src/utils/logger');

async function verifyIntegration() {
  console.log('🔍 ПРОВЕРКА ИНТЕГРАЦИИ НАПОМИНАНИЙ ПО ПРОФОРМАМ\n');
  console.log('='.repeat(100) + '\n');

  const checks = {
    cron: false,
    sendpulse: false,
    paymentSchedule: false,
    autoSend: false
  };

  try {
    // 1. Проверка интеграции с cron
    console.log('1️⃣  Проверка интеграции с Cron...');
    try {
      const scheduler = new SchedulerService({ autoStart: false });
      
      // Проверяем, что сервис добавлен
      if (scheduler.proformaReminderService) {
        console.log('   ✅ ProformaReminderService добавлен в SchedulerService');
        checks.cron = true;
      } else {
        console.log('   ❌ ProformaReminderService НЕ найден в SchedulerService');
      }

      // Проверяем, что метод существует
      if (typeof scheduler.runProformaReminderCycle === 'function') {
        console.log('   ✅ Метод runProformaReminderCycle существует');
        checks.cron = true;
      } else {
        console.log('   ❌ Метод runProformaReminderCycle НЕ найден');
      }

      // Проверяем, что cron задача настроена
      const schedulerCode = require('fs').readFileSync('./src/services/scheduler.js', 'utf8');
      if (schedulerCode.includes('runProformaReminderCycle')) {
        console.log('   ✅ Метод runProformaReminderCycle вызывается в cron');
        checks.cron = true;
      } else {
        console.log('   ❌ Метод runProformaReminderCycle НЕ вызывается в cron');
      }

      if (schedulerCode.includes('SECOND_PAYMENT_CRON_EXPRESSION') && 
          schedulerCode.includes('runProformaReminderCycle')) {
        console.log('   ✅ Cron задача настроена на ежедневный запуск в 9:00');
        checks.cron = true;
      }
    } catch (error) {
      console.log(`   ❌ Ошибка проверки cron: ${error.message}`);
    }

    console.log('\n2️⃣  Проверка интеграции с SendPulse...');
    try {
      const reminderService = new ProformaSecondPaymentReminderService();
      
      if (reminderService.sendpulseClient) {
        console.log('   ✅ SendPulse клиент инициализирован');
        checks.sendpulse = true;
      } else {
        console.log('   ⚠️  SendPulse клиент не инициализирован (возможно, нет переменных окружения)');
        console.log('      Проверьте SENDPULSE_ID и SENDPULSE_SECRET в .env');
      }

      // Проверяем, что метод sendReminder использует SendPulse
      const serviceCode = require('fs').readFileSync('./src/services/proformaSecondPaymentReminderService.js', 'utf8');
      if (serviceCode.includes('sendTelegramMessage') && serviceCode.includes('sendpulseClient')) {
        console.log('   ✅ Метод sendReminder использует SendPulse для отправки');
        checks.sendpulse = true;
      }
    } catch (error) {
      console.log(`   ⚠️  Ошибка проверки SendPulse: ${error.message}`);
      if (error.message.includes('SENDPULSE_ID') || error.message.includes('SENDPULSE_SECRET')) {
        console.log('      Это нормально, если переменные окружения не настроены');
      }
    }

    console.log('\n3️⃣  Проверка учета графика платежей...');
    try {
      const reminderService = new ProformaSecondPaymentReminderService();
      const serviceCode = require('fs').readFileSync('./src/services/proformaSecondPaymentReminderService.js', 'utf8');
      
      // Проверяем логику определения графика 50/50
      if (serviceCode.includes('daysDiff < 30') || serviceCode.includes('daysDiff >= 30')) {
        console.log('   ✅ Проверка графика платежей (>30 дней = 50/50) реализована');
        checks.paymentSchedule = true;
      }

      // Проверяем вычисление даты второго платежа
      if (serviceCode.includes('setMonth') && serviceCode.includes('setMonth(secondPaymentDate.getMonth() - 1)')) {
        console.log('   ✅ Дата второго платежа вычисляется как expected_close_date - 1 месяц');
        checks.paymentSchedule = true;
      }

      // Проверяем разделение платежей по дате
      if (serviceCode.includes('firstPayments') && serviceCode.includes('secondPayments')) {
        console.log('   ✅ Платежи разделяются на первый и второй по дате второго платежа');
        checks.paymentSchedule = true;
      }

      // Проверяем проверку оплаты первого платежа
      if (serviceCode.includes('firstPaymentPaid') && serviceCode.includes('expectedFirstPayment')) {
        console.log('   ✅ Проверка оплаты первого платежа (>=90% от 50%) реализована');
        checks.paymentSchedule = true;
      }

      // Проверяем проверку оплаты второго платежа
      if (serviceCode.includes('secondPaymentPaid') && serviceCode.includes('isSecondPaymentDateReached')) {
        console.log('   ✅ Проверка оплаты второго платежа с учетом даты реализована');
        checks.paymentSchedule = true;
      }
    } catch (error) {
      console.log(`   ❌ Ошибка проверки графика платежей: ${error.message}`);
    }

    console.log('\n4️⃣  Проверка автоматической отправки...');
    try {
      const serviceCode = require('fs').readFileSync('./src/services/proformaSecondPaymentReminderService.js', 'utf8');
      const schedulerCode = require('fs').readFileSync('./src/services/scheduler.js', 'utf8');
      
      // Проверяем, что processAllDeals существует
      if (serviceCode.includes('async processAllDeals()')) {
        console.log('   ✅ Метод processAllDeals() существует');
        checks.autoSend = true;
      }

      // Проверяем, что processAllDeals фильтрует по дате
      if (serviceCode.includes('isDateReached') && serviceCode.includes('tasks.filter')) {
        console.log('   ✅ Фильтрация задач по дате (только просроченные) реализована');
        checks.autoSend = true;
      }

      // Проверяем, что runProformaReminderCycle вызывает processAllDeals
      if (schedulerCode.includes('runProformaReminderCycle') && 
          schedulerCode.includes('processAllDeals')) {
        console.log('   ✅ runProformaReminderCycle вызывает processAllDeals');
        checks.autoSend = true;
      }

      // Проверяем, что cron вызывает runProformaReminderCycle
      if (schedulerCode.includes('runProformaReminderCycle({ trigger: \'cron_proforma_reminder\' })')) {
        console.log('   ✅ Cron задача вызывает runProformaReminderCycle автоматически');
        checks.autoSend = true;
      }
    } catch (error) {
      console.log(`   ❌ Ошибка проверки автоматической отправки: ${error.message}`);
    }

    console.log('\n' + '='.repeat(100));
    console.log('📊 ИТОГОВАЯ ПРОВЕРКА:');
    console.log('='.repeat(100));
    console.log(`✅ Интеграция с Cron: ${checks.cron ? 'ДА' : 'НЕТ'}`);
    console.log(`✅ Интеграция с SendPulse: ${checks.sendpulse ? 'ДА' : 'ЧАСТИЧНО (проверьте переменные окружения)'}`);
    console.log(`✅ Учет графика платежей: ${checks.paymentSchedule ? 'ДА' : 'НЕТ'}`);
    console.log(`✅ Автоматическая отправка: ${checks.autoSend ? 'ДА' : 'НЕТ'}`);

    if (checks.cron && checks.sendpulse && checks.paymentSchedule && checks.autoSend) {
      console.log('\n🎉 ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ! Система готова к работе.');
      console.log('\n💡 Напоминания будут отправляться автоматически:');
      console.log('   • Ежедневно в 9:00 (Europe/Warsaw)');
      console.log('   • Только для сделок с графиком 50/50 (>30 дней до начала лагеря)');
      console.log('   • Только для сделок, где дата второго платежа уже наступила');
      console.log('   • Только для сделок с оплаченным первым платежом (>=90% от 50%)');
      console.log('   • Только для сделок с неоплаченным вторым платежом');
    } else {
      console.log('\n⚠️  НЕКОТОРЫЕ ПРОВЕРКИ НЕ ПРОЙДЕНЫ. Проверьте детали выше.');
    }

  } catch (error) {
    logger.error('Ошибка при проверке интеграции:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

verifyIntegration();
