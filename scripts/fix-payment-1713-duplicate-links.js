require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixPayment1713DuplicateLinks() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю дублирование связей платежа 1713...\n');

    // Убираем ручную связь, оставляем только автоматическую
    const { error: updateError } = await supabase
      .from('payments')
      .update({
        manual_proforma_fullnumber: null,
        manual_proforma_id: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1713);

    if (updateError) {
      logger.error('Ошибка при обновлении платежа 1713:', updateError);
      return;
    }

    logger.info('✅ Ручная связь удалена, оставлена только автоматическая');

    // Проверим результат
    const { data: updatedPayment, error: checkError } = await supabase
      .from('payments')
      .select('id, proforma_id, manual_proforma_fullnumber, manual_proforma_id')
      .eq('id', 1713)
      .single();

    if (!checkError && updatedPayment) {
      logger.info('\nПроверка результата:');
      logger.info(`  proforma_id: ${updatedPayment.proforma_id}`);
      logger.info(`  manual_proforma_fullnumber: ${updatedPayment.manual_proforma_fullnumber}`);
      logger.info(`  manual_proforma_id: ${updatedPayment.manual_proforma_id}`);
    }

    logger.info('\nДублирование связей исправлено! Теперь платеж будет считаться только один раз.');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixPayment1713DuplicateLinks();
