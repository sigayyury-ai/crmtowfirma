/**
 * Исправление метаданных Stripe платежа для Deal #1849
 * 
 * Проблема: В метаданных Stripe указан product_id: 41, но в сделке используется продукт 1089
 * Нужно обновить метаданные, чтобы они соответствовали продукту из сделки
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

const DEAL_ID = '1849';
const CRM_PRODUCT_ID = '41'; // Продукт из метаданных Stripe

async function main() {
  logger.info('=== Исправление метаданных Stripe платежа для Deal #1849 ===\n');

  try {
    // 1. Получить информацию о сделке из Pipedrive
    logger.info('1. Получение информации о сделке из Pipedrive...');
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDeal(DEAL_ID);
    
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Не удалось получить сделку ${DEAL_ID} из Pipedrive: ${dealResult.error || 'Unknown error'}`);
    }

    const deal = dealResult.deal;
    logger.info(`   ✅ Сделка найдена: "${deal.title || 'Без названия'}"`);

    // 2. Получить продукты сделки
    logger.info('\n2. Получение продуктов сделки...');
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    
    if (!productsResult.success) {
      throw new Error(`Не удалось получить продукты сделки: ${productsResult.error || 'Unknown error'}`);
    }

    const dealProducts = productsResult.products || [];
    logger.info(`   ✅ Найдено продуктов в сделке: ${dealProducts.length}`);

    if (dealProducts.length === 0) {
      throw new Error('В сделке нет продуктов');
    }

    // Используем первый продукт из сделки
    const crmProduct = dealProducts[0];
    const crmProductId = String(crmProduct.product?.id || crmProduct.id);
    const crmProductName = crmProduct.name || crmProduct.product?.name || crmProduct.item_title || 'Без названия';
    
    logger.info(`   Используемый CRM продукт:`);
    logger.info(`     ID: ${crmProductId}`);
    logger.info(`     Name: "${crmProductName}"`);

    // 3. Найти Stripe платежи для Deal #1849
    logger.info('\n3. Поиск Stripe платежей для Deal #1849...');
    const stripeRepository = new StripeRepository();
    
    if (!stripeRepository.isEnabled()) {
      throw new Error('StripeRepository не настроен');
    }

    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, original_amount, amount_pln, currency, created_at, raw_payload')
      .eq('deal_id', DEAL_ID)
      .order('created_at', { ascending: false });

    if (stripeError) {
      throw new Error(`Ошибка при получении Stripe платежей: ${stripeError.message}`);
    }

    logger.info(`   ✅ Найдено Stripe платежей: ${stripePayments?.length || 0}`);

    if (!stripePayments || stripePayments.length === 0) {
      logger.warn('   ⚠️  Stripe платежи для Deal #1849 не найдены');
      return;
    }

    // 4. Найти или создать product_link для правильного CRM продукта
    logger.info('\n4. Поиск или создание product_link для CRM продукта...');
    
    let productLink = await stripeRepository.findProductLinkByCrmId(crmProductId);
    
    if (!productLink) {
      logger.info(`   Product link не найден, создаем новый...`);
      
      // Попробуем найти продукт в базе данных по названию
      const normalizedName = crmProductName.toLowerCase().trim();
      const { data: products, error: productsError } = await supabase
        .from('products')
        .select('id, name, normalized_name')
        .or(`name.ilike.%${crmProductName}%,normalized_name.ilike.%${normalizedName}%`)
        .limit(10);

      if (productsError) {
        logger.warn(`   Ошибка при поиске продукта в базе: ${productsError.message}`);
      }

      let campProductId = null;
      if (products && products.length > 0) {
        campProductId = products[0].id;
        logger.info(`   ✅ Найден продукт в базе: ID ${campProductId}, Name: "${products[0].name}"`);
      }

      productLink = await stripeRepository.upsertProductLink({
        crmProductId: crmProductId,
        crmProductName: crmProductName,
        stripeProductId: null,
        campProductId: campProductId,
        status: 'active'
      });

      if (!productLink) {
        throw new Error('Не удалось создать product_link');
      }

      logger.info(`   ✅ Product link создан: ID ${productLink.id}`);
    } else {
      logger.info(`   ✅ Product link найден: ID ${productLink.id}`);
    }

    // 5. Обновить Stripe платежи: product_id и метаданные
    logger.info('\n5. Обновление Stripe платежей...');
    
    let updatedCount = 0;
    let errorCount = 0;

    for (const payment of stripePayments) {
      try {
        // Проверяем метаданные
        const metadata = payment.raw_payload?.metadata || {};
        const metadataProductId = metadata.product_id ? String(metadata.product_id) : null;
        
        logger.info(`   Платеж ${payment.session_id || payment.id}:`);
        logger.info(`     Текущий product_id: ${payment.product_id || 'NULL'}`);
        logger.info(`     Metadata product_id: ${metadataProductId || 'NULL'}`);
        
        // Обновляем product_id на правильный product_link.id
        const needsProductIdUpdate = payment.product_id !== productLink.id;
        
        // Обновляем метаданные, если там указан неправильный product_id
        let needsMetadataUpdate = false;
        const newMetadata = { ...metadata };
        
        if (metadataProductId && metadataProductId !== crmProductId) {
          logger.info(`     Обновление metadata.product_id: ${metadataProductId} -> ${crmProductId}`);
          newMetadata.product_id = crmProductId;
          needsMetadataUpdate = true;
        }
        
        if (!metadata.crm_product_id || String(metadata.crm_product_id) !== crmProductId) {
          logger.info(`     Обновление metadata.crm_product_id: ${metadata.crm_product_id || 'NULL'} -> ${crmProductId}`);
          newMetadata.crm_product_id = crmProductId;
          needsMetadataUpdate = true;
        }
        
        if (!metadata.crm_product_name || metadata.crm_product_name !== crmProductName) {
          logger.info(`     Обновление metadata.crm_product_name: "${metadata.crm_product_name || 'NULL'}" -> "${crmProductName}"`);
          newMetadata.crm_product_name = crmProductName;
          needsMetadataUpdate = true;
        }

        if (!needsProductIdUpdate && !needsMetadataUpdate) {
          logger.info(`     ✅ Платеж уже обновлен`);
          continue;
        }

        // Обновляем платеж
        const updateData = {};
        
        if (needsProductIdUpdate) {
          updateData.product_id = productLink.id;
        }
        
        if (needsMetadataUpdate) {
          // Обновляем raw_payload с новыми метаданными
          const updatedPayload = {
            ...payment.raw_payload,
            metadata: newMetadata
          };
          updateData.raw_payload = updatedPayload;
        }

        const { error: updateError } = await supabase
          .from('stripe_payments')
          .update(updateData)
          .eq('id', payment.id);

        if (updateError) {
          logger.error(`     ❌ Ошибка при обновлении: ${updateError.message}`);
          errorCount++;
        } else {
          logger.info(`     ✅ Платеж обновлен`);
          if (needsProductIdUpdate) {
            logger.info(`        product_id: ${productLink.id}`);
          }
          if (needsMetadataUpdate) {
            logger.info(`        metadata обновлены`);
          }
          updatedCount++;
        }
      } catch (error) {
        logger.error(`     ❌ Ошибка: ${error.message}`);
        errorCount++;
      }
    }

    logger.info(`\n   Итого обновлено платежей: ${updatedCount}`);
    if (errorCount > 0) {
      logger.warn(`   Ошибок при обновлении: ${errorCount}`);
    }

    // 6. Создать product_link для CRM продукта 41, если он нужен
    logger.info('\n6. Создание product_link для CRM продукта 41 (если нужен)...');
    
    // Попробуем получить информацию о продукте 41 из Pipedrive
    try {
      const product41Result = await pipedriveClient.getProduct(CRM_PRODUCT_ID);
      if (product41Result.success && product41Result.product) {
        const product41Name = product41Result.product.name || 'Без названия';
        logger.info(`   ✅ CRM продукт 41 найден в Pipedrive: "${product41Name}"`);
        
        // Попробуем найти продукт в базе данных
        const normalizedName = product41Name.toLowerCase().trim();
        const { data: products, error: productsError } = await supabase
          .from('products')
          .select('id, name, normalized_name')
          .or(`name.ilike.%${product41Name}%,normalized_name.ilike.%${normalizedName}%`)
          .limit(10);

        let campProductId = null;
        if (products && products.length > 0) {
          campProductId = products[0].id;
          logger.info(`   ✅ Найден продукт в базе: ID ${campProductId}, Name: "${products[0].name}"`);
        }

        // Создаем product_link для продукта 41
        const productLink41 = await stripeRepository.upsertProductLink({
          crmProductId: CRM_PRODUCT_ID,
          crmProductName: product41Name,
          stripeProductId: null,
          campProductId: campProductId,
          status: 'active'
        });

        if (productLink41) {
          logger.info(`   ✅ Product link для CRM продукта 41 создан: ID ${productLink41.id}`);
        }
      } else {
        logger.warn(`   ⚠️  CRM продукт 41 не найден в Pipedrive`);
      }
    } catch (error) {
      logger.warn(`   ⚠️  Ошибка при получении продукта 41: ${error.message}`);
    }

    logger.info('\n✅ Исправление завершено!');
    logger.info('\nТеперь в ежемесячном отчете для Deal #1849 должен отображаться правильный продукт и правильная сумма.');

  } catch (error) {
    logger.error('\n❌ Ошибка при выполнении скрипта:', error);
    logger.error('Stack:', error.stack);
    process.exit(1);
  }
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



