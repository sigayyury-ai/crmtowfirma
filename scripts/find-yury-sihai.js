require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function findYurySihai() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Ищу все записи связанные с YURY SIHAI...');

    // 1. Найдем проформы где buyer_name содержит YURY SIHAI
    const { data: proformasYury, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('buyer_name', '%YURY SIHAI%')
      .order('id');

    if (proformasError) {
      logger.error('Ошибка при поиске проформ с YURY SIHAI:', proformasError);
    } else {
      logger.info(`\nНайдено проформ с плательщиком YURY SIHAI: ${proformasYury.length}`);
      proformasYury.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, deal_id: ${proforma.pipedrive_deal_id}, buyer: ${proforma.buyer_name}`);
      });
    }

    // 2. Найдем проформы где buyer_alt_name содержит YURY SIHAI
    const { data: proformasYuryAlt, error: proformasAltError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('buyer_alt_name', '%YURY SIHAI%')
      .order('id');

    if (proformasAltError) {
      logger.error('Ошибка при поиске проформ с YURY SIHAI в alt name:', proformasAltError);
    } else {
      logger.info(`\nНайдено проформ с alt плательщиком YURY SIHAI: ${proformasYuryAlt.length}`);
      proformasYuryAlt.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, deal_id: ${proforma.pipedrive_deal_id}, buyer_alt: ${proforma.buyer_alt_name}`);
      });
    }

    // 3. Найдем все проформы с deal_id из найденных выше
    const allYuryProformas = [...proformasYury, ...proformasYuryAlt];
    const dealIds = [...new Set(allYuryProformas.map(p => p.pipedrive_deal_id).filter(id => id))];

    if (dealIds.length > 0) {
      logger.info(`\nПроверяю все проформы для deal_id: ${dealIds.join(', ')}`);

      for (const dealId of dealIds) {
        const { data: allProformasForDeal, error: dealError } = await supabase
          .from('proformas')
          .select('*')
          .eq('pipedrive_deal_id', dealId)
          .order('id');

        if (dealError) {
          logger.error(`Ошибка при поиске проформ для deal ${dealId}:`, dealError);
          continue;
        }

        logger.info(`\nВсе проформы для deal ${dealId}:`);
        allProformasForDeal.forEach(proforma => {
          logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, buyer: ${proforma.buyer_name}, status: ${proforma.status}, deleted_at: ${proforma.deleted_at}`);
        });
      }
    }

    // 4. Найдем Anton Komissarov для сравнения
    const { data: proformasAnton, error: antonError } = await supabase
      .from('proformas')
      .select('*')
      .ilike('buyer_name', '%Anton Komissarov%')
      .order('id');

    if (antonError) {
      logger.error('Ошибка при поиске Anton Komissarov:', antonError);
    } else {
      logger.info(`\nНайдено проформ с Anton Komissarov: ${proformasAnton.length}`);
      proformasAnton.forEach(proforma => {
        logger.info(`- ID: ${proforma.id}, fullnumber: ${proforma.fullnumber}, deal_id: ${proforma.pipedrive_deal_id}`);
      });
    }

    logger.info('\nПоиск завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

findYurySihai();
