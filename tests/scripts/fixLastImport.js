#!/usr/bin/env node

/**
 * Скрипт для исправления платежей из последнего импорта CSV
 * Применяет правила для налоговых платежей и исправляет направление (direction)
 */

require('dotenv').config();
const supabase = require('../../src/services/supabaseClient');

// Паттерны налоговых платежей (всегда расходы)
const TAX_PAYMENT_PATTERNS = [
  /URZĄD\s+SKARBOWY/i,           // Tax office
  /ZAKŁAD\s+UBEZPIECZEŃ/i,        // Social insurance institution (ZUS)
  /ZUS/i,                         // ZUS abbreviation
  /PRZELEW\s+ZEWNĘTRZNY\s+DO\s+ZUS/i,  // Transfer to ZUS
  /PRZELEW\s+PODATKOWY/i,        // Tax transfer
  /CIT-8/i,                       // Corporate income tax
  /PIT/i,                         // Personal income tax
  /VAT/i,                         // VAT
  /SKARBOWY/i,                    // Tax (skarbowy)
  /PODATEK/i,                     // Tax (podatek)
  /UBEZPIECZENIA/i,               // Insurance (social)
  /SKŁADKA/i,                     // Contribution (social insurance)
];

function isTaxPayment(description, payerName) {
  const descUpper = (description || '').toUpperCase();
  const payerUpper = (payerName || '').toUpperCase();
  
  return TAX_PAYMENT_PATTERNS.some(pattern => 
    pattern.test(descUpper) || pattern.test(payerUpper)
  );
}

