require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findDeal1600() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все проформы для deal 1600...');

    // Найдем все проформы для deal 1600
    const { data: allProformas, error: allError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .order('id');

    if (allError) {
      logger.error('Ошибка при поиске проформ deal 1600:', allError);
      return;
    }

    logger.info(`Найдено проформ для deal 1600: ${allProformas.length}`);

    allProformas.forEach(proforma => {
      logger.info(`\nПроформа ID: ${proforma.id}`);
      logger.info(`  fullnumber: ${proforma.fullnumber}`);
      logger.info(`  buyer_name: ${proforma.buyer_name}`);
      logger.info(`  buyer_alt_name: ${proforma.buyer_alt_name}`);
      logger.info(`  status: ${proforma.status}`);
      logger.info(`  deleted_at: ${proforma.deleted_at}`);
      logger.info(`  total: ${proforma.total} ${proforma.currency}`);
      logger.info(`  created_at: ${proforma.created_at}`);
    });

    // Найдем CO-PROF 140/2025
    const { data: coprof140, error: coprofError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%CO-PROF 140/2025%,fullnumber.ilike.%140/2025%`)
      .single();

    if (coprofError && coprofError.code !== 'PGRST116') {
      logger.error('Ошибка при поиске CO-PROF 140/2025:', coprofError);
    } else if (coprof140) {
      logger.info(`\nНайдена CO-PROF 140/2025:`);
      logger.info(`  ID: ${coprof140.id}`);
      logger.info(`  buyer_name: ${coprof140.buyer_name}`);
      logger.info(`  buyer_alt_name: ${coprof140.buyer_alt_name}`);
      logger.info(`  deal_id: ${coprof140.pipedrive_deal_id}`);
      logger.info(`  status: ${coprof140.status}`);
    }

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

    // Найдем все проформы с YURY SIHAI для deal 1600
    const yuryProformas = allProformas.filter(p =>
      p.buyer_name?.toLowerCase().includes('yury') ||
      p.buyer_alt_name?.toLowerCase().includes('yury')
    );

    if (yuryProformas.length > 0) {
      logger.info(`\nНайдены проформы с YURY SIHAI для deal 1600:`);
      yuryProformas.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, buyer: ${proforma.buyer_name}, status: ${proforma.status}`);
      });
    }

    logger.info('\nАнализ завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findDeal1600();
