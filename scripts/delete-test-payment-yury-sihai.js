/**
 * Удаление тестового платежа от Yury Sihai
 * Платеж: 1,00 PLN, дата: 11.01.2026, продукт: Lustro wody
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  logger.info('=== Удаление тестового платежа от Yury Sihai ===\n');

  try {
    // Ищем Stripe платежи от Yury Sihai с суммой около 1 PLN
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, original_amount, amount_pln, currency, created_at, processed_at, payment_status')
      .or(`customer_name.ilike.%Yury Sihai%,company_name.ilike.%Yury Sihai%`)
      .order('processed_at', { ascending: false });

    if (stripeError) {
      throw new Error(`Ошибка при получении Stripe платежей: ${stripeError.message}`);
    }

    logger.info(`Найдено Stripe платежей: ${stripePayments?.length || 0}\n`);

    if (!stripePayments || stripePayments.length === 0) {
      logger.warn('Платежи не найдены');
      return;
    }

    // Ищем платеж с суммой 1,00 PLN и датой около 11.01.2026
    const targetDate = new Date('2026-01-11');
    const targetDateStart = new Date(targetDate);
    targetDateStart.setHours(0, 0, 0, 0);
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    let testPayment = null;
    
    for (const payment of stripePayments) {
      const processedAt = payment.processed_at ? new Date(payment.processed_at) : null;
      const originalAmount = Number(payment.original_amount) || 0;
      
      logger.info(`Проверка платежа:`);
      logger.info(`  ID: ${payment.id}`);
      logger.info(`  Deal ID: ${payment.deal_id || 'N/A'}`);
      logger.info(`  Original Amount: ${originalAmount} ${payment.currency || 'PLN'}`);
      logger.info(`  Amount PLN: ${payment.amount_pln || 'NULL'}`);
      logger.info(`  Processed At: ${processedAt ? processedAt.toISOString() : 'N/A'}`);
      
      // Проверяем, соответствует ли платеж критериям тестового платежа
      // Сумма около 1 PLN и дата около 11.01.2026
      const isAmountMatch = Math.abs(originalAmount - 1.0) < 0.01 || Math.abs(Number(payment.amount_pln) - 4.21) < 0.01;
      const isDateMatch = processedAt && processedAt >= targetDateStart && processedAt <= targetDateEnd;
      
      if (isAmountMatch && isDateMatch) {
        testPayment = payment;
        logger.info(`  ✅ Найден тестовый платеж!`);
        break;
      }
      
      logger.info('');
    }

    if (!testPayment) {
      logger.warn('Тестовый платеж не найден по критериям (1,00 PLN, 11.01.2026)');
      logger.info('\nПоказываю все найденные платежи для ручной проверки:');
      stripePayments.forEach((payment, i) => {
        const processedAt = payment.processed_at ? new Date(payment.processed_at) : null;
        logger.info(`  ${i + 1}. Deal #${payment.deal_id || 'N/A'}, Amount: ${payment.original_amount || 0} ${payment.currency || 'PLN'}, Amount PLN: ${payment.amount_pln || 'NULL'}, Date: ${processedAt ? processedAt.toISOString().split('T')[0] : 'N/A'}`);
      });
      return;
    }

    logger.info(`\nУдаление тестового платежа:`);
    logger.info(`  ID: ${testPayment.id}`);
    logger.info(`  Session ID: ${testPayment.session_id || 'N/A'}`);
    logger.info(`  Deal ID: ${testPayment.deal_id || 'N/A'}`);
    logger.info(`  Amount: ${testPayment.original_amount || 0} ${testPayment.currency || 'PLN'}`);
    logger.info(`  Amount PLN: ${testPayment.amount_pln || 'NULL'}`);

    // Удаляем платеж (soft delete через deleted_at или hard delete)
    // Проверяем структуру таблицы - возможно есть поле deleted_at
    const { error: deleteError } = await supabase
      .from('stripe_payments')
      .delete()
      .eq('id', testPayment.id);

    if (deleteError) {
      // Попробуем soft delete через обновление статуса
      logger.warn(`Hard delete не удался: ${deleteError.message}`);
      logger.info('Попытка soft delete через обновление статуса...');
      
      const { error: updateError } = await supabase
        .from('stripe_payments')
        .update({ 
          payment_status: 'refunded',
          status: 'deleted'
        })
        .eq('id', testPayment.id);

      if (updateError) {
        throw new Error(`Не удалось удалить платеж: ${updateError.message}`);
      }
      
      logger.info('✅ Платеж помечен как удаленный (soft delete)');
    } else {
      logger.info('✅ Платеж удален из базы данных');
    }

    logger.info('\n✅ Тестовый платеж успешно удален из отчета');

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



