#!/usr/bin/env node

/**
 * Удаление тестовых сделок TEST_AUTO_ из базы данных
 * Ищет по deal_id из истекших сессий и по тестовым email адресам
 * 
 * Использование:
 *   node scripts/delete-test-auto-deals-from-db.js [--dry-run]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DRY_RUN = process.argv.includes('--dry-run');

async function deleteTestAutoDealsFromDb() {
  try {
    console.log('\n🗑️  Удаление тестовых сделок TEST_AUTO_ из базы данных\n');
    console.log('='.repeat(100));

    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - изменения не будут применены\n');
    }

    const repository = new StripeRepository();
    const schedulerService = new SecondPaymentSchedulerService();

    // Получаем истекшие сессии из Stripe
    console.log('📋 Поиск истекших сессий с тестовыми deal_id...\n');
    
    const expiredSessions = await schedulerService.findExpiredUnpaidSessionsFromStripe();
    
    // Фильтруем тестовые сессии по email
    const testEmails = ['test_deposit_', 'test_rest_', 'test_'];
    const testSessions = expiredSessions.filter(session => {
      const email = session.customerEmail || '';
      return testEmails.some(testPrefix => email.includes(testPrefix));
    });

    // Получаем уникальные deal_id
    const testDealIds = [...new Set(testSessions.map(s => s.dealId))];

    console.log(`✅ Найдено тестовых сессий: ${testSessions.length}`);
    console.log(`✅ Найдено уникальных deal_id: ${testDealIds.length}\n`);

    if (testDealIds.length === 0) {
      console.log('✅ Тестовых сделок не найдено\n');
      return;
    }

    // Показываем список найденных deal_id
    console.log('📋 Список тестовых deal_id:\n');
    testDealIds.forEach((dealId, index) => {
      const sessionsForDeal = testSessions.filter(s => s.dealId === dealId);
      console.log(`${index + 1}. Deal #${dealId}: ${sessionsForDeal.length} сессий`);
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

    for (const dealId of testDealIds) {
      try {
        // Удаляем платежи
        const payments = await repository.listPayments({ dealId: String(dealId) });
        
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
          // Проверяем, сколько записей было удалено
          const { count } = await supabase
            .from('stripe_reminder_logs')
            .select('*', { count: 'exact', head: true })
            .eq('deal_id', dealId);
          
          if (count === 0 && payments.length > 0) {
            deletedReminderLogs += 1;
          }
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
    logger.error('Delete test auto deals from DB failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

deleteTestAutoDealsFromDb().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





