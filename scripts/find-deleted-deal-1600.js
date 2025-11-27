require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findDeletedDeal1600() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все проформы для deal 1600 (включая удаленные)...');

    // Найдем все проформы для deal 1600, включая удаленные
    const { data: allProformas, error: allError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .order('id');

    if (allError) {
      logger.error('Ошибка при поиске всех проформ deal 1600:', allError);
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
      logger.info(`  updated_at: ${proforma.updated_at}`);
    });

    // Проверим, есть ли другие проформы с похожими номерами
    logger.info(`\n=== Поиск похожих проформ ===`);
    const similarPatterns = ['140', 'CO-PROF 140', 'PROF 140'];

    for (const pattern of similarPatterns) {
      const { data: similar, error: simError } = await supabase
        .from('proformas')
        .select('id, fullnumber, buyer_name, pipedrive_deal_id, status, deleted_at')
        .ilike('fullnumber', `%${pattern}%`)
        .neq('pipedrive_deal_id', 1600); // Исключаем уже найденные

      if (!simError && similar.length > 0) {
        logger.info(`Проформы с паттерном "${pattern}":`);
        similar.forEach(p => {
          logger.info(`  - ID: ${p.id}, fullnumber: ${p.fullnumber}, deal: ${p.pipedrive_deal_id}, buyer: ${p.buyer_name}, status: ${p.status}`);
        });
      }
    }

    // Проверим все удаленные проформы
    logger.info(`\n=== Все удаленные проформы ===`);
    const { data: deletedProformas, error: deletedError } = await supabase
      .from('proformas')
      .select('id, fullnumber, buyer_name, pipedrive_deal_id, deleted_at')
      .not('deleted_at', 'is', null)
      .ilike('buyer_name', '%Yury%')
      .order('deleted_at', { ascending: false });

    if (!deletedError && deletedProformas.length > 0) {
      logger.info(`Найдены удаленные проформы с Yury:`);
      deletedProformas.forEach(p => {
        logger.info(`  - ID: ${p.id}, fullnumber: ${p.fullnumber}, deal: ${p.pipedrive_deal_id}, buyer: ${p.buyer_name}, deleted: ${p.deleted_at}`);
      });
    } else {
      logger.info('Удаленных проформ с Yury не найдено');
    }

    logger.info('\nАнализ завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findDeletedDeal1600();
