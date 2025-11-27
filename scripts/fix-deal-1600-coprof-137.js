require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixDeal1600Coprof137() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю проформу для deal 1600 на CO-PROF 137/2025 с Mariia Pankova...');

    // Найдем текущую проформу для deal 1600
    const { data: currentProforma, error: findError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1600)
      .eq('status', 'active')
      .single();

    if (findError || !currentProforma) {
      logger.error('Не найдена активная проформа для deal 1600');
      return;
    }

    logger.info(`Найдена проформа ID: ${currentProforma.id}, fullnumber: ${currentProforma.fullnumber}, buyer: ${currentProforma.buyer_name}`);

    // Обновим проформу
    const { data: updated, error: updateError } = await supabase
      .from('proformas')
      .update({
        fullnumber: 'CO-PROF 137/2025',
        buyer_name: 'Mariia Pankova',
        buyer_alt_name: 'Mariia Pankova',
        updated_at: new Date().toISOString()
      })
      .eq('id', currentProforma.id)
      .select();

    if (updateError) {
      logger.error('Ошибка при обновлении проформы:', updateError);
      return;
    }

    logger.info('Проформа успешно обновлена:');
    logger.info(`- fullnumber: ${updated[0].fullnumber}`);
    logger.info(`- buyer_name: ${updated[0].buyer_name}`);
    logger.info(`- buyer_alt_name: ${updated[0].buyer_alt_name}`);
    logger.info(`- deal_id: ${updated[0].pipedrive_deal_id}`);

    logger.info('Исправление завершено успешно!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

// Запросим подтверждение перед выполнением
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Изменить проформу CO-PROF ***/2025 для deal 1600 на CO-PROF 137/2025 с плательщиком Mariia Pankova? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    fixDeal1600Coprof137().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
