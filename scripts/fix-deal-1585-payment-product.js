#!/usr/bin/env node

/**
 * Исправление связи платежа с продуктом для Deal #1585
 * 
 * Проблема: Платеж от Siergiej Żarkiewicz на сумму 1 424,00 PLN от 04.01.2026
 * попал не в тот продукт для проформы CO-PROF 143/2025
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PaymentProductLinkService = require('../src/services/payments/paymentProductLinkService');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_ID = 1585;
const PROFORMA_FULLNUMBER = 'CO-PROF 143/2025';
const PAYER_NAME = 'Siergiej Żarkiewicz';
const PAYMENT_AMOUNT = 1424.00;
const PAYMENT_DATE = '2026-01-04';

async function findPayment() {
  console.log('\n🔍 Поиск платежа...');
  console.log(`   Плательщик: ${PAYER_NAME}`);
  console.log(`   Сумма: ${PAYMENT_AMOUNT} PLN`);
  console.log(`   Дата: ${PAYMENT_DATE}`);
  
  // Ищем проформу
  const { data: proforma, error: proformaError } = await supabase
    .from('proformas')
    .select('id, fullnumber, buyer_name, pipedrive_deal_id, total, currency')
    .eq('fullnumber', PROFORMA_FULLNUMBER)
    .single();
  
  if (proformaError || !proforma) {
    logger.error('Проформа не найдена:', proformaError);
    return null;
  }
  
  console.log(`\n✅ Проформа найдена:`);
  console.log(`   ID: ${proforma.id}`);
  console.log(`   Номер: ${proforma.fullnumber}`);
  console.log(`   Плательщик: ${proforma.buyer_name}`);
  console.log(`   Deal ID: ${proforma.pipedrive_deal_id}`);
  console.log(`   Сумма: ${proforma.total} ${proforma.currency}`);
  
  // Ищем платежи, связанные с проформой
  const { data: payments, error: paymentsError } = await supabase
    .from('payments')
    .select(`
      id,
      operation_date,
      payer_name,
      amount,
      currency,
      proforma_id,
      manual_proforma_fullnumber,
      source,
      match_status,
      manual_status
    `)
    .or(`proforma_id.eq.${proforma.id},manual_proforma_fullnumber.eq.${PROFORMA_FULLNUMBER}`)
    .order('operation_date', { ascending: false });
  
  if (paymentsError) {
    logger.error('Ошибка при поиске платежей:', paymentsError);
    return null;
  }
  
  console.log(`\n💳 Найдено платежей: ${payments.length}`);
  
  // Фильтруем по критериям (более гибкий поиск)
  const targetPayment = payments.find(p => {
    const amountMatch = Math.abs(parseFloat(p.amount) - PAYMENT_AMOUNT) < 0.01;
    const dateMatch = p.operation_date && p.operation_date.startsWith(PAYMENT_DATE);
    
    // Если есть payer_name, проверяем совпадение, иначе пропускаем эту проверку
    const payerMatch = !p.payer_name || 
      p.payer_name.toLowerCase().includes(PAYER_NAME.toLowerCase()) ||
      PAYER_NAME.toLowerCase().includes(p.payer_name.toLowerCase());
    
    return payerMatch && amountMatch && dateMatch;
  });
  
  if (!targetPayment) {
    console.log('\n⚠️  Точный платеж не найден. Доступные платежи:');
    payments.forEach((p, i) => {
      console.log(`\n   ${i + 1}. ID: ${p.id}`);
      console.log(`      Плательщик: ${p.payer_name || 'N/A'}`);
      console.log(`      Сумма: ${p.amount} ${p.currency}`);
      console.log(`      Дата: ${p.operation_date || 'N/A'}`);
      console.log(`      Проформа ID: ${p.proforma_id || 'N/A'}`);
      console.log(`      Manual proforma: ${p.manual_proforma_fullnumber || 'N/A'}`);
    });
    return null;
  }
  
  console.log(`\n✅ Найден целевой платеж:`);
  console.log(`   ID: ${targetPayment.id}`);
  console.log(`   Плательщик: ${targetPayment.payer_name}`);
  console.log(`   Сумма: ${targetPayment.amount} ${targetPayment.currency}`);
  console.log(`   Дата: ${targetPayment.operation_date}`);
  
  return { proforma, payment: targetPayment };
}

async function findCorrectProduct(proforma, dealId) {
  console.log('\n🔍 Определение правильного продукта...');
  
  // Стратегия поиска:
  // 1. Из продуктов в проформе (proforma_products)
  // 2. Из продуктов в Pipedrive сделке
  // 3. По названию продукта из Pipedrive
  
  let correctProductId = null;
  let source = null;
  
  // 1. Проверяем продукты в проформе
  const { data: proformaProducts, error: ppError } = await supabase
    .from('proforma_products')
    .select('product_id, products(id, name, normalized_name)')
    .eq('proforma_id', proforma.id)
    .limit(10);
  
  if (!ppError && proformaProducts && proformaProducts.length > 0) {
    // Берем первый продукт со статусом in_progress
    for (const pp of proformaProducts) {
      if (pp.product_id) {
        const { data: product } = await supabase
          .from('products')
          .select('id, name, calculation_status')
          .eq('id', pp.product_id)
          .single();
        
        if (product && product.calculation_status === 'in_progress') {
          correctProductId = product.id;
          source = `проформа ${proforma.fullnumber}`;
          console.log(`   ✅ Найден продукт из проформы: ID ${correctProductId}, "${product.name}"`);
          break;
        }
      }
    }
    
    // Если не нашли in_progress, берем первый доступный
    if (!correctProductId && proformaProducts[0].product_id) {
      const { data: product } = await supabase
        .from('products')
        .select('id, name')
        .eq('id', proformaProducts[0].product_id)
        .single();
      
      if (product) {
        correctProductId = product.id;
        source = `проформа ${proforma.fullnumber} (первый продукт)`;
        console.log(`   ✅ Найден продукт из проформы: ID ${correctProductId}, "${product.name}"`);
      }
    }
  }
  
  // 2. Если не нашли в проформе, проверяем продукты в Pipedrive
  if (!correctProductId && dealId) {
    try {
      const pipedriveClient = new PipedriveClient();
      const dealResult = await pipedriveClient.getDealWithRelatedData(String(dealId));
      
      if (dealResult.success && dealResult.deal && dealResult.deal.products && dealResult.deal.products.length > 0) {
        const pipedriveProduct = dealResult.deal.products[0];
        console.log(`   📦 Продукт в Pipedrive: "${pipedriveProduct.name}" (ID: ${pipedriveProduct.id})`);
        
        // Ищем продукт в базе по названию или CRM ID
        const { data: products } = await supabase
          .from('products')
          .select('id, name, normalized_name, calculation_status')
          .or(`name.ilike.%${pipedriveProduct.name}%,normalized_name.ilike.%${pipedriveProduct.name}%`)
          .limit(5);
        
        if (products && products.length > 0) {
          // Предпочитаем in_progress
          const inProgressProduct = products.find(p => p.calculation_status === 'in_progress');
          if (inProgressProduct) {
            correctProductId = inProgressProduct.id;
            source = `Pipedrive product "${pipedriveProduct.name}" (in_progress)`;
            console.log(`   ✅ Найден продукт из Pipedrive: ID ${correctProductId}, "${inProgressProduct.name}"`);
          } else {
            correctProductId = products[0].id;
            source = `Pipedrive product "${pipedriveProduct.name}"`;
            console.log(`   ✅ Найден продукт из Pipedrive: ID ${correctProductId}, "${products[0].name}"`);
          }
        }
      }
    } catch (error) {
      console.log(`   ⚠️  Ошибка при получении данных из Pipedrive: ${error.message}`);
    }
  }
  
  if (!correctProductId) {
    console.log(`   ❌ Не удалось определить правильный продукт автоматически`);
    return null;
  }
  
  return { productId: correctProductId, source };
}

async function checkCurrentLink(paymentId) {
  console.log('\n🔍 Проверка текущей связи платежа с продуктом...');
  
  const linkService = new PaymentProductLinkService();
  const currentLink = await linkService.getLinkByPayment(paymentId);
  
  if (currentLink) {
    console.log(`   ⚠️  Текущая связь:`);
    console.log(`      Product ID: ${currentLink.product_id}`);
    console.log(`      Product Name: ${currentLink.product?.name || 'N/A'}`);
    console.log(`      Linked at: ${currentLink.linked_at}`);
    console.log(`      Linked by: ${currentLink.linked_by || 'N/A'}`);
    return currentLink;
  } else {
    console.log(`   ℹ️  Текущей связи не найдено`);
    return null;
  }
}

async function fixProductLink(paymentId, correctProduct) {
  console.log('\n🔧 Исправление связи платежа с продуктом...');
  console.log(`   Payment ID: ${paymentId}`);
  console.log(`   Правильный Product ID: ${correctProduct.productId} (из ${correctProduct.source})`);
  
  const linkService = new PaymentProductLinkService();
  
  try {
    // Удаляем старую связь если есть
    const currentLink = await linkService.getLinkByPayment(paymentId);
    if (currentLink) {
      console.log(`   🗑️  Удаление старой связи...`);
      await linkService.removeLink({ paymentId });
      console.log(`   ✅ Старая связь удалена`);
    }
    
    // Создаем новую правильную связь
    console.log(`   ➕ Создание новой связи...`);
    const newLink = await linkService.createLink({
      paymentId,
      productId: correctProduct.productId,
      linkedBy: 'fix-deal-1585-script'
    });
    
    console.log(`   ✅ Новая связь создана:`);
    console.log(`      Link ID: ${newLink.id}`);
    console.log(`      Product: ${newLink.product?.name || 'N/A'}`);
    console.log(`      Linked at: ${newLink.linked_at}`);
    
    return true;
  } catch (error) {
    logger.error('Ошибка при исправлении связи:', error);
    console.log(`   ❌ Ошибка: ${error.message}`);
    return false;
  }
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ СВЯЗИ ПЛАТЕЖА С ПРОДУКТОМ');
    console.log(`   Deal #${DEAL_ID} | ${PROFORMA_FULLNUMBER}`);
    console.log('='.repeat(80));
    
    // 1. Находим платеж
    const data = await findPayment();
    if (!data) {
      console.log('\n❌ Не удалось найти платеж. Проверьте данные.');
      process.exit(1);
    }
    
    const { proforma, payment } = data;
    
    // 2. Определяем правильный продукт
    const correctProduct = await findCorrectProduct(proforma, proforma.pipedrive_deal_id || DEAL_ID);
    if (!correctProduct) {
      console.log('\n❌ Не удалось определить правильный продукт. Требуется ручная проверка.');
      process.exit(1);
    }
    
    // 3. Проверяем текущую связь
    const currentLink = await checkCurrentLink(payment.id);
    
    if (currentLink && currentLink.product_id === correctProduct.productId) {
      console.log('\n✅ Платеж уже связан с правильным продуктом!');
      process.exit(0);
    }
    
    // 4. Исправляем связь
    const success = await fixProductLink(payment.id, correctProduct);
    
    if (success) {
      console.log('\n' + '='.repeat(80));
      console.log('✅ ИСПРАВЛЕНИЕ ЗАВЕРШЕНО УСПЕШНО');
      console.log('='.repeat(80));
      console.log(`\nПлатеж ID ${payment.id} теперь связан с продуктом ID ${correctProduct.productId}`);
    } else {
      console.log('\n❌ Не удалось исправить связь. Проверьте логи.');
      process.exit(1);
    }
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('\n❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();

