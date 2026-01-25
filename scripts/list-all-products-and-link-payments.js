#!/usr/bin/env node

/**
 * Список всех продуктов и возможность связать платежи с правильными продуктами
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');

async function listAllProducts() {
  console.log('\n📦 Все продукты в базе данных:\n');

  const { data: products } = await supabase
    .from('products')
    .select('id, name, normalized_name, calculation_status')
    .order('id');

  if (!products || products.length === 0) {
    console.log('   Продуктов не найдено');
    return [];
  }

  console.log(`Найдено продуктов: ${products.length}\n`);
  products.forEach((product, index) => {
    console.log(`${String(index + 1).padStart(3)}. Product ID: ${product.id}`);
    console.log(`     Название: "${product.name || 'N/A'}"`);
    console.log(`     Статус: ${product.calculation_status || 'N/A'}`);
    console.log('');
  });

  return products;
}

async function showPaymentsForDeals() {
  const dealIds = ['1714', '1775'];
  
  console.log('\n💳 Платежи для Deal #1714 и #1775:\n');

  const { data: payments } = await supabase
    .from('stripe_payments')
    .select('id, deal_id, session_id, customer_name, customer_email, original_amount, currency, created_at, product_id')
    .in('deal_id', dealIds)
    .order('created_at', { ascending: false });

  if (!payments || payments.length === 0) {
    console.log('   Платежей не найдено');
    return [];
  }

  payments.forEach((payment, index) => {
    const date = new Date(payment.created_at);
    const isFuture = date > new Date('2026-01-08');
    const marker = isFuture ? ' ⚠️ БУДУЩАЯ ДАТА' : '';
    
    console.log(`${index + 1}. Payment ID: ${payment.id}`);
    console.log(`   Deal ID: ${payment.deal_id}`);
    console.log(`   Клиент: ${payment.customer_name || payment.customer_email || 'N/A'}`);
    console.log(`   Сумма: ${payment.original_amount || 0} ${payment.currency || 'N/A'}`);
    console.log(`   Дата: ${payment.created_at}${marker}`);
    console.log(`   Product ID: ${payment.product_id || 'N/A'}`);
    console.log('');
  });

  return payments;
}

async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('📋 СПИСОК ПРОДУКТОВ И ПЛАТЕЖЕЙ');
    console.log('='.repeat(80));

    const products = await listAllProducts();
    const payments = await showPaymentsForDeals();

    console.log('\n' + '='.repeat(80));
    console.log('💡 РЕКОМЕНДАЦИИ');
    console.log('='.repeat(80));
    console.log('\n1. Если платежи тестовые (будущие даты) - их нужно удалить');
    console.log('2. Если платежи реальные - нужно:');
    console.log('   - Добавить продукты в Pipedrive для этих сделок');
    console.log('   - Или связать платежи с существующими продуктами через payment_product_links');
    console.log('   - Или обновить product_id в stripe_payments на правильный UUID из product_links');
    console.log('\n3. Продукты 56, 59, 41 в отчете создаются динамически когда нет связи с реальным продуктом');
    console.log('   Нужно либо удалить тестовые платежи, либо связать их с правильными продуктами\n');
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();






