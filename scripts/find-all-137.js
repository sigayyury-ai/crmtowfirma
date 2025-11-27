require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findAll137() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все записи с номером 137...');

    // Найдем все проформы с 137
    const { data: proformas137, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('fullnumber', '%137%')
      .order('id');

    if (proformasError) {
      logger.error('Ошибка при поиске проформ с 137:', proformasError);
      return;
    }

    logger.info(`Найдено записей с 137: ${proformas137.length}`);

    proformas137.forEach(proforma => {
      logger.info(`\nПроформа ID: ${proforma.id}`);
      logger.info(`  fullnumber: ${proforma.fullnumber}`);
      logger.info(`  pipedrive_deal_id: ${proforma.pipedrive_deal_id}`);
      logger.info(`  buyer_name: ${proforma.buyer_name}`);
      logger.info(`  status: ${proforma.status}`);
      logger.info(`  deleted_at: ${proforma.deleted_at}`);
    });

    // Проверим, есть ли уже Mariia Pankova где-то
    const { data: mariiaAll, error: mariiaAllError } = await supabase
      .from('proformas')
      .select('id, fullnumber, buyer_name, pipedrive_deal_id, status')
      .or('buyer_name.ilike.%mariia%,buyer_alt_name.ilike.%mariia%')
      .order('id');

    if (!mariiaAllError && mariiaAll.length > 0) {
      logger.info(`\nВсе записи с Mariia: ${mariiaAll.length}`);
      mariiaAll.forEach(p => {
        logger.info(`- ID: ${p.id}, fullnumber: ${p.fullnumber}, deal: ${p.pipedrive_deal_id}, buyer: ${p.buyer_name}`);
      });
    }

    logger.info('\nПоиск завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findAll137();
