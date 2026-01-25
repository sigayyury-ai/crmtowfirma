/**
 * Исправление amount_pln для Deal #1849
 * 
 * Проблема: Stripe платеж имеет amount_pln = NULL, поэтому в отчете показывается 0,00 PLN
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const exchangeRateService = require('../src/services/stripe/exchangeRateService');
const logger = require('../src/utils/logger');

const DEAL_ID = '1849';

async function main() {
  logger.info('=== Исправление amount_pln для Deal #1849 ===\n');

  try {
    // Найти Stripe платежи для Deal #1849
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, original_amount, amount_pln, currency, created_at, processed_at, exchange_rate')
      .eq('deal_id', DEAL_ID)
      .order('created_at', { ascending: false });

    if (stripeError) {
      throw new Error(`Ошибка при получении Stripe платежей: ${stripeError.message}`);
    }

    logger.info(`Найдено Stripe платежей: ${stripePayments?.length || 0}\n`);

    if (!stripePayments || stripePayments.length === 0) {
      logger.warn('Stripe платежи для Deal #1849 не найдены');
      return;
    }

    for (const payment of stripePayments) {
      logger.info(`Обработка платежа ${payment.session_id || payment.id}:`);
      logger.info(`  Original Amount: ${payment.original_amount || 0} ${payment.currency || 'PLN'}`);
      logger.info(`  Current Amount PLN: ${payment.amount_pln || 'NULL'}`);
      logger.info(`  Exchange Rate: ${payment.exchange_rate || 'NULL'}`);
      logger.info(`  Created At: ${payment.created_at || 'N/A'}`);

      // Проверяем, нужно ли обновлять amount_pln
      const currentAmountPln = payment.amount_pln;
      const needsUpdate = currentAmountPln === null || currentAmountPln === undefined || currentAmountPln === 0;
      
      if (!needsUpdate) {
        logger.info(`  ✅ amount_pln уже установлен: ${currentAmountPln}, пропускаем`);
        continue;
      }
      
      logger.info(`  ⚠️  amount_pln = ${currentAmountPln}, нужно обновить`);

      const originalAmount = Number(payment.original_amount) || 0;
      const currency = (payment.currency || 'PLN').toUpperCase();

      if (originalAmount === 0) {
        logger.warn(`  ⚠️  Original amount = 0, пропускаем`);
        continue;
      }

      let amountPln = null;
      let exchangeRate = payment.exchange_rate;

      // Если валюта PLN, amount_pln = original_amount
      if (currency === 'PLN') {
        amountPln = originalAmount;
        logger.info(`  Валюта PLN, используем original_amount: ${amountPln}`);
      } else {
        // Если есть exchange_rate, используем его
        if (exchangeRate && Number(exchangeRate) > 0) {
          amountPln = originalAmount * Number(exchangeRate);
          logger.info(`  Используем существующий exchange_rate: ${exchangeRate}`);
          logger.info(`  Рассчитанный amount_pln: ${amountPln}`);
        } else {
          // Пытаемся получить курс обмена
          try {
            logger.info(`  Получение курса обмена для ${currency} -> PLN...`);
            const rate = await exchangeRateService.getRate(currency, 'PLN');
            if (rate && rate > 0) {
              exchangeRate = rate;
              amountPln = originalAmount * rate;
              logger.info(`  Получен курс: ${rate}`);
              logger.info(`  Рассчитанный amount_pln: ${amountPln}`);
            } else {
              logger.warn(`  ⚠️  Не удалось получить курс обмена для ${currency}`);
            }
          } catch (error) {
            logger.warn(`  ⚠️  Ошибка при получении курса обмена: ${error.message}`);
          }
        }
      }

      if (amountPln === null || !Number.isFinite(amountPln)) {
        logger.warn(`  ⚠️  Не удалось рассчитать amount_pln для платежа ${payment.session_id || payment.id}`);
        continue;
      }

      // Округляем до 2 знаков после запятой
      amountPln = Math.round(amountPln * 100) / 100;

      // Обновляем платеж
      const updateData = {
        amount_pln: amountPln
      };

      // Если exchange_rate отсутствует, обновляем и его
      if (exchangeRate && !payment.exchange_rate) {
        updateData.exchange_rate = exchangeRate;
      }

      logger.info(`  Обновление платежа...`);
      const { error: updateError } = await supabase
        .from('stripe_payments')
        .update(updateData)
        .eq('id', payment.id);

      if (updateError) {
        logger.error(`  ❌ Ошибка при обновлении: ${updateError.message}`);
      } else {
        logger.info(`  ✅ Платеж обновлен: amount_pln = ${amountPln} PLN`);
        if (exchangeRate && !payment.exchange_rate) {
          logger.info(`     exchange_rate = ${exchangeRate}`);
        }
      }
      logger.info('');
    }

    logger.info('✅ Исправление завершено!');
    logger.info('\nТеперь в ежемесячном отчете для Deal #1849 должна отображаться правильная сумма в PLN.');

  } catch (error) {
    logger.error('\n❌ Ошибка при выполнении скрипта:', error);
    logger.error('Stack:', error.stack);
    process.exit(1);
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

