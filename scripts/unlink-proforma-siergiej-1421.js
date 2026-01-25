#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = '1421';
const INCORRECT_BUYER = 'Siergiej Żarkiewicz';

async function unlinkIncorrectProforma() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Поиск проформы для Deal ID ${DEAL_ID}\n`);
    logger.info('='.repeat(80));

    // 1. Находим проформу по deal_id и покупателю
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
      
      // Ищем проформу с неправильным контрагентом
      if (!buyerName.includes(INCORRECT_BUYER) && !buyerName.includes('Żarkiewicz')) {
        logger.info(`\n✅ Пропускаем проформу для другого контрагента: ${buyerName}`);
        logger.info(`   Проформа: ${proforma.fullnumber || proforma.id}`);
        continue;
      }

      logger.info(`\n📋 Отвязываем проформу для неправильного контрагента: ${buyerName}`);
      logger.info(`   Проформа: ${proforma.fullnumber || proforma.id}`);
      logger.info(`   Текущий pipedrive_deal_id: ${proforma.pipedrive_deal_id}`);

      // Отвязываем проформу от сделки 1421 (устанавливаем pipedrive_deal_id в null)
      logger.info(`\n   Отвязываем проформу от сделки ${DEAL_ID}...`);

      const { error: updateError } = await supabase
        .from('proformas')
        .update({
          pipedrive_deal_id: null
        })
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('Ошибка при отвязывании проформы:', updateError);
      } else {
        logger.info(`\n   ✅ Проформа ${proforma.fullnumber || proforma.id} успешно отвязана от сделки ${DEAL_ID}`);
        logger.info(`   pipedrive_deal_id установлен в null`);
      }
    }

    logger.info('\n✅ Готово!\n');
  } catch (error) {
    logger.error('Ошибка:', error);
    process.exit(1);
  }
}

unlinkIncorrectProforma();
