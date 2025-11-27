require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function analyzeProducts() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Начинаем анализ продуктов в базе данных...');

    // Получаем все продукты
    const { data: products, error } = await supabase
      .from('products')
      .select('*')
      .order('id');

    if (error) {
      logger.error('Ошибка при получении продуктов:', error);
      process.exit(1);
    }

    logger.info(`Найдено ${products.length} продуктов в базе данных`);

    // Анализируем продукты
    const analysis = {
      total: products.length,
      withNames: 0,
      withoutNames: 0,
      testProducts: 0,
      emptyProducts: 0,
      categories: {}
    };

    products.forEach(product => {
      // Проверяем наличие имени
      if (!product.name || product.name.trim() === '') {
        analysis.withoutNames++;
        logger.info(`Продукт без имени: ID=${product.id}`);
      } else {
        analysis.withNames++;
      }

      // Проверяем на тестовые продукты
      const name = (product.name || '').toLowerCase();
      if (name.includes('test') || name.includes('тест') || name.includes('sample') ||
          name.includes('пример') || name.includes('demo') || name.includes('проверка')) {
        analysis.testProducts++;
        logger.info(`Тестовый продукт: ID=${product.id}, Name="${product.name}"`);
      }

      // Категоризация по типам имен
      let category = 'other';
      if (!product.name || product.name.trim() === '') {
        category = 'empty';
        analysis.emptyProducts++;
      } else if (name.includes('test') || name.includes('тест') ||
                 name.includes('sample') || name.includes('пример') ||
                 name.includes('demo') || name.includes('проверка')) {
        category = 'test';
      } else if (name.length < 5) {
        category = 'short_name';
      } else if (name.includes('camp') || name.includes('лагерь') ||
                 name.includes('kemping') || name.includes('camping')) {
        category = 'camp_related';
      } else if (name.includes('workshop') || name.includes('мастерская') ||
                 name.includes('семинар') || name.includes('курс')) {
        category = 'workshop';
      } else {
        category = 'regular';
      }

      if (!analysis.categories[category]) {
        analysis.categories[category] = 0;
      }
      analysis.categories[category]++;
    });

    // Выводим статистику
    logger.info('\n=== СТАТИСТИКА ПРОДУКТОВ ===');
    logger.info(`Всего продуктов: ${analysis.total}`);
    logger.info(`С именами: ${analysis.withNames}`);
    logger.info(`Без имен: ${analysis.withoutNames}`);
    logger.info(`Тестовых: ${analysis.testProducts}`);
    logger.info(`Пустых: ${analysis.emptyProducts}`);

    logger.info('\n=== КАТЕГОРИИ ПРОДУКТОВ ===');
    Object.entries(analysis.categories).forEach(([category, count]) => {
      logger.info(`${category}: ${count}`);
    });

    // Проверяем связи с проформами
    logger.info('\n=== ПРОВЕРКА СВЯЗЕЙ ===');
    const { data: proformaProducts, error: ppError } = await supabase
      .from('proforma_products')
      .select('product_id')
      .not('product_id', 'is', null);

    if (ppError) {
      logger.error('Ошибка при получении связей с проформами:', ppError);
    } else {
      const linkedProductIds = new Set(proformaProducts.map(pp => pp.product_id));
      const unlinkedProducts = products.filter(p => !linkedProductIds.has(p.id));

      logger.info(`Продуктов с проформами: ${linkedProductIds.size}`);
      logger.info(`Продуктов без проформ: ${unlinkedProducts.length}`);

      if (unlinkedProducts.length > 0) {
        logger.info('\nПродукты без проформ:');
        unlinkedProducts.slice(0, 10).forEach(product => {
          logger.info(`ID=${product.id}, Name="${product.name || 'Пустое'}"`);
        });
        if (unlinkedProducts.length > 10) {
          logger.info(`... и еще ${unlinkedProducts.length - 10} продуктов`);
        }
      }
    }

    // Проверяем источники продуктов (если есть поле source или created_at)
    logger.info('\n=== АНАЛИЗ ИСТОЧНИКОВ ===');
    const recentProducts = products
      .filter(p => p.created_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 5);

    logger.info('Последние созданные продукты:');
    recentProducts.forEach(product => {
      logger.info(`ID=${product.id}, Name="${product.name || 'Пустое'}", Created=${product.created_at}`);
    });

    logger.info('\nАнализ завершен успешно!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

analyzeProducts();
