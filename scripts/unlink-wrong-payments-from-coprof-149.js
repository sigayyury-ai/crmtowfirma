require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function unlinkWrongPaymentsFromCoprof149() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Отвязываю неправильные платежи от CO-PROF 149/2025...\n');

    // Платежи, которые нужно отвязать
    const paymentsToUnlink = [921, 949];

    logger.info(`Будут отвязаны платежи: ${paymentsToUnlink.join(', ')}`);
    logger.info('Оставлен будет только платеж: 1713\n');

    // Отвязываем каждый платеж
    for (const paymentId of paymentsToUnlink) {
      logger.info(`Отвязываю платеж ${paymentId}...`);

      // Сначала посмотрим текущие данные платежа
      const { data: currentPayment, error: selectError } = await supabase
        .from('payments')
        .select('id, proforma_id, manual_proforma_fullnumber, payer_name, amount, currency')
        .eq('id', paymentId)
        .single();

      if (selectError) {
        logger.error(`Ошибка при получении данных платежа ${paymentId}:`, selectError);
        continue;
      }

      logger.info(`  Текущие данные: proforma_id=${currentPayment.proforma_id}, manual_fullnumber=${currentPayment.manual_proforma_fullnumber}`);

      // Отвязываем платеж
      const { error: updateError } = await supabase
        .from('payments')
        .update({
          proforma_id: null,
          manual_proforma_fullnumber: null,
          manual_status: 'rejected', // Помечаем как отклоненный
          updated_at: new Date().toISOString()
        })
        .eq('id', paymentId);

      if (updateError) {
        logger.error(`Ошибка при отвязывании платежа ${paymentId}:`, updateError);
      } else {
        logger.info(`✅ Платеж ${paymentId} успешно отвязан от CO-PROF 149/2025`);
      }
    }

    logger.info('\nПроверяю финальный результат...\n');

    // Проверим, какие платежи остались связанными с CO-PROF 149/2025
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id')
      .eq('fullnumber', 'CO-PROF 149/2025')
      .single();

    if (proformaError || !proforma) {
      logger.error('Не удалось найти проформу для финальной проверки');
      return;
    }

    // Найдем оставшиеся связанные платежи
    const { data: remainingPayments, error: remainingError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency, proforma_id, manual_proforma_fullnumber')
      .eq('proforma_id', proforma.id);

    if (remainingError) {
      logger.error('Ошибка при проверке оставшихся платежей:', remainingError);
    } else {
      logger.info(`Оставшиеся платежи, связанные напрямую: ${remainingPayments.length}`);
      remainingPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. ID: ${p.id}, ${p.payer_name}, ${p.amount} ${p.currency}`);
      });
    }

    // Проверим платежи, связанные через manual_proforma_fullnumber
    const { data: manualRemaining, error: manualRemainingError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency, proforma_id, manual_proforma_fullnumber')
      .eq('manual_proforma_fullnumber', 'CO-PROF 149/2025');

    if (!manualRemainingError && manualRemaining.length > 0) {
      logger.info(`\nОставшиеся платежи, связанные вручную: ${manualRemaining.length}`);
      manualRemaining.forEach((p, i) => {
        logger.info(`  ${i + 1}. ID: ${p.id}, ${p.payer_name}, ${p.amount} ${p.currency}`);
      });
    }

    logger.info('\nОтвязывание завершено!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

unlinkWrongPaymentsFromCoprof149();
