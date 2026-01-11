#!/usr/bin/env node

/**
 * Исправление конвертации валют для платежа Deal #1769
 * 
 * Использование:
 *   node scripts/fix-payment-1769-currency.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeProcessorService = require('../src/services/stripe/processor');
const logger = require('../src/utils/logger');

const PAYMENT_ID = 'e35019fa-a780-4cc7-a872-7d780a2fb8c6';
const SESSION_ID = 'cs_live_a1lqZP1AmfOgW2BKv6LSM7LpLxWcvXYgzSXFz0rnoux7S8a5M9kb1QkW5G';
const ORIGINAL_AMOUNT = 300.00;
const CURRENCY = 'EUR';

async function fixPayment1769Currency() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔧 Исправление конвертации валют для платежа Deal #1769`);
    console.log('='.repeat(80));

    // Получаем актуальный курс валют
    console.log(`\n1. Получение актуального курса EUR/PLN...`);
    const processor = new StripeProcessorService();
    const conversion = await processor.convertAmountWithRate(ORIGINAL_AMOUNT, CURRENCY);
    
    const correctAmountPln = conversion.amountPln;
    const exchangeRate = conversion.rate;
    const fetchedAt = conversion.fetchedAt;

    console.log(`   Курс EUR/PLN: ${exchangeRate || 'N/A'}`);
    console.log(`   Правильный amount_pln: ${correctAmountPln.toFixed(2)} PLN`);

    if (!exchangeRate || correctAmountPln === 0) {
      console.error(`   ❌ Не удалось получить курс валют`);
      return;
    }

    // Получаем текущий платеж
    console.log(`\n2. Получение текущего платежа...`);
    const { data: payment, error: findError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('id', PAYMENT_ID)
      .single();

    if (findError || !payment) {
      console.error(`   ❌ Платеж не найден: ${findError?.message || 'unknown'}`);
      return;
    }

    console.log(`   ✅ Платеж найден`);
    console.log(`   Текущий amount_pln: ${payment.amount_pln || 'N/A'} PLN`);
    console.log(`   Текущий exchange_rate: ${payment.exchange_rate || 'N/A'}`);

    // Обновляем платеж
    console.log(`\n3. Обновление платежа...`);
    console.log(`   Старый amount_pln: ${payment.amount_pln || 0} PLN`);
    console.log(`   Новый amount_pln: ${correctAmountPln.toFixed(2)} PLN`);
    console.log(`   Курс: ${exchangeRate}`);

    const { error: updateError } = await supabase
      .from('stripe_payments')
      .update({
        amount_pln: correctAmountPln,
        exchange_rate: exchangeRate,
        exchange_rate_fetched_at: fetchedAt,
        updated_at: new Date().toISOString()
      })
      .eq('id', PAYMENT_ID);

    if (updateError) {
      console.error(`   ❌ Ошибка обновления: ${updateError.message}`);
      return;
    }

    console.log(`   ✅ Платеж успешно обновлен`);

    // Проверяем результат
    console.log(`\n4. Проверка результата...`);
    const { data: updatedPayment, error: checkError } = await supabase
      .from('stripe_payments')
      .select('original_amount, amount_pln, currency, exchange_rate')
      .eq('id', PAYMENT_ID)
      .single();

    if (!checkError && updatedPayment) {
      console.log(`   ✅ Проверка:`);
      console.log(`      original_amount: ${updatedPayment.original_amount} ${updatedPayment.currency}`);
      console.log(`      amount_pln: ${updatedPayment.amount_pln} PLN`);
      console.log(`      exchange_rate: ${updatedPayment.exchange_rate || 'N/A'}`);
      
      const ratio = updatedPayment.amount_pln / updatedPayment.original_amount;
      console.log(`      Коэффициент конвертации: ${ratio.toFixed(4)}`);
      
      if (Math.abs(ratio - exchangeRate) < 0.01) {
        console.log(`      ✅ Конвертация правильная!`);
      } else {
        console.log(`      ⚠️  Коэффициент отличается от курса`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Исправление завершено успешно!`);
    console.log('='.repeat(80));
    console.log(`\nИтоги:`);
    console.log(`  ✅ amount_pln исправлен: ${payment.amount_pln || 0} → ${correctAmountPln.toFixed(2)} PLN`);
    console.log(`  ✅ Курс сохранен: ${exchangeRate}`);
    console.log(`  ✅ Deal #1769 теперь имеет правильную конвертацию\n`);

  } catch (error) {
    console.error(`\n❌ Критическая ошибка: ${error.message}`);
    logger.error('Error fixing payment 1769 currency', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

fixPayment1769Currency();