function shouldBeExpense(payment) {
  // Правило 1: Налоговые платежи всегда расходы
  if (isTaxPayment(payment.description, payment.payer_name)) {
    return { shouldBe: 'out', reason: 'Налоговый платеж' };
  }
  
  // Правило 2: Если amount_raw отрицательный, это расход
  if (payment.amount_raw) {
    const amountCleaned = payment.amount_raw.replace(/["\s]/g, '').replace(',', '.');
    const amountValue = parseFloat(amountCleaned);
    if (!isNaN(amountValue) && amountValue < 0) {
      return { shouldBe: 'out', reason: 'Отрицательная сумма в amount_raw' };
    }
  }
  
  // Правило 3: Категория содержит "Podatki", "Ubezpieczenia" и т.д.
  if (payment.category) {
    const categoryUpper = payment.category.toUpperCase();
    if (categoryUpper.includes('PODATKI') || 
        categoryUpper.includes('UBEZPIECZENIA') ||
        categoryUpper.includes('SKARBOWY') ||
        categoryUpper.includes('ZUS')) {
      return { shouldBe: 'out', reason: 'Категория указывает на налоги/страхование' };
    }
  }
  
  return null;
}

async function fixLastImport() {
  try {
    console.log('🔍 Поиск последнего импорта...\n');
    
    // Найти последний импорт
    const { data: lastImport, error: importError } = await supabase
      .from('payment_imports')
      .select('id, filename, uploaded_at, total_records')
      .order('uploaded_at', { ascending: false })
      .limit(1)
      .single();
    
    if (importError || !lastImport) {
      console.error('❌ Не найден последний импорт');
      console.error('Ошибка:', importError);
      process.exit(1);
    }
    
    console.log('📦 Последний импорт:');
    console.log(`   ID: ${lastImport.id}`);
    console.log(`   Файл: ${lastImport.filename}`);
    console.log(`   Дата: ${lastImport.uploaded_at}`);
    console.log(`   Всего записей: ${lastImport.total_records}\n`);
    
    // Найти все платежи из этого импорта
    console.log('🔍 Загрузка платежей из импорта...\n');
    
    let payments;
    let paymentsError;
    
    // Сначала попробуем найти по import_id
    const { data: paymentsByImport, error: errorByImport } = await supabase
      .from('payments')
      .select('id, direction, amount, amount_raw, description, payer_name, category, operation_date, currency, import_id')
      .eq('import_id', lastImport.id)
      .order('operation_date', { ascending: false });
    
    if (!errorByImport && paymentsByImport && paymentsByImport.length > 0) {
      payments = paymentsByImport;
      paymentsError = null;
      console.log(`✅ Найдено платежей по import_id: ${payments.length}\n`);
    } else {
      // Если не найдено по import_id, ищем по датам из файла (август-ноябрь 2025)
      console.log('⚠️  Платежи не найдены по import_id, ищем по датам из файла...\n');
      const { data: paymentsByDate, error: errorByDate } = await supabase
        .from('payments')
        .select('id, direction, amount, amount_raw, description, payer_name, category, operation_date, currency, import_id')
        .gte('operation_date', '2025-08-01')
        .lte('operation_date', '2025-11-21')
        .order('operation_date', { ascending: false })
        .limit(1000);
      
      payments = paymentsByDate;
      paymentsError = errorByDate;
      
      if (!errorByDate && payments && payments.length > 0) {
        console.log(`✅ Найдено платежей по датам: ${payments.length}\n`);
      }
    }
    
    if (paymentsError) {
      console.error('❌ Ошибка загрузки платежей:', paymentsError);
      process.exit(1);
    }
    
    console.log(`📊 Найдено платежей: ${payments.length}`);
    console.log(`   Доходы (in): ${payments.filter(p => p.direction === 'in').length}`);
    console.log(`   Расходы (out): ${payments.filter(p => p.direction === 'out').length}\n`);
    
    // Анализ платежей
    const fixes = [];
    
    for (const payment of payments) {
      const fixInfo = shouldBeExpense(payment);
      
      if (fixInfo && payment.direction !== fixInfo.shouldBe) {
        fixes.push({
          paymentId: payment.id,
          currentDirection: payment.direction,
          shouldBeDirection: fixInfo.shouldBe,
          reason: fixInfo.reason,
          description: payment.description,
          payer: payment.payer_name,
          amount: payment.amount,
          amountRaw: payment.amount_raw,
          date: payment.operation_date
        });
      }
    }
    
    if (fixes.length === 0) {
      console.log('✅ Все платежи имеют правильное направление!\n');
      return;
    }
    
    console.log(`⚠️  Найдено платежей для исправления: ${fixes.length}\n`);
    console.log('Список платежей для исправления:');
    console.log('='.repeat(80));
    
    fixes.forEach((fix, index) => {
      console.log(`\n${index + 1}. Платеж ID: ${fix.paymentId}`);
      console.log(`   Дата: ${fix.date}`);
      console.log(`   Текущее направление: ${fix.currentDirection} → Должно быть: ${fix.shouldBeDirection}`);
      console.log(`   Причина: ${fix.reason}`);
      console.log(`   Сумма: ${fix.amount} (raw: ${fix.amountRaw})`);
      console.log(`   Описание: ${fix.description?.substring(0, 60)}...`);
      console.log(`   Плательщик: ${fix.payer || 'N/A'}`);
    });
    
    console.log('\n' + '='.repeat(80));
    console.log(`\nВсего к исправлению: ${fixes.length} платежей\n`);
    
    // Спросить подтверждение
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Продолжить исправление? (yes/no): ', async (answer) => {
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        console.log('\n❌ Исправление отменено');
        rl.close();
        process.exit(0);
      }
      
      console.log('\n🔧 Начинаю исправление...\n');
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const fix of fixes) {
        try {
          const { error: updateError } = await supabase
            .from('payments')
            .update({ 
              direction: fix.shouldBeDirection,
              updated_at: new Date().toISOString()
            })
            .eq('id', fix.paymentId);
          
          if (updateError) {
            console.error(`❌ Ошибка исправления платежа ${fix.paymentId}:`, updateError.message);
            errorCount++;
          } else {
            console.log(`✅ Исправлен платеж ${fix.paymentId}: ${fix.currentDirection} → ${fix.shouldBeDirection} (${fix.reason})`);
            successCount++;
          }
        } catch (error) {
          console.error(`❌ Ошибка исправления платежа ${fix.paymentId}:`, error.message);
          errorCount++;
        }
      }
      
      console.log('\n' + '='.repeat(80));
      console.log('\n📊 Результаты исправления:');
      console.log(`   ✅ Успешно исправлено: ${successCount}`);
      console.log(`   ❌ Ошибок: ${errorCount}`);
      console.log(`   📦 Всего обработано: ${fixes.length}\n`);
      
      rl.close();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  fixLastImport();
}

module.exports = { fixLastImport, isTaxPayment, shouldBeExpense };

