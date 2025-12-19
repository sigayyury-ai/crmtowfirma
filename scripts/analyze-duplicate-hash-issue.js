const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');
const crypto = require('crypto');

/**
 * Анализ причины дубликатов: проверка почему operation_hash не предотвратил дубликаты
 */

async function analyzeDuplicateHashIssue() {
  if (!supabase) {
    logger.error('Supabase client is not configured');
    process.exit(1);
  }

  try {
    logger.info('🔍 Анализ причин дубликатов платежей...\n');

    // Получаем все платежи с одинаковой датой, суммой и похожим описанием
    // но разными operation_hash (если такие есть)
    const { data: allPayments, error: fetchError } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, description, operation_hash, source, created_at')
      .order('operation_date', { ascending: false })
      .order('id', { ascending: false });

    if (fetchError) {
      logger.error('Ошибка при загрузке платежей:', fetchError);
      throw fetchError;
    }

    logger.info(`Всего платежей в базе: ${allPayments.length}\n`);

    // Группируем по ключу: дата + сумма + начало описания
    const paymentsByKey = new Map();
    
    for (const payment of allPayments) {
      if (!payment.operation_date || payment.amount === null || payment.amount === undefined) {
        continue;
      }

      const descriptionStart = (payment.description || '').substring(0, 50).toLowerCase().trim();
      const key = `${payment.operation_date}_${payment.amount}_${descriptionStart}`;

      if (!paymentsByKey.has(key)) {
        paymentsByKey.set(key, []);
      }

      paymentsByKey.get(key).push(payment);
    }

    // Находим группы с дубликатами
    const duplicateGroups = [];
    for (const [key, payments] of paymentsByKey.entries()) {
      if (payments.length > 1) {
        duplicateGroups.push({ key, payments });
      }
    }

    logger.info(`Найдено групп с дубликатами: ${duplicateGroups.length}\n`);

    // Анализируем каждую группу
    let groupsWithoutHash = 0;
    let groupsWithDifferentHash = 0;
    let groupsWithSameHash = 0;

    for (const group of duplicateGroups) {
      const hashes = group.payments.map(p => p.operation_hash).filter(Boolean);
      const uniqueHashes = new Set(hashes);

      if (hashes.length === 0) {
        groupsWithoutHash++;
        logger.info(`Группа без operation_hash: ${group.key}`);
        logger.info(`  Платежи: ${group.payments.map(p => `ID: ${p.id}`).join(', ')}`);
      } else if (uniqueHashes.size > 1) {
        groupsWithDifferentHash++;
        logger.info(`Группа с разными operation_hash: ${group.key}`);
        logger.info(`  Уникальных hash: ${uniqueHashes.size}, платежей: ${group.payments.length}`);
        group.payments.forEach(p => {
          logger.info(`    ID: ${p.id}, hash: ${p.operation_hash ? p.operation_hash.substring(0, 16) + '...' : 'NULL'}, создан: ${p.created_at}`);
          logger.info(`    Описание: ${(p.description || '').substring(0, 60)}`);
        });
      } else {
        groupsWithSameHash++;
        logger.info(`Группа с одинаковым operation_hash (проблема с upsert): ${group.key}`);
        logger.info(`  Hash: ${hashes[0] ? hashes[0].substring(0, 16) + '...' : 'NULL'}`);
        logger.info(`  Платежи: ${group.payments.map(p => `ID: ${p.id}`).join(', ')}`);
      }
    }

    logger.info('\n📊 Статистика:');
    logger.info(`  Групп без operation_hash: ${groupsWithoutHash}`);
    logger.info(`  Групп с разными operation_hash: ${groupsWithDifferentHash}`);
    logger.info(`  Групп с одинаковым operation_hash: ${groupsWithSameHash}`);

    // Проверяем, как генерируется hash для примеров
    if (groupsWithDifferentHash > 0) {
      logger.info('\n🔬 Анализ генерации hash для примеров:\n');
      
      const exampleGroup = duplicateGroups.find(g => {
        const hashes = g.payments.map(p => p.operation_hash).filter(Boolean);
        return new Set(hashes).size > 1;
      });

      if (exampleGroup) {
        logger.info(`Пример группы: ${exampleGroup.key}\n`);
        
        exampleGroup.payments.forEach((payment, index) => {
          logger.info(`Платеж ${index + 1} (ID: ${payment.id}):`);
          logger.info(`  Дата: ${payment.operation_date}`);
          logger.info(`  Сумма: ${payment.amount} ${payment.currency || 'PLN'}`);
          logger.info(`  Описание: ${payment.description || ''}`);
          logger.info(`  Hash: ${payment.operation_hash || 'NULL'}`);
          logger.info(`  Создан: ${payment.created_at}`);
          
          // Пробуем регенерировать hash разными способами
          if (payment.operation_date && payment.amount && payment.description) {
            // Способ 1: date-amount-description
            const hash1 = crypto.createHash('sha256')
              .update(`${payment.operation_date}-${payment.amount}-${payment.description}`)
              .digest('hex');
            
            // Способ 2: date-amount-description (нормализованное описание)
            const normalizedDesc = (payment.description || '').toLowerCase().trim();
            const hash2 = crypto.createHash('sha256')
              .update(`${payment.operation_date}-${payment.amount}-${normalizedDesc}`)
              .digest('hex');
            
            logger.info(`  Регенерированный hash (способ 1): ${hash1.substring(0, 16)}...`);
            logger.info(`  Регенерированный hash (способ 2, нормализованный): ${hash2.substring(0, 16)}...`);
            logger.info(`  Совпадает с оригиналом: ${payment.operation_hash === hash1 || payment.operation_hash === hash2 ? 'ДА' : 'НЕТ'}`);
          }
          logger.info('');
        });
      }
    }

    return {
      totalPayments: allPayments.length,
      duplicateGroups: duplicateGroups.length,
      groupsWithoutHash,
      groupsWithDifferentHash,
      groupsWithSameHash
    };

  } catch (error) {
    logger.error('Ошибка при анализе:', error);
    throw error;
  }
}

if (require.main === module) {
  analyzeDuplicateHashIssue()
    .then(() => {
      logger.info('\n✅ Анализ завершен');
      process.exit(0);
    })
    .catch(error => {
      logger.error('Критическая ошибка:', error);
      process.exit(1);
    });
}

module.exports = { analyzeDuplicateHashIssue };
