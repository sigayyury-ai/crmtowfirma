#!/usr/bin/env node

/**
 * Выгрузка открытых сделок из Pipedrive CRM
 * Сохраняет ID сделки и реальную сумму из CRM в JSON файл
 * 
 * Использование:
 *   node scripts/export-deals-from-crm.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

async function exportDealsFromCrm() {
  try {
    console.log('\n📥 Выгрузка открытых сделок из Pipedrive CRM...\n');
    console.log('='.repeat(100));

    const pipedrive = new PipedriveClient();
    const deals = [];

    // Получаем все открытые сделки
    let start = 0;
    const limit = 500;
    let hasMore = true;

    while (hasMore) {
      console.log(`Загрузка сделок: ${start} - ${start + limit}...`);
      
      const result = await pipedrive.getDeals({
        filter_id: null,
        status: 'open', // Только открытые сделки
        limit: limit,
        start: start
      });

      if (!result.success || !result.deals) {
        console.error('Ошибка при получении сделок:', result.error);
        break;
      }

      const batch = result.deals || [];
      console.log(`   Получено: ${batch.length} сделок`);

      for (const deal of batch) {
        deals.push({
          id: deal.id,
          title: deal.title || 'Без названия',
          value: parseFloat(deal.value) || 0,
          currency: deal.currency || 'PLN',
          expected_close_date: deal.expected_close_date || null,
          close_date: deal.close_date || null,
          stage_id: deal.stage_id || null,
          status: deal.status || null,
          pipeline_id: deal.pipeline_id || null,
          person_id: deal.person_id || null,
          org_id: deal.org_id || null,
          created_at: deal.add_time || null,
          updated_at: deal.update_time || null
        });
      }

      if (batch.length < limit) {
        hasMore = false;
      } else {
        start += limit;
      }
    }

    console.log(`\n✅ Всего выгружено сделок: ${deals.length}`);

    // Сохраняем в JSON файл
    const outputPath = path.join(__dirname, '../tmp/deals-from-crm.json');
    const outputDir = path.dirname(outputPath);
    
    // Создаем директорию, если её нет
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Директория уже существует
    }

    const output = {
      exported_at: new Date().toISOString(),
      total_deals: deals.length,
      deals: deals
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\n💾 Данные сохранены в: ${outputPath}`);
    console.log(`\n📊 Статистика:`);
    console.log(`   Всего сделок: ${deals.length}`);
    
    // Статистика по валютам
    const currencyStats = {};
    deals.forEach(deal => {
      const currency = deal.currency || 'PLN';
      currencyStats[currency] = (currencyStats[currency] || 0) + 1;
    });
    console.log(`   По валютам:`);
    Object.entries(currencyStats).forEach(([currency, count]) => {
      console.log(`     ${currency}: ${count}`);
    });

    // Статистика по суммам
    const totalByCurrency = {};
    deals.forEach(deal => {
      const currency = deal.currency || 'PLN';
      totalByCurrency[currency] = (totalByCurrency[currency] || 0) + deal.value;
    });
    console.log(`   Общая сумма по валютам:`);
    Object.entries(totalByCurrency).forEach(([currency, total]) => {
      console.log(`     ${currency}: ${total.toFixed(2)}`);
    });

    console.log('\n✅ Выгрузка завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Export deals from CRM failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

exportDealsFromCrm().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





