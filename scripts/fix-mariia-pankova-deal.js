require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixMariiaPankovaDeal() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Изменяю deal для Mariia Pankova с CO-PROF 137/2025 на deal 1589...');

    // Найдем CO-PROF 137/2025
    const { data: proforma, error: findError } = await supabase
      .from('proformas')
      .select('*')
      .eq('fullnumber', 'CO-PROF 137/2025')
      .single();

    if (findError || !proforma) {
      logger.error('CO-PROF 137/2025 не найдена');
      return;
    }

    logger.info(`Найдена CO-PROF 137/2025:`);
    logger.info(`  Текущий deal_id: ${proforma.pipedrive_deal_id}`);
    logger.info(`  Текущий buyer: ${proforma.buyer_name}`);

    // Изменим deal_id на 1589
    const { data: updated, error: updateError } = await supabase
      .from('proformas')
      .update({
        pipedrive_deal_id: 1589,
        updated_at: new Date().toISOString()
      })
      .eq('id', proforma.id)
      .select();

    if (updateError) {
      logger.error('Ошибка при обновлении deal_id:', updateError);
      return;
    }

    logger.info('✅ Успешно изменено:');
    logger.info(`  deal_id: ${proforma.pipedrive_deal_id} → ${updated[0].pipedrive_deal_id}`);
    logger.info(`  buyer_name остался: ${updated[0].buyer_name}`);

    logger.info('Исправление завершено!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

// Запросим подтверждение
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Изменить deal_id для CO-PROF 137/2025 (Mariia Pankova) на 1589? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    fixMariiaPankovaDeal().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
