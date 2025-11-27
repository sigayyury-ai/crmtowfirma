require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function simpleFixCoprof137() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Просто меняю плательщика для CO-PROF 137/2025 на Mariia Pankova...');

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

    // Изменим плательщика на Mariia Pankova
    const { data: updated, error: updateError } = await supabase
      .from('proformas')
      .update({
        buyer_name: 'Mariia Pankova',
        buyer_alt_name: 'Mariia Pankova',
        updated_at: new Date().toISOString()
      })
      .eq('id', proforma.id)
      .select();

    if (updateError) {
      logger.error('Ошибка при обновлении:', updateError);
      return;
    }

    logger.info('✅ Успешно изменено:');
    logger.info(`  buyer_name: ${updated[0].buyer_name}`);
    logger.info(`  buyer_alt_name: ${updated[0].buyer_alt_name}`);
    logger.info(`  deal_id остался: ${updated[0].pipedrive_deal_id}`);

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

rl.question('Изменить плательщика для CO-PROF 137/2025 на Mariia Pankova? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    simpleFixCoprof137().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
