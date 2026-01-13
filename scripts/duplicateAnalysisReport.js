require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

/**
 * Полный отчет о дубликатах и причинах их возникновения
 */
async function generateReport() {
  console.log('📊 ОТЧЕТ О ДУБЛИКАТАХ ПЛАТЕЖЕЙ\n');
  console.log('='.repeat(80));
  console.log('');

  try {
    const year = 2025;
    const month = 12;

    // Получаем дубликаты NAME-CHEAP.COM*
    const { data: payments } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, payer_name, description, operation_hash, created_at, direction')
      .eq('payer_name', 'NAME-CHEAP.COM*')
      .eq('amount', 38.07)
      .eq('currency', 'PLN')
      .is('deleted_at', null)
      .order('operation_date');

    console.log('🔍 АНАЛИЗ ДУБЛИКАТОВ NAME-CHEAP.COM*\n');
    console.log(`Найдено платежей: ${payments.length}\n`);

    if (payments.length >= 2) {
      const p1 = payments[0];
      const p2 = payments[1];

      console.log('Платеж 1:');
      console.log(`  ID: ${p1.id}`);
      console.log(`  Дата: ${p1.operation_date}`);
      console.log(`  Hash: ${p1.operation_hash}`);
      console.log(`  Описание: ${p1.description}`);
      console.log(`  Создан: ${p1.created_at}`);
      console.log('');

      console.log('Платеж 2:');
      console.log(`  ID: ${p2.id}`);
      console.log(`  Дата: ${p2.operation_date}`);
      console.log(`  Hash: ${p2.operation_hash}`);
      console.log(`  Описание: ${p2.description}`);
      console.log(`  Создан: ${p2.created_at}`);
      console.log('');

      // Анализ различий
      const date1 = new Date(p1.operation_date);
      const date2 = new Date(p2.operation_date);
      const daysDiff = Math.abs((date2 - date1) / (1000 * 60 * 60 * 24));

      console.log('📈 АНАЛИЗ РАЗЛИЧИЙ:\n');
      console.log(`  Разница в датах: ${daysDiff} дней`);
      console.log(`  Hash одинаковые: ${p1.operation_hash === p2.operation_hash ? 'ДА ✅' : 'НЕТ ❌'}`);
      
      const desc1 = (p1.description || '').toLowerCase();
      const desc2 = (p2.description || '').toLowerCase();
      const hasNierozliczona1 = desc1.includes('nierozliczona');
      const hasNierozliczona2 = desc2.includes('nierozliczona');
      
      console.log(`  Описание 1 содержит "nierozliczona": ${hasNierozliczona1 ? 'ДА ⚠️' : 'НЕТ'}`);
      console.log(`  Описание 2 содержит "nierozliczona": ${hasNierozliczona2 ? 'ДА ⚠️' : 'НЕТ'}`);
      console.log('');

      // Причина
      console.log('🔍 ПРИЧИНА ВОЗНИКНОВЕНИЯ ДУБЛИКАТА:\n');
      
      if (p1.operation_hash !== p2.operation_hash) {
        console.log('  ❌ ПРОБЛЕМА: Разные operation_hash');
        console.log('');
        console.log('  Объяснение:');
        console.log('    operation_hash генерируется на основе:');
        console.log('    - Дата операции');
        console.log('    - Сумма');
        console.log('    - Описание (включая "transakcja nierozliczona")');
        console.log('    - Номер счета (для некоторых форматов)');
        console.log('');
        console.log('  Когда транзакция сначала приходит как "transakcja nierozliczona"');
        console.log('  (незавершенная), а потом как завершенная:');
        console.log('    1. Описание отличается → разный hash');
        console.log('    2. Дата может отличаться (дата операции vs дата завершения) → разный hash');
        console.log('    3. Система не может определить, что это одна транзакция');
        console.log('    4. Оба платежа импортируются как отдельные записи');
        console.log('');
      }

      if (hasNierozliczona1 !== hasNierozliczona2) {
        console.log('  ⚠️  ПОДТВЕРЖДЕНИЕ: Один платеж с "transakcja nierozliczona", другой без');
        console.log('     Это указывает на то, что транзакция была импортирована дважды:');
        console.log('     - Сначала как незавершенная (05.12)');
        console.log('     - Потом как завершенная (06.12)');
        console.log('');
      }

      // Решение
      console.log('💡 РЕШЕНИЕ:\n');
      console.log('  1. Улучшить генерацию operation_hash:');
      console.log('     - Нормализовать описание перед генерацией hash');
      console.log('     - Удалять "transakcja nierozliczona" из описания');
      console.log('     - Использовать дату операции (не дату завершения)');
      console.log('');
      console.log('  2. Улучшить проверку дубликатов при импорте:');
      console.log('     - Проверять не только по operation_hash');
      console.log('     - Проверять по комбинации: payer + amount + date (±3 дня)');
      console.log('     - Если найдено совпадение, обновлять существующий платеж вместо создания нового');
      console.log('');
      console.log('  3. Улучшить алгоритм поиска дубликатов:');
      console.log('     - Уже реализовано: проверка по payer + amount + date');
      console.log('     - Добавить проверку схожести описаний');
      console.log('     - Учитывать "transakcja nierozliczona" как вариант одного платежа');
      console.log('');
    }

    // Общая статистика
    console.log('📊 ОБЩАЯ СТАТИСТИКА:\n');
    
    const { data: allPayments } = await supabase
      .from('payments')
      .select('id, operation_date, payer_name, description, operation_hash')
      .is('deleted_at', null)
      .gte('operation_date', `2025-12-01`)
      .lte('operation_date', `2025-12-31`);

    // Проверка по hash
    const hashMap = new Map();
    const hashDuplicates = [];
    for (const p of allPayments) {
      if (p.operation_hash) {
        if (hashMap.has(p.operation_hash)) {
          hashDuplicates.push({ hash: p.operation_hash, count: 2 });
        } else {
          hashMap.set(p.operation_hash, p);
        }
      }
    }

    console.log(`  Всего платежей за декабрь 2025: ${allPayments.length}`);
    console.log(`  Уникальных operation_hash: ${hashMap.size}`);
    console.log(`  Точных дубликатов по hash: ${hashDuplicates.length}`);
    console.log('');

    if (hashDuplicates.length > 0) {
      console.log('  ⚠️  ВНИМАНИЕ: Найдены платежи с одинаковым operation_hash!');
      console.log('     Это означает, что один и тот же платеж был импортирован несколько раз.');
      console.log('     Нужно проверить логику импорта CSV.\n');
    }

    console.log('✅ Отчет завершен\n');

  } catch (error) {
    logger.error('❌ Ошибка при генерации отчета:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

generateReport().catch(error => {
  console.error('❌ Необработанная ошибка:', error);
  process.exit(1);
});

