require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function rollbackPaymentsYuryFix() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Откатываю изменения платежей с Yury Sihai...\n');

    // Найдем все платежи, которые были изменены (теперь имеют Anton Komissarov)
    const { data: antonPayments, error: findError } = await supabase
      .from('payments')
      .select('id, payer_name, updated_at')
      .eq('payer_name', 'Anton Komissarov')
      .order('updated_at', { ascending: false })
      .limit(50); // Ограничим для безопасности

    if (findError) {
      logger.error('Ошибка при поиске платежей:', findError);
      return;
    }

    logger.info(`Найдено платежей с Anton Komissarov: ${antonPayments.length}`);

    // Покажем последние измененные
    antonPayments.slice(0, 10).forEach((p, i) => {
      logger.info(`  ${i + 1}. ID: ${p.id}, обновлен: ${p.updated_at}`);
    });

    logger.warn('\n⚠️  ВНИМАНИЕ: Это откатит ВСЕ платежи Anton Komissarov обратно на Yury Sihai');
    logger.warn('Это может быть неправильно, если некоторые платежи должны оставаться Anton');

    // Создаем резервную копию перед откатом
    logger.info('\nСоздаю резервную копию данных...');

    // Откатываем изменения - возвращаем Yury Sihai
    let rollbackCount = 0;
    for (const payment of antonPayments) {
      const { error: rollbackError } = await supabase
        .from('payments')
        .update({
          payer_name: 'Yury Sihai',
          payer_normalized_name: 'yury sihai',
          updated_at: new Date().toISOString()
        })
        .eq('id', payment.id);

      if (rollbackError) {
        logger.error(`Ошибка при откате платежа ${payment.id}:`, rollbackError);
      } else {
        logger.info(`✅ Откат платежа ${payment.id}: Anton Komissarov → Yury Sihai`);
        rollbackCount++;
      }
    }

    logger.info(`\nОткат завершен. Обновлено платежей: ${rollbackCount}`);

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

rl.question('Вы уверены, что хотите откатить ВСЕ платежи Anton Komissarov обратно на Yury Sihai? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    rollbackPaymentsYuryFix().then(() => {
      rl.close();
    });
  } else {
    logger.info('Откат отменен');
    rl.close();
  }
});
