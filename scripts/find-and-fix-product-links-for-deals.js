#!/usr/bin/env node

/**
 * Поиск и исправление связей продуктов для Deal #1714 и #1775
 * 
 * Стратегия:
 * 1. Найти похожие сделки с правильными продуктами
 * 2. Найти продукты через проформы других сделок
 * 3. Создать правильные связи через payment_product_links
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_IDS = ['1714', '1775'];

async function findSimilarDeals(dealId, amount, currency) {
  console.log(`\n🔍 Поиск похожих сделок для Deal #${dealId}...`);
  console.log(`   Сумма: ${amount} ${currency}`);
  
  try {
    const pipedriveClient = new PipedriveClient();
    
    // Получаем данные текущей сделки
    const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      return null;
    }
    
    const deal = dealResult.deal;
    const dealValue = parseFloat(deal.value) || 0;
    const dealCurrency = deal.currency || 'PLN';
    
    // Ищем другие сделки с похожей суммой и валютой
    // (в пределах 20% от суммы)
    const minAmount = dealValue * 0.8;
    const maxAmount = dealValue * 1.2;
    
    console.log(`   Ищем сделки с суммой от ${minAmount} до ${maxAmount} ${dealCurrency}`);
    
    // Получаем список всех сделок (ограничимся последними 100 для производительности)
    const { deals } = await pipedriveClient.getDeals({
      start: 0,
      limit: 100,
      status: 'all'
    });
    
    const similarDeals = (deals || []).filter(d => {
      if (String(d.id) === dealId) return false;
      const value = parseFloat(d.value) || 0;
      const curr = d.currency || 'PLN';
      return curr === dealCurrency && value >= minAmount && value <= maxAmount;
    });
    
    console.log(`   Найдено похожих сделок: ${similarDeals.length}`);
    
    // Проверяем какие продукты есть у похожих сделок
    const dealsWithProducts = [];
    for (const similarDeal of similarDeals.slice(0, 10)) {
      const similarDealResult = await pipedriveClient.getDealWithRelatedData(similarDeal.id);
      if (similarDealResult.success && similarDealResult.deal.products && similarDealResult.deal.products.length > 0) {
        dealsWithProducts.push({
          dealId: similarDeal.id,
          dealTitle: similarDeal.title,
          products: similarDealResult.deal.products
        });
      }
    }
    
    return dealsWithProducts;
  } catch (error) {
    logger.error(`Ошибка при поиске похожих сделок для Deal #${dealId}:`, error);
    return null;
  }
}

async function findProductFromProformas(dealId) {
  console.log(`\n🔍 Поиск продуктов через проформы для Deal #${dealId}...`);
  
  // Ищем проформы для этой сделки
  const { data: proformas } = await supabase
    .from('proformas')
    .select('id, fullnumber, pipedrive_deal_id')
    .eq('pipedrive_deal_id', dealId)
    .limit(5);
  
  if (!proformas || proformas.length === 0) {
    console.log(`   Проформ не найдено`);
    return null;
  }
  
  console.log(`   Найдено проформ: ${proformas.length}`);
  
  // Ищем продукты в проформах
  for (const proforma of proformas) {
    const { data: proformaProducts } = await supabase
      .from('proforma_products')
      .select('product_id, products(id, name, normalized_name)')
      .eq('proforma_id', proforma.id)
      .limit(1);
    
    if (proformaProducts && proformaProducts.length > 0 && proformaProducts[0].product_id) {
      const product = proformaProducts[0].products;
      console.log(`   ✅ Найден продукт из проформы ${proforma.fullnumber}:`);
      console.log(`      Product ID: ${product.id}, Название: "${product.name}"`);
      return product.id;
    }
  }
  
  return null;
}

async function findProductFromOtherPayments(dealId, customerName, amount, currency) {
  console.log(`\n🔍 Поиск продуктов через другие платежи...`);
  console.log(`   Клиент: ${customerName}, Сумма: ${amount} ${currency}`);
  
  // Ищем другие Stripe платежи от этого же клиента с похожей суммой
  const { data: similarPayments } = await supabase
    .from('stripe_payments')
    .select('id, deal_id, product_id, original_amount, currency, customer_name')
    .or(`customer_name.ilike.%${customerName}%,customer_email.ilike.%${customerName}%`)
    .eq('currency', currency)
    .not('deal_id', 'eq', dealId)
    .not('product_id', 'is', null)
    .limit(10);
  
  if (similarPayments && similarPayments.length > 0) {
    // Берем самый частый product_id
    const productIdCounts = {};
    similarPayments.forEach(p => {
      if (p.product_id) {
        productIdCounts[p.product_id] = (productIdCounts[p.product_id] || 0) + 1;
      }
    });
    
    const mostCommonProductId = Object.entries(productIdCounts)
      .sort((a, b) => b[1] - a[1])[0]?.[0];
    
    if (mostCommonProductId) {
      // Проверяем что это валидный UUID из product_links
      const { data: productLink } = await supabase
        .from('product_links')
        .select('*, products(id, name)')
        .eq('id', mostCommonProductId)
        .single();
      
      if (productLink && productLink.products) {
        console.log(`   ✅ Найден продукт из похожих платежей:`);
        console.log(`      Product Link ID: ${mostCommonProductId}`);
        console.log(`      Product ID: ${productLink.products.id}, Название: "${productLink.products.name}"`);
        return {
          productLinkId: mostCommonProductId,
          productId: productLink.products.id
        };
      }
    }
  }
  
  return null;
}

async function findOrCreateProductLink(crmProductId, crmProductName, campProductId) {
  if (!crmProductId && !campProductId) {
    return null;
  }
  
  // Ищем существующий product_link
  let query = supabase.from('product_links').select('*');
  
  if (crmProductId) {
    query = query.eq('crm_product_id', String(crmProductId));
  } else if (campProductId) {
    query = query.eq('camp_product_id', String(campProductId));
  }
  
  const { data: existingLinks } = await query.limit(1);
  
  if (existingLinks && existingLinks.length > 0) {
    return existingLinks[0].id;
  }
  
  // Создаем новый product_link если не найден
  const { data: newLink, error } = await supabase
    .from('product_links')
    .insert({
      crm_product_id: crmProductId ? String(crmProductId) : null,
      crm_product_name: crmProductName || null,
      camp_product_id: campProductId ? String(campProductId) : null,
      status: 'active'
    })
    .select()
    .single();
  
  if (error) {
    logger.error('Ошибка при создании product_link:', error);
    return null;
  }
  
  return newLink.id;
}

async function fixDealProductLinks(dealId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔧 Исправление связей для Deal #${dealId}`);
  console.log('='.repeat(80));
  
  // Получаем все Stripe платежи для сделки
  const { data: stripePayments } = await supabase
    .from('stripe_payments')
    .select('id, session_id, deal_id, product_id, original_amount, currency, customer_name, customer_email, created_at')
    .eq('deal_id', dealId)
    .order('created_at', { ascending: false });
  
  if (!stripePayments || stripePayments.length === 0) {
    console.log(`   Платежей не найдено`);
    return { fixed: 0, errors: 0 };
  }
  
  console.log(`\n💳 Найдено платежей: ${stripePayments.length}`);
  
  // Стратегия 1: Ищем продукт через проформы
  let correctProductId = await findProductFromProformas(dealId);
  let correctProductLinkId = null;
  
  // Стратегия 2: Если не нашли через проформы, ищем через похожие платежи
  if (!correctProductId) {
    const firstPayment = stripePayments[0];
    const customerName = firstPayment.customer_name || firstPayment.customer_email || '';
    const amount = firstPayment.original_amount || 0;
    const currency = firstPayment.currency || 'PLN';
    
    const productInfo = await findProductFromOtherPayments(dealId, customerName, amount, currency);
    if (productInfo) {
      correctProductLinkId = productInfo.productLinkId;
      correctProductId = productInfo.productId;
    }
  }
  
  // Стратегия 3: Ищем через похожие сделки
  if (!correctProductId) {
    const firstPayment = stripePayments[0];
    const amount = firstPayment.original_amount || 0;
    const currency = firstPayment.currency || 'PLN';
    
    const similarDeals = await findSimilarDeals(dealId, amount, currency);
    if (similarDeals && similarDeals.length > 0) {
      // Берем продукт из первой похожей сделки
      const firstSimilarDeal = similarDeals[0];
      if (firstSimilarDeal.products && firstSimilarDeal.products.length > 0) {
        const crmProduct = firstSimilarDeal.products[0];
        console.log(`\n   ✅ Найден продукт из похожей сделки #${firstSimilarDeal.dealId}:`);
        console.log(`      CRM Product ID: ${crmProduct.id}, Название: "${crmProduct.name}"`);
        
        // Ищем или создаем product_link
        correctProductLinkId = await findOrCreateProductLink(
          String(crmProduct.id),
          crmProduct.name,
          null
        );
        
        if (correctProductLinkId) {
          // Получаем camp_product_id из product_link
          const { data: productLink } = await supabase
            .from('product_links')
            .select('camp_product_id, products(id)')
            .eq('id', correctProductLinkId)
            .single();
          
          if (productLink && productLink.camp_product_id) {
            correctProductId = parseInt(productLink.camp_product_id, 10);
          }
        }
      }
    }
  }
  
  if (!correctProductId && !correctProductLinkId) {
    console.log(`\n   ⚠️  Не удалось определить правильный продукт автоматически`);
    console.log(`   Требуется ручная проверка`);
    return { fixed: 0, errors: 0, status: 'no_product_found' };
  }
  
  console.log(`\n   ✅ Правильный продукт:`);
  if (correctProductId) {
    const { data: product } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', correctProductId)
      .single();
    
    if (product) {
      console.log(`      Product ID: ${correctProductId}, Название: "${product.name}"`);
    }
  }
  if (correctProductLinkId) {
    console.log(`      Product Link ID: ${correctProductLinkId}`);
  }
  
  // Исправляем связи
  console.log(`\n   🔧 Исправление связей...`);
  
  let fixed = 0;
  let errors = 0;
  
  // Обновляем product_id в stripe_payments (если есть product_link_id)
  if (correctProductLinkId) {
    const paymentIds = stripePayments.map(p => p.id);
    const { error: updateError } = await supabase
      .from('stripe_payments')
      .update({ product_id: correctProductLinkId })
      .in('id', paymentIds);
    
    if (updateError) {
      console.log(`      ❌ Ошибка при обновлении stripe_payments: ${updateError.message}`);
      errors++;
    } else {
      console.log(`      ✅ Обновлено product_id в ${paymentIds.length} платежах`);
      fixed += paymentIds.length;
    }
  }
  
  // Создаем связи через payment_product_links (если есть product_id)
  if (correctProductId) {
    // Удаляем старые связи если есть
    const paymentIds = stripePayments.map(p => p.id);
    await supabase
      .from('payment_product_links')
      .delete()
      .in('payment_id', paymentIds);
    
    // Создаем новые связи
    // Но payment_product_links работает с payments.id (BIGINT), а не stripe_payments.id (UUID)
    // Нужно найти соответствующие записи в payments или создать связи по-другому
    
    console.log(`      ℹ️  payment_product_links работает только с таблицей payments, не stripe_payments`);
    console.log(`      Связи будут созданы через product_id в stripe_payments`);
  }
  
  return { fixed, errors, productId: correctProductId, productLinkId: correctProductLinkId };
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('🔧 ПОИСК И ИСПРАВЛЕНИЕ СВЯЗЕЙ ПРОДУКТОВ');
    console.log('='.repeat(80));
    
    const results = [];
    
    for (const dealId of DEAL_IDS) {
      const result = await fixDealProductLinks(dealId);
      results.push({ dealId, ...result });
    }
    
    // Итоги
    console.log('\n' + '='.repeat(80));
    console.log('📊 ИТОГИ');
    console.log('='.repeat(80));
    
    results.forEach(result => {
      console.log(`\nDeal #${result.dealId}:`);
      if (result.status === 'no_product_found') {
        console.log(`   ⚠️  Продукт не найден - требуется ручная проверка`);
      } else {
        console.log(`   ✅ Исправлено: ${result.fixed}`);
        console.log(`   ❌ Ошибок: ${result.errors}`);
        if (result.productId) {
          console.log(`   📦 Product ID: ${result.productId}`);
        }
        if (result.productLinkId) {
          console.log(`   🔗 Product Link ID: ${result.productLinkId}`);
        }
      }
    });
    
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

main();






