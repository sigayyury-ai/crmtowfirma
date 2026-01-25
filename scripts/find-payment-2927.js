#!/usr/bin/env node

/**
 * Найти платеж с ID 2927 через API
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findPaymentViaAPI(paymentId) {
  const baseURL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const apiUrl = `${baseURL}/api/payments/${paymentId}`;
  
  console.log(`🔍 Поиск платежа ${paymentId} через API...`);
  console.log(`   URL: ${apiUrl}\n`);

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Ошибка API (${response.status}):`, data);
      return null;
    }

    if (data.success && data.data) {
      return data.data;
    }

    console.error('❌ Платеж не найден через API');
    return null;
  } catch (error) {
    console.error('❌ Ошибка при запросе к API:', error.message);
    console.log('   Попытка прямого запроса к базе данных...\n');
    return null;
  }
}

async function findPaymentViaDatabase(paymentId) {
  console.log(`🔍 Поиск платежа ${paymentId} в базе данных...\n`);

  if (!supabase) {
    console.error('❌ Supabase client не настроен');
    return null;
  }

  try {
    const { data: payment, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        console.error(`❌ Платеж ${paymentId} не найден в базе данных`);
      } else {
        console.error('❌ Ошибка при запросе к базе данных:', error);
      }
      return null;
    }

    return payment;
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    return null;
  }
}

function displayPayment(payment) {
  if (!payment) {
    return;
  }

  console.log('='.repeat(80));
  console.log(`📋 Платеж #${payment.id}`);
  console.log('='.repeat(80));
  console.log(`   ID: ${payment.id}`);
  console.log(`   Дата операции: ${payment.operation_date || '—'}`);
  console.log(`   Дата платежа: ${payment.payment_date || '—'}`);
  console.log(`   Сумма: ${payment.amount || 0} ${payment.currency || '—'}`);
  console.log(`   Направление: ${payment.direction || '—'}`);
  console.log(`   Описание: ${payment.description || '—'}`);
  console.log(`   Плательщик: ${payment.payer_name || '—'}`);
  console.log(`   Источник: ${payment.source || '—'}`);
  console.log(`   Статус сопоставления: ${payment.match_status || '—'}`);
  console.log(`   Ручной статус: ${payment.manual_status || '—'}`);
  
  if (payment.proforma_id) {
    console.log(`   ID проформы: ${payment.proforma_id}`);
  }
  if (payment.proforma_fullnumber) {
    console.log(`   Номер проформы: ${payment.proforma_fullnumber}`);
  }
  
  if (payment.deal_id) {
    console.log(`   ID сделки: ${payment.deal_id}`);
  }
  
  if (payment.stripe_session_id) {
    console.log(`   Stripe Session ID: ${payment.stripe_session_id}`);
  }
  if (payment.stripe_payment_status) {
    console.log(`   Stripe Payment Status: ${payment.stripe_payment_status}`);
  }
  
  if (payment.income_category_id) {
    console.log(`   Категория дохода ID: ${payment.income_category_id}`);
  }
  if (payment.expense_category_id) {
    console.log(`   Категория расхода ID: ${payment.expense_category_id}`);
  }
  
  if (payment.product_id) {
    console.log(`   ID продукта: ${payment.product_id}`);
  }
  
  console.log(`   Создан: ${payment.created_at || '—'}`);
  console.log(`   Обновлен: ${payment.updated_at || '—'}`);
  console.log('='.repeat(80));
}

async function main() {
  const PAYMENT_ID = 2927;

  console.log(`🔍 Поиск платежа ${PAYMENT_ID}\n`);

  // Сначала пробуем через API
  let payment = await findPaymentViaAPI(PAYMENT_ID);

  // Если через API не получилось, пробуем напрямую через базу данных
  if (!payment) {
    payment = await findPaymentViaDatabase(PAYMENT_ID);
  }

  if (payment) {
    displayPayment(payment);
  } else {
    console.error(`\n❌ Платеж ${PAYMENT_ID} не найден ни через API, ни в базе данных`);
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('❌ Критическая ошибка:', error);
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});






