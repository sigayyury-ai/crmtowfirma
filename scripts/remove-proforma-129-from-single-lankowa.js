require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const PROFORMA_NUMBER = 'CO-PROF 129/2025';
const PRODUCT_NAME = 'Single Lankowa';

async function removeProformaFromProduct() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`=== УДАЛЕНИЕ ПРОФОРМЫ ${PROFORMA_NUMBER} ИЗ ПРОДУКТА "${PRODUCT_NAME}" ===\n`);

    // 1. Находим проформу
    logger.info(`🔍 Поиск проформы ${PROFORMA_NUMBER}...`);
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%129/2025%,fullnumber.ilike.%CO-PROF 129/2025%`)
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
    logger.info(`✅ Проформа найдена:`);
    logger.info(`  ID: ${proforma.id}`);
    logger.info(`  Номер: ${proforma.fullnumber}`);
    logger.info(`  Покупатель: ${proforma.buyer_name || 'неизвестно'}`);
    logger.info(`  Deal ID: ${proforma.pipedrive_deal_id || 'нет'}\n`);

    // 2. Находим продукт "Single Lankowa"
    logger.info(`🔍 Поиск продукта "${PRODUCT_NAME}"...`);
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('*')
      .or('name.ilike.%Single Lankowa%,name.ilike.%single lankowa%')
      .limit(1);

    if (productError) {
      logger.error('Ошибка при поиске продукта:', productError);
      process.exit(1);
    }

    if (!products || products.length === 0) {
      logger.error(`Продукт "${PRODUCT_NAME}" не найден`);
      process.exit(1);
    }

    const product = products[0];
    logger.info(`✅ Продукт найден: ID=${product.id}, Name="${product.name}"\n`);

    // 3. Проверяем текущую связь
    logger.info(`🔍 Проверка текущей связи...`);
    const { data: links, error: linksError } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', proforma.id)
      .eq('product_id', product.id);

    if (linksError) {
      logger.error('Ошибка при проверке связи:', linksError);
      process.exit(1);
    }

    if (!links || links.length === 0) {
      logger.info(`✅ Проформа уже не связана с продуктом "${PRODUCT_NAME}"`);
      logger.info(`   Ничего делать не нужно.\n`);
      return;
    }

    logger.info(`Найдено связей: ${links.length}`);
    links.forEach(link => {
      logger.info(`  - ID связи: ${link.id}, Продукт: ${link.products?.name || link.name || 'N/A'}`);
    });

    // 4. Удаляем связь
    logger.info(`\n🗑️  Удаление связи с продуктом "${PRODUCT_NAME}"...\n`);
    
    const { error: deleteError } = await supabase
      .from('proforma_products')
      .delete()
      .eq('proforma_id', proforma.id)
      .eq('product_id', product.id);

    if (deleteError) {
      logger.error(`❌ Ошибка при удалении связи:`, deleteError);
      process.exit(1);
    }

    logger.info(`✅ Связь удалена\n`);

    // 5. Проверяем результат
    logger.info(`🔍 Проверка результата...`);
    const { data: remainingLinks, error: checkError } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', proforma.id)
      .eq('product_id', product.id);

    if (checkError) {
      logger.error('Ошибка при проверке:', checkError);
    } else if (remainingLinks && remainingLinks.length > 0) {
      logger.warn(`⚠️  Связь все еще существует: ${remainingLinks.length}`);
    } else {
      logger.info(`✅ Проформа ${PROFORMA_NUMBER} больше не связана с продуктом "${PRODUCT_NAME}"`);
    }

    // 6. Проверяем, остались ли другие связи этой проформы с продуктами
    logger.info(`\n🔍 Проверка других продуктов для проформы...\n`);
    const { data: allLinks, error: allLinksError } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', proforma.id);

    if (allLinksError) {
      logger.error(`Ошибка:`, allLinksError);
    } else if (allLinks && allLinks.length > 0) {
      logger.info(`Проформа ${PROFORMA_NUMBER} все еще связана с продуктами:`);
      allLinks.forEach(link => {
        logger.info(`  - ${link.products?.name || link.name || 'Без названия'} (ID: ${link.product_id})`);
      });
    } else {
      logger.info(`Проформа ${PROFORMA_NUMBER} не связана ни с какими продуктами`);
    }

    logger.info(`\n=== ОПЕРАЦИЯ ЗАВЕРШЕНА ===\n`);
    logger.info(`Проформа ${PROFORMA_NUMBER} (${proforma.buyer_name || 'неизвестно'}) удалена из продукта "${PRODUCT_NAME}"`);
    logger.info(`Проформа больше не будет показываться в отчетах по продукту "${PRODUCT_NAME}"\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

removeProformaFromProduct();



