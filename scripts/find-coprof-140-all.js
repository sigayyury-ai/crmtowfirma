require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findCoprof140All() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все проформы с номером 140...');

    // Найдем все проформы с номером 140
    const { data: proformas140, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('fullnumber', '%140%')
      .order('id');

    if (proformasError) {
      logger.error('Ошибка при поиске проформ с 140:', proformasError);
      return;
    }

    logger.info(`Найдено проформ с номером 140: ${proformas140.length}`);

    proformas140.forEach(proforma => {
      logger.info(`\nПроформа ID: ${proforma.id}`);
      logger.info(`  fullnumber: ${proforma.fullnumber}`);
      logger.info(`  pipedrive_deal_id: ${proforma.pipedrive_deal_id}`);
      logger.info(`  buyer_name: ${proforma.buyer_name}`);
      logger.info(`  buyer_alt_name: ${proforma.buyer_alt_name}`);
      logger.info(`  status: ${proforma.status}`);
      logger.info(`  deleted_at: ${proforma.deleted_at}`);
      logger.info(`  total: ${proforma.total} ${proforma.currency}`);
    });

    // Проверим все проформы для deal 1600
    logger.info(`\n=== Все проформы для deal 1600 ===`);
    const { data: allDeal1600, error: dealError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .order('id');

    if (dealError) {
      logger.error('Ошибка при поиске всех проформ deal 1600:', dealError);
    } else {
      logger.info(`Найдено проформ для deal 1600: ${allDeal1600.length}`);
      allDeal1600.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, buyer: ${proforma.buyer_name}, status: ${proforma.status}`);
      });
    }

    // Найдем все проформы с YURY SIHAI
    logger.info(`\n=== Все проформы с YURY SIHAI ===`);
    const { data: yuryProformas, error: yuryError } = await supabase
      .from('proformas')
      .select('*')
      .or(`buyer_name.ilike.%yury%,buyer_alt_name.ilike.%yury%`)
      .order('id');

    if (yuryError) {
      logger.error('Ошибка при поиске YURY SIHAI:', yuryError);
    } else {
      logger.info(`Найдено проформ с YURY SIHAI: ${yuryProformas.length}`);
      yuryProformas.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, deal_id: ${proforma.pipedrive_deal_id}, buyer: ${proforma.buyer_name}, status: ${proforma.status}`);
      });
    }

    // Проверим, есть ли другие deal с похожими номерами
    logger.info(`\n=== Поиск похожих deal ===`);
    const similarDeals = [1599, 1600, 1601, 1602];
    for (const dealId of similarDeals) {
      const { data: dealProformas, error: dealErr } = await supabase
        .from('proformas')
        .select('id, fullnumber, buyer_name, status')
        .eq('pipedrive_deal_id', dealId);

      if (!dealErr && dealProformas.length > 0) {
        logger.info(`Deal ${dealId}: ${dealProformas.length} проформ`);
        dealProformas.forEach(p => {
          logger.info(`  - ${p.fullnumber}: ${p.buyer_name} (${p.status})`);
        });
      }
    }

    logger.info('\nПоиск завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findCoprof140All();
