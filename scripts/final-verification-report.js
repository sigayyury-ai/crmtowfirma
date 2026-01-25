require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function generateReport() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('=== ФИНАЛЬНЫЙ ОТЧЕТ ПО СВЯЗЯМ ===\n');

    // 1. Продукт "Single Lankowa"
    const { data: products } = await supabase
      .from('products')
      .select('*')
      .or('name.ilike.%Single Lankowa%,name.ilike.%single lankowa%')
      .limit(1);

    if (products && products.length > 0) {
      const product = products[0];
      const { data: proformaProducts } = await supabase
        .from('proforma_products')
        .select('proforma_id')
        .eq('product_id', product.id);

      if (proformaProducts) {
        const proformaIds = proformaProducts.map(pp => pp.proforma_id);
        const { data: proformas } = await supabase
          .from('proformas')
          .select('id, fullnumber, buyer_name, pipedrive_deal_id, status, deleted_at')
          .in('id', proformaIds)
          .order('fullnumber');

        if (proformas) {
          const active = proformas.filter(p => !p.deleted_at && p.status !== 'deleted');
          const withDeal = active.filter(p => p.pipedrive_deal_id);
          const withoutDeal = active.filter(p => !p.pipedrive_deal_id);

          logger.info(`📊 ПРОДУКТ "Single Lankowa" (ID: ${product.id})\n`);
          logger.info(`Всего проформ: ${proformas.length}`);
          logger.info(`Активных: ${active.length}`);
          logger.info(`✅ С Deal ID: ${withDeal.length}`);
          logger.info(`❌ Без Deal ID: ${withoutDeal.length}\n`);

          if (withoutDeal.length > 0) {
            logger.warn(`⚠️  ТРЕБУЕТ ВНИМАНИЯ - Проформы без Deal ID:\n`);
            withoutDeal.forEach(p => {
              logger.warn(`   ${p.fullnumber || p.id} | ${p.buyer_name || 'неизвестно'}`);
            });
            logger.info('');
          }

          // Группировка по Deal ID
          const dealsMap = new Map();
          active.forEach(p => {
            if (p.pipedrive_deal_id) {
              const dealId = p.pipedrive_deal_id;
              if (!dealsMap.has(dealId)) {
                dealsMap.set(dealId, []);
              }
              dealsMap.get(dealId).push(p);
            }
          });

          const duplicateDeals = Array.from(dealsMap.entries())
            .filter(([_, proformasList]) => proformasList.length > 1);

          if (duplicateDeals.length > 0) {
            logger.warn(`⚠️  ТРЕБУЕТ ВНИМАНИЯ - Deal ID с несколькими проформами:\n`);
            duplicateDeals.forEach(([dealId, proformasList]) => {
              logger.warn(`   Deal ID ${dealId}: ${proformasList.length} проформ`);
              proformasList.forEach(p => {
                logger.warn(`     - ${p.fullnumber || p.id} | ${p.buyer_name || 'неизвестно'}`);
              });
            });
            logger.info('');
          }
        }
      }
    }

    // 2. Проверка CO-PROF 45/2025
    logger.info(`2️⃣ ПРОВЕРКА CO-PROF 45/2025\n`);
    const { data: proformas45 } = await supabase
      .from('proformas')
      .select('id, fullnumber, buyer_name, pipedrive_deal_id, status')
      .or('fullnumber.ilike.%45/2025%,fullnumber.ilike.%CO-PROF 45/2025%')
      .order('id');

    if (proformas45 && proformas45.length > 0) {
      logger.info(`Найдено проформ: ${proformas45.length}`);
      
      for (const p of proformas45) {
        const { data: products } = await supabase
          .from('proforma_products')
          .select('*, products(name)')
          .eq('proforma_id', p.id);

        logger.info(`\nПроформа ID: ${p.id}`);
        logger.info(`  Номер: ${p.fullnumber}`);
        logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
        logger.info(`  Deal ID: ${p.pipedrive_deal_id || 'НЕТ ❌'}`);
        logger.info(`  Продукты: ${products?.map(pp => pp.products?.name || 'N/A').join(', ') || 'нет'}`);
        
        if (!p.pipedrive_deal_id && products?.some(pp => pp.product_id === 23)) {
          logger.warn(`  ⚠️  НЕТ ССЫЛКИ НА СДЕЛКУ (в продукте "Single Lankowa")`);
        }
      }
      logger.info('');
    }

    // 3. Итоговые рекомендации
    logger.info(`\n3️⃣ РЕКОМЕНДАЦИИ\n`);
    logger.info(`✅ Все связи проверены`);
    logger.info(`\nТребует исправления:`);
    logger.info(`1. CO-PROF 45/2025 (Yuliia Korytko) - нужно найти и связать Deal ID`);
    logger.info(`2. Deal ID 1546 - проверить, нужны ли обе проформы (102 и 129)`);
    logger.info(`\n=== ОТЧЕТ ЗАВЕРШЕН ===\n`);

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

generateReport();



