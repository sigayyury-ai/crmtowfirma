require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function verifyAllLinks() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('=== ПРОВЕРКА ВСЕХ СВЯЗЕЙ В БАЗЕ ДАННЫХ ===\n');

    // 1. Проверка проформ продукта "Single Lankowa"
    logger.info('1️⃣ ПРОВЕРКА ПРОДУКТА "Single Lankowa"\n');
    
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('*')
      .or('name.ilike.%Single Lankowa%,name.ilike.%single lankowa%')
      .limit(1);

    if (productError) {
      logger.error('Ошибка при поиске продукта:', productError);
    } else if (products && products.length > 0) {
      const product = products[0];
      logger.info(`Продукт: ID=${product.id}, Name="${product.name}"\n`);

      // Находим все проформы продукта
      const { data: proformaProducts, error: ppError } = await supabase
        .from('proforma_products')
        .select('proforma_id, products(name)')
        .eq('product_id', product.id);

      if (ppError) {
        logger.error('Ошибка при поиске связей:', ppError);
      } else {
        const proformaIds = proformaProducts.map(pp => pp.proforma_id);
        logger.info(`Связано проформ с продуктом: ${proformaIds.length}`);

        // Получаем детали проформ
        const { data: proformas, error: proformasError } = await supabase
          .from('proformas')
          .select('id, fullnumber, buyer_name, pipedrive_deal_id, status, deleted_at')
          .in('id', proformaIds)
          .order('pipedrive_deal_id');

        if (!proformasError && proformas) {
          logger.info(`\nДетали проформ:`);
          
          const withDeal = proformas.filter(p => p.pipedrive_deal_id && !p.deleted_at);
          const withoutDeal = proformas.filter(p => !p.pipedrive_deal_id && !p.deleted_at);
          const deleted = proformas.filter(p => p.deleted_at);

          logger.info(`  ✅ С Deal ID: ${withDeal.length}`);
          logger.info(`  ❌ Без Deal ID: ${withoutDeal.length}`);
          logger.info(`  🗑️  Удаленных: ${deleted.length}\n`);

          if (withoutDeal.length > 0) {
            logger.warn(`⚠️  Проформы без Deal ID:`);
            withoutDeal.forEach(p => {
              logger.warn(`    - ${p.fullnumber || p.id} | ${p.buyer_name || 'неизвестно'}`);
            });
            logger.info('');
          }

          // Группировка по Deal ID
          const dealsMap = new Map();
          proformas.forEach(p => {
            if (p.pipedrive_deal_id && !p.deleted_at) {
              const dealId = p.pipedrive_deal_id;
              if (!dealsMap.has(dealId)) {
                dealsMap.set(dealId, []);
              }
              dealsMap.get(dealId).push(p);
            }
          });

          // Проверка дубликатов (один Deal ID - несколько проформ)
          const duplicateDeals = Array.from(dealsMap.entries())
            .filter(([_, proformasList]) => proformasList.length > 1);

          if (duplicateDeals.length > 0) {
            logger.warn(`⚠️  Deal ID с несколькими проформами: ${duplicateDeals.length}`);
            duplicateDeals.forEach(([dealId, proformasList]) => {
              logger.warn(`  Deal ID ${dealId}: ${proformasList.length} проформ`);
              proformasList.forEach(p => {
                logger.warn(`    - ${p.fullnumber || p.id} | ${p.buyer_name || 'неизвестно'}`);
              });
            });
            logger.info('');
          }
        }
      }
    }

    // 2. Проверка проформ CO-PROF 45/2025 (дубликаты)
    logger.info('2️⃣ ПРОВЕРКА ПРОФОРМЫ CO-PROF 45/2025\n');
    
    const { data: proformas45, error: p45Error } = await supabase
      .from('proformas')
      .select('*')
      .or('fullnumber.ilike.%45/2025%,fullnumber.ilike.%CO-PROF 45/2025%')
      .order('id');

    if (p45Error) {
      logger.error('Ошибка при поиске:', p45Error);
    } else if (proformas45 && proformas45.length > 0) {
      logger.info(`Найдено проформ CO-PROF 45/2025: ${proformas45.length}`);
      
      if (proformas45.length > 1) {
        logger.warn(`⚠️  ВНИМАНИЕ: Найдено ${proformas45.length} проформ с одним номером!`);
      }

      proformas45.forEach((p, idx) => {
        logger.info(`\nПроформа ${idx + 1}:`);
        logger.info(`  ID: ${p.id}`);
        logger.info(`  Номер: ${p.fullnumber}`);
        logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
        logger.info(`  Email: ${p.buyer_email || 'нет'}`);
        logger.info(`  Deal ID: ${p.pipedrive_deal_id || 'НЕТ ❌'}`);
        logger.info(`  Статус: ${p.status || 'N/A'}`);
        logger.info(`  Удалена: ${p.deleted_at ? 'да (' + p.deleted_at + ')' : 'нет'}`);
      });
      logger.info('');
    }

    // 3. Проверка проформ CO-PROF 96/2025 (Hanna Chakhouskaya)
    logger.info('3️⃣ ПРОВЕРКА ПРОФОРМЫ CO-PROF 96/2025 (Hanna Chakhouskaya)\n');
    
    const { data: proformas96, error: p96Error } = await supabase
      .from('proformas')
      .select('*')
      .or('fullnumber.ilike.%96/2025%,fullnumber.ilike.%CO-PROF 96/2025%')
      .order('id');

    if (p96Error) {
      logger.error('Ошибка при поиске:', p96Error);
    } else if (proformas96 && proformas96.length > 0) {
      proformas96.forEach((p, idx) => {
        logger.info(`Проформа ${idx + 1}:`);
        logger.info(`  ID: ${p.id}`);
        logger.info(`  Номер: ${p.fullnumber}`);
        logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
        logger.info(`  Deal ID: ${p.pipedrive_deal_id || 'НЕТ ❌'}`);
        logger.info(`  Статус: ${p.status || 'N/A'}`);
        
        if (p.pipedrive_deal_id) {
          logger.info(`  ✅ Ссылка: https://comoon.pipedrive.com/deal/${p.pipedrive_deal_id}`);
        } else {
          logger.warn(`  ⚠️  НЕТ ССЫЛКИ НА СДЕЛКУ`);
        }
      });
      logger.info('');
    }

    // 4. Проверка проформ CO-PROF 129/2025 (Aliaksandr Slaushchyk)
    logger.info('4️⃣ ПРОВЕРКА ПРОФОРМЫ CO-PROF 129/2025 (Aliaksandr Slaushchyk)\n');
    
    const { data: proformas129, error: p129Error } = await supabase
      .from('proformas')
      .select('*')
      .or('fullnumber.ilike.%129/2025%,fullnumber.ilike.%CO-PROF 129/2025%')
      .order('id');

    if (p129Error) {
      logger.error('Ошибка при поиске:', p129Error);
    } else if (proformas129 && proformas129.length > 0) {
      proformas129.forEach((p, idx) => {
        logger.info(`Проформа ${idx + 1}:`);
        logger.info(`  ID: ${p.id}`);
        logger.info(`  Номер: ${p.fullnumber}`);
        logger.info(`  Покупатель: ${p.buyer_name || 'неизвестно'}`);
        logger.info(`  Deal ID: ${p.pipedrive_deal_id || 'НЕТ ❌'}`);
        logger.info(`  Статус: ${p.status || 'N/A'}`);
        
        if (p.pipedrive_deal_id) {
          logger.info(`  ✅ Ссылка: https://comoon.pipedrive.com/deal/${p.pipedrive_deal_id}`);
        } else {
          logger.warn(`  ⚠️  НЕТ ССЫЛКИ НА СДЕЛКУ`);
        }
      });
      logger.info('');
    }

    // 5. Общая статистика по проформам продукта "Single Lankowa"
    logger.info('5️⃣ ОБЩАЯ СТАТИСТИКА\n');
    
    if (products && products.length > 0) {
      const product = products[0];
      const { data: allProformaProducts, error: allPPError } = await supabase
        .from('proforma_products')
        .select('proforma_id')
        .eq('product_id', product.id);

      if (!allPPError && allProformaProducts) {
        const allProformaIds = allProformaProducts.map(pp => pp.proforma_id);
        const { data: allProformas, error: allProformasError } = await supabase
          .from('proformas')
          .select('id, fullnumber, buyer_name, pipedrive_deal_id, status, deleted_at')
          .in('id', allProformaIds);

        if (!allProformasError && allProformas) {
          const active = allProformas.filter(p => !p.deleted_at && p.status !== 'deleted');
          const withDeal = active.filter(p => p.pipedrive_deal_id);
          const withoutDeal = active.filter(p => !p.pipedrive_deal_id);

          logger.info(`Всего проформ в продукте "${product.name}": ${allProformas.length}`);
          logger.info(`  Активных: ${active.length}`);
          logger.info(`  С Deal ID: ${withDeal.length}`);
          logger.info(`  Без Deal ID: ${withoutDeal.length}`);

          if (withoutDeal.length > 0) {
            logger.warn(`\n⚠️  Проформы без Deal ID:`);
            withoutDeal.forEach(p => {
              logger.warn(`    - ${p.fullnumber || p.id} | ${p.buyer_name || 'неизвестно'}`);
            });
          }
        }
      }
    }

    logger.info('\n=== ПРОВЕРКА ЗАВЕРШЕНА ===\n');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

verifyAllLinks();



