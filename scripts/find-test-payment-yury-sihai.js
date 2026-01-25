/**
 * Поиск тестового платежа от Yury Sihai для удаления
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  logger.info('=== Поиск тестового платежа от Yury Sihai ===\n');

  try {
    // Ищем Stripe платежи от Yury Sihai
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, company_name, original_amount, amount_pln, currency, created_at, processed_at, payment_status')
      .or(`customer_name.ilike.%Yury Sihai%,company_name.ilike.%Yury Sihai%`)
      .order('created_at', { ascending: false });

    if (stripeError) {
      throw new Error(`Ошибка при получении Stripe платежей: ${stripeError.message}`);
    }

    logger.info(`Найдено Stripe платежей: ${stripePayments?.length || 0}\n`);

    if (stripePayments && stripePayments.length > 0) {
      stripePayments.forEach((payment, i) => {
        logger.info(`Платеж ${i + 1}:`);
        logger.info(`  ID: ${payment.id}`);
        logger.info(`  Session ID: ${payment.session_id || 'N/A'}`);
        logger.info(`  Deal ID: ${payment.deal_id || 'N/A'}`);
        logger.info(`  Customer: ${payment.customer_name || payment.company_name || 'N/A'}`);
        logger.info(`  Original Amount: ${payment.original_amount || 0} ${payment.currency || 'PLN'}`);
        logger.info(`  Amount PLN: ${payment.amount_pln || 'NULL'}`);
        logger.info(`  Created At: ${payment.created_at || 'N/A'}`);
        logger.info(`  Processed At: ${payment.processed_at || 'N/A'}`);
        logger.info(`  Status: ${payment.payment_status || 'N/A'}`);
        logger.info('');
      });
    }

    // Также ищем в таблице payments
    const { data: bankPayments, error: bankError } = await supabase
      .from('payments')
      .select('id, deal_id, description, amount, currency, operation_date, payer_name, manual_status, match_status, source')
      .ilike('payer_name', '%Yury Sihai%')
      .order('operation_date', { ascending: false });

    if (bankError) {
      logger.warn(`Ошибка при получении банковских платежей: ${bankError.message}`);
    } else {
      logger.info(`Найдено банковских платежей: ${bankPayments?.length || 0}\n`);

      if (bankPayments && bankPayments.length > 0) {
        bankPayments.forEach((payment, i) => {
          logger.info(`Платеж ${i + 1}:`);
          logger.info(`  ID: ${payment.id}`);
          logger.info(`  Deal ID: ${payment.deal_id || 'N/A'}`);
          logger.info(`  Payer: ${payment.payer_name || 'N/A'}`);
          logger.info(`  Amount: ${payment.amount || 0} ${payment.currency || 'PLN'}`);
          logger.info(`  Operation Date: ${payment.operation_date || 'N/A'}`);
          logger.info(`  Source: ${payment.source || 'N/A'}`);
          logger.info(`  Status: ${payment.manual_status || payment.match_status || 'N/A'}`);
          logger.info('');
        });
      }
    }

  } catch (error) {
    logger.error(`❌ Ошибка: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
  }
}

if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };



