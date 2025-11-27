require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findCoprof149() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу проформу CO-PROF 149/2025...');

    // Найдем проформу CO-PROF 149/2025
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%CO-PROF 149/2025%,fullnumber.ilike.%149/2025%,fullnumber.ilike.%149%`)
      .order('id');

    if (proformaError) {
      logger.error('Ошибка при поиске проформ:', proformaError);
      return;
    }

    logger.info(`Найдено проформ с номером 149: ${proformas.length}`);

    proformas.forEach(proforma => {
      logger.info(`\nПроформа ID: ${proforma.id}`);
      logger.info(`  fullnumber: ${proforma.fullnumber}`);
      logger.info(`  pipedrive_deal_id: ${proforma.pipedrive_deal_id}`);
      logger.info(`  status: ${proforma.status}`);
      logger.info(`  total: ${proforma.total} ${proforma.currency}`);
    });

    // Проверим связи с продуктами
    for (const proforma of proformas) {
      const { data: links, error: linksError } = await supabase
        .from('proforma_products')
        .select('*, products(name, normalized_name)')
        .eq('proforma_id', proforma.id);

      if (linksError) {
        logger.error(`Ошибка при получении связей для проформы ${proforma.id}:`, linksError);
        continue;
      }

      logger.info(`  Продукты (${links.length}):`);
      links.forEach(link => {
        logger.info(`    - ${link.products?.name || 'Без названия'} (product_id: ${link.product_id})`);
      });
    }

    // Найдем продукт NY2026
    const { data: ny2026, error: nyError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', '%NY2026%');

    if (nyError) {
      logger.error('Ошибка при поиске NY2026:', nyError);
    } else if (ny2026 && ny2026.length > 0) {
      logger.info(`\nНайден продукт NY2026:`);
      ny2026.forEach(product => {
        logger.info(`  ID: ${product.id}, Name: ${product.name}`);
      });
    } else {
      logger.warn('Продукт NY2026 не найден');
    }

    logger.info('\nПоиск завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findCoprof149();
