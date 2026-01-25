/**
 * Исправление привязки продуктов для всех проблемных сделок
 * 
 * Исправляет:
 * - Deal #1849: CRM продукт 41 -> правильный продукт и amount_pln
 * - Deal #1714: CRM продукт 56 -> проверка и исправление
 * - Deal #1775: CRM продукт 59 -> проверка и исправление
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const exchangeRateService = require('../src/services/stripe/exchangeRateService');
const logger = require('../src/utils/logger');

const DEALS_TO_FIX = [
  { dealId: '1849', crmProductId: '41' },
  { dealId: '1714', crmProductId: '56' },
  { dealId: '1775', crmProductId: '59' }
];

async function fixDealProduct(dealId, expectedCrmProductId) {
  logger.info(`\n=== Исправление Deal #${dealId} ===`);

  try {
    // 1. Получить информацию о сделке
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDeal(dealId);
    
    if (!dealResult.success || !dealResult.deal) {
      logger.warn(`   ⚠️  Сделка ${dealId} не найдена в Pipedrive`);
      return { dealId, fixed: false, error: 'Deal not found' };
    }

    const deal = dealResult.deal;
    logger.info(`   Сделка: "${deal.title || 'Без названия'}"`);

    // 2. Получить продукты сделки
    const productsResult = await pipedriveClient.getDealProducts(dealId);
    if (!productsResult.success) {
      logger.warn(`   ⚠️  Не удалось получить продукты: ${productsResult.error}`);
      return { dealId, fixed: false, error: 'Failed to get products' };
    }

    const dealProducts = productsResult.products || [];
    if (dealProducts.length === 0) {
      logger.warn(`   ⚠️  В сделке нет продуктов`);
      return { dealId, fixed: false, error: 'No products in deal' };
    }

    // Используем первый продукт из сделки
    const crmProduct = dealProducts[0];
    const crmProductId = String(crmProduct.product?.id || crmProduct.id);
    const crmProductName = crmProduct.name || crmProduct.product?.name || crmProduct.item_title || 'Без названия';
    
    logger.info(`   CRM продукт в сделке: ID ${crmProductId}, Name: "${crmProductName}"`);

    // 3. Найти Stripe платежи
    const stripeRepository = new StripeRepository();
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, original_amount, amount_pln, currency, exchange_rate, created_at, raw_payload')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false });

    if (stripeError) {
      logger.warn(`   ⚠️  Ошибка при получении платежей: ${stripeError.message}`);
      return { dealId, fixed: false, error: stripeError.message };
    }

    if (!stripePayments || stripePayments.length === 0) {
      logger.info(`   ℹ️  Stripe платежи не найдены`);
      return { dealId, fixed: false, error: 'No Stripe payments' };
    }

    logger.info(`   Найдено Stripe платежей: ${stripePayments.length}`);

    // 4. Найти или создать product_link
    let productLink = await stripeRepository.findProductLinkByCrmId(crmProductId);
    
    if (!productLink) {
      // Попробуем найти продукт в базе
      const normalizedName = crmProductName.toLowerCase().trim();
      const { data: products } = await supabase
        .from('products')
        .select('id, name')
        .or(`name.ilike.%${crmProductName}%,normalized_name.ilike.%${normalizedName}%`)
        .limit(1);

      const campProductId = products && products.length > 0 ? products[0].id : null;
      
      productLink = await stripeRepository.upsertProductLink({
        crmProductId: crmProductId,
        crmProductName: crmProductName,
        stripeProductId: null,
        campProductId: campProductId,
        status: 'active'
      });
      
      if (productLink) {
        logger.info(`   ✅ Product link создан: ID ${productLink.id}`);
      }
    } else {
      logger.info(`   ✅ Product link найден: ID ${productLink.id}`);
    }

    let updatedCount = 0;
    let amountPlnFixed = 0;

    // 5. Обновить платежи
    for (const payment of stripePayments) {
      const updates = {};
      let needsUpdate = false;

      // Обновить product_id
      if (productLink && payment.product_id !== productLink.id) {
        updates.product_id = productLink.id;
        needsUpdate = true;
        logger.info(`     Обновление product_id: ${payment.product_id || 'NULL'} -> ${productLink.id}`);
      }

      // Обновить amount_pln если NULL
      if (payment.amount_pln === null || payment.amount_pln === undefined || payment.amount_pln === 0) {
        const originalAmount = Number(payment.original_amount) || 0;
        const currency = (payment.currency || 'PLN').toUpperCase();
        
        let amountPln = null;
        let exchangeRate = payment.exchange_rate;

        if (currency === 'PLN') {
          amountPln = originalAmount;
        } else if (exchangeRate && Number(exchangeRate) > 0) {
          amountPln = originalAmount * Number(exchangeRate);
        } else {
          try {
            exchangeRate = await exchangeRateService.getRate(currency, 'PLN');
            if (exchangeRate && exchangeRate > 0) {
              amountPln = originalAmount * exchangeRate;
            }
          } catch (error) {
            logger.warn(`     ⚠️  Не удалось получить курс для ${currency}: ${error.message}`);
          }
        }

        if (amountPln !== null && Number.isFinite(amountPln)) {
          amountPln = Math.round(amountPln * 100) / 100;
          updates.amount_pln = amountPln;
          if (exchangeRate && !payment.exchange_rate) {
            updates.exchange_rate = exchangeRate;
          }
          needsUpdate = true;
          amountPlnFixed++;
          logger.info(`     Обновление amount_pln: NULL -> ${amountPln} PLN`);
        }
      }

      // Обновить метаданные
      const metadata = payment.raw_payload?.metadata || {};
      const metadataProductId = metadata.product_id ? String(metadata.product_id) : null;
      
      if (metadataProductId !== crmProductId || !metadata.crm_product_id || metadata.crm_product_name !== crmProductName) {
        const newMetadata = {
          ...metadata,
          product_id: crmProductId,
          crm_product_id: crmProductId,
          crm_product_name: crmProductName
        };
        updates.raw_payload = {
          ...payment.raw_payload,
          metadata: newMetadata
        };
        needsUpdate = true;
        logger.info(`     Обновление metadata: product_id ${metadataProductId || 'NULL'} -> ${crmProductId}`);
      }

      if (needsUpdate) {
        const { error: updateError } = await supabase
          .from('stripe_payments')
          .update(updates)
          .eq('id', payment.id);

        if (updateError) {
          logger.error(`     ❌ Ошибка: ${updateError.message}`);
        } else {
          updatedCount++;
          logger.info(`     ✅ Платеж ${payment.session_id || payment.id} обновлен`);
        }
      } else {
        logger.info(`     ✅ Платеж ${payment.session_id || payment.id} уже корректен`);
      }
    }

    return {
      dealId,
      fixed: updatedCount > 0,
      updatedPayments: updatedCount,
      amountPlnFixed
    };

  } catch (error) {
    logger.error(`   ❌ Ошибка: ${error.message}`);
    return { dealId, fixed: false, error: error.message };
  }
}

async function main() {
  logger.info('=== Исправление привязки продуктов для всех проблемных сделок ===\n');

  const results = [];

  for (const { dealId, crmProductId } of DEALS_TO_FIX) {
    const result = await fixDealProduct(dealId, crmProductId);
    results.push(result);
  }

  logger.info('\n=== Итоги ===\n');
  results.forEach(result => {
    if (result.fixed) {
      logger.info(`✅ Deal #${result.dealId}: обновлено платежей ${result.updatedPayments}, исправлено amount_pln: ${result.amountPlnFixed}`);
    } else {
      logger.info(`ℹ️  Deal #${result.dealId}: ${result.error || 'не требует исправления'}`);
    }
  });

  logger.info('\n✅ Исправление завершено!');
  logger.info('\nТеперь в ежемесячном отчете должны отображаться правильные продукты и суммы.');
}

if (require.main === module) {
  main().then(() => {
    process.exit(0);
  }).catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };



