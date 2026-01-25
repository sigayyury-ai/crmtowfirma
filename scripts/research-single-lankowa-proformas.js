require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const MAX_CAPACITY = 22; // Максимум человек в кемпе

async function researchSingleLankowa() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('=== РЕСЕРЧ: Single Lankowa - Анализ проформ ===\n');

    // 1. Находим продукт "Single Lankowa"
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('*')
      .or('name.ilike.%Single Lankowa%,name.ilike.%single lankowa%')
      .order('id');

    if (productError) {
      logger.error('Ошибка при поиске продукта:', productError);
      process.exit(1);
    }

    if (!products || products.length === 0) {
      logger.error('Продукт "Single Lankowa" не найден');
      process.exit(1);
    }

    logger.info(`Найдено продуктов: ${products.length}`);
    products.forEach(p => {
      logger.info(`  - ID: ${p.id}, Name: "${p.name}", Status: ${p.calculation_status || 'N/A'}`);
    });

    const productId = products[0].id;
    const productName = products[0].name;
    logger.info(`\nИспользуем продукт: ID=${productId}, Name="${productName}"\n`);

    // 2. Находим все проформы, связанные с этим продуктом
    const { data: proformaProducts, error: ppError } = await supabase
      .from('proforma_products')
      .select('proforma_id, name, quantity')
      .eq('product_id', productId);

    if (ppError) {
      logger.error('Ошибка при поиске связей проформ с продуктом:', ppError);
      process.exit(1);
    }

    if (!proformaProducts || proformaProducts.length === 0) {
      logger.info('Проформы не найдены для этого продукта');
      return;
    }

    logger.info(`Найдено связей проформ с продуктом: ${proformaProducts.length}`);
    const proformaIds = proformaProducts.map(pp => pp.proforma_id);

    // 3. Получаем детальную информацию о проформах
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .in('id', proformaIds)
      .order('issued_at', { ascending: false });

    if (proformasError) {
      logger.error('Ошибка при получении проформ:', proformasError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.info('Детали проформ не найдены');
      return;
    }

    // 4. Анализ проформ
    logger.info(`\n=== АНАЛИЗ ПРОФОРМ ===\n`);
    logger.info(`Всего проформ: ${proformas.length}`);
    logger.info(`Лимит кемпа: ${MAX_CAPACITY} человек\n`);

    const activeProformas = proformas.filter(p => !p.deleted_at && p.status !== 'deleted');
    const deletedProformas = proformas.filter(p => p.deleted_at || p.status === 'deleted');

    logger.info(`Активных проформ: ${activeProformas.length}`);
    logger.info(`Удаленных проформ: ${deletedProformas.length}`);

    // Группировка по статусам
    const statusGroups = {};
    proformas.forEach(p => {
      const status = p.deleted_at ? 'deleted' : (p.status || 'unknown');
      statusGroups[status] = (statusGroups[status] || 0) + 1;
    });

    logger.info('\nГруппировка по статусам:');
    Object.entries(statusGroups).forEach(([status, count]) => {
      logger.info(`  ${status}: ${count}`);
    });

    // Группировка по годам/месяцам
    const monthGroups = {};
    proformas.forEach(p => {
      if (p.issued_at) {
        const date = new Date(p.issued_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthGroups[monthKey] = (monthGroups[monthKey] || 0) + 1;
      }
    });

    logger.info('\nГруппировка по месяцам выдачи:');
    Object.entries(monthGroups)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .forEach(([month, count]) => {
        logger.info(`  ${month}: ${count} проформ`);
      });

    // Анализ уникальных покупателей
    const uniqueBuyers = new Set();
    const buyerProformas = {};
    activeProformas.forEach(p => {
      const buyerKey = (p.buyer_email || p.buyer_name || 'unknown').toLowerCase();
      uniqueBuyers.add(buyerKey);
      if (!buyerProformas[buyerKey]) {
        buyerProformas[buyerKey] = [];
      }
      buyerProformas[buyerKey].push(p);
    });

    logger.info(`\nУникальных покупателей (активные проформы): ${uniqueBuyers.size}`);

    // Проверка дубликатов (один покупатель - несколько проформ)
    const duplicateBuyers = Object.entries(buyerProformas)
      .filter(([_, proformasList]) => proformasList.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    if (duplicateBuyers.length > 0) {
      logger.info(`\n⚠️  Покупатели с несколькими проформами: ${duplicateBuyers.length}`);
      duplicateBuyers.slice(0, 10).forEach(([buyer, proformasList]) => {
        logger.info(`\n  🔍 Покупатель: ${buyer}`);
        logger.info(`     Количество проформ: ${proformasList.length}`);
        logger.info(`     Детали проформ:`);
        proformasList.forEach((p, idx) => {
          const date = p.issued_at ? new Date(p.issued_at).toISOString().split('T')[0] : 'нет даты';
          logger.info(`       ${idx + 1}. ${p.fullnumber || p.id}`);
          logger.info(`          - Дата: ${date}`);
          logger.info(`          - Deal ID: ${p.pipedrive_deal_id || 'нет'}`);
          logger.info(`          - Статус: ${p.status || 'N/A'}`);
          logger.info(`          - Сумма: ${p.total || 0} ${p.currency || 'PLN'}`);
          logger.info(`          - Покупатель: ${p.buyer_name || 'неизвестно'}`);
          logger.info(`          - Email: ${p.buyer_email || 'нет'}`);
          logger.info(`          - Удалена: ${p.deleted_at ? 'да (' + p.deleted_at + ')' : 'нет'}`);
        });
      });
      if (duplicateBuyers.length > 10) {
        logger.info(`  ... и еще ${duplicateBuyers.length - 10} покупателей с дубликатами`);
      }
    }

    // 5. Детальный список всех активных проформ
    logger.info(`\n=== ДЕТАЛЬНЫЙ СПИСОК АКТИВНЫХ ПРОФОРМ (${activeProformas.length}) ===\n`);
    logger.info('Формат: Номер | Покупатель | Email | Deal ID | Дата | Сумма | Статус');
    logger.info('─'.repeat(100));

    activeProformas.forEach((p, index) => {
      const date = p.issued_at ? new Date(p.issued_at).toISOString().split('T')[0] : 'нет даты';
      const amount = `${p.total || 0} ${p.currency || 'PLN'}`;
      const buyerInfo = p.buyer_name || p.buyer_email || 'неизвестно';
      const email = p.buyer_email || '-';
      const dealId = p.pipedrive_deal_id || '-';
      const status = p.status || 'N/A';

      logger.info(`${index + 1}. ${p.fullnumber || p.id} | ${buyerInfo} | ${email} | ${dealId} | ${date} | ${amount} | ${status}`);
    });

    // 6. Выводы и рекомендации
    logger.info(`\n=== ВЫВОДЫ ===\n`);
    logger.info(`1. Всего проформ: ${proformas.length}`);
    logger.info(`2. Активных проформ: ${activeProformas.length}`);
    logger.info(`3. Уникальных покупателей: ${uniqueBuyers.size}`);
    logger.info(`4. Лимит кемпа: ${MAX_CAPACITY} человек\n`);

    logger.info(`\n📊 СРАВНЕНИЕ С ЛИМИТОМ КЕМПА:`);
    if (activeProformas.length > MAX_CAPACITY) {
      logger.info(`⚠️  ВНИМАНИЕ: Количество активных проформ (${activeProformas.length}) ПРЕВЫШАЕТ лимит кемпа (${MAX_CAPACITY})`);
      logger.info(`   Разница: ${activeProformas.length - MAX_CAPACITY} проформ`);
      logger.info(`   Уникальных покупателей: ${uniqueBuyers.size} (но проформ ${activeProformas.length})`);
    } else if (activeProformas.length === MAX_CAPACITY) {
      logger.info(`✅ Количество проформ точно соответствует лимиту кемпа (${MAX_CAPACITY})`);
      if (uniqueBuyers.size < MAX_CAPACITY) {
        logger.info(`⚠️  НО: Уникальных покупателей ${uniqueBuyers.size}, а проформ ${activeProformas.length}`);
        logger.info(`   Это означает, что у ${activeProformas.length - uniqueBuyers.size} покупателя(ей) несколько проформ`);
      }
    } else {
      logger.info(`✅ Количество проформ меньше лимита кемпа (есть свободные места: ${MAX_CAPACITY - activeProformas.length})`);
    }

    if (duplicateBuyers.length > 0) {
      logger.info(`\n⚠️  КРИТИЧЕСКАЯ ПРОБЛЕМА: Обнаружены покупатели с несколькими проформами (${duplicateBuyers.length} покупателей)`);
      logger.info(`   Реальных покупателей: ${uniqueBuyers.size}`);
      logger.info(`   Всего проформ: ${activeProformas.length}`);
      logger.info(`   Разница: ${activeProformas.length - uniqueBuyers.size} "лишних" проформ`);
      logger.info(`   Это может указывать на дубликаты, ошибки в данных или повторные продажи`);
      logger.info(`   РЕКОМЕНДАЦИЯ: Проверить каждую проформу покупателей с дубликатами на реальность`);
    }

    if (deletedProformas.length > 0) {
      logger.info(`\nℹ️  Найдено ${deletedProformas.length} удаленных проформ`);
      logger.info(`   Это может быть нормально, если были отмены или изменения`);
    }

    // 7. Экспорт в файл для дальнейшего анализа (опционально)
    logger.info(`\n=== РЕКОМЕНДАЦИИ ===\n`);
    logger.info('1. Проверить проформы с одинаковыми покупателями (возможные дубликаты)');
    logger.info('2. Проверить статусы проформ - убедиться, что все активные проформы реальные');
    logger.info('3. Связать проформы со сделками в Pipedrive для проверки их актуальности');
    logger.info('4. Проверить даты проформ - возможно, некоторые проформы относятся к разным периодам');

    logger.info('\n=== АНАЛИЗ ЗАВЕРШЕН ===\n');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

researchSingleLankowa();

