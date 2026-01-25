#!/usr/bin/env node

/**
 * Удаление тестовых сделок TEST_AUTO_ из базы данных
 * Удаляет:
 * - Записи из stripe_payments
 * - Записи из stripe_reminder_logs (если есть)
 * 
 * Использование:
 *   node scripts/delete-test-auto-deals.js [--dry-run]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DRY_RUN = process.argv.includes('--dry-run');

async function deleteTestAutoDeals() {
  try {
    console.log('\n🗑️  Удаление тестовых сделок TEST_AUTO_ из базы данных\n');
    console.log('='.repeat(100));

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - изменения не будут применены\n');
    }

    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    // Получаем все сделки из Pipedrive с названием TEST_AUTO_
    console.log('📋 Поиск тестовых сделок в Pipedrive...\n');
    
    const dealsResult = await pipedriveClient.getDeals({
      filter_id: null,
      status: 'all_not_deleted',
      limit: 500,
      start: 0
    });

    if (!dealsResult.success || !dealsResult.deals) {
      throw new Error('Не удалось получить сделки из Pipedrive');
    }

    const testDeals = dealsResult.deals.filter(deal => 
      deal.title && deal.title.includes('TEST_AUTO_')
    );

    console.log(`✅ Найдено тестовых сделок: ${testDeals.length}\n`);

    if (testDeals.length === 0) {
      console.log('✅ Тестовых сделок не найдено\n');
      return;
    }

    // Показываем список найденных сделок
    console.log('📋 Список тестовых сделок:\n');
    testDeals.forEach((deal, index) => {
      console.log(`${index + 1}. Deal #${deal.id}: ${deal.title}`);
    });
    console.log('');

    if (DRY_RUN) {
      console.log('='.repeat(100));
      console.log('\n✅ Dry run завершен - изменения не применены\n');
      return;
    }

    // Удаляем данные из базы данных
    console.log('🗑️  Удаление данных из базы...\n');

    let deletedPayments = 0;
    let deletedReminderLogs = 0;
    let errors = [];

    for (const deal of testDeals) {
      try {
        // Удаляем платежи
        const payments = await repository.listPayments({ dealId: String(deal.id) });
        
        for (const payment of payments) {
          try {
            const { error: deleteError } = await supabase
              .from('stripe_payments')
              .delete()
              .eq('id', payment.id);

            if (deleteError) {
              errors.push({
                dealId: deal.id,
                paymentId: payment.id,
                error: deleteError.message
              });
            } else {
              deletedPayments++;
            }
          } catch (err) {
            errors.push({
              dealId: deal.id,
              paymentId: payment.id,
              error: err.message
            });
          }
        }

        // Удаляем записи из stripe_reminder_logs
        const { error: deleteReminderError } = await supabase
          .from('stripe_reminder_logs')
          .delete()
          .eq('deal_id', deal.id);

        if (deleteReminderError) {
          errors.push({
            dealId: deal.id,
            type: 'reminder_logs',
            error: deleteReminderError.message
          });
        } else {
          // Проверяем, сколько записей было удалено
          const { count } = await supabase
            .from('stripe_reminder_logs')
            .select('*', { count: 'exact', head: true })
            .eq('deal_id', deal.id);
          
          if (count === 0) {
            deletedReminderLogs += payments.length > 0 ? 1 : 0; // Примерная оценка
          }
        }

        console.log(`   ✅ Deal #${deal.id}: удалено ${payments.length} платежей`);

      } catch (error) {
        errors.push({
          dealId: deal.id,
          error: error.message
        });
        console.log(`   ❌ Deal #${deal.id}: ошибка - ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n📊 РЕЗУЛЬТАТЫ:\n');
    console.log(`   Удалено платежей: ${deletedPayments}`);
    console.log(`   Удалено записей из reminder_logs: ${deletedReminderLogs}`);
    console.log(`   Ошибок: ${errors.length}`);

    if (errors.length > 0) {
      console.log('\n❌ Ошибки:');
      errors.forEach((err, index) => {
        console.log(`   ${index + 1}. Deal #${err.dealId}: ${err.error}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('\n✅ Удаление завершено!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Delete test auto deals failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

deleteTestAutoDeals().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





