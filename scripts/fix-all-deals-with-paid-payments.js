#!/usr/bin/env node

/**
 * Поиск и исправление всех сделок, где оба платежа оплачены, но статус не обновлен
 */

require('dotenv').config();
const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');

async function fixAllDeals() {
  console.log('🔧 Поиск и исправление всех сделок с оплаченными платежами\n');
  console.log('='.repeat(80));
  
  try {
    const repository = new StripeRepository();
    const processor = new StripeProcessorService();
    
    if (!repository.isEnabled()) {
      console.log('❌ Supabase не настроен.');
      return;
    }
    
    // Используем новый метод verifyAndFixDealStatuses
    console.log('\n🔍 Запуск автоматической проверки и исправления...');
    const result = await processor.verifyAndFixDealStatuses({ limit: 200 });
    
    console.log(`\n✅ Проверка завершена:`);
    console.log(`   Проверено сделок: ${result.checked}`);
    console.log(`   Исправлено статусов: ${result.fixed}`);
    if (result.errors.length > 0) {
      console.log(`   Ошибок: ${result.errors.length}`);
      result.errors.slice(0, 5).forEach(err => {
        console.log(`      - Deal #${err.dealId}: ${err.error}`);
      });
    }
    
    if (result.fixed > 0) {
      console.log(`\n✅ Успешно исправлено ${result.fixed} сделок!`);
    } else {
      console.log(`\nℹ️  Все сделки имеют правильный статус.`);
    }
    
    console.log(`\n${'='.repeat(80)}\n`);
    
  } catch (error) {
    console.error(`\n❌ Ошибка:`);
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   ${error.stack}`);
    }
    process.exit(1);
  }
}

fixAllDeals();

