#!/usr/bin/env node

/**
 * Проверка последних Stripe платежей на расхождения сумм и валют
 * Сравнивает данные из базы данных с реальными данными из Stripe API
 * 
 * Использование:
 *   node scripts/verify-stripe-payments-currency.js [--limit=20]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const LIMIT = parseInt(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] || '20', 10);

async function verifyStripePayments() {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Проверка последних ${LIMIT} Stripe платежей`);
    console.log('='.repeat(80));

    // Получаем последние оплаченные платежи из базы данных
    console.log(`\n1. Получение последних оплаченных платежей из базы данных...`);
    const allPayments = await repository.listPayments({ 
      limit: LIMIT * 2 // Берем больше, чтобы найти оплаченные
    });

    const paidPayments = allPayments
      .filter(p => p.payment_status === 'paid' || p.status === 'processed')
      .slice(0, LIMIT);

    console.log(`   Найдено оплаченных платежей: ${paidPayments.length}`);

    if (paidPayments.length === 0) {
      console.log('   ⚠️  Нет оплаченных платежей для проверки');
      return;
    }

    const issues = [];
    const correct = [];

    console.log(`\n2. Проверка каждого платежа в Stripe API...\n`);

    for (let i = 0; i < paidPayments.length; i++) {
      const payment = paidPayments[i];
      
      if (!payment.session_id) {
        console.log(`${i + 1}. Платеж #${payment.id || 'N/A'}: ⚠️  Нет session_id`);
        continue;
      }

      try {
        // Получаем сессию из Stripe
        const session = await stripe.checkout.sessions.retrieve(payment.session_id);
        
        // Получаем данные сделки
        const dealId = payment.deal_id;
        let deal = null;
        if (dealId) {
          try {
            const dealResult = await pipedriveClient.getDeal(dealId);
            if (dealResult.success && dealResult.deal) {
              deal = dealResult.deal;
            }
          } catch (e) {
            // Игнорируем ошибки получения сделки
          }
        }

        // Реальные данные из Stripe
        const stripeAmount = session.amount_total ? session.amount_total / 100 : 0;
        const stripeCurrency = session.currency?.toUpperCase() || 'EUR';
        
        // Данные из базы
        const dbOriginalAmount = parseFloat(payment.original_amount || 0);
        const dbAmountPln = parseFloat(payment.amount_pln || 0);
        const dbCurrency = payment.currency?.toUpperCase() || 'EUR';

        // Проверяем расхождения
        const hasAmountMismatch = Math.abs(stripeAmount - dbOriginalAmount) > 0.01;
        const hasCurrencyMismatch = stripeCurrency !== dbCurrency;

        console.log(`${i + 1}. Deal #${dealId || 'N/A'} - ${deal?.title || payment.customer_name || 'N/A'}`);
        console.log(`   Session ID: ${payment.session_id.substring(0, 30)}...`);
        console.log(`   Stripe: ${stripeAmount.toFixed(2)} ${stripeCurrency}`);
        console.log(`   БД original_amount: ${dbOriginalAmount.toFixed(2)} ${dbCurrency}`);
        console.log(`   БД amount_pln: ${dbAmountPln.toFixed(2)} PLN`);

        if (deal) {
          console.log(`   Сделка: ${deal.value} ${deal.currency || 'EUR'}`);
        }

        // Проверяем конвертацию
        if (stripeCurrency !== 'PLN' && dbAmountPln > 0) {
          // Пытаемся понять, правильная ли конвертация
          // Если original_amount в EUR, а amount_pln близок к original_amount * курс, то ок
          // Если amount_pln = original_amount, то возможно была ошибка конвертации
          const expectedPln = stripeCurrency === 'EUR' ? stripeAmount * 4.3 : stripeAmount; // Примерный курс
          const plnDiff = Math.abs(dbAmountPln - expectedPln);
          const plnSameAsOriginal = Math.abs(dbAmountPln - dbOriginalAmount) < 0.01;
          
          if (plnSameAsOriginal && stripeCurrency !== 'PLN') {
            console.log(`   ⚠️  ПРОБЛЕМА: amount_pln = original_amount, но валюта не PLN!`);
            console.log(`      Возможно, amount_pln должен быть в PLN, а не в ${stripeCurrency}`);
            issues.push({
              dealId,
              sessionId: payment.session_id,
              issue: 'amount_pln равен original_amount при не-PLN валюте',
              stripeAmount,
              stripeCurrency,
              dbOriginalAmount,
              dbAmountPln,
              dbCurrency
            });
          } else if (plnDiff > expectedPln * 0.1) {
            console.log(`   ⚠️  Возможная проблема с конвертацией (разница: ${plnDiff.toFixed(2)} PLN)`);
          }
        }

        if (hasAmountMismatch) {
          console.log(`   ❌ РАСХОЖДЕНИЕ СУММЫ! Разница: ${Math.abs(stripeAmount - dbOriginalAmount).toFixed(2)} ${stripeCurrency}`);
          issues.push({
            dealId,
            sessionId: payment.session_id,
            issue: 'Расхождение суммы',
            stripeAmount,
            stripeCurrency,
            dbOriginalAmount,
            dbAmountPln,
            dbCurrency,
            difference: Math.abs(stripeAmount - dbOriginalAmount)
          });
        } else if (hasCurrencyMismatch) {
          console.log(`   ⚠️  РАСХОЖДЕНИЕ ВАЛЮТЫ: Stripe=${stripeCurrency}, БД=${dbCurrency}`);
          issues.push({
            dealId,
            sessionId: payment.session_id,
            issue: 'Расхождение валюты',
            stripeAmount,
            stripeCurrency,
            dbOriginalAmount,
            dbAmountPln,
            dbCurrency
          });
        } else {
          console.log(`   ✅ Суммы совпадают`);
          correct.push({
            dealId,
            sessionId: payment.session_id
          });
        }

        // Проверяем Payment Intent для дополнительной информации
        if (session.payment_intent) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
            console.log(`   Payment Intent: ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()}`);
            
            if (paymentIntent.amount / 100 !== stripeAmount) {
              console.log(`   ⚠️  Payment Intent сумма отличается от Session суммы!`);
            }
          } catch (e) {
            // Игнорируем ошибки
          }
        }

        console.log('');

        // Небольшая задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 200));

      } catch (error) {
        console.log(`${i + 1}. Session ${payment.session_id.substring(0, 30)}...`);
        console.log(`   ❌ Ошибка: ${error.message}\n`);
        issues.push({
          dealId: payment.deal_id,
          sessionId: payment.session_id,
          issue: `Ошибка получения сессии: ${error.message}`
        });
      }
    }

    // Итоговая сводка
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ИТОГОВАЯ СВОДКА`);
    console.log('='.repeat(80));
    console.log(`\n✅ Корректных платежей: ${correct.length}`);
    console.log(`❌ Проблемных платежей: ${issues.length}`);

    if (issues.length > 0) {
      console.log(`\n📋 ДЕТАЛИ ПРОБЛЕМ:\n`);
      issues.forEach((issue, idx) => {
        console.log(`${idx + 1}. Deal #${issue.dealId || 'N/A'}`);
        console.log(`   Session: ${issue.sessionId}`);
        console.log(`   Проблема: ${issue.issue}`);
        if (issue.stripeAmount !== undefined) {
          console.log(`   Stripe: ${issue.stripeAmount.toFixed(2)} ${issue.stripeCurrency}`);
          console.log(`   БД original_amount: ${issue.dbOriginalAmount.toFixed(2)} ${issue.dbCurrency}`);
          console.log(`   БД amount_pln: ${issue.dbAmountPln.toFixed(2)} PLN`);
          if (issue.difference) {
            console.log(`   Разница: ${issue.difference.toFixed(2)} ${issue.stripeCurrency}`);
          }
        }
        console.log('');
      });
    }

    console.log('='.repeat(80));
    console.log('✅ Проверка завершена\n');

  } catch (error) {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    logger.error('Error verifying Stripe payments', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

verifyStripePayments();


