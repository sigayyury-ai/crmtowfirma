#!/usr/bin/env node

/**
 * Исправление проформы CO-PROF 149/2025:
 * 1. Связывание со сделкой 1606
 * 2. Исправление продукта (получение правильного продукта из сделки)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const PROFORMA_FULLNUMBER = 'CO-PROF 149/2025';
const DEAL_ID = 1606;

async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ ПРОФОРМЫ CO-PROF 149/2025');
    console.log(`   Связывание со сделкой: ${DEAL_ID}`);
    console.log('='.repeat(80));
    
    // 1. Находим проформу
    console.log('\n🔍 Поиск проформы...');
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id, total, currency')
      .eq('fullnumber', PROFORMA_FULLNUMBER)
      .single();
    
    if (proformaError || !proforma) {
      logger.error('Проформа не найдена:', proformaError);
      process.exit(1);
    }
    
    console.log(`   ✅ Проформа найдена:`);
    console.log(`      ID: ${proforma.id}`);
    console.log(`      Номер: ${proforma.fullnumber}`);
    console.log(`      Текущий Deal ID: ${proforma.pipedrive_deal_id || 'не установлен'}`);
    console.log(`      Сумма: ${proforma.total} ${proforma.currency}`);
    
    // 2. Получаем информацию о сделке из Pipedrive
    console.log(`\n📥 Получение данных сделки #${DEAL_ID} из Pipedrive...`);
    const pipedriveClient = new PipedriveClient();
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    
    if (!dealResult.success) {
      logger.error('Ошибка получения данных сделки:', dealResult.error);
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    console.log(`   ✅ Сделка найдена:`);
    console.log(`      ID: ${deal.id}`);
    console.log(`      Title: ${deal.title}`);
    console.log(`      Value: ${deal.value} ${deal.currency}`);
    
    // 3. Получаем продукты сделки
    console.log(`\n📦 Получение продуктов сделки...`);
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    
    if (!productsResult.success) {
      logger.error('Ошибка получения продуктов:', productsResult.error);
      process.exit(1);
    }
    
    const dealProducts = productsResult.products || [];
    console.log(`   ✅ Найдено продуктов: ${dealProducts.length}`);
    
    if (dealProducts.length === 0) {
      console.log(`   ⚠️  В сделке нет продуктов. Нужно указать продукт вручную.`);
      console.log(`   Пожалуйста, укажите ID правильного продукта для проформы.`);
      process.exit(1);
    }
    
    // Берем первый продукт (обычно в сделке один продукт)
    const dealProduct = dealProducts[0];
    const productName = dealProduct.name || dealProduct.product?.name || dealProduct.item_title || 'Unknown';
    console.log(`   📦 Продукт сделки: "${productName}"`);
    
    // 4. Ищем продукт в базе данных по названию
    console.log(`\n🔍 Поиск продукта в базе данных...`);
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, normalized_name')
      .or(`name.ilike.%${productName}%,normalized_name.ilike.%${productName}%`)
      .limit(5);
    
    if (productsError) {
      logger.error('Ошибка поиска продукта:', productsError);
      process.exit(1);
    }
    
    if (!products || products.length === 0) {
      console.log(`   ⚠️  Продукт "${productName}" не найден в базе данных.`);
      console.log(`   Доступные продукты из сделки:`);
      dealProducts.forEach((p, i) => {
        const name = p.name || p.product?.name || p.item_title || 'Unknown';
        console.log(`      ${i + 1}. ${name}`);
      });
      console.log(`   Пожалуйста, укажите ID правильного продукта вручную.`);
      process.exit(1);
    }
    
    // Если найдено несколько продуктов, берем первый (или можно добавить логику выбора)
    const correctProduct = products[0];
    console.log(`   ✅ Продукт найден:`);
    console.log(`      ID: ${correctProduct.id}`);
    console.log(`      Name: ${correctProduct.name}`);
    
    // 5. Проверяем текущие связи проформы с продуктами
    console.log(`\n📋 Текущие связи проформы с продуктами:`);
    const { data: currentLinks, error: linksError } = await supabase
      .from('proforma_products')
      .select('id, product_id, name, products(id, name)')
      .eq('proforma_id', proforma.id);
    
    if (linksError) {
      logger.error('Ошибка при получении связей:', linksError);
      process.exit(1);
    }
    
    if (!currentLinks || currentLinks.length === 0) {
      console.log(`   ⚠️  Связи не найдены.`);
    } else {
      console.log(`   ✅ Найдено связей: ${currentLinks.length}`);
      currentLinks.forEach((link, i) => {
        const product = link.products;
        console.log(`      ${i + 1}. Link ID: ${link.id}, Product ID: ${link.product_id}, Name: "${product?.name || link.name || 'N/A'}"`);
      });
    }
    
    // 6. Обновляем pipedrive_deal_id
    console.log(`\n🔗 Обновление связи со сделкой...`);
    const needsDealUpdate = proforma.pipedrive_deal_id !== String(DEAL_ID);
    
    if (needsDealUpdate) {
      const { data: updatedProforma, error: updateDealError } = await supabase
        .from('proformas')
        .update({
          pipedrive_deal_id: String(DEAL_ID),
          updated_at: new Date().toISOString()
        })
        .eq('id', proforma.id)
        .select('id, fullnumber, pipedrive_deal_id')
        .single();
      
      if (updateDealError) {
        logger.error('Ошибка при обновлении связи со сделкой:', updateDealError);
        process.exit(1);
      }
      
      console.log(`   ✅ Проформа связана со сделкой ${DEAL_ID}`);
    } else {
      console.log(`   ✅ Проформа уже связана со сделкой ${DEAL_ID}`);
    }
    
    // 7. Проверяем, нужно ли исправлять продукт
    const needsProductFix = !currentLinks || currentLinks.length === 0 || 
                           currentLinks.some(link => link.product_id !== correctProduct.id);
    
    if (!needsProductFix) {
      console.log(`\n✅ Проформа уже связана с правильным продуктом!`);
      console.log('\n' + '='.repeat(80));
      console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО');
      console.log('='.repeat(80));
      console.log(`\nПроформа ${PROFORMA_FULLNUMBER} связана со сделкой ${DEAL_ID} и продуктом "${correctProduct.name}"\n`);
      process.exit(0);
    }
    
    // 8. Исправляем связи с продуктом
    console.log(`\n🔧 Исправление связей с продуктом...`);
    
    // Удаляем старые связи
    if (currentLinks && currentLinks.length > 0) {
      const linkIds = currentLinks.map(link => link.id);
      console.log(`   🗑️  Удаление ${linkIds.length} старых связей...`);
      
      const { error: deleteError } = await supabase
        .from('proforma_products')
        .delete()
        .in('id', linkIds);
      
      if (deleteError) {
        logger.error('Ошибка при удалении старых связей:', deleteError);
        process.exit(1);
      }
      
      console.log(`   ✅ Старые связи удалены`);
    }
    
    // Создаем новую правильную связь
    console.log(`   ➕ Создание новой связи с продуктом "${correctProduct.name}"...`);
    
    const unitPrice = proforma.total || 0;
    
    const { data: newLink, error: insertError } = await supabase
      .from('proforma_products')
      .insert({
        proforma_id: proforma.id,
        product_id: correctProduct.id,
        name: correctProduct.name,
        quantity: 1,
        unit_price: unitPrice,
        line_total: unitPrice
      })
      .select('id, product_id, name, products(id, name)')
      .single();
    
    if (insertError) {
      logger.error('Ошибка при создании новой связи:', insertError);
      process.exit(1);
    }
    
    console.log(`   ✅ Новая связь создана:`);
    console.log(`      Link ID: ${newLink.id}`);
    console.log(`      Product: ${newLink.products?.name || newLink.name || 'N/A'}`);
    
    // 9. Проверяем финальный результат
    console.log(`\n📋 Финальная проверка...`);
    const { data: finalProforma, error: finalProformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id')
      .eq('id', proforma.id)
      .single();
    
    const { data: finalLinks, error: finalError } = await supabase
      .from('proforma_products')
      .select('id, product_id, products(id, name)')
      .eq('proforma_id', proforma.id);
    
    if (!finalError && finalLinks) {
      console.log(`   ✅ Проформа:`);
      console.log(`      ID: ${finalProforma.id}`);
      console.log(`      Номер: ${finalProforma.fullnumber}`);
      console.log(`      Deal ID: ${finalProforma.pipedrive_deal_id}`);
      console.log(`   ✅ Связи проформы с продуктами:`);
      finalLinks.forEach((link, i) => {
        const product = link.products;
        console.log(`      ${i + 1}. Product ID: ${link.product_id}, Name: "${product?.name || 'N/A'}"`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО');
    console.log('='.repeat(80));
    console.log(`\nПроформа ${PROFORMA_FULLNUMBER} теперь:`);
    console.log(`   - Связана со сделкой ${DEAL_ID} (${deal.title})`);
    console.log(`   - Связана с продуктом "${correctProduct.name}" (ID: ${correctProduct.id})`);
    console.log(`\nПлатежи из этой проформы теперь будут отображаться в отчете продукта "${correctProduct.name}"\n`);
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();





