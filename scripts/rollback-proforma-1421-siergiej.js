#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = '1421';
const CORRECT_BUYER = 'Yuliia Korytko';

async function rollbackIncorrectProforma() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Поиск проформы для Deal ID ${DEAL_ID}\n`);
    logger.info('='.repeat(80));

    // 1. Находим проформу по deal_id
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .order('issued_at', { ascending: false });

    if (proformaError) {
      logger.error('Ошибка при поиске проформы:', proformaError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.error(`Проформы для Deal ID ${DEAL_ID} не найдены`);
      process.exit(1);
    }

    logger.info(`Найдено проформ: ${proformas.length}`);

    for (const proforma of proformas) {
      const buyerName = proforma.buyer_name || proforma.buyer_alt_name || 'N/A';
      
      // Пропускаем правильного контрагента (Yuliia Korytko)
      if (buyerName.includes(CORRECT_BUYER) || buyerName.includes('Korytko')) {
        logger.info(`\n✅ Пропускаем проформу для правильного контрагента: ${buyerName}`);
        logger.info(`   Проформа: ${proforma.fullnumber || proforma.id}`);
        continue;
      }

      logger.info(`\n📋 Откатываем проформу для неправильного контрагента: ${buyerName}`);
      logger.info(`   Проформа: ${proforma.fullnumber || proforma.id}`);
      logger.info(`   Текущие агрегаты:`);
      logger.info(`     payments_total: ${proforma.payments_total || 0}`);
      logger.info(`     payments_total_pln: ${proforma.payments_total_pln || 0}`);
      logger.info(`     payments_count: ${proforma.payments_count || 0}`);
      logger.info(`     payments_total_cash: ${proforma.payments_total_cash || 0}`);
      logger.info(`     payments_total_cash_pln: ${proforma.payments_total_cash_pln || 0}`);

      // Восстанавливаем исходные значения из первого запуска скрипта
      // Siergiej Żarkiewicz: payments_total: 2423, payments_total_pln: 2423, payments_count: 0, payments_total_cash: 0
      const originalPaymentsTotal = 2423;
      const originalPaymentsTotalPln = 2423;
      const originalPaymentsCount = 0;
      const originalPaymentsTotalCash = 0;
      const originalPaymentsTotalCashPln = 0;

      logger.info(`\n   Восстанавливаем исходные значения:`);
      logger.info(`     payments_total: ${originalPaymentsTotal}`);
      logger.info(`     payments_total_pln: ${originalPaymentsTotalPln}`);
      logger.info(`     payments_count: ${originalPaymentsCount}`);
      logger.info(`     payments_total_cash: ${originalPaymentsTotalCash}`);
      logger.info(`     payments_total_cash_pln: ${originalPaymentsTotalCashPln}`);

      // Откатываем агрегаты
      const { error: updateError } = await supabase
        .from('proformas')
        .update({
          payments_total: originalPaymentsTotal,
          payments_total_pln: originalPaymentsTotalPln,
          payments_count: originalPaymentsCount,
          payments_total_cash: originalPaymentsTotalCash,
          payments_total_cash_pln: originalPaymentsTotalCashPln
        })
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('Ошибка при откате агрегатов:', updateError);
      } else {
        logger.info(`\n   ✅ Агрегаты успешно откачены для проформы ${proforma.fullnumber || proforma.id}`);
      }
    }

    logger.info('\n✅ Готово!\n');
  } catch (error) {
    logger.error('Ошибка:', error);
    process.exit(1);
  }
}

rollbackIncorrectProforma();
