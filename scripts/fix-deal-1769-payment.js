#!/usr/bin/env node

/**
 * Исправление платежа для Deal #1769
 * 1. Исправляет сумму deposit платежа с 1263.78 на 300 EUR (реальная сумма из Stripe)
 * 2. Создает сессию для второго платежа на 300 EUR
 * 
 * Использование:
 *   node scripts/fix-deal-1769-payment.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_ID = '1769';
const DEPOSIT_SESSION_ID = 'cs_live_a1lqZP1AmfOgW2BKv6LSM7LpLxWcvXYgzSXFz0rnoux7S8a5M9kb1QkW5G';
const CORRECT_DEPOSIT_AMOUNT = 300.00; // Реальная сумма из Stripe
const CORRECT_REST_AMOUNT = 300.00; // Оставшаяся часть (600 - 300)

async function fixDeal1769Payment() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔧 Исправление платежа для Deal #${DEAL_ID}`);
    console.log('='.repeat(80));

    // Шаг 1: Находим платеж в базе данных
    console.log(`\n1. Поиск платежа в базе данных...`);
    const { data: payment, error: findError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('session_id', DEPOSIT_SESSION_ID)
      .single();

    if (findError || !payment) {
      console.error(`❌ Платеж не найден: ${findError?.message || 'unknown'}`);
      return;
    }

    console.log(`   ✅ Найден платеж:`);
    console.log(`      ID: ${payment.id}`);
    console.log(`      Текущая сумма (original_amount): ${payment.original_amount || 'N/A'} ${payment.currency}`);
    console.log(`      Текущая сумма PLN (amount_pln): ${payment.amount_pln || 'N/A'}`);

    // Шаг 2: Обновляем сумму в базе данных
    console.log(`\n2. Обновление суммы в базе данных...`);
    console.log(`   Старая сумма (original_amount): ${payment.original_amount || 'N/A'} ${payment.currency}`);
    console.log(`   Старая сумма PLN (amount_pln): ${payment.amount_pln || 'N/A'}`);
    console.log(`   Новая сумма: ${CORRECT_DEPOSIT_AMOUNT} ${payment.currency}`);

    const { error: updateError } = await supabase
      .from('stripe_payments')
      .update({
        original_amount: CORRECT_DEPOSIT_AMOUNT,
        amount_pln: CORRECT_DEPOSIT_AMOUNT, // Для EUR amount_pln = amount
        updated_at: new Date().toISOString()
      })
      .eq('id', payment.id);

    if (updateError) {
      console.error(`   ❌ Ошибка при обновлении: ${updateError.message}`);
      return;
    }

    console.log(`   ✅ Сумма обновлена успешно`);

    // Шаг 3: Проверяем обновленный платеж
    const { data: updatedPayment, error: checkError } = await supabase
      .from('stripe_payments')
      .select('original_amount, amount, amount_pln, currency')
      .eq('id', payment.id)
      .single();

    if (!checkError && updatedPayment) {
      console.log(`\n   Проверка обновления:`);
      console.log(`      original_amount: ${updatedPayment.original_amount} ${updatedPayment.currency}`);
      console.log(`      amount: ${updatedPayment.amount} ${updatedPayment.currency}`);
      console.log(`      amount_pln: ${updatedPayment.amount_pln} ${updatedPayment.currency}`);
    }

    // Шаг 4: Получаем данные сделки
    console.log(`\n3. Получение данных сделки...`);
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDeal(DEAL_ID);
    
    if (!dealResult.success || !dealResult.deal) {
      console.error(`   ❌ Сделка не найдена: ${dealResult.error || 'unknown'}`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`   ✅ Сделка: ${deal.title}`);
    console.log(`      Сумма: ${deal.value} ${deal.currency || 'EUR'}`);

    // Шаг 5: Создаем сессию для второго платежа
    console.log(`\n4. Создание сессии для второго платежа (rest)...`);
    console.log(`   Сумма: ${CORRECT_REST_AMOUNT} ${deal.currency || 'EUR'}`);

    const processor = new StripeProcessorService();
    const sessionResult = await processor.createCheckoutSessionForDeal(deal, {
      trigger: 'manual_fix',
      runId: `fix_1769_${Date.now()}`,
      paymentType: 'rest',
      paymentSchedule: '50/50',
      paymentIndex: 2,
      customAmount: CORRECT_REST_AMOUNT
    });

    if (!sessionResult.success) {
      console.error(`   ❌ Ошибка при создании сессии: ${sessionResult.error || 'unknown'}`);
      return;
    }

    console.log(`   ✅ Сессия создана успешно:`);
    console.log(`      Session ID: ${sessionResult.sessionId}`);
    console.log(`      Payment URL: ${sessionResult.sessionUrl}`);
    console.log(`      Amount: ${sessionResult.amount} ${sessionResult.currency}`);

    // Шаг 6: Отправляем уведомление
    console.log(`\n5. Отправка уведомления...`);
    try {
      const repository = require('../src/services/stripe/repository');
      const allPayments = await repository.listPayments({ dealId: DEAL_ID, limit: 10 });
      
      const sessions = [];
      for (const p of allPayments) {
        if (p.session_id && (p.checkout_url || p.raw_payload?.url)) {
          sessions.push({
            id: p.session_id,
            url: p.checkout_url || p.raw_payload.url,
            type: p.payment_type,
            amount: p.original_amount || p.amount
          });
        }
      }

      // Добавляем новую сессию
      sessions.push({
        id: sessionResult.sessionId,
        url: sessionResult.sessionUrl,
        type: 'rest',
        amount: sessionResult.amount
      });

      const notificationResult = await processor.sendPaymentNotificationForDeal(DEAL_ID, {
        paymentSchedule: '50/50',
        sessions: sessions,
        currency: sessionResult.currency,
        totalAmount: parseFloat(deal.value) || 0
      });

      if (notificationResult.success) {
        console.log(`   ✅ Уведомление отправлено`);
      } else {
        console.log(`   ⚠️  Уведомление не отправлено: ${notificationResult.error}`);
      }
    } catch (notifyError) {
      console.log(`   ⚠️  Ошибка отправки уведомления: ${notifyError.message}`);
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Исправление завершено успешно!`);
    console.log('='.repeat(80));
    console.log(`\nИтоги:`);
    console.log(`  ✅ Deposit платеж исправлен: 1263.78 → 300.00 EUR`);
    console.log(`  ✅ Создана сессия для второго платежа: ${CORRECT_REST_AMOUNT} EUR`);
    console.log(`  ✅ Session ID: ${sessionResult.sessionId}`);
    console.log(`  ✅ Payment URL: ${sessionResult.sessionUrl}\n`);

  } catch (error) {
    console.error(`\n❌ Критическая ошибка: ${error.message}`);
    logger.error('Error fixing deal 1769 payment', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

fixDeal1769Payment();

