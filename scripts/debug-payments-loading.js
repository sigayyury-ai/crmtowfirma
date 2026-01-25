#!/usr/bin/env node

/**
 * Отладка загрузки платежей для проблемных сделок
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_IDS = [1678, 1707, 1818, 1734];

async function debugPaymentsLoading(dealId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 Отладка загрузки платежей для Deal #${dealId}`);
  console.log('='.repeat(80));

  const repository = new StripeRepository();
  
  if (!repository.isEnabled()) {
    console.log('❌ Stripe repository не включен');
    return;
  }

  // Проверяем разные варианты deal_id
  const variants = [
    String(dealId),
    parseInt(dealId, 10).toString(),
    dealId.toString()
  ];

  for (const variant of variants) {
    console.log(`\n📋 Поиск с dealId: "${variant}" (тип: ${typeof variant})`);
    
    try {
      const payments = await repository.listPayments({
        dealId: variant,
        limit: 100
      });
      
      console.log(`   ✅ Найдено платежей: ${payments.length}`);
      
      if (payments.length > 0) {
        console.log(`   💳 Платежи:`);
        payments.forEach(p => {
          console.log(`      - ID: ${p.id}, deal_id: "${p.deal_id}" (тип: ${typeof p.deal_id}), amount: ${p.amount_pln || p.amount}, status: ${p.payment_status || p.status}`);
        });
      }
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
    }
  }

  // Также проверим напрямую через Supabase
  try {
    const supabase = require('../src/services/supabaseClient');
    console.log(`\n📋 Прямой запрос к Supabase:`);
    
    const { data, error } = await supabase
      .from('stripe_sessions')
      .select('id, deal_id, amount_pln, payment_status, status')
      .or(`deal_id.eq.${dealId},deal_id.eq.${String(dealId)}`)
      .limit(100);
    
    if (error) {
      console.log(`   ❌ Ошибка Supabase: ${error.message}`);
    } else {
      console.log(`   ✅ Найдено записей: ${data?.length || 0}`);
      if (data && data.length > 0) {
        data.forEach(p => {
          console.log(`      - ID: ${p.id}, deal_id: "${p.deal_id}" (тип: ${typeof p.deal_id}), amount_pln: ${p.amount_pln}, payment_status: ${p.payment_status}, status: ${p.status}`);
        });
      }
    }
  } catch (error) {
    console.log(`   ❌ Ошибка при прямом запросе: ${error.message}`);
  }
}

async function main() {
  console.log('🔍 Отладка загрузки платежей\n');

  for (const dealId of DEAL_IDS) {
    await debugPaymentsLoading(dealId);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

main().catch((error) => {
  logger.error('Script failed', { error: error.message, stack: error.stack });
  console.error('❌ Критическая ошибка:', error.message);
  process.exit(1);
});



