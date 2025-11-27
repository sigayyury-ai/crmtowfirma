require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function analyzeProductsDetailed() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Детальный анализ продуктов...');

    // Получаем все продукты с дополнительными полями
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('id');

    if (error) {
      logger.error('Ошибка при получении продуктов:', error);
      process.exit(1);
    }

    logger.info(`Найдено ${products.length} продуктов`);

    // Детальный анализ каждого продукта
    products.forEach(product => {
      const name = product.name || '';
      const normalizedName = product.normalized_name || '';
      const hasName = name.trim().length > 0;
      const hasNormalizedName = normalizedName.trim().length > 0;

      // Проверяем на "Без названия" или похожие
      const isEmptyLike = !hasName ||
        name.toLowerCase().includes('без названия') ||
        name.toLowerCase().includes('empty') ||
        name.toLowerCase().includes('unnamed') ||
        name.trim() === '';

      logger.info(`Продукт ID=${product.id}:`);
      logger.info(`  name: "${name}" (${hasName ? 'есть' : 'пустое'})`);
      logger.info(`  normalized_name: "${normalizedName}" (${hasNormalizedName ? 'есть' : 'пустое'})`);
      logger.info(`  created_at: ${product.created_at}`);
      logger.info(`  calculation_status: ${product.calculation_status}`);
      logger.info(`  Похоже на пустое: ${isEmptyLike ? 'ДА' : 'НЕТ'}`);
      logger.info('---');
    });

    // Специальный поиск "Без названия"
    const emptyLikeProducts = products.filter(product => {
      const name = (product.name || '').toLowerCase();
      return !product.name ||
             product.name.trim() === '' ||
             name.includes('без названия') ||
             name.includes('empty') ||
             name.includes('unnamed') ||
             name === 'null';
    });

    logger.info(`\nПродукты, похожие на пустые (${emptyLikeProducts.length}):`);
    emptyLikeProducts.forEach(product => {
      logger.info(`ID=${product.id}, name="${product.name}", normalized="${product.normalized_name}"`);
    });

    // Проверяем, какие продукты созданы автоматически
    const autoCreatedProducts = products.filter(product =>
      product.created_at &&
      (!product.name || product.name.includes('Без названия') || product.name.trim() === '')
    );

    logger.info(`\nАвтоматически созданные пустые продукты (${autoCreatedProducts.length}):`);
    autoCreatedProducts.forEach(product => {
      logger.info(`ID=${product.id}, created_at=${product.created_at}`);
    });

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

analyzeProductsDetailed();
