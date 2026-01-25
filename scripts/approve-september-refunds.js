#!/usr/bin/env node

/**
 * Script to approve September refunds from services so they appear in PNL report
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  console.log('✅ Одобрение возвратов от сервисов за сентябрь 2025...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    const paymentIds = [2793, 1373];

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

      console.log(`📋 Текущие данные:`);
      console.log(`   Дата: ${payment.operation_date}`);
      console.log(`   Сумма: ${payment.amount} ${payment.currency}`);
      console.log(`   Manual Status: ${payment.manual_status || 'NULL'}`);
      console.log(`   Match Status: ${payment.match_status || 'NULL'}`);

      // Update payment to approved
      const { data: updated, error: updateError } = await supabase
        .from('payments')
        .update({
          manual_status: 'approved',
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId)
        .select()
        .single();

      if (updateError) {
        console.error(`❌ Ошибка при обновлении платежа ${paymentId}:`, updateError.message);
        continue;
      }

      console.log(`✅ Платеж ${paymentId} одобрен (manual_status='approved')`);
      console.log(`   Теперь он будет отображаться в PNL отчете в категории "Возвраты от сервисов"`);
    }

    console.log('\n\n✅ Готово!');
    console.log('\n💡 Результат:');
    console.log('   - Платежи одобрены вручную (manual_status="approved")');
    console.log('   - Теперь они будут проходить фильтр PNL отчета');
    console.log('   - Они будут отображаться в категории "Возвраты от сервисов" за сентябрь 2025');

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






