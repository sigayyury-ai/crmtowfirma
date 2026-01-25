#!/usr/bin/env node

/**
 * Перенос Stripe платежей из продукта id-28 в продукт id-2 (NY2026)
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

async function moveStripePaymentsFromProduct28To2() {
  console.log('🔄 Перенос Stripe платежей из продукта id-28 в продукт id-2 (NY2026)\n');
  console.log('='.repeat(80));

  try {
    // 1. Найдем продукты
    const { data: product28, error: p28Error } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', 28)
      .single();

    const { data: product2, error: p2Error } = await supabase
      .from('products')
      .select('id, name')
      .eq('id', 2)
      .single();

    if (p28Error || !product28) {
      console.error('❌ Продукт id-28 не найден');
      return;
    }

    if (p2Error || !product2) {
      console.error('❌ Продукт id-2 не найден');
      return;
    }

    console.log(`✅ Найден продукт 28: ${product28.name}`);
    console.log(`✅ Найден продукт 2: ${product2.name}\n`);

    // 2. Найдем product_link для продукта 2
    const { data: productLinks2, error: pl2Error } = await supabase
      .from('product_links')
      .select('*')
      .or(`crm_product_id.eq.2,camp_product_id.eq.2`)
      .limit(10);

    if (pl2Error || !productLinks2 || productLinks2.length === 0) {
      console.error('❌ Product links для продукта 2 не найдены');
      return;
    }

    // Используем первый product_link с правильным crm_product_id
    const productLink2 = productLinks2.find(pl => pl.crm_product_id === '2') || productLinks2[0];

    console.log(`✅ Product link для продукта 2: ${productLink2.id}\n`);

    // 3. Найдем все Stripe платежи, которые должны быть связаны с продуктом 28
    // Ищем по названию "COMOON NY" в line_items
    console.log('3️⃣ Поиск Stripe платежей с "COMOON NY" в line_items...');
    
    const { data: allPayments, error: allPaymentsError } = await supabase
      .from('stripe_payments')
      .select(`
        id,
        session_id,
        deal_id,
        product_id,
        created_at,
        processed_at,
        amount_pln,
        customer_name,
        customer_email,
        payment_status,
        raw_payload
      `)
      .eq('payment_status', 'paid')
      .order('processed_at', { ascending: false })
      .limit(1000);

    if (allPaymentsError) {
      console.error('❌ Ошибка поиска Stripe платежей:', allPaymentsError);
      return;
    }

    const sp28Error = null; // Для совместимости с кодом ниже

    // Фильтруем платежи с "COMOON NY" в line_items, но не связанные с продуктом id-2
    const stripePayments28 = (allPayments || []).filter(p => {
      // Пропускаем платежи, которые уже связаны с продуктом id-2
      if (p.product_id === productLink2.id) {
        return false;
      }

      // Проверяем line_items на наличие "COMOON NY"
      let payload = p.raw_payload;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (e) {
          return false;
        }
      }

      if (!payload || typeof payload !== 'object') {
        return false;
      }

      const lineItems = payload.line_items?.data || [];
      return lineItems.some(li => {
        const desc = (li?.description || li?.price?.product_data?.name || '').toUpperCase();
        return desc.includes('COMOON NY') || desc.includes('NY2026');
      });
    });

    if (sp28Error) {
      console.error('❌ Ошибка поиска Stripe платежей:', sp28Error);
      return;
    }

    console.log(`   Найдено ${stripePayments28?.length || 0} Stripe платежей для продукта 28\n`);

    if (!stripePayments28 || stripePayments28.length === 0) {
      console.log('✅ Нет платежей для переноса');
      return;
    }

    // Показываем примеры платежей
    console.log('📋 Примеры платежей для переноса (первые 10):');
    stripePayments28.slice(0, 10).forEach((p, idx) => {
      const date = p.processed_at ? new Date(p.processed_at).toISOString().split('T')[0] : 'NULL';
      console.log(`   ${idx + 1}. Клиент: ${p.customer_name || p.customer_email || 'N/A'}, Дата: ${date}, Сумма: ${p.amount_pln} PLN`);
    });
    console.log('');

    // Статистика по датам
    const decemberPayments = stripePayments28.filter(p => {
      if (!p.processed_at) return false;
      const d = new Date(p.processed_at);
      return d.getFullYear() === 2025 && d.getMonth() === 11;
    });
    
    const januaryPayments = stripePayments28.filter(p => {
      if (!p.processed_at) return false;
      const d = new Date(p.processed_at);
      return d.getFullYear() === 2026 && d.getMonth() === 0;
    });

    console.log(`📊 Статистика:`);
    console.log(`   Всего платежей: ${stripePayments28.length}`);
    console.log(`   За декабрь 2025: ${decemberPayments.length}`);
    console.log(`   За январь 2026: ${januaryPayments.length}\n`);

    // 4. Обновляем product_id на product_id для продукта 2
    console.log(`4️⃣ Обновление product_id на ${productLink2.id}...`);
    
    const updates = stripePayments28.map(p => ({
      id: p.id,
      session_id: p.session_id,
      product_id: productLink2.id
    }));

    // Применяем обновления батчами по 100
    const chunks = [];
    for (let i = 0; i < updates.length; i += 100) {
      chunks.push(updates.slice(i, i + 100));
    }

    let totalUpdated = 0;
    for (const chunk of chunks) {
      const { error: updateError } = await supabase
        .from('stripe_payments')
        .upsert(chunk, { onConflict: 'id' });

      if (updateError) {
        console.error('❌ Ошибка обновления:', updateError);
        throw new Error(`Failed to update stripe_payments: ${updateError.message}`);
      }
      totalUpdated += chunk.length;
      console.log(`   ✅ Обновлено ${totalUpdated}/${stripePayments28.length} платежей`);
    }

    // 5. Обновляем camp_product_id в product_link для продукта 2, если нужно
    if (!productLink2.camp_product_id || productLink2.camp_product_id !== 2) {
      console.log(`\n5️⃣ Обновление camp_product_id в product_link для продукта 2...`);
      
      const { error: updateLinkError } = await supabase
        .from('product_links')
        .update({ camp_product_id: 2 })
        .eq('id', productLink2.id);

      if (updateLinkError) {
        console.error('⚠️  Ошибка обновления product_link:', updateLinkError);
      } else {
        console.log('   ✅ camp_product_id обновлен');
      }
    }

    console.log(`\n✅ Успешно перенесено ${totalUpdated} платежей из продукта "${product28.name}" в продукт "${product2.name}"!`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  moveStripePaymentsFromProduct28To2();
}

