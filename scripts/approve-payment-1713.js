require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function approvePayment1713() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Устанавливаю статус approved для платежа 1713...\n');

    const { error: updateError } = await supabase
      .from('payments')
      .update({
        manual_status: 'approved',
        updated_at: new Date().toISOString()
      })
      .eq('id', 1713);

    if (updateError) {
      logger.error('Ошибка при обновлении платежа 1713:', updateError);
      return;
    }

    logger.info('✅ Платеж 1713 одобрен');

    // Проверим результат
    const { data: payment, error: checkError } = await supabase
      .from('payments')
      .select('id, manual_status, match_status')
      .eq('id', 1713)
      .single();

    if (!checkError && payment) {
      logger.info(`Статус платежа: manual_status=${payment.manual_status}, match_status=${payment.match_status}`);
    }

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

approvePayment1713();
