#!/usr/bin/env node

/**
 * Script to verify that September refunds are in the correct category
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Проверка категорий возвратов за сентябрь 2025...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get categories
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();
    
    const refundsCategory = categories.find(cat => cat.name === 'Возвраты');
    const servicesRefundsCategory = categories.find(cat => cat.name === 'Возвраты от сервисов');

    if (!refundsCategory) {
      console.error('❌ Category "Возвраты" not found');
      process.exit(1);
    }

    if (!servicesRefundsCategory) {
      console.error('❌ Category "Возвраты от сервисов" not found');
      process.exit(1);
    }

    console.log(`✅ Категория "Возвраты" (ID: ${refundsCategory.id})`);
    console.log(`✅ Категория "Возвраты от сервисов" (ID: ${servicesRefundsCategory.id})\n`);

    // September dates
    const septemberStart = new Date(Date.UTC(2025, 8, 1));
    const septemberEnd = new Date(Date.UTC(2025, 8, 30, 23, 59, 59, 999));

    // Check payments in "Возвраты" category
    const { data: refundsPayments, error: refundsError } = await supabase
      .from('payments')
      .select('*')
      .eq('income_category_id', refundsCategory.id)
      .eq('direction', 'in')
      .is('deleted_at', null)
      .gte('operation_date', septemberStart.toISOString())
      .lte('operation_date', septemberEnd.toISOString())
      .order('operation_date', { ascending: true });

    if (refundsError) {
      console.error('❌ Error fetching refunds payments:', refundsError);
    } else {
      console.log(`\n📋 Платежи в категории "Возвраты" (ID: ${refundsCategory.id}):`);
      if (!refundsPayments || refundsPayments.length === 0) {
        console.log('   ✅ Нет платежей (правильно)');
      } else {
        console.log(`   ⚠️  Найдено ${refundsPayments.length} платеж(ей):`);
        refundsPayments.forEach((p, i) => {
          console.log(`   ${i + 1}. ID: ${p.id}, Дата: ${p.operation_date}, Сумма: ${p.amount} ${p.currency}`);
        });
      }
    }

    // Check payments in "Возвраты от сервисов" category
    const { data: servicesPayments, error: servicesError } = await supabase
      .from('payments')
      .select('*')
      .eq('income_category_id', servicesRefundsCategory.id)
      .eq('direction', 'in')
      .is('deleted_at', null)
      .gte('operation_date', septemberStart.toISOString())
      .lte('operation_date', septemberEnd.toISOString())
      .order('operation_date', { ascending: true });

    if (servicesError) {
      console.error('❌ Error fetching services refunds payments:', servicesError);
    } else {
      console.log(`\n📋 Платежи в категории "Возвраты от сервисов" (ID: ${servicesRefundsCategory.id}):`);
      if (!servicesPayments || servicesPayments.length === 0) {
        console.log('   ❌ Нет платежей (неправильно - должны быть 2 платежа)');
      } else {
        console.log(`   ✅ Найдено ${servicesPayments.length} платеж(ей):`);
        let totalPLN = 0;
        servicesPayments.forEach((p, i) => {
          const amountPLN = parseFloat(p.payments_total_pln || p.amount || 0);
          totalPLN += amountPLN;
          console.log(`   ${i + 1}. ID: ${p.id}`);
          console.log(`      Дата: ${p.operation_date}`);
          console.log(`      Сумма: ${p.amount} ${p.currency}`);
          console.log(`      Сумма в PLN: ${amountPLN.toFixed(2)} PLN`);
          console.log(`      Описание: ${p.description?.substring(0, 60) || '—'}...`);
          console.log(`      Income Category ID: ${p.income_category_id}`);
          console.log('');
        });
        console.log(`   💰 ИТОГО: ${totalPLN.toFixed(2)} PLN`);
      }
    }

    // Check specific payment IDs
    console.log('\n\n🔍 Проверка конкретных платежей:');
    const paymentIds = [2793, 1373];
    
    for (const paymentId of paymentIds) {
      const { data: payment, error } = await supabase
        .from('payments')
        .select('id, operation_date, amount, currency, income_category_id, description')
        .eq('id', paymentId)
        .single();

      if (error || !payment) {
        console.log(`\n❌ Платеж ${paymentId}: не найден`);
        continue;
      }

      const categoryName = payment.income_category_id === servicesRefundsCategory.id 
        ? '✅ "Возвраты от сервисов"' 
        : payment.income_category_id === refundsCategory.id
        ? '⚠️  "Возвраты"'
        : payment.income_category_id
        ? `❓ Категория ID: ${payment.income_category_id}`
        : '❌ Без категории';

      console.log(`\n📋 Платеж ID: ${paymentId}`);
      console.log(`   Дата: ${payment.operation_date}`);
      console.log(`   Сумма: ${payment.amount} ${payment.currency}`);
      console.log(`   Категория: ${categoryName} (ID: ${payment.income_category_id || 'NULL'})`);
      console.log(`   Описание: ${payment.description?.substring(0, 60) || '—'}...`);
    }

    console.log('\n\n💡 Проверка завершена!');

  } catch (error) {
    logger.error('❌ Fatal error:', error);
    console.error('❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});






