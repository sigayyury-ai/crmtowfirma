#!/usr/bin/env node

/**
 * Удаление тестовых сделок TEST_AUTO_ из базы данных по списку deal_id
 * 
 * Использование:
 *   node scripts/delete-test-auto-deals-by-ids.js [--dry-run]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DRY_RUN = process.argv.includes('--dry-run');

// Список deal_id из dry-run результатов
const TEST_DEAL_IDS = [
  1882, 1883, 1888, 1889, 1894, 1895, 1900, 1901, 1906, 1907,
  1912, 1913, 1918, 1919, 1924, 1925, 1930, 1931, 1936, 1937,
  1942, 1943, 1948, 1949, 1950, 1951, 1956, 1957, 1962, 1963,
  1969, 1970, 1975, 1976, 1982, 1983, 1651
];

async function deleteTestAutoDealsByIds() {
  try {
    console.log('\n🗑️  Удаление тестовых сделок TEST_AUTO_ из базы данных\n');
    console.log('='.repeat(100));

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - изменения не будут применены\n');
    }

    const repository = new StripeRepository();

    console.log(`📋 Обработка ${TEST_DEAL_IDS.length} тестовых deal_id...\n`);

    let deletedPayments = 0;
    let deletedReminderLogs = 0;
    let errors = [];
    let dealsWithData = 0;

    for (const dealId of TEST_DEAL_IDS) {
      try {
        // Получаем платежи для этого deal_id
        const payments = await repository.listPayments({ dealId: String(dealId) });
        
        if (payments.length === 0) {
          continue; // Нет данных для этого deal_id
        }

        dealsWithData++;

        if (DRY_RUN) {
          console.log(`   📋 Deal #${dealId}: найдено ${payments.length} платежей (dry run)`);
          continue;
        }

        // Удаляем платежи
        for (const payment of payments) {
          try {
            const { error: deleteError } = await supabase
              .from('stripe_payments')
              .delete()
              .eq('id', payment.id);

            if (deleteError) {
              errors.push({
                dealId: dealId,
                paymentId: payment.id,
                error: deleteError.message
              });
            } else {
              deletedPayments++;
            }
          } catch (err) {
            errors.push({
              dealId: dealId,
              paymentId: payment.id,
              error: err.message
            });
          }
        }

        // Удаляем записи из stripe_reminder_logs
        const { error: deleteReminderError } = await supabase
          .from('stripe_reminder_logs')
          .delete()
          .eq('deal_id', dealId);

        if (deleteReminderError) {
          errors.push({
            dealId: dealId,
            type: 'reminder_logs',
            error: deleteReminderError.message
          });
        } else {
          deletedReminderLogs += 1; // Предполагаем, что была хотя бы одна запись
        }

        console.log(`   ✅ Deal #${dealId}: удалено ${payments.length} платежей`);

      } catch (error) {
        errors.push({
          dealId: dealId,
          error: error.message
        });
        console.log(`   ❌ Deal #${dealId}: ошибка - ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n📊 РЕЗУЛЬТАТЫ:\n');
    console.log(`   Обработано deal_id: ${TEST_DEAL_IDS.length}`);
    console.log(`   Deal_id с данными: ${dealsWithData}`);
    
    if (!DRY_RUN) {
      console.log(`   Удалено платежей: ${deletedPayments}`);
      console.log(`   Удалено записей из reminder_logs: ${deletedReminderLogs}`);
      console.log(`   Ошибок: ${errors.length}`);

      if (errors.length > 0) {
        console.log('\n❌ Ошибки:');
        errors.forEach((err, index) => {
          console.log(`   ${index + 1}. Deal #${err.dealId}: ${err.error}`);
        });
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n✅ Удаление завершено!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Delete test auto deals by IDs failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

deleteTestAutoDealsByIds().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





