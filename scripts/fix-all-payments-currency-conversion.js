#!/usr/bin/env node

/**
 * Исправление всех платежей с неправильной конвертацией валют
 * Находит платежи, где amount_pln равен original_amount при не-PLN валюте
 * и пересчитывает amount_pln с правильным курсом
 * 
 * Использование:
 *   node scripts/fix-all-payments-currency-conversion.js [--dry-run]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DRY_RUN = process.argv.includes('--dry-run');

async function fixCurrencyConversions() {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const processor = new StripeProcessorService();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔧 Исправление конвертации валют для платежей`);
    console.log(`   Режим: ${DRY_RUN ? 'DRY RUN (без изменений)' : 'РЕАЛЬНЫЕ ИЗМЕНЕНИЯ'}`);
    console.log('='.repeat(80));

    // Получаем все оплаченные платежи
    console.log(`\n1. Получение всех оплаченных платежей...`);
    const allPayments = await repository.listPayments({ limit: 1000 });
    const paidPayments = allPayments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
    
    console.log(`   Найдено оплаченных платежей: ${paidPayments.length}`);

    const issues = [];
    const fixed = [];

    console.log(`\n2. Проверка каждого платежа...\n`);

    for (let i = 0; i < paidPayments.length; i++) {
      const payment = paidPayments[i];
      
      if (!payment.session_id) continue;

      try {
        // Получаем сессию из Stripe
        const session = await stripe.checkout.sessions.retrieve(payment.session_id);
        
        const stripeAmount = session.amount_total ? session.amount_total / 100 : 0;
        const stripeCurrency = session.currency?.toUpperCase() || 'EUR';
        
        const dbOriginalAmount = parseFloat(payment.original_amount || 0);
        const dbAmountPln = parseFloat(payment.amount_pln || 0);
        const dbCurrency = payment.currency?.toUpperCase() || 'EUR';

        // Проверяем проблему: amount_pln равен original_amount при не-PLN валюте
        if (stripeCurrency !== 'PLN' && dbCurrency !== 'PLN') {
          const plnSameAsOriginal = Math.abs(dbAmountPln - dbOriginalAmount) < 0.01;
          
          if (plnSameAsOriginal && dbAmountPln > 0) {
            // Проблема найдена!
            console.log(`${i + 1}. Deal #${payment.deal_id || 'N/A'} - Session: ${payment.session_id.substring(0, 30)}...`);
            console.log(`   ⚠️  ПРОБЛЕМА: amount_pln = original_amount`);
            console.log(`      Stripe: ${stripeAmount.toFixed(2)} ${stripeCurrency}`);
            console.log(`      БД original_amount: ${dbOriginalAmount.toFixed(2)} ${dbCurrency}`);
            console.log(`      БД amount_pln: ${dbAmountPln.toFixed(2)} PLN (НЕПРАВИЛЬНО!)`);

            // Пересчитываем правильный amount_pln
            const conversion = await processor.convertAmountWithRate(stripeAmount, stripeCurrency);
            const correctAmountPln = conversion.amountPln;
            const exchangeRate = conversion.rate;

            console.log(`      Правильный amount_pln: ${correctAmountPln.toFixed(2)} PLN (курс: ${exchangeRate || 'N/A'})`);

            if (correctAmountPln > 0 && !DRY_RUN) {
              // Обновляем в базе данных
              const { error: updateError } = await supabase
                .from('stripe_payments')
                .update({
                  amount_pln: correctAmountPln,
                  exchange_rate: exchangeRate,
                  exchange_rate_fetched_at: conversion.fetchedAt,
                  updated_at: new Date().toISOString()
                })
                .eq('id', payment.id);

              if (updateError) {
                console.log(`      ❌ Ошибка обновления: ${updateError.message}`);
                issues.push({
                  paymentId: payment.id,
                  dealId: payment.deal_id,
                  sessionId: payment.session_id,
                  error: updateError.message
                });
              } else {
                console.log(`      ✅ Исправлено: ${dbAmountPln.toFixed(2)} → ${correctAmountPln.toFixed(2)} PLN`);
                fixed.push({
                  paymentId: payment.id,
                  dealId: payment.deal_id,
                  sessionId: payment.session_id,
                  oldAmountPln: dbAmountPln,
                  newAmountPln: correctAmountPln,
                  exchangeRate
                });
              }
            } else if (DRY_RUN) {
              console.log(`      [DRY RUN] Будет исправлено: ${dbAmountPln.toFixed(2)} → ${correctAmountPln.toFixed(2)} PLN`);
              fixed.push({
                paymentId: payment.id,
                dealId: payment.deal_id,
                sessionId: payment.session_id,
                oldAmountPln: dbAmountPln,
                newAmountPln: correctAmountPln,
                exchangeRate
              });
            } else {
              console.log(`      ⚠️  Не удалось получить курс валют`);
              issues.push({
                paymentId: payment.id,
                dealId: payment.deal_id,
                sessionId: payment.session_id,
                error: 'Failed to get exchange rate'
              });
            }

            console.log('');
          }
        }

        // Небольшая задержка между запросами
        if (i % 10 === 0 && i > 0) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

      } catch (error) {
        if (error.message.includes('No such checkout.session')) {
          // Сессия не найдена - возможно, тестовая или удаленная
          continue;
        }
        console.log(`${i + 1}. Session ${payment.session_id.substring(0, 30)}...`);
        console.log(`   ❌ Ошибка: ${error.message}\n`);
      }
    }

    // Итоговая сводка
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ИТОГОВАЯ СВОДКА`);
    console.log('='.repeat(80));
    console.log(`\n✅ Исправлено платежей: ${fixed.length}`);
    console.log(`❌ Ошибок: ${issues.length}`);

    if (fixed.length > 0) {
      console.log(`\n📋 ИСПРАВЛЕННЫЕ ПЛАТЕЖИ:\n`);
      fixed.forEach((f, idx) => {
        console.log(`${idx + 1}. Deal #${f.dealId || 'N/A'}`);
        console.log(`   Session: ${f.sessionId.substring(0, 40)}...`);
        console.log(`   amount_pln: ${f.oldAmountPln.toFixed(2)} → ${f.newAmountPln.toFixed(2)} PLN`);
        console.log(`   Курс: ${f.exchangeRate || 'N/A'}\n`);
      });
    }

    if (issues.length > 0) {
      console.log(`\n❌ ОШИБКИ:\n`);
      issues.forEach((issue, idx) => {
        console.log(`${idx + 1}. Deal #${issue.dealId || 'N/A'}`);
        console.log(`   Session: ${issue.sessionId}`);
        console.log(`   Ошибка: ${issue.error}\n`);
      });
    }

    console.log('='.repeat(80));
    console.log('✅ Проверка завершена\n');

  } catch (error) {
    console.error(`❌ Критическая ошибка: ${error.message}`);
    logger.error('Error fixing currency conversions', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

fixCurrencyConversions();


