#!/usr/bin/env node

/**
 * Скрипт для поиска сделок, где:
 * 1. Первый платеж был создан с графиком 50/50
 * 2. Первый платеж оплачен
 * 3. Второй платеж не создан
 * 4. Текущий график определяется как 100% (потому что до лагеря < 30 дней)
 * 
 * Это случаи, когда система не создала второй платеж, потому что график "изменился"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function findMissingSecondPayments() {
  try {
    console.log('🔍 Поиск сделок с отсутствующими вторыми платежами...\n');

    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    // Получаем все оплаченные deposit платежи
    const allPayments = await repository.listPayments({ limit: 1000 });
    
    const depositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid' &&
      p.payment_schedule === '50/50' &&
      p.deal_id
    );

    console.log(`Найдено ${depositPayments.length} оплаченных deposit платежей с графиком 50/50\n`);

    const missingSecondPayments = [];
    const checkedDeals = new Set();

    for (const depositPayment of depositPayments) {
      const dealId = depositPayment.deal_id;
      
      if (checkedDeals.has(dealId)) {
        continue;
      }
      checkedDeals.add(dealId);

      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult.success || !dealResult.deal) {
          continue;
        }

        const deal = dealResult.deal;
        const person = dealResult.person;
        const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

        // Получаем все платежи для сделки
        const dealPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 100
        });

        // Проверяем, есть ли второй платеж (rest/second/final)
        const restPayments = dealPayments.filter(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
        );

        // Если второй платеж уже есть, пропускаем
        if (restPayments.length > 0) {
          continue;
        }

        // Определяем текущий график на основе expected_close_date
        const closeDate = deal.expected_close_date || deal.close_date;
        let currentSchedule = '100%';
        let daysUntilCamp = null;
        let secondPaymentDate = null;

        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          daysUntilCamp = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysUntilCamp >= 30) {
            currentSchedule = '50/50';
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          }
        }

        // Находим первый платеж (deposit)
        const firstPayment = dealPayments.find(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') &&
          p.payment_status === 'paid'
        );

        if (!firstPayment) {
          continue;
        }

        // Вычисляем дату второго платежа на основе даты создания первого платежа
        const firstPaymentDate = new Date(firstPayment.created_at);
        const expectedCloseDate = closeDate ? new Date(closeDate) : null;
        let calculatedSecondPaymentDate = null;
        
        if (expectedCloseDate) {
          calculatedSecondPaymentDate = new Date(expectedCloseDate);
          calculatedSecondPaymentDate.setMonth(calculatedSecondPaymentDate.getMonth() - 1);
        }

        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';
        const firstPaymentAmount = parseFloat(firstPayment.original_amount || firstPayment.amount_pln || 0);
        const expectedSecondPaymentAmount = dealValue / 2;

        // Проверяем invoice_type
        const invoiceTypeFieldKey = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
        const invoiceType = deal[invoiceTypeFieldKey];
        const isStripeDeal = String(invoiceType) === '75';

        missingSecondPayments.push({
          dealId: deal.id,
          dealTitle: deal.title,
          customerEmail,
          dealValue,
          currency,
          firstPayment: {
            id: firstPayment.id,
            amount: firstPaymentAmount,
            currency: firstPayment.currency || currency,
            createdAt: firstPayment.created_at,
            paymentSchedule: firstPayment.payment_schedule,
            sessionId: firstPayment.session_id
          },
          expectedSecondPayment: {
            amount: expectedSecondPaymentAmount,
            currency,
            calculatedDate: calculatedSecondPaymentDate ? calculatedSecondPaymentDate.toISOString().split('T')[0] : null
          },
          currentSchedule,
          daysUntilCamp,
          expectedCloseDate: closeDate,
          isStripeDeal,
          stageId: deal.stage_id,
          stageName: deal.stage || 'Unknown',
          reason: currentSchedule === '100%' 
            ? 'График изменился на 100% (до лагеря < 30 дней), поэтому cron не создал второй платеж'
            : 'Второй платеж должен быть создан, но не был'
        });

      } catch (error) {
        logger.error(`Ошибка при обработке сделки ${dealId}:`, error.message);
        continue;
      }
    }

    // Сортируем по дате создания первого платежа
    missingSecondPayments.sort((a, b) => 
      new Date(a.firstPayment.createdAt) - new Date(b.firstPayment.createdAt)
    );

    console.log(`\n📊 Найдено ${missingSecondPayments.length} сделок с отсутствующими вторыми платежами:\n`);

    // Выводим таблицу с основными данными
    console.log('📋 Сводная таблица:');
    console.log('─'.repeat(140));
    console.log(
      'Deal ID'.padEnd(10) + '| ' +
      'First Payment Date'.padEnd(20) + '| ' +
      'Expected Close Date'.padEnd(20) + '| ' +
      'Second Payment Date'.padEnd(20) + '| ' +
      'Days Until Camp'.padEnd(18) + '| ' +
      'Amount'.padEnd(15) + '| ' +
      'Status'
    );
    console.log('─'.repeat(140));
    
    missingSecondPayments.forEach(deal => {
      const firstPaymentDate = new Date(deal.firstPayment.createdAt).toISOString().split('T')[0];
      const expectedCloseDate = deal.expectedCloseDate || 'N/A';
      const secondPaymentDate = deal.expectedSecondPayment.calculatedDate || 'N/A';
      const daysUntil = deal.daysUntilCamp !== null ? String(deal.daysUntilCamp) : 'N/A';
      const amount = `${deal.firstPayment.amount} ${deal.firstPayment.currency}`;
      const status = deal.stageName || `Stage ${deal.stageId}`;
      
      console.log(
        String(deal.dealId).padEnd(10) + '| ' +
        firstPaymentDate.padEnd(20) + '| ' +
        expectedCloseDate.padEnd(20) + '| ' +
        secondPaymentDate.padEnd(20) + '| ' +
        daysUntil.padEnd(18) + '| ' +
        amount.padEnd(15) + '| ' +
        status
      );
    });
    console.log('─'.repeat(140));
    console.log('');

    // Группируем по причине
    const byReason = {
      scheduleChanged: missingSecondPayments.filter(d => d.currentSchedule === '100%'),
      shouldBeCreated: missingSecondPayments.filter(d => d.currentSchedule === '50/50')
    };

    if (byReason.scheduleChanged.length > 0) {
      console.log(`\n⚠️  КРИТИЧНО: ${byReason.scheduleChanged.length} сделок, где график изменился на 100%:`);
      console.log('   (Первый платеж был создан с графиком 50/50, но сейчас до лагеря < 30 дней)\n');
      
      byReason.scheduleChanged.forEach((deal, index) => {
        const firstPaymentDate = new Date(deal.firstPayment.createdAt).toISOString().split('T')[0];
        const secondPaymentDate = deal.expectedSecondPayment.calculatedDate;
        const daysUntil = deal.daysUntilCamp;
        
        console.log(`${index + 1}. Deal #${deal.dealId}: ${deal.dealTitle}`);
        console.log(`   Клиент: ${deal.customerEmail}`);
        console.log(`   Сумма: ${deal.dealValue} ${deal.currency}`);
        console.log(`   Первый платеж: ${deal.firstPayment.amount} ${deal.firstPayment.currency} (${firstPaymentDate})`);
        console.log(`   Ожидаемый второй платеж: ${deal.expectedSecondPayment.amount} ${deal.currency}`);
        console.log(`   Дата второго платежа: ${secondPaymentDate || 'не определена'}`);
        console.log(`   Дней до лагеря: ${daysUntil !== null ? daysUntil : 'не определена'}`);
        console.log(`   Статус: ${deal.stageName} (${deal.stageId})`);
        console.log(`   Stripe deal: ${deal.isStripeDeal ? '✅' : '❌'}`);
        console.log(`   Причина: ${deal.reason}`);
        console.log('');
      });
    }

    if (byReason.shouldBeCreated.length > 0) {
      console.log(`\n📋 ${byReason.shouldBeCreated.length} сделок, где второй платеж должен быть создан:`);
      console.log('   (График все еще 50/50, но второй платеж не создан)\n');
      
      byReason.shouldBeCreated.forEach((deal, index) => {
        const firstPaymentDate = new Date(deal.firstPayment.createdAt).toISOString().split('T')[0];
        const secondPaymentDate = deal.expectedSecondPayment.calculatedDate;
        
        console.log(`${index + 1}. Deal #${deal.dealId}: ${deal.dealTitle}`);
        console.log(`   Клиент: ${deal.customerEmail}`);
        console.log(`   Первый платеж: ${deal.firstPayment.amount} ${deal.firstPayment.currency} (${firstPaymentDate})`);
        console.log(`   Ожидаемый второй платеж: ${deal.expectedSecondPayment.amount} ${deal.currency}`);
        console.log(`   Дата второго платежа: ${secondPaymentDate || 'не определена'}`);
        console.log(`   Stripe deal: ${deal.isStripeDeal ? '✅' : '❌'}`);
        console.log('');
      });
    }

    // Сохраняем результаты в JSON
    const fs = require('fs');
    const outputPath = 'tmp/missing-second-payments.json';
    fs.mkdirSync('tmp', { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(missingSecondPayments, null, 2));
    console.log(`\n💾 Результаты сохранены в ${outputPath}`);

    return missingSecondPayments;

  } catch (error) {
    logger.error('Ошибка при поиске отсутствующих вторых платежей:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

findMissingSecondPayments().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});

