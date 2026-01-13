require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

/**
 * Анализ дубликатов платежей для понимания причин их возникновения
 */
async function analyzeDuplicates() {
  console.log('🔍 Анализ дубликатов платежей...\n');

  try {
    // Проверяем декабрь 2025
    const year = 2025;
    const month = 12;
    const yearStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    // Получаем все платежи за месяц
    const { data: payments, error } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, payer_name, description, operation_hash, direction, created_at')
      .is('deleted_at', null)
      .gte('operation_date', yearStart.toISOString())
      .lte('operation_date', yearEnd.toISOString())
      .order('operation_date', { ascending: true });

    if (error) {
      console.error('❌ Ошибка при получении платежей:', error);
      return;
    }

    console.log(`📊 Всего платежей за ${month}/${year}: ${payments.length}\n`);

    // 1. Проверка по operation_hash (точные дубликаты)
    console.log('1️⃣ Проверка по operation_hash (точные дубликаты)...\n');
    const hashMap = new Map();
    const hashDuplicates = [];

    for (const payment of payments) {
      if (payment.operation_hash) {
        if (hashMap.has(payment.operation_hash)) {
          hashDuplicates.push({
            hash: payment.operation_hash,
            payments: [hashMap.get(payment.operation_hash), payment]
          });
        } else {
          hashMap.set(payment.operation_hash, payment);
        }
      }
    }

    if (hashDuplicates.length > 0) {
      console.log(`⚠️  Найдено ${hashDuplicates.length} групп с одинаковым operation_hash (точные дубликаты):\n`);
      hashDuplicates.forEach((group, idx) => {
        console.log(`   Группа ${idx + 1}:`);
        group.payments.forEach(p => {
          console.log(`     ID: ${p.id}, Дата: ${p.operation_date}, Сумма: ${p.amount} ${p.currency}, Плательщик: ${p.payer_name || 'null'}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ Дубликатов по operation_hash не найдено\n');
    }

    // 2. Проверка по текущему алгоритму (payer + amount + currency)
    console.log('2️⃣ Проверка по текущему алгоритму (payer + amount + currency)...\n');
    
    const normalizePayerName = (name) => {
      if (!name) return '';
      return name.trim().toLowerCase().replace(/\s+/g, ' ');
    };

    const groups = new Map();
    
    for (const payment of payments) {
      const normalizedPayer = normalizePayerName(payment.payer_name);
      const key = `${normalizedPayer}|${payment.amount}|${payment.currency || 'PLN'}`;
      
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key).push(payment);
    }

    const currentAlgorithmDuplicates = [];
    
    for (const [key, group] of groups.entries()) {
      if (group.length > 1) {
        // Проверяем, находятся ли платежи в пределах 7 дней
        const sortedByDate = group.sort((a, b) => 
          new Date(a.operation_date) - new Date(b.operation_date)
        );
        
        const firstDate = new Date(sortedByDate[0].operation_date);
        const lastDate = new Date(sortedByDate[sortedByDate.length - 1].operation_date);
        const daysDiff = Math.abs((lastDate - firstDate) / (1000 * 60 * 60 * 24));
        
        if (daysDiff <= 7) {
          currentAlgorithmDuplicates.push({
            key,
            group: sortedByDate,
            daysDiff: Math.round(daysDiff)
          });
        }
      }
    }

    if (currentAlgorithmDuplicates.length > 0) {
      console.log(`⚠️  Найдено ${currentAlgorithmDuplicates.length} групп дубликатов по текущему алгоритму:\n`);
      
      currentAlgorithmDuplicates.forEach((dup, idx) => {
        const [payer, amount, currency] = dup.key.split('|');
        console.log(`   Группа ${idx + 1}: Плательщик="${payer}", Сумма=${amount}, Валюта=${currency}, Разница дней=${dup.daysDiff}`);
        console.log(`   Платежи (${dup.group.length}):`);
        
        dup.group.forEach((p, pIdx) => {
          const hashMatch = dup.group.some(other => 
            other.id !== p.id && other.operation_hash === p.operation_hash
          );
          const hashStatus = hashMatch ? '⚠️ ОДИНАКОВЫЙ HASH' : '✅ Разный hash';
          
          console.log(`     ${pIdx + 1}. ID: ${p.id}`);
          console.log(`        Дата: ${p.operation_date}`);
          console.log(`        Hash: ${p.operation_hash ? p.operation_hash.substring(0, 16) + '...' : 'null'} ${hashStatus}`);
          console.log(`        Описание: ${(p.description || '').substring(0, 80)}...`);
          console.log(`        Создан: ${p.created_at}`);
        });
        console.log('');
      });
    } else {
      console.log('✅ Дубликатов по текущему алгоритму не найдено\n');
    }

    // 3. Анализ причин
    console.log('3️⃣ Анализ причин возникновения дубликатов:\n');
    
    if (hashDuplicates.length > 0) {
      console.log('   ❌ ПРОБЛЕМА: Найдены платежи с одинаковым operation_hash');
      console.log('      Причина: Один и тот же платеж был импортирован несколько раз');
      console.log('      Решение: Использовать operation_hash для предотвращения дублирования при импорте\n');
    }

    const falsePositives = currentAlgorithmDuplicates.filter(dup => {
      // Проверяем, есть ли в группе платежи с одинаковым hash
      const hashes = new Set();
      for (const p of dup.group) {
        if (p.operation_hash) {
          if (hashes.has(p.operation_hash)) {
            return false; // Есть реальный дубликат
          }
          hashes.add(p.operation_hash);
        }
      }
      // Если все hash разные, но описания сильно отличаются - это ложное срабатывание
      const descriptions = dup.group.map(p => (p.description || '').toLowerCase());
      const firstDesc = descriptions[0];
      const allSimilar = descriptions.every(desc => {
        if (!desc || !firstDesc) return false;
        // Проверяем, есть ли общие слова
        const words1 = firstDesc.split(/\s+/).filter(w => w.length > 3);
        const words2 = desc.split(/\s+/).filter(w => w.length > 3);
        const commonWords = words1.filter(w => words2.includes(w));
        return commonWords.length >= 2; // Хотя бы 2 общих слова
      });
      
      return !allSimilar;
    });

    if (falsePositives.length > 0) {
      console.log(`   ⚠️  ПРОБЛЕМА: Найдено ${falsePositives.length} ложных срабатываний`);
      console.log('      Причина: Алгоритм считает дубликатами платежи с одинаковой суммой и плательщиком,');
      console.log('               но с разными описаниями и operation_hash');
      console.log('      Решение: Улучшить алгоритм - учитывать operation_hash и схожесть описаний\n');
    }

    // 4. Рекомендации
    console.log('4️⃣ Рекомендации по улучшению:\n');
    console.log('   1. Использовать operation_hash как основной критерий для определения дубликатов');
    console.log('   2. При импорте CSV проверять operation_hash перед добавлением платежа');
    console.log('   3. Улучшить алгоритм поиска дубликатов:');
    console.log('      - Сначала проверять operation_hash');
    console.log('      - Если hash разные, проверять схожесть описаний');
    console.log('      - Учитывать payer_name только если он не null');
    console.log('      - Для платежей с payer_name=null использовать только amount + currency + date + description\n');

  } catch (error) {
    logger.error('❌ Критическая ошибка:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

analyzeDuplicates().catch(error => {
  console.error('❌ Необработанная ошибка:', error);
  process.exit(1);
});

