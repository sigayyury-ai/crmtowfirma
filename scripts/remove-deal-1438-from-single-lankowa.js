require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = 1438;
const PRODUCT_NAME = 'Single Lankowa';

async function removeDeal1438FromProduct() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`=== УДАЛЕНИЕ DEAL ${DEAL_ID} ИЗ ПРОДУКТА "${PRODUCT_NAME}" ===\n`);

    // 1. Находим проформы для Deal ID 1438
    logger.info(`🔍 Поиск проформ для Deal ID ${DEAL_ID}...`);
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .order('issued_at', { ascending: false });

    if (proformasError) {
      logger.error('Ошибка при поиске проформ:', proformasError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.error(`Проформы для Deal ID ${DEAL_ID} не найдены`);
      process.exit(1);
    }

    logger.info(`Найдено проформ: ${proformas.length}\n`);

    proformas.forEach(p => {
      logger.info(`Проформа: ${p.fullnumber || p.id}`);
      logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
      logger.info(`  Статус: ${p.status || 'N/A'}`);
      logger.info(`  Дата: ${p.issued_at || 'нет'}`);
    });

    // 2. Находим продукт "Single Lankowa"
    logger.info(`\n🔍 Поиск продукта "${PRODUCT_NAME}"...`);
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
    logger.info(`Продукт найден: ID=${product.id}, Name="${product.name}"\n`);

    // 3. Проверяем текущие связи проформ с продуктом
    logger.info(`🔍 Проверка текущих связей с продуктом...`);
    for (const proforma of proformas) {
      const { data: links, error: linksError } = await supabase
        .from('proforma_products')
        .select('*, products(name)')
        .eq('proforma_id', proforma.id)
        .eq('product_id', product.id);

      if (linksError) {
        logger.error(`Ошибка при проверке связей для проформы ${proforma.id}:`, linksError);
        continue;
      }

      if (links && links.length > 0) {
        logger.info(`\nПроформа ${proforma.fullnumber || proforma.id}:`);
        logger.info(`  Найдено связей с продуктом "${PRODUCT_NAME}": ${links.length}`);
        links.forEach(link => {
          logger.info(`    - ID связи: ${link.id}, Продукт: ${link.products?.name || link.name || 'N/A'}`);
        });
      } else {
        logger.info(`\nПроформа ${proforma.fullnumber || proforma.id}:`);
        logger.info(`  Связей с продуктом "${PRODUCT_NAME}" не найдено`);
      }
    }

    // 4. Удаляем связи
    logger.info(`\n🗑️  Удаление связей с продуктом "${PRODUCT_NAME}"...\n`);
    
    for (const proforma of proformas) {
      const { error: deleteError } = await supabase
        .from('proforma_products')
        .delete()
        .eq('proforma_id', proforma.id)
        .eq('product_id', product.id);

      if (deleteError) {
        logger.error(`❌ Ошибка при удалении связи для проформы ${proforma.fullnumber || proforma.id}:`, deleteError);
      } else {
        logger.info(`✅ Связь удалена для проформы ${proforma.fullnumber || proforma.id}`);
      }
    }

    // 5. Проверяем результат
    logger.info(`\n🔍 Проверка результата...\n`);
    for (const proforma of proformas) {
      const { data: remainingLinks, error: checkError } = await supabase
        .from('proforma_products')
        .select('*, products(name)')
        .eq('proforma_id', proforma.id)
        .eq('product_id', product.id);

      if (checkError) {
        logger.error(`Ошибка при проверке:`, checkError);
      } else if (remainingLinks && remainingLinks.length > 0) {
        logger.warn(`⚠️  Для проформы ${proforma.fullnumber || proforma.id} остались связи: ${remainingLinks.length}`);
      } else {
        logger.info(`✅ Проформа ${proforma.fullnumber || proforma.id} больше не связана с продуктом "${PRODUCT_NAME}"`);
      }
    }

    // 6. Проверяем, остались ли другие связи этой проформы с продуктами
    logger.info(`\n🔍 Проверка других продуктов для проформ...\n`);
    for (const proforma of proformas) {
      const { data: allLinks, error: allLinksError } = await supabase
        .from('proforma_products')
        .select('*, products(name)')
        .eq('proforma_id', proforma.id);

      if (allLinksError) {
        logger.error(`Ошибка:`, allLinksError);
      } else if (allLinks && allLinks.length > 0) {
        logger.info(`Проформа ${proforma.fullnumber || proforma.id} все еще связана с продуктами:`);
        allLinks.forEach(link => {
          logger.info(`  - ${link.products?.name || link.name || 'Без названия'} (ID: ${link.product_id})`);
        });
      } else {
        logger.info(`Проформа ${proforma.fullnumber || proforma.id} не связана ни с какими продуктами`);
      }
    }

    logger.info(`\n=== ОПЕРАЦИЯ ЗАВЕРШЕНА ===\n`);
    logger.info(`Deal ID ${DEAL_ID} (${proformas[0]?.buyer_name || 'неизвестно'}) удален из продукта "${PRODUCT_NAME}"`);
    logger.info(`Проформы больше не будут показываться в отчетах по продукту "${PRODUCT_NAME}"\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

removeDeal1438FromProduct();



