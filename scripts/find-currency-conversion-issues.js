#!/usr/bin/env node

/**
 * Поиск платежей с проблемами конвертации валют
 * Показывает случаи, где amount_pln равен original_amount при не-PLN валюте
 * 
 * Использование:
 *   node scripts/find-currency-conversion-issues.js [--limit=50]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const LIMIT = parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '50', 10);

async function findCurrencyIssues() {
  try {
    const repository = new StripeRepository();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Поиск платежей с проблемами конвертации валют`);
    console.log(`   Лимит: ${LIMIT} платежей`);
    console.log('='.repeat(80));

    // Получаем оплаченные платежи
    console.log(`\n1. Получение оплаченных платежей...`);
    const allPayments = await repository.listPayments({ limit: LIMIT * 2 });
    const paidPayments = allPayments
      .filter(p => (p.payment_status === 'paid' || p.status === 'processed') && p.original_amount && p.amount_pln)
      .slice(0, LIMIT);
    
    console.log(`   Проверяется: ${paidPayments.length} платежей\n`);

    const issues = [];

    for (let i = 0; i < paidPayments.length; i++) {
      const payment = paidPayments[i];
      
      const dbOriginalAmount = parseFloat(payment.original_amount || 0);
      const dbAmountPln = parseFloat(payment.amount_pln || 0);
      const dbCurrency = (payment.currency || 'EUR').toUpperCase();

      // Проверяем проблему: amount_pln равен original_amount при не-PLN валюте
      if (dbCurrency !== 'PLN' && dbOriginalAmount > 0 && dbAmountPln > 0) {
        const plnSameAsOriginal = Math.abs(dbAmountPln - dbOriginalAmount) < 0.01;
        
        if (plnSameAsOriginal) {
          // Проблема найдена!
          const expectedPln = dbCurrency === 'EUR' ? dbOriginalAmount * 4.25 : dbOriginalAmount * 4.5; // Примерный курс
          
          issues.push({
            dealId: payment.deal_id,
            sessionId: payment.session_id,
            paymentId: payment.id,
            originalAmount: dbOriginalAmount,
            amountPln: dbAmountPln,
            currency: dbCurrency,
            expectedPln: expectedPln,
            difference: expectedPln - dbAmountPln
          });
        }
      }
    }

    // Выводим результаты
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 РЕЗУЛЬТАТЫ`);
    console.log('='.repeat(80));
    console.log(`\n❌ Найдено проблемных платежей: ${issues.length}\n`);

    if (issues.length > 0) {
      console.log('ПРОБЛЕМНЫЕ ПЛАТЕЖИ:\n');
      issues.forEach((issue, idx) => {
        console.log(`${idx + 1}. Deal #${issue.dealId || 'N/A'}`);
        console.log(`   Session ID: ${issue.sessionId || 'N/A'}`);
        console.log(`   Валюта: ${issue.currency}`);
        console.log(`   original_amount: ${issue.originalAmount.toFixed(2)} ${issue.currency}`);
        console.log(`   amount_pln: ${issue.amountPln.toFixed(2)} PLN (НЕПРАВИЛЬНО!)`);
        console.log(`   Ожидаемый amount_pln: ~${issue.expectedPln.toFixed(2)} PLN`);
        console.log(`   Разница: ${issue.difference.toFixed(2)} PLN`);
        console.log('');
      });

      // Группируем по сделкам
      const dealsMap = new Map();
      issues.forEach(issue => {
        if (!dealsMap.has(issue.dealId)) {
          dealsMap.set(issue.dealId, []);
        }
        dealsMap.get(issue.dealId).push(issue);
      });

      console.log(`\n📋 ПРОБЛЕМНЫЕ СДЕЛКИ (${dealsMap.size}):\n`);
      dealsMap.forEach((paymentIssues, dealId) => {
        console.log(`Deal #${dealId}: ${paymentIssues.length} платеж(ей) с проблемой`);
        paymentIssues.forEach(issue => {
          console.log(`   - ${issue.originalAmount.toFixed(2)} ${issue.currency} → должно быть ~${issue.expectedPln.toFixed(2)} PLN, записано ${issue.amountPln.toFixed(2)} PLN`);
        });
        console.log('');
      });
    } else {
      console.log('✅ Проблемных платежей не найдено');
    }

    console.log('='.repeat(80));
    console.log('✅ Проверка завершена\n');

  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    logger.error('Error finding currency issues', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

findCurrencyIssues();


