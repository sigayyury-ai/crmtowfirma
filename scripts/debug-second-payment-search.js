#!/usr/bin/env node

/**
 * Детальная отладка поиска сделок для вторых платежей
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function debugSearch() {
  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    console.log('🔍 Детальная отладка поиска сделок...\n');

    const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const stripeTriggerValue = '75';

    // Получаем все сделки
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

    // Шаг 1: Фильтруем по invoice_type = 75
    const stripeDeals = dealsResult.deals.filter(deal => {
      const invoiceType = deal[invoiceTypeFieldKey];
      return String(invoiceType) === stripeTriggerValue;
    });

    console.log(`✅ Сделок со статусом Stripe (invoice_type = 75): ${stripeDeals.length}\n`);

    if (stripeDeals.length === 0) {
      console.log('⚠️  Нет сделок со статусом Stripe');
      return;
    }

    // Шаг 2: Проверяем график платежей
    let dealsWith5050 = 0;
    let dealsWithFirstPaid = 0;
    let dealsWithoutSecond = 0;
    const eligibleDeals = [];

    for (const deal of stripeDeals.slice(0, 10)) { // Проверяем первые 10 для примера
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
          dealsWith5050++;
        }
      }

      if (schedule === '50/50') {
        // Проверяем первый платеж
        const allPayments = await repository.listPayments({
          dealId: String(deal.id),
          limit: 100
        });

        const depositPayments = allPayments.filter(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') &&
          p.payment_status === 'paid'
        );

        const restPayments = allPayments.filter(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'paid'
        );

        if (depositPayments.length > 0) {
          dealsWithFirstPaid++;
          
          if (restPayments.length === 0) {
            dealsWithoutSecond++;
            
            const dealWithRelated = await pipedriveClient.getDealWithRelatedData(deal.id);
            const person = dealWithRelated?.person;
            const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

            eligibleDeals.push({
              dealId: deal.id,
              dealTitle: deal.title,
              customerEmail,
              expectedCloseDate: closeDate,
              secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
              daysUntil: Math.ceil((secondPaymentDate - new Date()) / (1000 * 60 * 60 * 24))
            });
          }
        }
      }
    }

    console.log(`📊 Статистика по первым 10 сделкам:`);
    console.log(`   - С графиком 50/50: ${dealsWith5050}`);
    console.log(`   - С оплаченным первым платежом: ${dealsWithFirstPaid}`);
    console.log(`   - Без второго платежа: ${dealsWithoutSecond}\n`);

    if (eligibleDeals.length > 0) {
      console.log(`✅ Найдено подходящих сделок (первые 10):\n`);
      eligibleDeals.forEach((deal, index) => {
        console.log(`${index + 1}. Deal #${deal.dealId}: ${deal.dealTitle}`);
        console.log(`   Клиент: ${deal.customerEmail}`);
        console.log(`   Дата второго платежа: ${deal.secondPaymentDate} (через ${deal.daysUntil} дн.)`);
        console.log(`   Начало лагеря: ${deal.expectedCloseDate}`);
        console.log(`   Ссылка: https://comoon.pipedrive.com/deal/${deal.dealId}\n`);
      });
    } else {
      console.log('⚠️  Среди первых 10 сделок нет подходящих');
      console.log('   Это может означать, что:');
      console.log('   - Все вторые платежи уже созданы');
      console.log('   - Первые платежи еще не оплачены');
      console.log('   - График платежей 100% (не 50/50)');
    }

  } catch (error) {
    logger.error('Ошибка при отладке:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

debugSearch();
