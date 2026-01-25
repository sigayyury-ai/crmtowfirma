#!/usr/bin/env node

/**
 * Script to list all refunds (payments with income_category_id = "Возвраты") for September
 * Shows payments from both payments and stripe_payments tables
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const IncomeCategoryService = require('../src/services/pnl/incomeCategoryService');
const logger = require('../src/utils/logger');

async function main() {
  console.log('🔍 Поиск возвратов за сентябрь...\n');

  if (!supabase) {
    console.error('❌ Supabase client is not configured');
    process.exit(1);
  }

  try {
    // Get "Возвраты" category ID
    const incomeCategoryService = new IncomeCategoryService();
    const categories = await incomeCategoryService.listCategories();
    const refundsCategory = categories.find(cat => cat.name === 'Возвраты');

    if (!refundsCategory) {
      console.error('❌ Category "Возвраты" not found');
      process.exit(1);
    }

    console.log(`✅ Найдена категория "Возвраты" (ID: ${refundsCategory.id})\n`);

    // Get current year and previous year
    const currentYear = new Date().getFullYear();
    const years = [currentYear - 1, currentYear];

    for (const year of years) {
      console.log(`\n📅 === СЕНТЯБРЬ ${year} ===\n`);

      // September dates
      const septemberStart = new Date(Date.UTC(year, 8, 1)); // Month is 0-indexed, so 8 = September
      const septemberEnd = new Date(Date.UTC(year, 8, 30, 23, 59, 59, 999));

      // Get bank payments (from payments table)
      const { data: bankPayments, error: bankError } = await supabase
        .from('payments')
        .select('*')
        .eq('income_category_id', refundsCategory.id)
        .eq('direction', 'in')
        .is('deleted_at', null)
        .gte('operation_date', septemberStart.toISOString())
        .lte('operation_date', septemberEnd.toISOString())
        .order('operation_date', { ascending: true });

      if (bankError) {
        console.error(`❌ Error fetching bank payments:`, bankError);
        continue;
      }

      // Get Stripe payments (from stripe_payments table)
      const { data: stripePayments, error: stripeError } = await supabase
        .from('stripe_payments')
        .select('*')
        .eq('income_category_id', refundsCategory.id)
        .gte('created_at', septemberStart.toISOString())
        .lte('created_at', septemberEnd.toISOString())
        .order('created_at', { ascending: true });

      if (stripeError) {
        console.error(`❌ Error fetching Stripe payments:`, stripeError);
        continue;
      }

      const allPayments = [
        ...(bankPayments || []).map(p => ({ ...p, source: 'bank' })),
        ...(stripePayments || []).map(p => ({ ...p, source: 'stripe' }))
      ];

      if (allPayments.length === 0) {
        console.log(`   Нет возвратов за сентябрь ${year}`);
        continue;
      }

      console.log(`📊 Найдено возвратов: ${allPayments.length}\n`);

      let totalAmountPLN = 0;
      let totalAmountOriginal = 0;

      allPayments.forEach((payment, index) => {
        const date = payment.operation_date || payment.created_at;
        const dateStr = date ? new Date(date).toLocaleDateString('ru-RU', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }) : 'N/A';
        
        const amount = parseFloat(payment.amount || payment.amount_pln || 0);
        const currency = payment.currency || 'PLN';
        const amountPLN = parseFloat(payment.payments_total_pln || payment.amount_pln || amount || 0);
        
        totalAmountPLN += amountPLN;
        totalAmountOriginal += amount;

        console.log(`${index + 1}. Платеж ID: ${payment.id} (${payment.source === 'bank' ? 'Банк' : 'Stripe'})`);
        console.log(`   📅 Дата: ${dateStr} (${date || 'N/A'})`);
        console.log(`   💰 Сумма: ${amount.toFixed(2)} ${currency}`);
        console.log(`   💰 Сумма в PLN: ${amountPLN.toFixed(2)} PLN`);
        
        if (payment.source === 'bank') {
          console.log(`   👤 Плательщик: ${payment.payer_name || '—'}`);
          console.log(`   📝 Описание: ${payment.description?.substring(0, 100) || '—'}`);
          console.log(`   📄 Проформа: ${payment.proforma_fullnumber || payment.proforma_id || '—'}`);
          console.log(`   📊 Статус: ${payment.manual_status || payment.match_status || '—'}`);
        } else {
          console.log(`   📧 Email: ${payment.customer_email || '—'}`);
          console.log(`   💳 Session ID: ${payment.session_id || '—'}`);
          console.log(`   📊 Статус: ${payment.stripe_payment_status || '—'}`);
          console.log(`   🎯 Deal ID: ${payment.deal_id || '—'}`);
        }
        
        console.log(`   📅 Создан: ${payment.created_at ? new Date(payment.created_at).toLocaleString('ru-RU') : '—'}`);
        console.log('');
      });

      console.log(`\n💰 ИТОГО за сентябрь ${year}:`);
      console.log(`   Сумма в оригинальной валюте: ${totalAmountOriginal.toFixed(2)}`);
      console.log(`   Сумма в PLN: ${totalAmountPLN.toFixed(2)} PLN`);
      
      if (Math.abs(totalAmountPLN - 21296) < 0.01) {
        console.log(`   ✅ Сумма точно соответствует 21 296 PLN`);
      } else if (Math.abs(totalAmountPLN - 21296) < 100) {
        console.log(`   ⚠️  Сумма близка к 21 296 PLN (разница: ${(totalAmountPLN - 21296).toFixed(2)} PLN)`);
      } else {
        console.log(`   ❌ Сумма НЕ соответствует 21 296 PLN (разница: ${(totalAmountPLN - 21296).toFixed(2)} PLN)`);
      }
    }

    console.log('\n💡 Примечание:');
    console.log('   - Возвраты помечаются через income_category_id = категория "Возвраты"');
    console.log('   - Эти платежи отображаются в PNL отчете в разделе "Возвраты"');
    console.log('   - Проверьте, правильно ли они помечены и не должны ли быть в расходах');

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






