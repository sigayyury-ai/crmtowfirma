#!/usr/bin/env node

/**
 * Скрипт для удаления тестовых сделок из базы данных stripe_payments
 * 
 * Удаляет все записи из stripe_payments, связанные со сделками,
 * название которых начинается с "TEST_AUTO_"
 * 
 * Использование:
 *   node scripts/delete-test-deals-from-db.js [--confirm]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const TEST_PREFIX = 'TEST_AUTO_';

async function deleteTestDealsFromDB() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');

  if (!confirm) {
    console.log('\n⚠️  WARNING: This script will delete all Stripe payment records');
    console.log(`   related to deals with prefix: "${TEST_PREFIX}"`);
    console.log('\n   To proceed, run with --confirm flag:');
    console.log('   node scripts/delete-test-deals-from-db.js --confirm\n');
    process.exit(0);
  }

  try {
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    if (!repository.isEnabled()) {
      console.log('❌ Stripe repository не включен\n');
      return;
    }

    console.log('🔍 Поиск тестовых сделок в Pipedrive...\n');

    // Находим все тестовые сделки
    const testDeals = [];
    let start = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      try {
        const result = await pipedriveClient.getDeals({
          start,
          limit,
          status: 'all'
        });

        if (result.success && result.deals) {
          const deals = result.deals.filter(deal => 
            deal.title && deal.title.startsWith(TEST_PREFIX)
          );
          testDeals.push(...deals);
          
          hasMore = result.deals.length === limit;
          start += limit;
        } else {
          hasMore = false;
        }
      } catch (error) {
        logger.error('Error searching for test deals', { error: error.message });
        hasMore = false;
      }
    }

    console.log(`📋 Найдено тестовых сделок: ${testDeals.length}\n`);

    if (testDeals.length === 0) {
      console.log('✅ Тестовых сделок не найдено. Проверяю базу данных напрямую...\n');
      
      // Если сделок нет в Pipedrive, проверяем базу данных напрямую
      // по deal_id из результатов проверки
      const testDealIds = [
        '1984', '1983', '1982', '1980', '1979', '1977', '1976', '1975', 
        '1974', '1973', '1971', '1970', '1969', '1888', '1894', '1900', 
        '1906', '1912', '1918', '1924', '1930', '1936', '1942', '1948', 
        '1950', '1956', '1962', '1967', '1966', '1964', '1963', '1961', 
        '1960', '1959'
      ];

      let deleted = 0;
      for (const dealId of testDealIds) {
        try {
          const payments = await repository.listPayments({
            dealId: String(dealId),
            limit: 1000
          });

          if (payments.length > 0) {
            console.log(`🗑️  Удаление записей для Deal #${dealId} (${payments.length} записей)...`);
            
            for (const payment of payments) {
              if (payment.session_id) {
                const { error } = await repository.supabase
                  .from('stripe_payments')
                  .delete()
                  .eq('session_id', payment.session_id);
                
                if (error) {
                  console.log(`   ⚠️  Ошибка удаления ${payment.session_id}: ${error.message}`);
                } else {
                  deleted++;
                }
              }
            }
            console.log(`   ✅ Удалено ${payments.length} записей для Deal #${dealId}`);
          }
        } catch (error) {
          console.log(`   ❌ Ошибка обработки Deal #${dealId}: ${error.message}`);
        }
      }

      console.log(`\n✅ Всего удалено записей: ${deleted}\n`);
      return;
    }

    // Получаем ID тестовых сделок
    const testDealIds = testDeals.map(d => String(d.id));
    console.log(`📋 ID тестовых сделок: ${testDealIds.join(', ')}\n`);

    // Находим все платежи для этих сделок
    let totalPayments = 0;
    const paymentsToDelete = [];

    for (const dealId of testDealIds) {
      try {
        const payments = await repository.listPayments({
          dealId: String(dealId),
          limit: 1000
        });
        
        paymentsToDelete.push(...payments);
        totalPayments += payments.length;
        
        console.log(`📋 Deal #${dealId}: ${payments.length} записей в базе`);
      } catch (error) {
        logger.error(`Error getting payments for deal ${dealId}`, { error: error.message });
      }
    }

    console.log(`\n📊 Всего записей для удаления: ${totalPayments}\n`);

    if (totalPayments === 0) {
      console.log('✅ Нет записей для удаления\n');
      return;
    }

    // Удаляем записи
    let deleted = 0;
    let errors = 0;

    for (const payment of paymentsToDelete) {
      try {
        if (payment.session_id) {
          const { error } = await repository.supabase
            .from('stripe_payments')
            .delete()
            .eq('session_id', payment.session_id);
          
          if (error) {
            errors++;
            console.log(`   ⚠️  Ошибка удаления ${payment.session_id}: ${error.message}`);
          } else {
            deleted++;
          }
        }
      } catch (error) {
        errors++;
        logger.error(`Error deleting payment ${payment.session_id}`, { error: error.message });
      }
    }

    console.log(`\n✅ Удалено записей: ${deleted}`);
    if (errors > 0) {
      console.log(`⚠️  Ошибок: ${errors}`);
    }
    console.log('');

  } catch (error) {
    logger.error('❌ Ошибка при удалении тестовых данных', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

deleteTestDealsFromDB();

