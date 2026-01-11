#!/usr/bin/env node

/**
 * Проверка реальных платежей в Stripe для сделки
 * 
 * Использование:
 *   node scripts/verify-deal-payment-stripe.js <dealId>
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

async function verifyDealPayment(dealId) {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔍 Проверка реальных платежей для Deal #${dealId}`);
    console.log('='.repeat(80));

    // Получаем данные сделки
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Сделка не найдена: ${dealResult.error || 'unknown'}`);
      return;
    }

    const deal = dealResult.deal;
    console.log(`\n📋 Сделка: ${deal.title}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'EUR'}`);

    // Получаем платежи из базы данных
    const payments = await repository.listPayments({ dealId: String(dealId), limit: 100 });
    console.log(`\n📊 Платежи в базе данных: ${payments.length}`);

    // Проверяем каждую сессию в Stripe
    console.log(`\n🔍 Проверка сессий в Stripe API:\n`);
    
    let totalPaidInStripe = 0;
    let totalPaidInDb = 0;

    for (const payment of payments) {
      if (!payment.session_id) {
        console.log(`⚠️  Платеж без session_id: ${payment.id || 'N/A'}`);
        continue;
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(payment.session_id);
        
        console.log(`\n📋 Session ID: ${payment.session_id}`);
        console.log(`   Статус в Stripe: ${session.status}`);
        console.log(`   Payment Status в Stripe: ${session.payment_status}`);
        
        // Получаем реальную сумму из Stripe
        const stripeAmount = session.amount_total ? session.amount_total / 100 : 0;
        const stripeCurrency = session.currency?.toUpperCase() || 'EUR';
        
        console.log(`   Сумма в Stripe: ${stripeAmount.toFixed(2)} ${stripeCurrency}`);
        
        // Сумма из базы данных
        const dbAmount = parseFloat(payment.amount_pln || payment.amount || payment.original_amount || 0);
        console.log(`   Сумма в БД: ${dbAmount.toFixed(2)} ${payment.currency || 'EUR'}`);
        
        if (Math.abs(stripeAmount - dbAmount) > 0.01) {
          console.log(`   ⚠️  РАСХОЖДЕНИЕ! Разница: ${Math.abs(stripeAmount - dbAmount).toFixed(2)} ${stripeCurrency}`);
        } else {
          console.log(`   ✅ Суммы совпадают`);
        }

        // Если оплачено, добавляем к общей сумме
        if (session.payment_status === 'paid') {
          totalPaidInStripe += stripeAmount;
          totalPaidInDb += dbAmount;
          
          // Получаем payment intent для деталей
          if (session.payment_intent) {
            try {
              const paymentIntent = await stripe.paymentIntents.retrieve(session.payment_intent);
              console.log(`   Payment Intent ID: ${paymentIntent.id}`);
              console.log(`   Сумма Payment Intent: ${(paymentIntent.amount / 100).toFixed(2)} ${paymentIntent.currency.toUpperCase()}`);
              console.log(`   Статус: ${paymentIntent.status}`);
            } catch (e) {
              console.log(`   ⚠️  Не удалось получить Payment Intent: ${e.message}`);
            }
          }
        }

        console.log(`   Создана: ${session.created ? new Date(session.created * 1000).toISOString() : 'N/A'}`);
        if (session.customer_email) {
          console.log(`   Email: ${session.customer_email}`);
        }

      } catch (error) {
        console.log(`   ❌ Ошибка при получении сессии: ${error.message}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📊 ИТОГО:`);
    console.log(`   Оплачено в Stripe: ${totalPaidInStripe.toFixed(2)} ${deal.currency || 'EUR'}`);
    console.log(`   Оплачено в БД: ${totalPaidInDb.toFixed(2)} ${deal.currency || 'EUR'}`);
    console.log(`   Ожидаемая сумма: ${parseFloat(deal.value || 0).toFixed(2)} ${deal.currency || 'EUR'}`);
    
    if (Math.abs(totalPaidInStripe - totalPaidInDb) > 0.01) {
      console.log(`   ⚠️  РАСХОЖДЕНИЕ между Stripe и БД: ${Math.abs(totalPaidInStripe - totalPaidInDb).toFixed(2)} ${deal.currency || 'EUR'}`);
    }
    
    const paidRatio = parseFloat(deal.value || 0) > 0 ? (totalPaidInStripe / parseFloat(deal.value || 0)) * 100 : 0;
    console.log(`   Процент оплаты (по Stripe): ${paidRatio.toFixed(2)}%`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error(`❌ Ошибка: ${error.message}`);
    logger.error('Error verifying deal payment', { dealId, error: error.message, stack: error.stack });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dealId = args[0];

  if (!dealId) {
    console.error('❌ Ошибка: не указан Deal ID');
    console.error('\nИспользование:');
    console.error('  node scripts/verify-deal-payment-stripe.js <dealId>');
    process.exit(1);
  }

  await verifyDealPayment(dealId);
}

main();

