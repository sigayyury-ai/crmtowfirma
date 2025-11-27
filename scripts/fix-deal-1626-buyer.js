require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixDeal1626Buyer() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Исправляю плательщика для deal 1626...');

    // Найдем удаленную проформу для deal 1626
    const { data: deletedProforma, error: findError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', 1626)
      .eq('status', 'deleted')
      .single();

    if (findError || !deletedProforma) {
      logger.error('Не найдена удаленная проформа для deal 1626');
      return;
    }

    logger.info(`Найдена проформа ID: ${deletedProforma.id}, buyer: ${deletedProforma.buyer_name}`);

    // Обновим плательщика на Anton Komissarov
    const { data: updated, error: updateError } = await supabase
      .from('proformas')
      .update({
        buyer_name: 'Anton Komissarov',
        buyer_alt_name: 'Anton Komissarov',
        status: 'active', // Восстановим проформу
        deleted_at: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', deletedProforma.id)
      .select();

    if (updateError) {
      logger.error('Ошибка при обновлении проформы:', updateError);
      return;
    }

    logger.info('Проформа успешно обновлена:');
    logger.info(`- buyer_name: ${updated[0].buyer_name}`);
    logger.info(`- buyer_alt_name: ${updated[0].buyer_alt_name}`);
    logger.info(`- status: ${updated[0].status}`);
    logger.info(`- deleted_at: ${updated[0].deleted_at}`);

    // Проверим, что проформа правильно связана с продуктом NY2026
    const { data: links, error: linksError } = await supabase
      .from('proforma_products')
      .select('*, products(name)')
      .eq('proforma_id', deletedProforma.id);

    if (linksError) {
      logger.error('Ошибка при проверке связей:', linksError);
    } else {
      logger.info('Проверка связей с продуктами:');
      links.forEach(link => {
        logger.info(`- Продукт: ${link.products?.name} (ID: ${link.product_id})`);
      });
    }

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

rl.question('Вы уверены, что хотите изменить плательщика с "Yury Sihai" на "Anton Komissarov" для deal 1626? (yes/no): ', (answer) => {
  if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
    fixDeal1626Buyer().then(() => {
      rl.close();
    });
  } else {
    logger.info('Операция отменена');
    rl.close();
  }
});
