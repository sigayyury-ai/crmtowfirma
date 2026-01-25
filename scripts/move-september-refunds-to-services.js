#!/usr/bin/env node

/**
 * Script to move September refunds from "Возвраты" category to "Возвраты от сервисов" category
 * These are refunds FROM services (Airbnb, airport), not refunds TO clients
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔄 Перемещение возвратов от сервисов из категории "Возвраты" в "Возвраты от сервисов"...\n');

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

    console.log(`✅ Найдена категория "Возвраты" (ID: ${refundsCategory.id})`);
    console.log(`✅ Найдена категория "Возвраты от сервисов" (ID: ${servicesRefundsCategory.id})\n`);

    // Payment IDs to move
    const paymentIds = [2793, 1373];

    console.log(`📋 Платежи для перемещения: ${paymentIds.join(', ')}\n`);

    for (const paymentId of paymentIds) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Обработка платежа ID: ${paymentId}`);
      console.log('='.repeat(80));

      // Get payment
      const { data: payment, error: fetchError } = await supabase
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .single();

      if (fetchError || !payment) {
        console.error(`❌ Платеж ${paymentId} не найден:`, fetchError?.message);
        continue;
      }

      // Check current category
      if (payment.income_category_id !== refundsCategory.id) {
        console.log(`⚠️  Платеж ${paymentId} уже не в категории "Возвраты" (текущая категория ID: ${payment.income_category_id})`);
        continue;
      }

      console.log(`📋 Текущие данные:`);
      console.log(`   Дата: ${payment.operation_date || '—'}`);
      console.log(`   Сумма: ${payment.amount || 0} ${payment.currency || 'PLN'}`);
      console.log(`   Описание: ${payment.description?.substring(0, 80) || '—'}...`);
      console.log(`   Текущая категория: "Возвраты" (ID: ${payment.income_category_id})`);

      // Update payment
      const { data: updated, error: updateError } = await supabase
        .from('payments')
        .update({
          income_category_id: servicesRefundsCategory.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (updateError) {
        console.error(`❌ Ошибка при обновлении платежа ${paymentId}:`, updateError.message);
        continue;
      }

      console.log(`✅ Платеж ${paymentId} успешно перемещен в категорию "Возвраты от сервисов" (ID: ${servicesRefundsCategory.id})`);
    }

    console.log('\n\n✅ Готово!');
    console.log('\n💡 Результат:');
    console.log('   - Платежи перемещены из категории "Возвраты" в "Возвраты от сервисов"');
    console.log('   - Теперь они будут отображаться в PNL отчете в правильной категории');
    console.log('   - Категория "Возвраты" теперь содержит только возвраты клиентам');

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






