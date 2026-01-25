#!/usr/bin/env node

/**
 * Исправление неправильных связей продуктов со сделками и платежами
 * 
 * Находит сделки и платежи, проверяет какие продукты должны быть связаны,
 * и исправляет связи если они неправильные.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_IDS = ['1714', '1775']; // Сделки из отчета

async function findDealData(dealId) {
  console.log(`\n🔍 Анализ Deal #${dealId}...`);
  
  try {
    const pipedriveClient = new PipedriveClient();
    
    // Получаем данные сделки из Pipedrive
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    
    if (!dealResult.success || !dealResult.deal) {
      console.log(`   ❌ Сделка не найдена в Pipedrive`);
      return null;
    }
    
    const deal = dealResult.deal;
    console.log(`   ✅ Сделка найдена: "${deal.title}"`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status || 'N/A'}`);
    
    // Получаем продукты из сделки Pipedrive
    if (deal.products && deal.products.length > 0) {
      console.log(`   📦 Продукты в Pipedrive (${deal.products.length}):`);
      deal.products.forEach((product, index) => {
        console.log(`      ${index + 1}. ID: ${product.id}, Название: "${product.name}"`);
      });
    } else {
      console.log(`   ⚠️  Продукты в Pipedrive не найдены`);
    }
    
    // Ищем платежи для этой сделки
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('*')
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false });
    
    if (stripeError) {
      console.log(`   ⚠️  Ошибка при поиске Stripe платежей: ${stripeError.message}`);
    } else {
      console.log(`   💳 Stripe платежей найдено: ${stripePayments?.length || 0}`);
      if (stripePayments && stripePayments.length > 0) {
        stripePayments.forEach((payment, index) => {
          console.log(`      ${index + 1}. ${payment.original_amount || payment.amount || 0} ${payment.currency || 'N/A'}`);
          console.log(`         Session: ${payment.session_id?.substring(0, 30)}...`);
          console.log(`         Product ID в платеже: ${payment.product_id || 'N/A'}`);
          console.log(`         Клиент: ${payment.customer_name || payment.customer_email || 'N/A'}`);
          console.log(`         Дата: ${payment.created_at || 'N/A'}`);
        });
      }
    }
    
    // Ищем проформы для этой сделки
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, total, currency, pipedrive_deal_id')
      .eq('pipedrive_deal_id', dealId)
      .order('created_at', { ascending: false });
    
    if (proformaError) {
      console.log(`   ⚠️  Ошибка при поиске проформ: ${proformaError.message}`);
    } else {
      console.log(`   📄 Проформ найдено: ${proformas?.length || 0}`);
      if (proformas && proformas.length > 0) {
        proformas.forEach((proforma, index) => {
          console.log(`      ${index + 1}. ${proforma.fullnumber || proforma.id}`);
          console.log(`         Сумма: ${proforma.total} ${proforma.currency || 'N/A'}`);
          
          // Ищем продукты в проформе
          supabase
            .from('proforma_products')
            .select('*, products(id, name)')
            .eq('proforma_id', proforma.id)
            .then(({ data: proformaProducts, error: ppError }) => {
              if (!ppError && proformaProducts && proformaProducts.length > 0) {
                console.log(`         Продукты в проформе:`);
                proformaProducts.forEach(pp => {
                  const productName = pp.products?.name || pp.name || 'N/A';
                  console.log(`            - Product ID: ${pp.product_id || 'N/A'}, Название: "${productName}"`);
                });
              }
            });
        });
      }
    }
    
    // Ищем текущие связи продуктов в payment_product_links
    if (stripePayments && stripePayments.length > 0) {
      const paymentIds = stripePayments.map(p => p.id);
      const { data: productLinks, error: linksError } = await supabase
        .from('payment_product_links')
        .select('*, products(id, name)')
        .in('payment_id', paymentIds);
      
      if (!linksError && productLinks && productLinks.length > 0) {
        console.log(`   🔗 Текущие связи payment_product_links:`);
        productLinks.forEach(link => {
          const productName = link.products?.name || 'N/A';
          console.log(`      Payment ID: ${link.payment_id}, Product ID: ${link.product_id}, Название: "${productName}"`);
        });
      }
    }
    
    return {
      deal,
      stripePayments: stripePayments || [],
      proformas: proformas || []
    };
    
  } catch (error) {
    logger.error(`Ошибка при анализе Deal #${dealId}:`, error);
    console.log(`   ❌ Ошибка: ${error.message}`);
    return null;
  }
}

async function findCorrectProduct(dealData) {
  console.log(`\n🔍 Определение правильного продукта...`);
  
  // Стратегия поиска правильного продукта:
  // 1. Из продуктов в проформе
  // 2. Из продуктов в Pipedrive сделке
  // 3. По названию продукта из Pipedrive
  
  let correctProductId = null;
  let source = null;
  
  // Проверяем продукты в проформах
  if (dealData.proformas && dealData.proformas.length > 0) {
    for (const proforma of dealData.proformas) {
      const { data: proformaProducts } = await supabase
        .from('proforma_products')
        .select('product_id, products(id, name)')
        .eq('proforma_id', proforma.id)
        .limit(1);
      
      if (proformaProducts && proformaProducts.length > 0 && proformaProducts[0].product_id) {
        correctProductId = proformaProducts[0].product_id;
        source = `proforma ${proforma.fullnumber || proforma.id}`;
        console.log(`   ✅ Найден продукт из проформы: Product ID ${correctProductId}`);
        break;
      }
    }
  }
  
  // Если не нашли в проформе, проверяем продукты в Pipedrive
  if (!correctProductId && dealData.deal.products && dealData.deal.products.length > 0) {
    const pipedriveProduct = dealData.deal.products[0];
    
    // Ищем продукт в базе по названию или CRM ID
    const { data: products } = await supabase
      .from('products')
      .select('id, name, normalized_name')
      .or(`name.ilike.%${pipedriveProduct.name}%,normalized_name.ilike.%${pipedriveProduct.name}%`)
      .limit(5);
    
    if (products && products.length > 0) {
      // Берем первый подходящий продукт
      correctProductId = products[0].id;
      source = `Pipedrive product "${pipedriveProduct.name}"`;
      console.log(`   ✅ Найден продукт из Pipedrive: Product ID ${correctProductId}, "${products[0].name}"`);
    }
  }
  
  if (!correctProductId) {
    console.log(`   ⚠️  Не удалось определить правильный продукт автоматически`);
  }
  
  return { productId: correctProductId, source };
}

async function fixProductLinks(dealId, dealData, correctProduct) {
  if (!correctProduct.productId) {
    console.log(`\n⚠️  Не могу исправить связи - правильный продукт не определен`);
    return { fixed: 0, errors: 0 };
  }
  
  console.log(`\n🔧 Исправление связей для Deal #${dealId}...`);
  console.log(`   Правильный продукт: ID ${correctProduct.productId} (из ${correctProduct.source})`);
  
  let fixed = 0;
  let errors = 0;
  
  // Исправляем product_id в stripe_payments
  if (dealData.stripePayments && dealData.stripePayments.length > 0) {
    const paymentIds = dealData.stripePayments.map(p => p.id);
    
    // Проверяем какие платежи имеют неправильный product_id
    const paymentsToFix = dealData.stripePayments.filter(p => 
      p.product_id !== correctProduct.productId
    );
    
    if (paymentsToFix.length > 0) {
      console.log(`   💳 Исправление product_id в ${paymentsToFix.length} Stripe платежах...`);
      
      for (const payment of paymentsToFix) {
        const { error } = await supabase
          .from('stripe_payments')
          .update({ product_id: correctProduct.productId })
          .eq('id', payment.id);
        
        if (error) {
          console.log(`      ❌ Ошибка при обновлении платежа ${payment.id}: ${error.message}`);
          errors++;
        } else {
          console.log(`      ✅ Обновлен платеж ${payment.id}`);
          fixed++;
        }
      }
    } else {
      console.log(`   ✅ Все Stripe платежи уже имеют правильный product_id`);
    }
    
    // Исправляем payment_product_links
    const { data: existingLinks } = await supabase
      .from('payment_product_links')
      .select('*')
      .in('payment_id', paymentIds);
    
    if (existingLinks && existingLinks.length > 0) {
      // Удаляем старые связи
      const linkIds = existingLinks.map(l => l.id);
      await supabase
        .from('payment_product_links')
        .delete()
        .in('id', linkIds);
      
      console.log(`   🗑️  Удалено ${linkIds.length} старых связей payment_product_links`);
    }
    
    // Создаем новые правильные связи
    console.log(`   ➕ Создание новых связей payment_product_links...`);
    for (const payment of dealData.stripePayments) {
      const { error } = await supabase
        .from('payment_product_links')
        .insert({
          payment_id: payment.id,
          product_id: correctProduct.productId,
          linked_by: 'system_fix',
          linked_at: new Date().toISOString()
        });
      
      if (error) {
        // Возможно связь уже существует
        if (!error.message.includes('duplicate') && !error.message.includes('unique')) {
          console.log(`      ⚠️  Ошибка при создании связи для платежа ${payment.id}: ${error.message}`);
          errors++;
        }
      } else {
        fixed++;
      }
    }
  }
  
  return { fixed, errors };
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ИСПРАВЛЕНИЕ НЕПРАВИЛЬНЫХ СВЯЗЕЙ ПРОДУКТОВ');
    console.log('='.repeat(80));
    
    const results = [];
    
    for (const dealId of DEAL_IDS) {
      // Анализируем сделку
      const dealData = await findDealData(dealId);
      
      if (!dealData) {
        continue;
      }
      
      // Определяем правильный продукт
      const correctProduct = await findCorrectProduct(dealData);
      
      if (!correctProduct.productId) {
        console.log(`\n⚠️  Для Deal #${dealId} не удалось определить правильный продукт`);
        console.log(`   Требуется ручная проверка`);
        results.push({ dealId, fixed: 0, errors: 0, status: 'no_product_found' });
        continue;
      }
      
      // Исправляем связи
      const fixResult = await fixProductLinks(dealId, dealData, correctProduct);
      results.push({ dealId, ...fixResult, productId: correctProduct.productId });
    }
    
    // Итоги
    console.log('\n' + '='.repeat(80));
    console.log('📊 ИТОГИ ИСПРАВЛЕНИЯ');
    console.log('='.repeat(80));
    
    results.forEach(result => {
      console.log(`\nDeal #${result.dealId}:`);
      if (result.status === 'no_product_found') {
        console.log(`   ⚠️  Продукт не найден - требуется ручная проверка`);
      } else {
        console.log(`   ✅ Исправлено связей: ${result.fixed}`);
        console.log(`   ❌ Ошибок: ${result.errors}`);
        console.log(`   📦 Правильный продукт: ID ${result.productId}`);
      }
    });
    
    const totalFixed = results.reduce((sum, r) => sum + (r.fixed || 0), 0);
    const totalErrors = results.reduce((sum, r) => sum + (r.errors || 0), 0);
    
    console.log(`\n📈 ВСЕГО: ${totalFixed} связей исправлено, ${totalErrors} ошибок`);
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();






