require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function finalFixCoprof137() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Выполняю финальное исправление CO-PROF 137/2025 для Mariia Pankova...');

    // Шаг 1: Изменим номер для deal 1598 с CO-PROF 137/2025 на CO-PROF 138/2025
    logger.info('Шаг 1: Изменяю номер для deal 1598...');
    const { error: update1598Error } = await supabase
      .from('proformas')
      .update({
        fullnumber: 'CO-PROF 138/2025',
        updated_at: new Date().toISOString()
      })
      .eq('pipedrive_deal_id', 1598)
      .eq('fullnumber', 'CO-PROF 137/2025');

    if (update1598Error) {
      logger.error('Ошибка при изменении номера для deal 1598:', update1598Error);
      return;
    }
    logger.info('✅ Deal 1598: CO-PROF 137/2025 → CO-PROF 138/2025');

    // Шаг 2: Изменим номер и плательщика для deal 1600
    logger.info('Шаг 2: Изменяю номер и плательщика для deal 1600...');
    const { error: update1600Error } = await supabase
      .from('proformas')
      .update({
        fullnumber: 'CO-PROF 137/2025',
        buyer_name: 'Mariia Pankova',
        buyer_alt_name: 'Mariia Pankova',
        updated_at: new Date().toISOString()
      })
      .eq('pipedrive_deal_id', 1600);

    if (update1600Error) {
      logger.error('Ошибка при изменении для deal 1600:', update1600Error);
      return;
    }
    logger.info('✅ Deal 1600: CO-PROF ***/2025 → CO-PROF 137/2025, Siergiej Żarkiewicz → Mariia Pankova');

    // Шаг 3: Проверка результата
    logger.info('Шаг 3: Проверяю результат...');

    const { data: finalCheck, error: checkError } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id, buyer_name')
      .in('fullnumber', ['CO-PROF 137/2025', 'CO-PROF 138/2025'])
      .order('pipedrive_deal_id');

    if (checkError) {
      logger.error('Ошибка при проверке:', checkError);
    } else {
      logger.info('Финальный результат:');
      finalCheck.forEach(p => {
        logger.info(`- Deal ${p.pipedrive_deal_id}: ${p.fullnumber} → ${p.buyer_name}`);
      });
    }

    logger.info('Исправление завершено успешно! 🎉');

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

rl.question('Выполнить финальное исправление CO-PROF 137/2025 для Mariia Pankova? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    finalFixCoprof137().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
