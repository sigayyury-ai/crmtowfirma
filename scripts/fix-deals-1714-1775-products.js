#!/usr/bin/env node

/**
 * Исправление связей продуктов для Deal #1714 и #1775
 * 
 * Варианты:
 * 1. Удалить тестовые платежи (если даты будущие)
 * 2. Связать с правильными продуктами (если платежи реальные)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const readline = require('readline');

const DEAL_IDS = ['1714', '1775'];
const FUTURE_DATE_THRESHOLD = new Date('2026-01-08');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function analyzePayments() {
  console.log('\n🔍 Анализ платежей...\n');

  const { data: payments } = await supabase
    .from('stripe_payments')
    .select('id, deal_id, session_id, customer_name, customer_email, original_amount, currency, created_at, product_id, payment_status')
    .in('deal_id', DEAL_IDS)
    .order('created_at', { ascending: false });

  if (!payments || payments.length === 0) {
    console.log('   Платежей не найдено');
    return { allPayments: [], testPayments: [], realPayments: [] };
  }

  const testPayments = [];
  const realPayments = [];

  payments.forEach(payment => {
    const date = new Date(payment.created_at);
    if (date > FUTURE_DATE_THRESHOLD) {
      testPayments.push(payment);
    } else {
      realPayments.push(payment);
    }
  });

  console.log(`Всего платежей: ${payments.length}`);
  console.log(`Тестовых (будущие даты): ${testPayments.length}`);
  console.log(`Реальных: ${realPayments.length}\n`);

  if (testPayments.length > 0) {
    console.log('⚠️  Тестовые платежи (будущие даты):');
    testPayments.forEach((p, i) => {
      console.log(`   ${i + 1}. Deal #${p.deal_id} | ${p.customer_name || p.customer_email || 'N/A'} | ${p.original_amount} ${p.currency} | ${p.created_at}`);
    });
    console.log('');
  }

  if (realPayments.length > 0) {
    console.log('✅ Реальные платежи:');
    realPayments.forEach((p, i) => {
      console.log(`   ${i + 1}. Deal #${p.deal_id} | ${p.customer_name || p.customer_email || 'N/A'} | ${p.original_amount} ${p.currency} | ${p.created_at}`);
    });
    console.log('');
  }

  return { allPayments: payments, testPayments, realPayments };
}

async function listProducts() {
  const { data: products } = await supabase
    .from('products')
    .select('id, name, normalized_name')
    .order('id')
    .limit(50);

  if (!products || products.length === 0) {
    return [];
  }

  console.log('\n📦 Доступные продукты:\n');
  products.forEach((p, i) => {
    console.log(`   ${String(i + 1).padStart(2)}. ID: ${p.id} - "${p.name}"`);
  });
  console.log('');

  return products;
}

async function deleteTestPayments(testPayments) {
  if (testPayments.length === 0) {
    return { deleted: 0, errors: 0 };
  }

  console.log(`\n🗑️  Удаление ${testPayments.length} тестовых платежей...\n`);

  let deleted = 0;
  let errors = 0;

  const sessionIds = testPayments.map(p => p.session_id).filter(Boolean);

  if (sessionIds.length > 0) {
    const { error } = await supabase
      .from('stripe_payments')
      .delete()
      .in('session_id', sessionIds);

    if (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      errors++;
    } else {
      deleted += sessionIds.length;
      console.log(`   ✅ Удалено ${sessionIds.length} платежей`);
    }
  }

  // Удаляем платежи без session_id по id
  const paymentsWithoutSession = testPayments.filter(p => !p.session_id);
  if (paymentsWithoutSession.length > 0) {
    const paymentIds = paymentsWithoutSession.map(p => p.id);
    const { error } = await supabase
      .from('stripe_payments')
      .delete()
      .in('id', paymentIds);

    if (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      errors++;
    } else {
      deleted += paymentIds.length;
      console.log(`   ✅ Удалено ${paymentIds.length} платежей без session_id`);
    }
  }

  return { deleted, errors };
}

async function linkPaymentsToProduct(payments, productId) {
  if (payments.length === 0 || !productId) {
    return { linked: 0, errors: 0 };
  }

  console.log(`\n🔗 Связывание ${payments.length} платежей с продуктом ID ${productId}...\n`);

  // Находим или создаем product_link для этого продукта
  const { data: product } = await supabase
    .from('products')
    .select('id, name')
    .eq('id', productId)
    .single();

  if (!product) {
    console.log(`   ❌ Продукт ID ${productId} не найден`);
    return { linked: 0, errors: payments.length };
  }

  console.log(`   Продукт: "${product.name}"`);

  // Ищем существующий product_link с этим camp_product_id
  const { data: productLinks } = await supabase
    .from('product_links')
    .select('id')
    .eq('camp_product_id', String(productId))
    .limit(1);

  let productLinkId = productLinks && productLinks.length > 0 ? productLinks[0].id : null;

  // Если product_link не найден, создаем новый
  if (!productLinkId) {
    const { data: newLink, error: createError } = await supabase
      .from('product_links')
      .insert({
        camp_product_id: String(productId),
        crm_product_name: product.name,
        status: 'active'
      })
      .select()
      .single();

    if (createError) {
      console.log(`   ❌ Ошибка при создании product_link: ${createError.message}`);
      return { linked: 0, errors: payments.length };
    }

    productLinkId = newLink.id;
    console.log(`   ✅ Создан product_link ID: ${productLinkId}`);
  } else {
    console.log(`   ✅ Используется существующий product_link ID: ${productLinkId}`);
  }

  // Обновляем product_id в stripe_payments
  const paymentIds = payments.map(p => p.id);
  const { error: updateError } = await supabase
    .from('stripe_payments')
    .update({ product_id: productLinkId })
    .in('id', paymentIds);

  if (updateError) {
    console.log(`   ❌ Ошибка при обновлении stripe_payments: ${updateError.message}`);
    return { linked: 0, errors: payments.length };
  }

  console.log(`   ✅ Обновлено ${paymentIds.length} платежей`);
  return { linked: paymentIds.length, errors: 0 };
}

async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ СВЯЗЕЙ ПРОДУКТОВ ДЛЯ DEAL #1714 И #1775');
    console.log('='.repeat(80));

    const { allPayments, testPayments, realPayments } = await analyzePayments();

    if (allPayments.length === 0) {
      console.log('\n✅ Платежей не найдено. Нечего исправлять.\n');
      rl.close();
      return;
    }

    // Если есть тестовые платежи - предлагаем удалить
    if (testPayments.length > 0) {
      console.log('\n⚠️  Обнаружены тестовые платежи с будущими датами!');
      const deleteConfirm = await ask('Удалить тестовые платежи? (yes/no): ');
      
      if (deleteConfirm.toLowerCase() === 'yes') {
        const result = await deleteTestPayments(testPayments);
        console.log(`\n✅ Удалено: ${result.deleted}, ошибок: ${result.errors}\n`);
      } else {
        console.log('   Удаление отменено\n');
      }
    }

    // Если есть реальные платежи без продуктов - предлагаем связать
    const paymentsWithoutProduct = realPayments.filter(p => !p.product_id);
    
    if (paymentsWithoutProduct.length > 0) {
      console.log(`\n📋 Найдено ${paymentsWithoutProduct.length} реальных платежей без продуктов`);
      const linkConfirm = await ask('Связать их с продуктами? (yes/no): ');
      
      if (linkConfirm.toLowerCase() === 'yes') {
        const products = await listProducts();
        
        if (products.length > 0) {
          // Группируем платежи по deal_id
          const paymentsByDeal = {};
          paymentsWithoutProduct.forEach(p => {
            if (!paymentsByDeal[p.deal_id]) {
              paymentsByDeal[p.deal_id] = [];
            }
            paymentsByDeal[p.deal_id].push(p);
          });

          for (const [dealId, dealPayments] of Object.entries(paymentsByDeal)) {
            console.log(`\n💳 Deal #${dealId}: ${dealPayments.length} платежей`);
            const productIdInput = await ask(`Введите Product ID для связи (или Enter чтобы пропустить): `);
            
            if (productIdInput.trim()) {
              const productId = parseInt(productIdInput.trim(), 10);
              if (isNaN(productId)) {
                console.log(`   ⚠️  Неверный Product ID, пропускаем`);
                continue;
              }

              const result = await linkPaymentsToProduct(dealPayments, productId);
              console.log(`   ✅ Связано: ${result.linked}, ошибок: ${result.errors}\n`);
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ ГОТОВО');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();






