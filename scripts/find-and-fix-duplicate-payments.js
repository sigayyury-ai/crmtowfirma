const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

/**
 * Скрипт для поиска и удаления дубликатов платежей в базе данных
 * Дубликаты определяются по: operation_date, amount, description (первые 50 символов)
 */

async function findDuplicatePayments() {
  if (!supabase) {
    logger.error('Supabase client is not configured');
    process.exit(1);
  }

  try {
    logger.info('🔍 Поиск дубликатов платежей в базе данных...\n');

    // Получаем все платежи
    const { data: allPayments, error: fetchError } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, description, direction, source, created_at')
      .order('operation_date', { ascending: false })
      .order('id', { ascending: false });

    if (fetchError) {
      logger.error('Ошибка при загрузке платежей:', fetchError);
      throw fetchError;
    }

    logger.info(`Всего платежей в базе: ${allPayments.length}\n`);

    // Группируем платежи по ключу: дата + сумма + начало описания
    const paymentsByKey = new Map();
    const duplicates = [];

    for (const payment of allPayments) {
      if (!payment.operation_date || payment.amount === null || payment.amount === undefined) {
        continue;
      }

      // Создаем ключ для группировки
      const descriptionStart = (payment.description || '').substring(0, 50).toLowerCase().trim();
      const key = `${payment.operation_date}_${payment.amount}_${descriptionStart}`;

      if (!paymentsByKey.has(key)) {
        paymentsByKey.set(key, []);
      }

      paymentsByKey.get(key).push(payment);
    }

    // Находим группы с дубликатами (2+ платежа с одинаковым ключом)
    for (const [key, payments] of paymentsByKey.entries()) {
      if (payments.length > 1) {
        // Сортируем по дате создания (самый старый - оригинал, остальные - дубликаты)
        payments.sort((a, b) => {
          const dateA = new Date(a.created_at || 0);
          const dateB = new Date(b.created_at || 0);
          return dateA - dateB;
        });

        const original = payments[0];
        const duplicatesGroup = payments.slice(1);

        duplicates.push({
          key,
          original,
          duplicates: duplicatesGroup,
          totalCount: payments.length
        });
      }
    }

    logger.info(`Найдено групп с дубликатами: ${duplicates.length}\n`);

    // Выводим статистику
    let totalDuplicates = 0;
    const duplicatesBySource = {};
    const duplicatesByDirection = {};

    duplicates.forEach(group => {
      totalDuplicates += group.duplicates.length;
      
      group.duplicates.forEach(dup => {
        const source = dup.source || 'unknown';
        const direction = dup.direction || 'unknown';
        
        duplicatesBySource[source] = (duplicatesBySource[source] || 0) + 1;
        duplicatesByDirection[direction] = (duplicatesByDirection[direction] || 0) + 1;
      });
    });

    logger.info('📊 Статистика дубликатов:');
    logger.info(`  Всего дубликатов: ${totalDuplicates}`);
    logger.info(`  Групп с дубликатами: ${duplicates.length}`);
    logger.info(`  По источникам:`, duplicatesBySource);
    logger.info(`  По направлениям:`, duplicatesByDirection);
    logger.info('');

    // Выводим примеры дубликатов
    if (duplicates.length > 0) {
      logger.info('📋 Примеры дубликатов (первые 10 групп):\n');
      
      duplicates.slice(0, 10).forEach((group, index) => {
        logger.info(`${index + 1}. Группа: ${group.key}`);
        logger.info(`   Оригинал (ID: ${group.original.id}):`);
        logger.info(`     Дата: ${group.original.operation_date}`);
        logger.info(`     Сумма: ${group.original.amount} ${group.original.currency || 'PLN'}`);
        logger.info(`     Описание: ${(group.original.description || '').substring(0, 60)}`);
        logger.info(`     Создан: ${group.original.created_at}`);
        logger.info(`     Источник: ${group.original.source || 'unknown'}`);
        logger.info(`   Дубликаты (${group.duplicates.length}):`);
        
        group.duplicates.forEach((dup, dupIndex) => {
          logger.info(`     ${dupIndex + 1}. ID: ${dup.id}, создан: ${dup.created_at}, источник: ${dup.source || 'unknown'}`);
        });
        logger.info('');
      });

      if (duplicates.length > 10) {
        logger.info(`   ... и еще ${duplicates.length - 10} групп\n`);
      }
    }

    return {
      totalPayments: allPayments.length,
      duplicateGroups: duplicates.length,
      totalDuplicates,
      duplicates,
      duplicatesBySource,
      duplicatesByDirection
    };

  } catch (error) {
    logger.error('Ошибка при поиске дубликатов:', error);
    throw error;
  }
}

async function deleteDuplicatePayments(dryRun = true) {
  const result = await findDuplicatePayments();

  if (result.totalDuplicates === 0) {
    logger.info('✅ Дубликатов не найдено. База данных чистая.');
    return { deleted: 0, skipped: 0 };
  }

  logger.info(`\n${dryRun ? '🔍 [DRY RUN]' : '🗑️'} Удаление дубликатов...\n`);

  let deleted = 0;
  let skipped = 0;
  const errors = [];

  for (const group of result.duplicates) {
    for (const duplicate of group.duplicates) {
      try {
        if (dryRun) {
          logger.info(`[DRY RUN] Будет удален платеж ID: ${duplicate.id} (дубликат платежа ID: ${group.original.id})`);
          skipped++;
        } else {
          const { error: deleteError } = await supabase
            .from('payments')
            .delete()
            .eq('id', duplicate.id);

          if (deleteError) {
            logger.error(`Ошибка при удалении платежа ID ${duplicate.id}:`, deleteError);
            errors.push({ id: duplicate.id, error: deleteError.message });
          } else {
            deleted++;
            logger.info(`✅ Удален платеж ID: ${duplicate.id} (дубликат платежа ID: ${group.original.id})`);
          }
        }
      } catch (error) {
        logger.error(`Ошибка при обработке платежа ID ${duplicate.id}:`, error);
        errors.push({ id: duplicate.id, error: error.message });
      }
    }
  }

  logger.info(`\n${dryRun ? '🔍 [DRY RUN]' : '✅'} Результат:`);
  logger.info(`  Удалено: ${deleted}`);
  logger.info(`  Пропущено: ${skipped}`);
  if (errors.length > 0) {
    logger.error(`  Ошибок: ${errors.length}`);
    errors.forEach(err => {
      logger.error(`    ID ${err.id}: ${err.error}`);
    });
  }

  return { deleted, skipped, errors };
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--delete');

  try {
    if (dryRun) {
      logger.info('🔍 Режим проверки (dry-run). Для удаления используйте флаг --delete\n');
      await findDuplicatePayments();
      logger.info('\n💡 Для удаления найденных дубликатов запустите скрипт с флагом --delete');
    } else {
      logger.info('⚠️  Режим удаления. Дубликаты будут удалены из базы данных!\n');
      await deleteDuplicatePayments(false);
      logger.info('\n✅ Обработка завершена');
    }
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { findDuplicatePayments, deleteDuplicatePayments };
