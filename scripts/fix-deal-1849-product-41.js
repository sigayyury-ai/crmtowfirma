/**
 * Скрипт для исправления привязки продукта для Deal #1849 и CRM продукта 41
 * 
 * Проблема: В ежемесячном отчете (Payment Report) отображается имя "Gor Artashevich Davlyatshin" 
 * вместо правильного названия продукта для Deal #1849 с CRM продуктом 41.
 * 
 * Решение:
 * 1. Найти Stripe платежи для Deal #1849
 * 2. Найти правильный продукт для CRM продукта 41
 * 3. Создать или обновить product_link для связи CRM продукта 41 с правильным продуктом
 * 4. Обновить Stripe платежи, чтобы они ссылались на правильный product_link
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_ID = '1849';
const CRM_PRODUCT_ID = '41';

async function main() {
  logger.info('=== Исправление привязки продукта для Deal #1849 и CRM продукта 41 ===\n');

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
    logger.info(`   Person: ${deal.person_id?.name || 'Не указан'}`);

    // 2. Получить продукты сделки из Pipedrive
    logger.info('\n2. Получение продуктов сделки из Pipedrive...');
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    
    if (!productsResult.success) {
      throw new Error(`Не удалось получить продукты сделки: ${productsResult.error || 'Unknown error'}`);
    }

    const dealProducts = productsResult.products || [];
    logger.info(`   ✅ Найдено продуктов в сделке: ${dealProducts.length}`);

    if (dealProducts.length === 0) {
      throw new Error('В сделке нет продуктов');
    }

    // Найти продукт с ID 41
    const targetProduct = dealProducts.find(p => {
      const productId = p.product?.id || p.id;
      return String(productId) === CRM_PRODUCT_ID;
    });

    if (!targetProduct) {
      logger.warn(`   ⚠️  Продукт с ID ${CRM_PRODUCT_ID} не найден в сделке`);
      logger.info(`   Доступные продукты:`);
      dealProducts.forEach((p, i) => {
        const productId = p.product?.id || p.id;
        const productName = p.name || p.product?.name || p.item_title || 'Без названия';
        logger.info(`     ${i + 1}. ID: ${productId}, Name: "${productName}"`);
      });
      
      // Используем первый продукт, если продукт 41 не найден
      if (dealProducts.length > 0) {
        const firstProduct = dealProducts[0];
        const productId = firstProduct.product?.id || firstProduct.id;
        const productName = firstProduct.name || firstProduct.product?.name || firstProduct.item_title || 'Без названия';
        logger.info(`\n   Используем первый продукт: ID ${productId}, Name: "${productName}"`);
      } else {
        throw new Error('В сделке нет продуктов для использования');
      }
    }

    const crmProduct = targetProduct || dealProducts[0];
    const crmProductId = String(crmProduct.product?.id || crmProduct.id);
    const crmProductName = crmProduct.name || crmProduct.product?.name || crmProduct.item_title || 'Без названия';
    
    logger.info(`\n   Используемый CRM продукт:`);
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
      .select('id, session_id, deal_id, product_id, customer_name, company_name, original_amount, amount_pln, created_at, raw_payload')
      .eq('deal_id', DEAL_ID)
      .order('created_at', { ascending: false });

    if (stripeError) {
      throw new Error(`Ошибка при получении Stripe платежей: ${stripeError.message}`);
    }

    logger.info(`   ✅ Найдено Stripe платежей: ${stripePayments?.length || 0}`);

    if (!stripePayments || stripePayments.length === 0) {
      logger.warn('   ⚠️  Stripe платежи для Deal #1849 не найдены');
      logger.info('   Возможно, платежи еще не синхронизированы или сделка не связана со Stripe платежами');
      return;
    }

    // Показать информацию о найденных платежах
    stripePayments.forEach((payment, i) => {
      const customerName = payment.customer_name || payment.company_name || 'Неизвестно';
      const amount = payment.amount_pln || payment.original_amount || 0;
      logger.info(`     ${i + 1}. Session: ${payment.session_id || 'N/A'}, Customer: "${customerName}", Amount: ${amount} PLN`);
      logger.info(`        Product ID: ${payment.product_id || 'NULL'}`);
    });

    // 4. Найти или создать product_link для CRM продукта 41
    logger.info('\n4. Поиск или создание product_link для CRM продукта 41...');
    
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
        // Используем первый найденный продукт
        campProductId = products[0].id;
        logger.info(`   ✅ Найден продукт в базе: ID ${campProductId}, Name: "${products[0].name}"`);
      } else {
        logger.warn(`   ⚠️  Продукт "${crmProductName}" не найден в базе данных`);
        logger.info(`   Product link будет создан без camp_product_id`);
      }

      // Создаем product_link
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
      logger.info(`     CRM Product ID: ${productLink.crm_product_id || 'NULL'}`);
      logger.info(`     CRM Product Name: ${productLink.crm_product_name || 'NULL'}`);
      logger.info(`     Camp Product ID: ${productLink.camp_product_id || 'NULL'}`);

      // Обновляем название продукта, если оно изменилось
      if (productLink.crm_product_name !== crmProductName) {
        logger.info(`   Обновляем название продукта: "${productLink.crm_product_name}" → "${crmProductName}"`);
        productLink = await stripeRepository.upsertProductLink({
          crmProductId: crmProductId,
          crmProductName: crmProductName,
          stripeProductId: productLink.stripe_product_id || null,
          campProductId: productLink.camp_product_id || null,
          status: productLink.status || 'active'
        });
      }
    }

    // 5. Обновить Stripe платежи, чтобы они ссылались на правильный product_link
    logger.info('\n5. Обновление Stripe платежей...');
    
    let updatedCount = 0;
    let errorCount = 0;

    for (const payment of stripePayments) {
      if (payment.product_id === productLink.id) {
        logger.info(`   Платеж ${payment.session_id || payment.id} уже привязан к правильному product_link`);
        continue;
      }

      try {
        const { error: updateError } = await supabase
          .from('stripe_payments')
          .update({ product_id: productLink.id })
          .eq('id', payment.id);

        if (updateError) {
          logger.error(`   ❌ Ошибка при обновлении платежа ${payment.session_id || payment.id}: ${updateError.message}`);
          errorCount++;
        } else {
          logger.info(`   ✅ Платеж ${payment.session_id || payment.id} обновлен`);
          updatedCount++;
        }
      } catch (error) {
        logger.error(`   ❌ Ошибка при обновлении платежа ${payment.session_id || payment.id}: ${error.message}`);
        errorCount++;
      }
    }

    logger.info(`\n   Итого обновлено платежей: ${updatedCount}`);
    if (errorCount > 0) {
      logger.warn(`   Ошибок при обновлении: ${errorCount}`);
    }

    // 6. Проверка результата
    logger.info('\n6. Проверка результата...');
    const { data: updatedPayments, error: checkError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_name, amount_pln')
      .eq('deal_id', DEAL_ID);

    if (checkError) {
      logger.warn(`   ⚠️  Ошибка при проверке: ${checkError.message}`);
    } else {
      logger.info(`   ✅ Все платежи для Deal #1849:`);
      updatedPayments.forEach((payment, i) => {
        const customerName = payment.customer_name || 'Неизвестно';
        const amount = payment.amount_pln || 0;
        logger.info(`     ${i + 1}. Session: ${payment.session_id || 'N/A'}, Customer: "${customerName}", Amount: ${amount} PLN`);
        logger.info(`        Product ID: ${payment.product_id || 'NULL'} ${payment.product_id === productLink.id ? '✅' : '❌'}`);
      });
    }

    logger.info('\n✅ Исправление завершено!');
    logger.info(`\nТеперь в ежемесячном отчете для Deal #1849 должен отображаться продукт "${crmProductName}" вместо имени плательщика.`);

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

