require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixOnlyCoprof149Payments() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю только платежи, связанные с CO-PROF 149/2025 (deal 1626)...\n');

    // Найдем проформу CO-PROF 149/2025
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, buyer_name, pipedrive_deal_id')
      .eq('fullnumber', 'CO-PROF 149/2025')
      .single();

    if (proformaError || !proforma) {
      logger.error('Проформа CO-PROF 149/2025 не найдена');
      return;
    }

    logger.info(`Найдена проформа: ${proforma.fullnumber} (deal: ${proforma.pipedrive_deal_id}, buyer: ${proforma.buyer_name})`);

    // Найдем платежи, связанные с этой проформой
    const { data: linkedPayments, error: linkedError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency, operation_date, source')
      .eq('proforma_id', proforma.id);

    if (linkedError) {
      logger.error('Ошибка при поиске связанных платежей:', linkedError);
      return;
    }

    logger.info(`Найдено связанных платежей: ${linkedPayments.length}`);

    // Также найдем платежи, которые могут быть связаны через manual_proforma_fullnumber
    const { data: manualLinkedPayments, error: manualError } = await supabase
      .from('payments')
      .select('id, payer_name, amount, currency, operation_date, source')
      .eq('manual_proforma_fullnumber', 'CO-PROF 149/2025');

    if (!manualError && manualLinkedPayments.length > 0) {
      logger.info(`Найдено платежей с manual_proforma_fullnumber: ${manualLinkedPayments.length}`);
      linkedPayments.push(...manualLinkedPayments);
    }

    if (linkedPayments.length === 0) {
      logger.info('Нет платежей, связанных с этой проформой');
      return;
    }

    // Покажем найденные платежи
    logger.info('\nНайденные платежи:');
    linkedPayments.forEach((p, i) => {
      logger.info(`  ${i + 1}. ${p.payer_name}: ${p.amount} ${p.currency} (${p.source})`);
    });

    // Найдем платежи с Yury Sihai среди связанных
    const yuryPayments = linkedPayments.filter(p => p.payer_name && p.payer_name.toLowerCase().includes('yury'));

    if (yuryPayments.length === 0) {
      logger.info('Среди связанных платежей нет платежей с Yury Sihai');
      return;
    }

    logger.info(`\nНайдено ${yuryPayments.length} платежей с Yury Sihai для исправления:`);

    // Исправляем только эти платежи
    let fixedCount = 0;
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
        logger.info(`✅ Исправлен платеж ${payment.id}: Yury Sihai → Anton Komissarov (${payment.amount} ${payment.currency})`);
        fixedCount++;
      }
    }

    logger.info(`\nИсправление завершено. Обновлено платежей: ${fixedCount}`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixOnlyCoprof149Payments();
