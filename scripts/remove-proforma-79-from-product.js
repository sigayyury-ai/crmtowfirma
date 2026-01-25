require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const PROFORMA_NUMBER = 'CO-PROF 79/2025';

async function removeProformaFromProduct() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`=== УДАЛЕНИЕ ПРОФОРМЫ ${PROFORMA_NUMBER} ИЗ ПРОДУКТА ===\n`);

    // 1. Находим проформу
    logger.info(`🔍 Поиск проформы...`);
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .eq('fullnumber', PROFORMA_NUMBER)
      .limit(1);

    if (proformaError) {
      logger.error('Ошибка при поиске проформы:', proformaError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.error(`Проформа ${PROFORMA_NUMBER} не найдена`);
      process.exit(1);
    }

    const proforma = proformas[0];
    logger.info(`✅ Проформа найдена:\n`);
    logger.info(`  ID: ${proforma.id}`);
    logger.info(`  Номер: ${proforma.fullnumber}`);
    logger.info(`  Покупатель: ${proforma.buyer_name || 'неизвестно'}\n`);

    // 2. Находим все связи проформы с продуктами
    logger.info(`🔍 Поиск связей с продуктами...`);
    const { data: links, error: linksError } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', proforma.id);

    if (linksError) {
      logger.error('Ошибка при поиске связей:', linksError);
      process.exit(1);
    }

    if (!links || links.length === 0) {
      logger.info(`⚠️  Проформа не связана ни с одним продуктом`);
      process.exit(0);
    }

    logger.info(`Найдено связей: ${links.length}\n`);
    links.forEach(link => {
      const productName = link.products?.name || link.name || 'неизвестно';
      logger.info(`  - Продукт: "${productName}" (product_id: ${link.product_id})`);
    });

    // 3. Удаляем все связи
    logger.info(`\n🗑️  Удаление связей...`);
    const { error: deleteError } = await supabase
      .from('proforma_products')
      .delete()
      .eq('proforma_id', proforma.id);

    if (deleteError) {
      logger.error('❌ Ошибка при удалении связей:', deleteError);
      process.exit(1);
    }

    logger.info(`✅ Успешно удалено ${links.length} связей(и)\n`);

    // 4. Проверяем результат
    logger.info(`🔍 Проверка результата...`);
    const { data: remainingLinks, error: verifyError } = await supabase
      .from('proforma_products')
      .select('*')
      .eq('proforma_id', proforma.id);

    if (verifyError) {
      logger.error('Ошибка при проверке:', verifyError);
    } else {
      if (!remainingLinks || remainingLinks.length === 0) {
        logger.info(`✅ Все связи удалены. Проформа ${PROFORMA_NUMBER} больше не связана с продуктами.`);
      } else {
        logger.warn(`⚠️  Остались связи: ${remainingLinks.length}`);
      }
    }

    logger.info(`\n=== ОПЕРАЦИЯ ЗАВЕРШЕНА ===\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

removeProformaFromProduct();



