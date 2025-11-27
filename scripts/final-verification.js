require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function finalVerification() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Финальная проверка всех исправлений...\n');

    // Проверим все исправленные проформы
    const checks = [
      { fullnumber: 'CO-PROF 137/2025', expectedBuyer: 'Mariia Pankova', expectedDeal: 1589 },
      { fullnumber: 'CO-PROF 140/2025', expectedBuyer: 'Nik Harist', expectedDeal: 1600 },
      { fullnumber: 'CO-PROF 149/2025', expectedBuyer: 'Anton Komissarov', expectedDeal: 1626 }
    ];

    for (const check of checks) {
      const { data: proforma, error } = await supabase
        .from('proformas')
        .select('*')
        .eq('fullnumber', check.fullnumber)
        .single();

      if (error) {
        logger.error(`❌ ${check.fullnumber}: ошибка - ${error.message}`);
        continue;
      }

      const buyerMatch = proforma.buyer_name === check.expectedBuyer;
      const dealMatch = proforma.pipedrive_deal_id === check.expectedDeal;

      if (buyerMatch && dealMatch) {
        logger.info(`✅ ${check.fullnumber}: ${check.expectedBuyer} (deal ${check.expectedDeal})`);
      } else {
        logger.warn(`⚠️  ${check.fullnumber}: ${proforma.buyer_name} (deal ${proforma.pipedrive_deal_id}) - ожидалось ${check.expectedBuyer} (deal ${check.expectedDeal})`);
      }
    }

    logger.info('\nФинальная проверка завершена!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

finalVerification();
