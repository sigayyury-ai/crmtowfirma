#!/usr/bin/env node

/**
 * Поиск конкретных тестовых платежей по Deal ID и клиенту
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findPaymentsByDeals() {
  const dealIds = ['2041', '2039'];
  
  console.log('\n🔍 Поиск платежей для Deal #2041 и #2039...\n');

  try {
    // Ищем в stripe_payments
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('*')
      .in('deal_id', dealIds)
      .order('created_at', { ascending: false });

    if (stripeError) {
      logger.error('Ошибка при поиске Stripe платежей:', stripeError);
    } else {
      console.log(`\n💳 Найдено Stripe платежей: ${stripePayments?.length || 0}\n`);
      if (stripePayments && stripePayments.length > 0) {
        stripePayments.forEach((payment, index) => {
          console.log(`${index + 1}. Payment ID: ${payment.id}`);
          console.log(`   Deal ID: ${payment.deal_id}`);
          console.log(`   Session ID: ${payment.session_id || 'N/A'}`);
          console.log(`   Клиент: ${payment.customer_name || payment.customer_email || 'N/A'}`);
          console.log(`   Сумма: ${payment.original_amount || payment.amount || 0} ${payment.currency || 'N/A'}`);
          console.log(`   Сумма в PLN: ${payment.amount_pln || 0} PLN`);
          console.log(`   Статус: ${payment.payment_status || 'N/A'} (${payment.status || 'N/A'})`);
          console.log(`   Создан: ${payment.created_at || 'N/A'}`);
          console.log('');
        });
      }
    }

    // Ищем в payments (банковские платежи)
    const { data: bankPayments, error: bankError } = await supabase
      .from('payments')
      .select('*')
      .or(`deal_id.eq.2041,deal_id.eq.2039`)
      .order('operation_date', { ascending: false });

    if (bankError) {
      logger.error('Ошибка при поиске банковских платежей:', bankError);
    } else {
      console.log(`\n🏦 Найдено банковских платежей: ${bankPayments?.length || 0}\n`);
      if (bankPayments && bankPayments.length > 0) {
        bankPayments.forEach((payment, index) => {
          console.log(`${index + 1}. Payment ID: ${payment.id}`);
          console.log(`   Deal ID: ${payment.deal_id || 'N/A'}`);
          console.log(`   Плательщик: ${payment.payer_name || 'N/A'}`);
          console.log(`   Сумма: ${payment.amount || 0} ${payment.currency || 'N/A'}`);
          console.log(`   Сумма в PLN: ${payment.amount_pln || 0} PLN`);
          console.log(`   Дата: ${payment.operation_date || 'N/A'}`);
          console.log(`   Описание: ${payment.description?.substring(0, 100) || 'N/A'}`);
          console.log('');
        });
      }
    }

    // Ищем по имени Yury Sihai и сумме 1,00 €
    console.log('\n🔍 Поиск платежей от Yury Sihai на сумму 1,00 €...\n');
    
    const { data: yuryPayments, error: yuryError } = await supabase
      .from('stripe_payments')
      .select('*')
      .or(`customer_name.ilike.%Yury Sihai%,customer_email.ilike.%yury%`)
      .eq('currency', 'EUR')
      .order('created_at', { ascending: false });

    if (yuryError) {
      logger.error('Ошибка при поиске платежей Yury Sihai:', yuryError);
    } else {
      // Фильтруем по сумме ~1 EUR (с учетом возможных округлений)
      const oneEuroPayments = (yuryPayments || []).filter(p => {
        const amount = parseFloat(p.original_amount || p.amount || 0);
        return Math.abs(amount - 1.0) < 0.01; // Точность до 1 цента
      });

      console.log(`Найдено платежей от Yury Sihai на ~1 EUR: ${oneEuroPayments.length}\n`);
      if (oneEuroPayments.length > 0) {
        oneEuroPayments.forEach((payment, index) => {
          console.log(`${index + 1}. Payment ID: ${payment.id}`);
          console.log(`   Deal ID: ${payment.deal_id || 'N/A'}`);
          console.log(`   Session ID: ${payment.session_id || 'N/A'}`);
          console.log(`   Клиент: ${payment.customer_name || payment.customer_email || 'N/A'}`);
          console.log(`   Сумма: ${payment.original_amount || payment.amount || 0} ${payment.currency || 'N/A'}`);
          console.log(`   Сумма в PLN: ${payment.amount_pln || 0} PLN`);
          console.log(`   Статус: ${payment.payment_status || 'N/A'} (${payment.status || 'N/A'})`);
          console.log(`   Создан: ${payment.created_at || 'N/A'}`);
          console.log('');
        });
      }
    }

    const oneEuroPayments = (yuryPayments || []).filter(p => {
      const amount = parseFloat(p.original_amount || p.amount || 0);
      return Math.abs(amount - 1.0) < 0.01; // Точность до 1 цента
    });

    return {
      stripePayments: stripePayments || [],
      bankPayments: bankPayments || [],
      yuryOneEuroPayments: oneEuroPayments || []
    };

  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

findPaymentsByDeals();

