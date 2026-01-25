#!/usr/bin/env node

/**
 * Обновление camp_product_id в product_links для продукта NY2026
 * Это необходимо для правильного связывания Stripe платежей с продуктом в отчетах
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

async function fixProductLinkCampProductId() {
  console.log('🔧 Обновление camp_product_id в product_links для NY2026\n');
  console.log('='.repeat(80));

  try {
    // 1. Найдем продукт NY2026
    const { data: products, error: productError } = await supabase
      .from('products')
      .select('id, name, normalized_name')
      .or('name.ilike.NY2026,normalized_name.ilike.ny2026')
      .limit(5);

    if (productError || !products || products.length === 0) {
      console.error('❌ Продукт NY2026 не найден');
      return;
    }

    const product = products[0];
    console.log(`✅ Найден продукт:`);
    console.log(`   ID: ${product.id}`);
    console.log(`   Название: ${product.name}\n`);

    // 2. Найдем product_link для этого продукта
    const { data: productLinks, error: plError } = await supabase
      .from('product_links')
      .select('*')
      .or(`crm_product_id.eq.${product.id},camp_product_id.eq.${product.id}`)
      .limit(10);

    if (plError || !productLinks || productLinks.length === 0) {
      console.error('❌ Product links не найдены');
      return;
    }

    // Используем первый product_link с правильным crm_product_id
    const productLink = productLinks.find(pl => pl.crm_product_id === String(product.id)) || productLinks[0];
    
    console.log(`✅ Найден product_link:`);
    console.log(`   UUID: ${productLink.id}`);
    console.log(`   CRM Product ID: ${productLink.crm_product_id || 'NULL'}`);
    console.log(`   Camp Product ID: ${productLink.camp_product_id || 'NULL'}`);
    console.log(`   CRM Product Name: ${productLink.crm_product_name || 'NULL'}\n`);

    // 3. Проверяем, нужно ли обновлять
    if (productLink.camp_product_id === String(product.id)) {
      console.log('✅ camp_product_id уже установлен правильно');
      return;
    }

    // 4. Обновляем camp_product_id
    console.log(`4️⃣ Обновление camp_product_id на ${product.id}...`);
    
    const { data: updatedLink, error: updateError } = await supabase
      .from('product_links')
      .update({ camp_product_id: product.id })
      .eq('id', productLink.id)
      .select()
      .single();

    if (updateError) {
      console.error('❌ Ошибка обновления:', updateError);
      return;
    }

    console.log(`✅ Успешно обновлен product_link:`);
    console.log(`   UUID: ${updatedLink.id}`);
    console.log(`   CRM Product ID: ${updatedLink.crm_product_id}`);
    console.log(`   Camp Product ID: ${updatedLink.camp_product_id}`);
    console.log(`\n✅ Теперь Stripe платежи будут правильно связываться с продуктом NY2026 в отчетах!`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  fixProductLinkCampProductId();
}






