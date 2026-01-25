require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const BUYER_NAME = 'Yuliia Korytko';

async function findProformaYuliia() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`=== ПОИСК ПРОФОРМ ДЛЯ ${BUYER_NAME} ===\n`);

    // Поиск по имени покупателя
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('buyer_name', `%${BUYER_NAME}%`)
      .order('issued_at', { ascending: false });

    if (proformaError) {
      logger.error('Ошибка при поиске проформ:', proformaError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.info(`Проформы для ${BUYER_NAME} не найдены`);
      return;
    }

    logger.info(`✅ Найдено проформ: ${proformas.length}\n`);

    proformas.forEach((p, idx) => {
      logger.info(`Проформа ${idx + 1}:`);
      logger.info(`  Номер: ${p.fullnumber || p.id}`);
      logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
      logger.info(`  Email: ${p.buyer_email || 'нет'}`);
      logger.info(`  Deal ID: ${p.pipedrive_deal_id || 'НЕТ ❌'}`);
      logger.info(`  Статус: ${p.status || 'N/A'}`);
      logger.info(`  Дата: ${p.issued_at || 'нет'}`);
      logger.info(`  Сумма: ${p.total || 0} ${p.currency || 'PLN'}`);
      
      if (!p.pipedrive_deal_id) {
        logger.warn(`  ⚠️  НЕТ ССЫЛКИ НА СДЕЛКУ`);
      } else {
        logger.info(`  ✅ Ссылка: https://comoon.pipedrive.com/deal/${p.pipedrive_deal_id}`);
      }
      logger.info('');
    });

    // Проверяем проформу CO-PROF 45/2025 отдельно
    logger.info(`\n🔍 Проверка проформы CO-PROF 45/2025...\n`);
    const { data: proforma45, error: p45Error } = await supabase
      .from('proformas')
      .select('*')
      .eq('fullnumber', 'CO-PROF 45/2025')
      .single();

    if (!p45Error && proforma45) {
      logger.info(`Проформа CO-PROF 45/2025:`);
      logger.info(`  Покупатель: ${proforma45.buyer_name || 'неизвестно'}`);
      logger.info(`  Deal ID: ${proforma45.pipedrive_deal_id || 'НЕТ ❌'}`);
    }

    logger.info(`\n=== ПОИСК ЗАВЕРШЕН ===\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findProformaYuliia();



