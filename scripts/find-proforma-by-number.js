#!/usr/bin/env node

/**
 * Находит проформу по номеру в базе данных
 * 
 * Использование:
 *   node scripts/find-proforma-by-number.js "CO-PROF 2/2026"
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findProforma(fullnumber) {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    const normalized = fullnumber.trim();
    logger.info('Поиск проформы...', { fullnumber: normalized });

    // Пробуем точное совпадение
    let { data, error } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id, buyer_name, status, created_at')
      .eq('fullnumber', normalized)
      .maybeSingle();

    if (error) {
      logger.error('Ошибка при поиске проформы:', error);
      process.exit(1);
    }

    if (data) {
      console.log('\n✅ Проформа найдена:');
      console.log(`   ID: ${data.id}`);
      console.log(`   Номер: ${data.fullnumber}`);
      console.log(`   Связана со сделкой: ${data.pipedrive_deal_id || 'не связана'}`);
      console.log(`   Плательщик: ${data.buyer_name || 'N/A'}`);
      console.log(`   Статус: ${data.status || 'N/A'}`);
      console.log(`   Создана: ${data.created_at || 'N/A'}`);
      return data;
    }

    // Если не найдено, пробуем поиск по части номера
    console.log('\n⚠️  Точное совпадение не найдено. Ищу по части номера...');
    
    // Пробуем разные варианты поиска
    const searchVariants = [
      normalized,
      normalized.replace(/\s+/g, ''),
      normalized.replace(/\s+/g, '-'),
      normalized.replace(/CO-PROF\s+/i, ''),
      normalized.replace(/CO-PROF\s+/i, '').replace(/\s+/g, ''),
      '2/2026',
      '2 2026'
    ];
    
    let partialMatches = [];
    let searchError = null;
    
    for (const variant of searchVariants) {
      const { data: matches, error: err } = await supabase
        .from('proformas')
        .select('id, fullnumber, pipedrive_deal_id, buyer_name, status')
        .ilike('fullnumber', `%${variant}%`)
        .limit(20);
      
      if (err) {
        searchError = err;
        continue;
      }
      
      if (matches && matches.length > 0) {
        partialMatches = matches;
        break;
      }
    }

    if (searchError) {
      logger.error('Ошибка при поиске:', searchError);
      process.exit(1);
    }

    if (partialMatches && partialMatches.length > 0) {
      console.log(`\n📋 Найдено ${partialMatches.length} похожих проформ:`);
      partialMatches.forEach((p, i) => {
        console.log(`\n   ${i + 1}. ${p.fullnumber}`);
        console.log(`      ID: ${p.id}`);
        console.log(`      Deal ID: ${p.pipedrive_deal_id || 'не связана'}`);
        console.log(`      Плательщик: ${p.buyer_name || 'N/A'}`);
        console.log(`      Статус: ${p.status || 'N/A'}`);
      });
    } else {
      console.log('\n❌ Проформа не найдена в базе данных');
      console.log(`   Искали: "${normalized}"`);
    }

  } catch (error) {
    logger.error('Неожиданная ошибка:', error);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Использование: node scripts/find-proforma-by-number.js <fullnumber>');
  console.error('Пример: node scripts/find-proforma-by-number.js "CO-PROF 2/2026"');
  process.exit(1);
}

findProforma(args[0]);
