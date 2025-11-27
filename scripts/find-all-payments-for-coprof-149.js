require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findAllPaymentsForCoprof149() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все платежи, привязанные к CO-PROF 149/2025...\n');

    // 1. Найдем проформу CO-PROF 149/2025
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, buyer_name, pipedrive_deal_id, status')
      .eq('fullnumber', 'CO-PROF 149/2025')
      .single();

    if (proformaError || !proforma) {
      logger.error('Проформа CO-PROF 149/2025 не найдена');
      return;
    }

    logger.info(`Проформа найдена:`);
    logger.info(`  ID: ${proforma.id}`);
    logger.info(`  Номер: ${proforma.fullnumber}`);
    logger.info(`  Плательщик: ${proforma.buyer_name}`);
    logger.info(`  Deal ID: ${proforma.pipedrive_deal_id}`);
    logger.info(`  Статус: ${proforma.status}`);
    logger.info('');

    // 2. Найдем платежи, напрямую связанные с proforma_id
    const { data: directPayments, error: directError } = await supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        payer_name,
        source,
        match_status,
        manual_status,
        proforma_id,
        manual_proforma_fullnumber
      `)
      .eq('proforma_id', proforma.id)
      .order('operation_date', { ascending: false });

    if (directError) {
      logger.error('Ошибка при поиске платежей по proforma_id:', directError);
    } else {
      logger.info(`Платежи, напрямую связанные с proforma_id (${proforma.id}): ${directPayments.length}`);
      directPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. ${p.payer_name} | ${p.amount} ${p.currency} | ${p.operation_date} | ${p.source} | ${p.match_status}`);
      });
    }

    // 3. Найдем платежи, связанные через manual_proforma_fullnumber
    const { data: manualPayments, error: manualError } = await supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        payer_name,
        source,
        match_status,
        manual_status,
        proforma_id,
        manual_proforma_fullnumber
      `)
      .eq('manual_proforma_fullnumber', 'CO-PROF 149/2025')
      .order('operation_date', { ascending: false });

    if (manualError) {
      logger.error('Ошибка при поиске платежей по manual_proforma_fullnumber:', manualError);
    } else {
      logger.info(`\nПлатежи, связанные через manual_proforma_fullnumber: ${manualPayments.length}`);
      manualPayments.forEach((p, i) => {
        logger.info(`  ${i + 1}. ${p.payer_name} | ${p.amount} ${p.currency} | ${p.operation_date} | ${p.source} | ${p.manual_status}`);
      });
    }

    // 4. Объединим все платежи
    const allPayments = [...(directPayments || []), ...(manualPayments || [])];

    // Удалим дубликаты по id
    const uniquePayments = allPayments.filter((payment, index, self) =>
      index === self.findIndex(p => p.id === payment.id)
    );

    logger.info(`\n=== ИТОГО УНИКАЛЬНЫХ ПЛАТЕЖЕЙ: ${uniquePayments.length} ===`);
    logger.info('');

    // 5. Сгруппируем по payer_name
    const paymentsByPayer = {};
    uniquePayments.forEach(payment => {
      const payer = payment.payer_name || 'Не указано';
      if (!paymentsByPayer[payer]) {
        paymentsByPayer[payer] = [];
      }
      paymentsByPayer[payer].push(payment);
    });

    logger.info('Распределение по плательщикам:');
    Object.keys(paymentsByPayer).forEach(payer => {
      const payments = paymentsByPayer[payer];
      const totalAmount = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
      logger.info(`  ${payer}: ${payments.length} платежей, сумма: ${totalAmount.toFixed(2)} ${payments[0]?.currency || 'PLN'}`);
    });

    // 6. Покажем детальную информацию
    logger.info('\nДетальная информация по платежам:');
    uniquePayments.forEach((p, i) => {
      logger.info(`\n${i + 1}. Платеж ID: ${p.id}`);
      logger.info(`   Плательщик: ${p.payer_name}`);
      logger.info(`   Сумма: ${p.amount} ${p.currency}`);
      logger.info(`   Дата: ${p.operation_date}`);
      logger.info(`   Источник: ${p.source}`);
      logger.info(`   Статус: ${p.match_status || p.manual_status}`);
      logger.info(`   Описание: ${p.description}`);
      if (p.proforma_id) {
        logger.info(`   Связан напрямую с proforma_id: ${p.proforma_id}`);
      }
      if (p.manual_proforma_fullnumber) {
        logger.info(`   Связан вручную с: ${p.manual_proforma_fullnumber}`);
      }
    });

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findAllPaymentsForCoprof149();
