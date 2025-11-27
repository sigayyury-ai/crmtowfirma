require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixNikHaristCoprof140Auto() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю CO-PROF 140/2025 для Nik Harist (Deal #1600)...');

    // Найдем текущую проформу deal 1600
    const { data: deal1600Proforma, error: find1600Error } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .eq('status', 'active')
      .single();

    if (find1600Error || !deal1600Proforma) {
      logger.error('Не найдена активная проформа для deal 1600');
      return;
    }

    logger.info(`Найдена проформа deal 1600: ${deal1600Proforma.fullnumber} (${deal1600Proforma.buyer_name})`);

    // Изменим на CO-PROF 140/2025 с Nik Harist
    const { error: updateError } = await supabase
      .from('proformas')
      .update({
        fullnumber: 'CO-PROF 140/2025',
        buyer_name: 'Nik Harist',
        buyer_alt_name: 'Nik Harist',
        updated_at: new Date().toISOString()
      })
      .eq('id', deal1600Proforma.id);

    if (updateError) {
      logger.error('Ошибка при обновлении:', updateError);
      return;
    }

    logger.info('✅ Deal 1600 обновлен:');
    logger.info(`  fullnumber: ${deal1600Proforma.fullnumber} → CO-PROF 140/2025`);
    logger.info(`  buyer_name: ${deal1600Proforma.buyer_name} → Nik Harist`);

    logger.info('Исправление завершено!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixNikHaristCoprof140Auto();
