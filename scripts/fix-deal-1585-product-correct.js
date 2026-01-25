#!/usr/bin/env node

/**
 * Исправление связи платежа с правильным продуктом для Deal #1585
 * 
 * Проблема: Платеж связан с NY2026, но в сделке продукт "Single Spain"
 * Нужно найти продукт "Single Spain" и связать платеж с ним
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PaymentProductLinkService = require('../src/services/payments/paymentProductLinkService');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_ID = 1585;
const PAYMENT_ID = 2944;
const CORRECT_PRODUCT_NAME = 'Single Spain';

async function findProductByName(productName) {
  console.log(`\n🔍 Поиск продукта "${productName}"...`);
  
  // Ищем по точному совпадению имени
  const { data: exactMatch, error: exactError } = await supabase
    .from('products')
    .select('id, name, normalized_name, calculation_status')
    .ilike('name', productName)
    .limit(5);
  
  if (!exactError && exactMatch && exactMatch.length > 0) {
    console.log(`   ✅ Найдено точных совпадений: ${exactMatch.length}`);
    exactMatch.forEach((p, i) => {
      console.log(`      ${i + 1}. ID: ${p.id}, Name: "${p.name}", Status: ${p.calculation_status}`);
    });
    
    // Предпочитаем in_progress
    const inProgressProduct = exactMatch.find(p => p.calculation_status === 'in_progress');
    if (inProgressProduct) {
      return inProgressProduct;
    }
    
    return exactMatch[0];
  }
  
  // Ищем по частичному совпадению
  const normalizedName = productName.toLowerCase().replace(/\s+/g, ' ').trim();
  const { data: partialMatch, error: partialError } = await supabase
    .from('products')
    .select('id, name, normalized_name, calculation_status')
    .or(`name.ilike.%${productName}%,normalized_name.ilike.%${normalizedName}%`)
    .limit(10);
  
  if (!partialError && partialMatch && partialMatch.length > 0) {
    console.log(`   ✅ Найдено частичных совпадений: ${partialMatch.length}`);
    partialMatch.forEach((p, i) => {
      console.log(`      ${i + 1}. ID: ${p.id}, Name: "${p.name}", Status: ${p.calculation_status}`);
    });
    
    // Предпочитаем in_progress
    const inProgressProduct = partialMatch.find(p => p.calculation_status === 'in_progress');
    if (inProgressProduct) {
      return inProgressProduct;
    }
    
    return partialMatch[0];
  }
  
  console.log(`   ❌ Продукт не найден`);
  return null;
}

async function main() {
  try {
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ СВЯЗИ ПЛАТЕЖА С ПРАВИЛЬНЫМ ПРОДУКТОМ');
    console.log(`   Deal #${DEAL_ID} | Payment ID: ${PAYMENT_ID}`);
    console.log(`   Правильный продукт: ${CORRECT_PRODUCT_NAME}`);
    console.log('='.repeat(80));
    
    // 1. Проверяем текущую связь
    console.log('\n📋 Текущая связь платежа:');
    const linkService = new PaymentProductLinkService();
    const currentLink = await linkService.getLinkByPayment(PAYMENT_ID);
    
    if (currentLink) {
      console.log(`   Product ID: ${currentLink.product_id}`);
      console.log(`   Product Name: ${currentLink.product?.name || 'N/A'}`);
      console.log(`   Linked at: ${currentLink.linked_at}`);
    } else {
      console.log(`   ⚠️  Связь не найдена`);
    }
    
    // 2. Проверяем продукт в сделке Pipedrive
    console.log('\n📦 Продукт в сделке Pipedrive:');
    const pipedriveClient = new PipedriveClient();
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    
    if (!productsResult.success || !productsResult.products || productsResult.products.length === 0) {
      console.log(`   ❌ Продукты не найдены в сделке`);
      process.exit(1);
    }
    
    const pipedriveProduct = productsResult.products[0];
    console.log(`   Product ID: ${pipedriveProduct.id}`);
    console.log(`   Name: ${pipedriveProduct.name}`);
    
    if (pipedriveProduct.name !== CORRECT_PRODUCT_NAME) {
      console.log(`   ⚠️  ВНИМАНИЕ: Название продукта в Pipedrive "${pipedriveProduct.name}" не совпадает с ожидаемым "${CORRECT_PRODUCT_NAME}"`);
      console.log(`   Используем продукт из Pipedrive: "${pipedriveProduct.name}"`);
    }
    
    // 3. Ищем продукт в базе данных
    const correctProduct = await findProductByName(pipedriveProduct.name);
    
    if (!correctProduct) {
      console.log(`\n❌ Не удалось найти продукт "${pipedriveProduct.name}" в базе данных`);
      console.log(`   Требуется создать продукт или проверить название`);
      process.exit(1);
    }
    
    console.log(`\n✅ Найден правильный продукт:`);
    console.log(`   ID: ${correctProduct.id}`);
    console.log(`   Name: ${correctProduct.name}`);
    console.log(`   Status: ${correctProduct.calculation_status}`);
    
    // 4. Проверяем, нужно ли исправлять
    if (currentLink && currentLink.product_id === correctProduct.id) {
      console.log(`\n✅ Платеж уже связан с правильным продуктом!`);
      process.exit(0);
    }
    
    // 5. Исправляем связь
    console.log(`\n🔧 Исправление связи...`);
    
    // Удаляем старую связь если есть
    if (currentLink) {
      console.log(`   🗑️  Удаление старой связи с продуктом "${currentLink.product?.name || currentLink.product_id}"...`);
      await linkService.removeLink({ paymentId: PAYMENT_ID });
      console.log(`   ✅ Старая связь удалена`);
    }
    
    // Создаем новую правильную связь
    console.log(`   ➕ Создание новой связи с продуктом "${correctProduct.name}"...`);
    const newLink = await linkService.createLink({
      paymentId: PAYMENT_ID,
      productId: correctProduct.id,
      linkedBy: 'fix-deal-1585-correct-product-script'
    });
    
    console.log(`   ✅ Новая связь создана:`);
    console.log(`      Link ID: ${newLink.id}`);
    console.log(`      Product: ${newLink.product?.name || 'N/A'}`);
    console.log(`      Linked at: ${newLink.linked_at}`);
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО');
    console.log('='.repeat(80));
    console.log(`\nПлатеж ID ${PAYMENT_ID} теперь связан с продуктом "${correctProduct.name}" (ID: ${correctProduct.id})`);
    console.log(`Соответствует продукту в сделке Pipedrive: "${pipedriveProduct.name}"\n`);
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();






