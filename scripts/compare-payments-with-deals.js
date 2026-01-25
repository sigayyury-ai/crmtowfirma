#!/usr/bin/env node

/**
 * Сравнение сумм платежей в БД с суммами сделок в CRM
 * Находит сделки, где суммы не совпадают
 * 
 * Использование:
 *   node scripts/compare-payments-with-deals.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

// Разумные диапазоны курсов валют к PLN (примерные)
const CURRENCY_RATES = {
  'PLN': { min: 0.99, max: 1.01 }, // PLN к PLN = 1
  'EUR': { min: 4.0, max: 5.0 },  // EUR к PLN примерно 4.2-4.5
  'USD': { min: 3.5, max: 5.0 },  // USD к PLN примерно 4.0-4.5
  'GBP': { min: 4.5, max: 6.0 }   // GBP к PLN примерно 5.0-5.5
};

async function comparePaymentsWithDeals() {
  try {
    console.log('\n🔍 Сравнение сумм платежей с суммами сделок в CRM...\n');
    console.log('='.repeat(100));

    const repository = new StripeRepository();
    const pipedrive = new PipedriveClient();

    // Получаем все платежи
    const allPayments = await repository.listPayments({ limit: 10000 });
    console.log(`📊 Всего платежей в БД: ${allPayments.length}\n`);

    // Группируем по deal_id
    const paymentsByDeal = new Map();
    for (const payment of allPayments) {
      if (!payment.deal_id) continue;
      
      const dealId = String(payment.deal_id);
      if (!paymentsByDeal.has(dealId)) {
        paymentsByDeal.set(dealId, []);
      }
      paymentsByDeal.get(dealId).push(payment);
    }

    console.log(`📊 Уникальных сделок с платежами: ${paymentsByDeal.size}\n`);

    const issues = [];
    let processed = 0;

    // Проверяем каждую сделку
    for (const [dealId, payments] of paymentsByDeal.entries()) {
      try {
        processed++;
        if (processed % 10 === 0) {
          console.log(`   Обработано: ${processed}/${paymentsByDeal.size}...`);
        }

        // Получаем данные сделки из CRM
        const dealResult = await pipedrive.getDeal(dealId);
        if (!dealResult.success || !dealResult.deal) {
          continue;
        }

        const deal = dealResult.deal;
        const dealValue = parseFloat(deal.value) || 0;
        const dealCurrency = deal.currency || 'PLN';

        if (dealValue <= 0) {
          continue; // Пропускаем сделки без суммы
        }

        // Считаем оплаченную сумму в валюте сделки
        const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
        
        // ВАЖНО: Проверяем ВСЕ платежи на неверные amount_pln, не только оплаченные
        let totalPaidInDealCurrency = 0;
        let totalPaidPln = 0;
        const paymentDetails = [];
        const amountPlnIssues = [];

        // Проверяем все платежи на проблемы с amount_pln
        for (const payment of payments) {
          const paymentCurrency = payment.currency || 'PLN';
          const originalAmount = parseFloat(payment.original_amount || payment.amount || 0);
          const amountPln = parseFloat(payment.amount_pln || 0);

          if (originalAmount > 0 && amountPln > 0) {
            // Для PLN: amount_pln должен быть равен original_amount
            if (paymentCurrency === 'PLN') {
              if (Math.abs(amountPln - originalAmount) > 0.01) {
                amountPlnIssues.push({
                  type: 'pln_amount_mismatch',
                  message: `Для PLN amount_pln (${amountPln}) не равен original_amount (${originalAmount}), разница: ${Math.abs(amountPln - originalAmount).toFixed(2)}`,
                  payment_id: payment.id,
                  session_id: payment.session_id,
                  payment_type: payment.payment_type,
                  payment_status: payment.payment_status || payment.status,
                  currency: paymentCurrency,
                  original_amount: originalAmount,
                  amount_pln: amountPln
                });
              }
            } else {
              // Для не-PLN валют: amount_pln НЕ должен быть равен original_amount
              // (должен быть конвертирован)
              if (Math.abs(amountPln - originalAmount) < 0.01) {
                amountPlnIssues.push({
                  type: 'amount_pln_equals_original',
                  message: `amount_pln равен original_amount для валюты ${paymentCurrency}: ${amountPln} (должен быть конвертирован в PLN, ожидается примерно ${(originalAmount * 4.2).toFixed(2)})`,
                  payment_id: payment.id,
                  session_id: payment.session_id,
                  payment_type: payment.payment_type,
                  payment_status: payment.payment_status || payment.status,
                  currency: paymentCurrency,
                  original_amount: originalAmount,
                  amount_pln: amountPln
                });
              } else {
                // Проверяем разумность курса конвертации
                const rate = amountPln / originalAmount;
                const expectedRate = CURRENCY_RATES[paymentCurrency];
                if (expectedRate && (rate < expectedRate.min || rate > expectedRate.max)) {
                  amountPlnIssues.push({
                    type: 'suspicious_conversion_rate',
                    message: `Подозрительный курс конвертации для ${paymentCurrency}: ${rate.toFixed(4)} (ожидается ${expectedRate.min}-${expectedRate.max})`,
                    payment_id: payment.id,
                    session_id: payment.session_id,
                    payment_type: payment.payment_type,
                    payment_status: payment.payment_status || payment.status,
                    currency: paymentCurrency,
                    original_amount: originalAmount,
                    amount_pln: amountPln,
                    calculated_rate: rate,
                    expected_rate_min: expectedRate.min,
                    expected_rate_max: expectedRate.max
                  });
                }
              }
            }
          }
        }

        for (const payment of paidPayments) {
          const paymentCurrency = payment.currency || 'PLN';
          const originalAmount = parseFloat(payment.original_amount || payment.amount || 0);
          const amountPln = parseFloat(payment.amount_pln || 0);

          // Суммируем только платежи в валюте сделки
          if (paymentCurrency === dealCurrency) {
            totalPaidInDealCurrency += originalAmount;
          }
          
          totalPaidPln += amountPln;

          paymentDetails.push({
            payment_id: payment.id,
            payment_type: payment.payment_type,
            currency: paymentCurrency,
            original_amount: originalAmount,
            amount_pln: amountPln,
            payment_status: payment.payment_status || payment.status
          });
        }

        // Проверяем несоответствия
        const issuesForDeal = [];

        // 1. Проверка: сумма платежей в валюте сделки не должна превышать сумму сделки более чем на 5%
        if (totalPaidInDealCurrency > dealValue * 1.05) {
          issuesForDeal.push({
            type: 'overpaid',
            message: `Оплачено больше суммы сделки: ${totalPaidInDealCurrency.toFixed(2)} ${dealCurrency} > ${dealValue} ${dealCurrency}`,
            deal_value: dealValue,
            paid_in_deal_currency: totalPaidInDealCurrency,
            difference: totalPaidInDealCurrency - dealValue
          });
        }

        // 2. Проверка: если все платежи в валюте сделки, но сумма сильно отличается
        const allPaymentsInDealCurrency = paidPayments.every(p => (p.currency || 'PLN') === dealCurrency);
        if (allPaymentsInDealCurrency && paidPayments.length > 0) {
          const ratio = totalPaidInDealCurrency / dealValue;
          if (ratio < 0.5 || ratio > 1.5) {
            issuesForDeal.push({
              type: 'amount_mismatch',
              message: `Сумма платежей сильно отличается от суммы сделки: ${totalPaidInDealCurrency.toFixed(2)} ${dealCurrency} vs ${dealValue} ${dealCurrency} (коэффициент: ${ratio.toFixed(2)})`,
              deal_value: dealValue,
              paid_in_deal_currency: totalPaidInDealCurrency,
              ratio: ratio
            });
          }
        }

        // 3. Проверка: если amount_pln записан как original_amount для валюты, отличной от PLN
        for (const payment of paidPayments) {
          const paymentCurrency = payment.currency || 'PLN';
          const originalAmount = parseFloat(payment.original_amount || payment.amount || 0);
          const amountPln = parseFloat(payment.amount_pln || 0);

          if (originalAmount > 0 && amountPln > 0) {
            // Для PLN: amount_pln должен быть равен original_amount
            if (paymentCurrency === 'PLN') {
              if (Math.abs(amountPln - originalAmount) > 0.01) {
                issuesForDeal.push({
                  type: 'pln_amount_mismatch',
                  message: `Для PLN amount_pln (${amountPln}) не равен original_amount (${originalAmount})`,
                  payment_id: payment.id,
                  payment_type: payment.payment_type,
                  currency: paymentCurrency,
                  original_amount: originalAmount,
                  amount_pln: amountPln,
                  difference: Math.abs(amountPln - originalAmount)
                });
              }
            } else {
              // Для не-PLN валют: amount_pln НЕ должен быть равен original_amount
              // (должен быть конвертирован)
              if (Math.abs(amountPln - originalAmount) < 0.01) {
                issuesForDeal.push({
                  type: 'amount_pln_equals_original',
                  message: `amount_pln равен original_amount для валюты ${paymentCurrency}: ${amountPln} (должен быть конвертирован в PLN)`,
                  payment_id: payment.id,
                  payment_type: payment.payment_type,
                  currency: paymentCurrency,
                  original_amount: originalAmount,
                  amount_pln: amountPln
                });
              } else {
                // Проверяем разумность курса конвертации
                const rate = amountPln / originalAmount;
                const expectedRate = CURRENCY_RATES[paymentCurrency];
                if (expectedRate && (rate < expectedRate.min || rate > expectedRate.max)) {
                  issuesForDeal.push({
                    type: 'suspicious_conversion_rate',
                    message: `Подозрительный курс конвертации для ${paymentCurrency}: ${rate.toFixed(4)} (ожидается ${expectedRate.min}-${expectedRate.max})`,
                    payment_id: payment.id,
                    payment_type: payment.payment_type,
                    currency: paymentCurrency,
                    original_amount: originalAmount,
                    amount_pln: amountPln,
                    calculated_rate: rate,
                    expected_rate_min: expectedRate.min,
                    expected_rate_max: expectedRate.max
                  });
                }
              }
            }
          }
        }

        // Добавляем проблемы с amount_pln
        if (amountPlnIssues.length > 0) {
          issuesForDeal.push(...amountPlnIssues);
        }

        if (issuesForDeal.length > 0) {
          issues.push({
            deal_id: dealId,
            deal_title: deal.title || 'Без названия',
            deal_value: dealValue,
            deal_currency: dealCurrency,
            total_paid_in_deal_currency: totalPaidInDealCurrency,
            total_paid_pln: totalPaidPln,
            payments_count: paidPayments.length,
            total_payments_count: payments.length,
            issues: issuesForDeal,
            payment_details: paymentDetails
          });
        }
      } catch (error) {
        logger.error(`Error processing deal ${dealId}`, { error: error.message });
      }
    }

    console.log(`\n✅ Проверено сделок: ${processed}`);
    console.log(`⚠️  Найдено сделок с проблемами: ${issues.length}\n`);

    // Выводим результаты
    if (issues.length > 0) {
      console.log('='.repeat(100));
      console.log('\n📋 СДЕЛКИ С ПРОБЛЕМАМИ:\n');

      issues.forEach((deal, index) => {
        console.log(`${index + 1}. Deal #${deal.deal_id}: ${deal.deal_title}`);
        console.log(`   💰 Сумма в CRM: ${deal.deal_value} ${deal.deal_currency}`);
        console.log(`   💳 Оплачено (в валюте сделки): ${deal.total_paid_in_deal_currency.toFixed(2)} ${deal.deal_currency}`);
        console.log(`   💳 Оплачено (PLN): ${deal.total_paid_pln.toFixed(2)} PLN`);
        console.log(`   📊 Платежей: ${deal.payments_count}`);
        console.log(`   🔗 Ссылка: https://app.pipedrive.com/deal/${deal.deal_id}`);
        
        deal.issues.forEach((issue, i) => {
          console.log(`\n   Проблема ${i + 1} (${issue.type}):`);
          console.log(`      ${issue.message}`);
          if (issue.payment_id) {
            console.log(`      Payment ID: ${issue.payment_id}`);
          }
        });
        console.log('');
      });
    } else {
      console.log('✅ Проблем не найдено!\n');
    }

    // Статистика по типам проблем
    const issueTypes = {};
    issues.forEach(deal => {
      deal.issues.forEach(issue => {
        issueTypes[issue.type] = (issueTypes[issue.type] || 0) + 1;
      });
    });

    console.log('='.repeat(100));
    console.log('\n📊 СТАТИСТИКА:\n');
    console.log(`   Всего проблемных сделок: ${issues.length}`);
    if (Object.keys(issueTypes).length > 0) {
      console.log(`   По типам проблем:`);
      Object.entries(issueTypes).forEach(([type, count]) => {
        console.log(`     ${type}: ${count}`);
      });
    }

    // Сохраняем в JSON
    const outputPath = path.join(__dirname, '../tmp/payments-deals-comparison.json');
    const outputDir = path.dirname(outputPath);
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Директория уже существует
    }

    const output = {
      exported_at: new Date().toISOString(),
      total_deals_checked: processed,
      issues_count: issues.length,
      issue_types: issueTypes,
      deals_with_issues: issues
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\n💾 Данные сохранены в: ${outputPath}`);
    console.log('\n✅ Проверка завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Compare payments with deals failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

comparePaymentsWithDeals().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

