require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function rollbackAntonToYuryAuto() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Откатываю ВСЕ платежи Anton Komissarov обратно на Yury Sihai...\n');

    // Найдем все платежи с Anton Komissarov
    const { data: antonPayments, error: findError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency')
      .eq('payer_name', 'Anton Komissarov');

    if (findError) {
      logger.error('Ошибка при поиске платежей:', findError);
      return;
    }

    logger.info(`Найдено платежей для отката: ${antonPayments.length}`);

    // Откатываем обратно на Yury Sihai
    let rollbackCount = 0;
    for (const payment of antonPayments) {
      const { error: rollbackError } = await supabase
        .from('payments')
        .update({
          payer_name: 'Yury Sihai',
          payer_normalized_name: 'yury sihai',
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id);

      if (rollbackError) {
        logger.error(`Ошибка при откате платежа ${payment.id}:`, rollbackError);
      } else {
        rollbackCount++;
      }
    }

    logger.info(`Откат завершен. Обновлено платежей: ${rollbackCount}`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

rollbackAntonToYuryAuto();
