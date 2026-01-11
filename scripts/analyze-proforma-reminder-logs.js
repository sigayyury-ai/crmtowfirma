#!/usr/bin/env node

/**
 * Анализ логов напоминаний о вторых платежах по проформам
 * Проверяет кому приходили напоминания и почему
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function analyzeReminderLogs() {
  try {
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Анализ логов напоминаний о вторых платежах по проформам...\n');

    // Получаем все логи напоминаний
    const { data: logs, error: logsError } = await supabase
      .from('proforma_reminder_logs')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);

    if (logsError) {
      console.error('❌ Ошибка при получении логов:', logsError.message);
      return;
    }

    if (!logs || logs.length === 0) {
      console.log('📭 Логов напоминаний не найдено');
      return;
    }

    console.log(`📊 Всего найдено логов: ${logs.length}\n`);
    console.log('='.repeat(120));

    // Группируем по сделкам
    const dealsMap = new Map();
    for (const log of logs) {
      if (!dealsMap.has(log.deal_id)) {
        dealsMap.set(log.deal_id, []);
      }
      dealsMap.get(log.deal_id).push(log);
    }

    console.log(`📋 Уникальных сделок: ${dealsMap.size}\n`);

    // Анализируем каждую сделку
    for (const [dealId, dealLogs] of dealsMap.entries()) {
      try {
        console.log(`\n${'─'.repeat(120)}`);
        console.log(`📦 Deal #${dealId}`);
        console.log(`${'─'.repeat(120)}`);

        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDeal(dealId);
        if (!dealResult.success || !dealResult.deal) {
          console.log(`   ⚠️  Сделка не найдена в Pipedrive`);
          continue;
        }

        const deal = dealResult.deal;
        console.log(`   Название: ${deal.title}`);
        console.log(`   Статус: ${deal.status}`);
        console.log(`   Сумма: ${deal.value || 0} ${deal.currency || 'PLN'}`);

        // Получаем данные персоны
        const dealWithRelated = await pipedriveClient.getDealWithRelatedData(dealId);
        const person = dealWithRelated?.person;
        const organization = dealWithRelated?.organization;

        const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
        const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];

        console.log(`\n   👤 Персона:`);
        console.log(`      ID: ${person?.id || 'N/A'}`);
        console.log(`      Имя: ${person?.name || 'N/A'}`);
        console.log(`      Email: ${person?.email?.[0]?.value || person?.email || 'N/A'}`);
        console.log(`      SendPulse ID: ${sendpulseId || '❌ НЕ НАЙДЕН'}`);

        if (organization) {
          console.log(`\n   🏢 Организация:`);
          console.log(`      ID: ${organization.id || 'N/A'}`);
          console.log(`      Название: ${organization.name || 'N/A'}`);
          console.log(`      Email: ${organization.email?.[0]?.value || organization.email || 'N/A'}`);
        }

        // Проверяем проформы
        const { data: proformas } = await supabase
          .from('proformas')
          .select('*')
          .eq('pipedrive_deal_id', dealId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        console.log(`\n   📋 Проформы: ${proformas?.length || 0}`);
        if (proformas && proformas.length > 0) {
          proformas.forEach((p, idx) => {
            console.log(`      ${idx + 1}. ${p.fullnumber || p.id}: ${p.total_amount || p.amount || 'N/A'} ${deal.currency || 'PLN'}`);
          });
        }

        // Проверяем платежи
        if (proformas && proformas.length > 0) {
          const proformaIds = proformas.map(p => p.id);
          const { data: payments } = await supabase
            .from('payments')
            .select('*')
            .in('proforma_id', proformaIds)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: true });

          console.log(`\n   💳 Платежи: ${payments?.length || 0}`);

          if (payments && payments.length > 0) {
            const dealValue = parseFloat(deal.value) || 0;
            const expectedFirstPayment = dealValue / 2;
            const expectedSecondPayment = dealValue / 2;

            const closeDate = deal.expected_close_date || deal.close_date;
            let secondPaymentDate = null;
            if (closeDate) {
              secondPaymentDate = new Date(closeDate);
              secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
              secondPaymentDate.setHours(0, 0, 0, 0);
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const firstPayments = payments.filter(p => {
              if (!p.payment_date) return false;
              const paymentDate = new Date(p.payment_date);
              paymentDate.setHours(0, 0, 0, 0);
              return secondPaymentDate && paymentDate < secondPaymentDate;
            });

            const secondPayments = payments.filter(p => {
              if (!p.payment_date) return false;
              const paymentDate = new Date(p.payment_date);
              paymentDate.setHours(0, 0, 0, 0);
              return secondPaymentDate && paymentDate >= secondPaymentDate;
            });

            const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
            const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
            const totalPaid = firstPaymentTotal + secondPaymentTotal;

            const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;
            const isSecondPaymentDateReached = secondPaymentDate && secondPaymentDate <= today;
            let secondPaymentPaid = false;
            
            if (isSecondPaymentDateReached) {
              secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
            } else {
              secondPaymentPaid = totalPaid >= dealValue * 0.9;
            }

            console.log(`      Первый платеж: ${firstPaymentTotal.toFixed(2)} ${deal.currency || 'PLN'} (${firstPayments.length} платежей)`);
            console.log(`      Второй платеж: ${secondPaymentTotal.toFixed(2)} ${deal.currency || 'PLN'} (${secondPayments.length} платежей)`);
            console.log(`      Всего оплачено: ${totalPaid.toFixed(2)} ${deal.currency || 'PLN'}`);
            console.log(`      Первый платеж оплачен: ${firstPaymentPaid ? '✅' : '❌'}`);
            console.log(`      Второй платеж оплачен: ${secondPaymentPaid ? '✅' : '❌'}`);
            console.log(`      Дата второго платежа: ${secondPaymentDate ? secondPaymentDate.toISOString().split('T')[0] : 'N/A'}`);
            console.log(`      Дата наступила: ${isSecondPaymentDateReached ? '✅' : '❌'}`);
          }
        }

        // Анализируем логи напоминаний
        console.log(`\n   📨 Логи напоминаний: ${dealLogs.length}`);
        dealLogs.forEach((log, idx) => {
          console.log(`\n      ${idx + 1}. Лог #${log.id}:`);
          console.log(`         Дата отправки: ${log.sent_date} (${new Date(log.sent_at).toLocaleString('ru-RU')})`);
          console.log(`         Дата второго платежа: ${log.second_payment_date}`);
          console.log(`         SendPulse ID: ${log.sendpulse_id || 'N/A'}`);
          console.log(`         Проформа: ${log.proforma_number || 'N/A'}`);
          console.log(`         Триггер: ${log.trigger_source || 'N/A'}`);
          console.log(`         Run ID: ${log.run_id || 'N/A'}`);

          // Проверяем соответствие SendPulse ID
          if (log.sendpulse_id && sendpulseId && log.sendpulse_id !== sendpulseId) {
            console.log(`         ⚠️  ВНИМАНИЕ: SendPulse ID в логе (${log.sendpulse_id}) не совпадает с текущим (${sendpulseId})`);
          }
        });

        // Проверяем условия отправки
        console.log(`\n   ✅ Проверка условий отправки:`);
        const closeDate = deal.expected_close_date || deal.close_date;
        const expectedCloseDate = closeDate ? new Date(closeDate) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (expectedCloseDate) {
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          const isSchedule5050 = daysDiff >= 30;
          
          console.log(`      Сделка открыта: ${deal.status === 'open' ? '✅' : '❌'}`);
          console.log(`      График 50/50 (>30 дней): ${isSchedule5050 ? '✅' : '❌'} (${daysDiff} дней до лагеря)`);
        console.log(`      Есть проформы: ${proformas && proformas.length > 0 ? '✅' : '❌'}`);
        
        // Проверяем платежи для анализа условий
        let paymentsCheck = null;
        if (proformas && proformas.length > 0) {
          const proformaIds = proformas.map(p => p.id);
          const { data: paymentsData } = await supabase
            .from('payments')
            .select('*')
            .in('proforma_id', proformaIds)
            .neq('manual_status', 'rejected')
            .order('payment_date', { ascending: true });
          paymentsCheck = paymentsData;
        }
        
        console.log(`      Есть платежи: ${paymentsCheck && paymentsCheck.length > 0 ? '✅' : '❌'}`);
        console.log(`      SendPulse ID заполнен: ${sendpulseId ? '✅' : '❌'}`);
        
          if (paymentsCheck && paymentsCheck.length > 0 && proformas && proformas.length > 0) {
            const dealValue = parseFloat(deal.value) || 0;
            const expectedFirstPayment = dealValue / 2;

            if (paymentsCheck && paymentsCheck.length > 0) {
              let secondPaymentDate = null;
              if (closeDate) {
                secondPaymentDate = new Date(closeDate);
                secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
                secondPaymentDate.setHours(0, 0, 0, 0);
              }

              const firstPayments = paymentsCheck.filter(p => {
                if (!p.payment_date) return false;
                const paymentDate = new Date(p.payment_date);
                paymentDate.setHours(0, 0, 0, 0);
                return secondPaymentDate && paymentDate < secondPaymentDate;
              });

              const secondPayments = paymentsCheck.filter(p => {
                if (!p.payment_date) return false;
                const paymentDate = new Date(p.payment_date);
                paymentDate.setHours(0, 0, 0, 0);
                return secondPaymentDate && paymentDate >= secondPaymentDate;
              });

              const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
              const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
              const totalPaid = firstPaymentTotal + secondPaymentTotal;

              const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;
              const isSecondPaymentDateReached = secondPaymentDate && secondPaymentDate <= today;
              let secondPaymentPaid = false;
              
              if (isSecondPaymentDateReached) {
                secondPaymentPaid = secondPaymentTotal >= (dealValue / 2) * 0.9;
              } else {
                secondPaymentPaid = totalPaid >= dealValue * 0.9;
              }

              console.log(`      Первый платеж оплачен (>=90%): ${firstPaymentPaid ? '✅' : '❌'} (${firstPaymentTotal.toFixed(2)} из ${expectedFirstPayment.toFixed(2)})`);
              console.log(`      Второй платеж НЕ оплачен: ${!secondPaymentPaid ? '✅' : '❌'}`);
              console.log(`      Дата второго платежа наступила: ${isSecondPaymentDateReached ? '✅' : '❌'}`);
            }
          }
        }

        console.log(`\n   🔗 Ссылка: https://comoon.pipedrive.com/deal/${dealId}`);

      } catch (error) {
        logger.error(`Ошибка при анализе Deal #${dealId}`, { error: error.message });
        console.log(`   ❌ Ошибка: ${error.message}`);
      }
    }

    console.log(`\n${'='.repeat(120)}`);
    console.log('📊 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(120));
    console.log(`Всего логов: ${logs.length}`);
    console.log(`Уникальных сделок: ${dealsMap.size}`);
    
    // Статистика по датам
    const logsByDate = new Map();
    logs.forEach(log => {
      const date = log.sent_date;
      if (!logsByDate.has(date)) {
        logsByDate.set(date, 0);
      }
      logsByDate.set(date, logsByDate.get(date) + 1);
    });

    console.log(`\n📅 Напоминания по датам:`);
    const sortedDates = Array.from(logsByDate.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    sortedDates.forEach(([date, count]) => {
      console.log(`   ${date}: ${count} напоминаний`);
    });

    // Статистика по триггерам
    const logsByTrigger = new Map();
    logs.forEach(log => {
      const trigger = log.trigger_source || 'unknown';
      if (!logsByTrigger.has(trigger)) {
        logsByTrigger.set(trigger, 0);
      }
      logsByTrigger.set(trigger, logsByTrigger.get(trigger) + 1);
    });

    console.log(`\n🔧 Напоминания по триггерам:`);
    Array.from(logsByTrigger.entries()).forEach(([trigger, count]) => {
      console.log(`   ${trigger}: ${count} напоминаний`);
    });

  } catch (error) {
    logger.error('Ошибка при анализе логов напоминаний:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

analyzeReminderLogs();

