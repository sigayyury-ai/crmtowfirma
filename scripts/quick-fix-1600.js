require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function quickFix1600() {
  logger.info('Исправляю deal 1600 на Nik Harist...');

  const { error } = await supabase
    .from('proformas')
    .update({
      fullnumber: 'CO-PROF 140/2025',
      buyer_name: 'Nik Harist',
      buyer_alt_name: 'Nik Harist',
      updated_at: new Date().toISOString()
    })
    .eq('pipedrive_deal_id', 1600);

  if (error) {
    logger.error('Ошибка:', error);
  } else {
    logger.info('✅ Исправлено!');
  }
}

quickFix1600();
