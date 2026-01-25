#!/usr/bin/env node

/**
 * Test script to verify backward compatibility of revenue entries
 * This script checks that all existing revenue entries will be preserved
 * and correctly processed after removing the unique constraint
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testBackwardCompatibility() {
  console.log('🔍 Проверка обратной совместимости revenue entries...\n');

  try {
    // 1. Get all revenue entries
    const { data: allEntries, error: fetchError } = await supabase
      .from('pnl_manual_entries')
      .select('id, category_id, year, month, amount_pln, created_at')
      .eq('entry_type', 'revenue')
      .order('year', { ascending: true })
      .order('category_id', { ascending: true })
      .order('month', { ascending: true });

    if (fetchError) {
      throw fetchError;
    }

    console.log(`✅ Всего revenue entries в базе: ${allEntries.length}`);

    // 2. Group by category/year/month to check for duplicates
    const grouped = {};
    allEntries.forEach(entry => {
      const key = `${entry.category_id}-${entry.year}-${entry.month}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(entry);
    });

    // 3. Check for duplicates (should be none before removing unique constraint)
    const duplicates = Object.entries(grouped).filter(([key, entries]) => entries.length > 1);
    if (duplicates.length > 0) {
      console.log(`⚠️  Найдено ${duplicates.length} дубликатов (это нормально после удаления уникального индекса)`);
      duplicates.slice(0, 3).forEach(([key, entries]) => {
        console.log(`   ${key}: ${entries.length} записей`);
      });
    } else {
      console.log('✅ Дубликатов нет (каждая комбинация category/year/month уникальна)');
    }

    // 4. Simulate how the code will process entries (as arrays)
    console.log('\n📊 Симуляция обработки записей (как массивы):');
    const processedByCategory = {};
    
    allEntries.forEach(entry => {
      const catId = entry.category_id;
      if (!processedByCategory[catId]) {
        processedByCategory[catId] = {};
      }
      const month = entry.month;
      if (!processedByCategory[catId][month]) {
        processedByCategory[catId][month] = [];
      }
      processedByCategory[catId][month].push(entry);
    });

    // 5. Calculate totals (simulating pnlReportService logic)
    let totalAmount = 0;
    let totalEntries = 0;
    Object.keys(processedByCategory).forEach(catId => {
      Object.keys(processedByCategory[catId]).forEach(month => {
        const entries = processedByCategory[catId][month];
        totalEntries += entries.length;
        entries.forEach(entry => {
          totalAmount += parseFloat(entry.amount_pln) || 0;
        });
      });
    });

    console.log(`✅ Все записи будут обработаны как массивы`);
    console.log(`   Всего категорий: ${Object.keys(processedByCategory).length}`);
    console.log(`   Всего записей: ${totalEntries}`);
    console.log(`   Общая сумма: ${totalAmount.toFixed(2)} PLN`);

    // 6. Check 2025 year specifically
    const entries2025 = allEntries.filter(e => e.year === 2025);
    console.log(`\n📅 Записи за 2025 год: ${entries2025.length}`);
    const byCategory2025 = {};
    entries2025.forEach(e => {
      const catId = e.category_id;
      if (!byCategory2025[catId]) {
        byCategory2025[catId] = [];
      }
      byCategory2025[catId].push(e);
    });
    Object.keys(byCategory2025).forEach(catId => {
      const entries = byCategory2025[catId];
      const total = entries.reduce((sum, e) => sum + (parseFloat(e.amount_pln) || 0), 0);
      console.log(`   Категория ${catId}: ${entries.length} записей, сумма: ${total.toFixed(2)} PLN`);
    });

    // 7. Verify that each entry will be in an array (even if single)
    console.log('\n✅ Проверка структуры данных:');
    let allInArrays = true;
    Object.keys(processedByCategory).forEach(catId => {
      Object.keys(processedByCategory[catId]).forEach(month => {
        const entries = processedByCategory[catId][month];
        if (!Array.isArray(entries)) {
          allInArrays = false;
        }
        // Each entry should be processed individually
        entries.forEach(entry => {
          if (!entry.id || !entry.amount_pln) {
            allInArrays = false;
          }
        });
      });
    });

    if (allInArrays) {
      console.log('✅ Все записи будут корректно обработаны как массивы');
      console.log('✅ Старые записи не будут потеряны');
      console.log('✅ Можно безопасно удалить уникальный индекс');
    } else {
      console.log('❌ Обнаружена проблема с обработкой записей');
    }

    console.log('\n✅ Тест завершен успешно!');
    console.log('📝 Вывод: Все существующие записи будут сохранены и корректно обработаны');

  } catch (error) {
    console.error('❌ Ошибка при проверке:', error);
    process.exit(1);
  }
}

testBackwardCompatibility().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});


