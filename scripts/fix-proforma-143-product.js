#!/usr/bin/env node

/**
 * Исправление связи проформы CO-PROF 143/2025 с правильным продуктом
 * 
 * Проблема: Проформа связана с NY2026, но должна быть связана с Single Spain
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const PROFORMA_FULLNUMBER = 'CO-PROF 143/2025';
const CORRECT_PRODUCT_ID = 22; // Single Spain
const CORRECT_PRODUCT_NAME = 'Single Spain';

async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ СВЯЗИ ПРОФОРМЫ С ПРОДУКТОМ');
    console.log(`   Проформа: ${PROFORMA_FULLNUMBER}`);
    console.log(`   Правильный продукт: ${CORRECT_PRODUCT_NAME} (ID: ${CORRECT_PRODUCT_ID})`);
    console.log('='.repeat(80));
    
    // 1. Находим проформу
    console.log('\n🔍 Поиск проформы...');
    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id')
      .eq('fullnumber', PROFORMA_FULLNUMBER)
      .single();
    
    if (proformaError || !proforma) {
      logger.error('Проформа не найдена:', proformaError);
      process.exit(1);
    }
    
    console.log(`   ✅ Проформа найдена:`);
    console.log(`      ID: ${proforma.id}`);
    console.log(`      Номер: ${proforma.fullnumber}`);
    console.log(`      Deal ID: ${proforma.pipedrive_deal_id}`);
    
    // 2. Проверяем текущие связи проформы с продуктами
    console.log('\n📋 Текущие связи проформы с продуктами:');
    const { data: currentLinks, error: linksError } = await supabase
      .from('proforma_products')
      .select('id, product_id, products(id, name)')
      .eq('proforma_id', proforma.id);
    
    if (linksError) {
      logger.error('Ошибка при получении связей:', linksError);
      process.exit(1);
    }
    
    if (!currentLinks || currentLinks.length === 0) {
      console.log(`   ⚠️  Связи не найдены. Создаем новую связь...`);
    } else {
      console.log(`   ✅ Найдено связей: ${currentLinks.length}`);
      currentLinks.forEach((link, i) => {
        const product = link.products;
        console.log(`      ${i + 1}. Link ID: ${link.id}, Product ID: ${link.product_id}, Name: "${product?.name || 'N/A'}"`);
      });
    }
    
    // 3. Проверяем правильный продукт
    console.log('\n🔍 Проверка правильного продукта...');
    const { data: correctProduct, error: productError } = await supabase
      .from('products')
      .select('id, name, calculation_status')
      .eq('id', CORRECT_PRODUCT_ID)
      .single();
    
    if (productError || !correctProduct) {
      logger.error('Правильный продукт не найден:', productError);
      process.exit(1);
    }
    
    console.log(`   ✅ Продукт найден:`);
    console.log(`      ID: ${correctProduct.id}`);
    console.log(`      Name: ${correctProduct.name}`);
    console.log(`      Status: ${correctProduct.calculation_status}`);
    
    // 4. Проверяем, нужно ли исправлять
    const needsFix = !currentLinks || currentLinks.length === 0 || 
                     currentLinks.some(link => link.product_id !== CORRECT_PRODUCT_ID);
    
    if (!needsFix) {
      console.log(`\n✅ Проформа уже связана с правильным продуктом!`);
      process.exit(0);
    }
    
    // 5. Исправляем связи
    console.log(`\n🔧 Исправление связей...`);
    
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
    
    // Получаем данные проформы для расчета суммы
    const { data: proformaDetails, error: proformaDetailsError } = await supabase
      .from('proformas')
      .select('total, currency')
      .eq('id', proforma.id)
      .single();
    
    const unitPrice = proformaDetails?.total || 0;
    
    const { data: newLink, error: insertError } = await supabase
      .from('proforma_products')
      .insert({
        proforma_id: proforma.id,
        product_id: CORRECT_PRODUCT_ID,
        name: correctProduct.name,
        quantity: 1,
        unit_price: unitPrice,
        line_total: unitPrice
      })
      .select('id, product_id, products(id, name)')
      .single();
    
    if (insertError) {
      logger.error('Ошибка при создании новой связи:', insertError);
      process.exit(1);
    }
    
    console.log(`   ✅ Новая связь создана:`);
    console.log(`      Link ID: ${newLink.id}`);
    console.log(`      Product: ${newLink.products?.name || 'N/A'}`);
    
    // 6. Проверяем финальный результат
    console.log(`\n📋 Финальная проверка...`);
    const { data: finalLinks, error: finalError } = await supabase
      .from('proforma_products')
      .select('id, product_id, products(id, name)')
      .eq('proforma_id', proforma.id);
    
    if (!finalError && finalLinks) {
      console.log(`   ✅ Связи проформы с продуктами:`);
      finalLinks.forEach((link, i) => {
        const product = link.products;
        console.log(`      ${i + 1}. Product ID: ${link.product_id}, Name: "${product?.name || 'N/A'}"`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО');
    console.log('='.repeat(80));
    console.log(`\nПроформа ${PROFORMA_FULLNUMBER} теперь связана с продуктом "${CORRECT_PRODUCT_NAME}" (ID: ${CORRECT_PRODUCT_ID})`);
    console.log(`Платежи из этой проформы теперь будут отображаться в отчете продукта "${CORRECT_PRODUCT_NAME}"\n`);
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

