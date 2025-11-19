#!/usr/bin/env node

/**
 * Скрипт для поиска проформ по Deal ID
 * 
 * Использование:
 *   node scripts/find-proformas-by-deal.js 1596
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const ProformaRepository = require('../src/services/proformaRepository');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2] || 1596;

async function findProformas() {
  try {
    const repository = new ProformaRepository();
    
    if (!repository.isEnabled()) {
      console.error('❌ Supabase не настроен (SUPABASE_URL или SUPABASE_KEY отсутствуют)');
      process.exit(1);
    }

    console.log(`🔍 Поиск проформ для Deal ID: ${DEAL_ID}\n`);

    const proformas = await repository.findByDealId(DEAL_ID);

    if (!proformas || proformas.length === 0) {
      console.log('❌ Проформы не найдены');
      return;
    }

    console.log(`✅ Найдено проформ: ${proformas.length}\n`);
    console.log('📋 Список проформ:');
    console.log('─'.repeat(80));

    proformas.forEach((proforma, index) => {
      console.log(`\n${index + 1}. ID: ${proforma.id}`);
      console.log(`   Номер: ${proforma.fullnumber || 'не указан'}`);
      console.log(`   Валюта: ${proforma.currency || 'не указана'}`);
      console.log(`   Сумма: ${proforma.total || 0}`);
      console.log(`   Оплачено: ${proforma.payments_total || 0}`);
      console.log(`   Покупатель: ${proforma.buyer_name || 'не указан'}`);
      if (proforma.created_at) {
        console.log(`   Создана: ${new Date(proforma.created_at).toLocaleString('ru-RU')}`);
      }
    });

    console.log('\n' + '─'.repeat(80));
  } catch (error) {
    logger.error('Ошибка при поиске проформ:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

findProformas();

