require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findAllDeal1626() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все проформы для deal 1626 (включая удаленные)...');

    // Найдем все проформы для deal 1626, включая удаленные
    const { data: allProformas, error: allError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1626)
      .order('id');

    if (allError) {
      logger.error('Ошибка при поиске всех проформ deal 1626:', allError);
      return;
    }

    logger.info(`Найдено проформ для deal 1626: ${allProformas.length}`);

    allProformas.forEach(proforma => {
      logger.info(`\nПроформа ID: ${proforma.id}`);
      logger.info(`  fullnumber: ${proforma.fullnumber}`);
      logger.info(`  buyer_name: ${proforma.buyer_name}`);
      logger.info(`  buyer_alt_name: ${proforma.buyer_alt_name}`);
      logger.info(`  status: ${proforma.status}`);
      logger.info(`  deleted_at: ${proforma.deleted_at}`);
      logger.info(`  total: ${proforma.total} ${proforma.currency}`);
      logger.info(`  created_at: ${proforma.created_at}`);
      logger.info(`  updated_at: ${proforma.updated_at}`);
    });

    // Проверим связи с продуктами для каждой проформы
    for (const proforma of allProformas) {
      const { data: links, error: linksError } = await supabase
        .from('proforma_products')
        .select('*, products(name)')
        .eq('proforma_id', proforma.id);

      if (linksError) {
        logger.error(`Ошибка связей для проформы ${proforma.id}:`, linksError);
        continue;
      }

      logger.info(`\n  Продукты для проформы ${proforma.id} (${links.length}):`);
      links.forEach(link => {
        logger.info(`    - ${link.products?.name || 'Без названия'} (${link.product_id})`);
      });
    }

    // Найдем продукт NY2026
    const { data: ny2026, error: nyError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', '%NY2026%');

    if (nyError) {
      logger.error('Ошибка поиска NY2026:', nyError);
    } else if (ny2026 && ny2026.length > 0) {
      logger.info(`\nПродукт NY2026 найден:`);
      ny2026.forEach(product => {
        logger.info(`  ID: ${product.id}, Name: ${product.name}`);
      });
    }

    logger.info('\nАнализ завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findAllDeal1626();
