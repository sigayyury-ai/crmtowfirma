require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixPaymentsTableYuryToAnton() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Обновляю платежи с Yury Sihai на Anton Komissarov в таблице payments...\n');

    // Найдем все платежи с Yury Sihai
    const { data: yuryPayments, error: findError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency')
      .ilike('payer_name', '%yury%');

    if (findError) {
      logger.error('Ошибка при поиске платежей:', findError);
      return;
    }

    logger.info(`Найдено платежей для обновления: ${yuryPayments.length}`);

    if (yuryPayments.length === 0) {
      logger.info('Нет платежей для обновления');
      return;
    }

    // Обновим каждый платеж
    let updatedCount = 0;
    for (const payment of yuryPayments) {
      const { error: updateError } = await supabase
        .from('payments')
        .update({
          payer_name: 'Anton Komissarov',
          payer_normalized_name: 'anton komissarov',
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id);

      if (updateError) {
        logger.error(`Ошибка при обновлении платежа ${payment.id}:`, updateError);
      } else {
        logger.info(`✅ Обновлен платеж ${payment.id}: ${payment.payer_name} → Anton Komissarov (${payment.amount} ${payment.currency})`);
        updatedCount++;
      }
    }

    logger.info(`\nВсего обновлено платежей: ${updatedCount}`);

    // Проверим, остались ли платежи с Yury
    const { data: remainingYury, error: checkError } = await supabase
      .from('payments')
      .select('id')
      .ilike('payer_name', '%yury%');

    if (!checkError) {
      logger.info(`Осталось платежей с Yury: ${remainingYury.length}`);
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixPaymentsTableYuryToAnton();
