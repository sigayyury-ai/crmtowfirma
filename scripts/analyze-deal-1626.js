require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function analyzeDeal1626() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('Анализирую Deal #1626 и связанную проформу CO-PROF 149/2025...');

    // 1. Найдем deal 1626
    const { data: deal, error: dealError } = await supabase
      .from('deals')
      .select('*')
      .eq('id', 1626)
      .single();

    if (dealError) {
      logger.error('Ошибка при поиске deal 1626:', dealError);
      return;
    }

    if (!deal) {
      logger.error('Deal 1626 не найден');
      return;
    }

    logger.info('Найден deal 1626:', {
      id: deal.id,
      title: deal.title,
      product_id: deal.product_id,
      status: deal.status
    });

    // 2. Найдем продукт NY2026
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .ilike('name', '%NY2026%')
      .single();

    if (productError && productError.code !== 'PGRST116') {
      logger.error('Ошибка при поиске продукта NY2026:', productError);
      return;
    }

    if (product) {
      logger.info('Найден продукт NY2026:', {
        id: product.id,
        name: product.name,
        normalized_name: product.normalized_name
      });
    } else {
      logger.warn('Продукт NY2026 не найден');
    }

    // 3. Найдем проформу CO-PROF 149/2025
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .or(`fullnumber.ilike.%CO-PROF 149/2025%,fullnumber.ilike.%149/2025%`)
      .single();

    if (proformaError && proformaError.code !== 'PGRST116') {
      logger.error('Ошибка при поиске проформы CO-PROF 149/2025:', proformaError);
      return;
    }

    if (proforma) {
      logger.info('Найдена проформа:', {
        id: proforma.id,
        fullnumber: proforma.fullnumber,
        deal_id: proforma.deal_id,
        product_id: proforma.product_id,
        status: proforma.status
      });
    } else {
      logger.warn('Проформа CO-PROF 149/2025 не найдена');

      // Попробуем найти по номеру 149
      const { data: proformas149, error: proformas149Error } = await supabase
        .from('proformas')
        .select('*')
        .ilike('fullnumber', '%149%');

      if (proformas149 && proformas149.length > 0) {
        logger.info('Найденные проформы с номером 149:');
        proformas149.forEach(p => {
          logger.info(`- ID: ${p.id}, fullnumber: ${p.fullnumber}, deal_id: ${p.deal_id}`);
        });
      }
    }

    // 4. Проверим связи в proforma_products
    if (proforma) {
      const { data: proformaProductLinks, error: linksError } = await supabase
        .from('proforma_products')
        .select('*')
        .eq('proforma_id', proforma.id);

      if (linksError) {
        logger.error('Ошибка при поиске связей proforma_products:', linksError);
      } else {
        logger.info('Связи proforma_products для проформы:');
        proformaProductLinks.forEach(link => {
          logger.info(`- proforma_id: ${link.proforma_id}, product_id: ${link.product_id}, quantity: ${link.quantity}`);
        });
      }
    }

    // 5. Проверим, правильно ли связан deal с продуктом
    if (deal.product_id && product && deal.product_id !== product.id) {
      logger.warn(`Deal ${deal.id} связан с продуктом ${deal.product_id}, но мы ищем продукт ${product.id} (NY2026)`);
    } else if (deal.product_id && product && deal.product_id === product.id) {
      logger.info(`Deal ${deal.id} правильно связан с продуктом ${product.id} (NY2026)`);
    }

    logger.info('Анализ завершен');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

analyzeDeal1626();
