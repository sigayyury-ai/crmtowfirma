require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findCoprof137() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу CO-PROF 137/2025...');

    // Найдем CO-PROF 137/2025
    const { data: proforma137, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%CO-PROF 137/2025%,fullnumber.ilike.%137/2025%`)
      .single();

    if (proformaError && proformaError.code !== 'PGRST116') {
      logger.error('Ошибка при поиске CO-PROF 137/2025:', proformaError);
      return;
    }

    if (proforma137) {
      logger.info('Найдена CO-PROF 137/2025:');
      logger.info(`  ID: ${proforma137.id}`);
      logger.info(`  fullnumber: ${proforma137.fullnumber}`);
      logger.info(`  pipedrive_deal_id: ${proforma137.pipedrive_deal_id}`);
      logger.info(`  buyer_name: ${proforma137.buyer_name}`);
      logger.info(`  buyer_alt_name: ${proforma137.buyer_alt_name}`);
      logger.info(`  status: ${proforma137.status}`);
      logger.info(`  total: ${proforma137.total} ${proforma137.currency}`);
    } else {
      logger.info('CO-PROF 137/2025 не найдена');
    }

    // Найдем все проформы с Mariia Pankova
    const { data: mariiaProformas, error: mariiaError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('buyer_name', '%Mariia Pankova%')
      .order('id');

    if (mariiaError) {
      logger.error('Ошибка при поиске Mariia Pankova:', mariiaError);
    } else {
      logger.info(`\nНайдено проформ с Mariia Pankova: ${mariiaProformas.length}`);
      mariiaProformas.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, deal_id: ${proforma.pipedrive_deal_id}, status: ${proforma.status}`);
      });
    }

    // Проверим, что сейчас с deal 1600
    const { data: deal1600Proformas, error: dealError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .order('id');

    if (dealError) {
      logger.error('Ошибка при поиске проформ deal 1600:', dealError);
    } else {
      logger.info(`\nТекущие проформы для deal 1600: ${deal1600Proformas.length}`);
      deal1600Proformas.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, buyer: ${proforma.buyer_name}, status: ${proforma.status}`);
      });
    }

    logger.info('\nПоиск завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findCoprof137();
