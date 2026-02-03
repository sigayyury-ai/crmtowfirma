#!/usr/bin/env node

/**
 * Удаление связи отмененных платежей от zemlyanayaksenia@gmail.com с продуктом id=13
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const EMAIL = 'zemlyanayaksenia@gmail.com';
const PRODUCT_ID = 13;

async function main() {
  console.log(`🔍 Удаление связи отмененных платежей от ${EMAIL} с продуктом id=${PRODUCT_ID}\n`);
  console.log('='.repeat(80));

  try {
    // 1. Находим ProductLink для продукта id=13
    const { data: productLinks, error: productLinksError } = await supabase
      .from('product_links')
      .select('id, crm_product_id, crm_product_name, camp_product_id')
      .eq('camp_product_id', String(PRODUCT_ID));

    if (productLinksError || !productLinks || productLinks.length === 0) {
      console.error('❌ ProductLink для продукта id=' + PRODUCT_ID + ' не найден');
      process.exit(1);
    }

    const productLinkId = productLinks[0].id;
    console.log(`✅ Найден ProductLink UUID: ${productLinkId} для продукта id=${PRODUCT_ID}`);

    // 2. Находим все платежи от этого email с этим product_id и статусом unpaid
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('id, session_id, deal_id, product_id, customer_email, customer_name, original_amount, currency, payment_status, created_at')
      .ilike('customer_email', EMAIL)
      .eq('product_id', productLinkId)
      .eq('payment_status', 'unpaid')
      .order('created_at', { ascending: false });

    if (stripeError) {
      console.error('❌ Ошибка поиска платежей:', stripeError);
      process.exit(1);
    }

    if (!stripePayments || stripePayments.length === 0) {
      console.log('ℹ️  Неоплаченные платежи от этого email в этом продукте не найдены');
      process.exit(0);
    }

    console.log(`\n⚠️  Найдено ${stripePayments.length} неоплаченных платежей:`);
    stripePayments.forEach((p, i) => {
      console.log(`  ${i + 1}. ID: ${p.id}`);
      console.log(`     Session ID: ${p.session_id}`);
      console.log(`     Deal ID: ${p.deal_id}`);
      console.log(`     Сумма: ${p.original_amount} ${p.currency}`);
      console.log(`     Создан: ${p.created_at}`);
    });

    // 3. Подтверждение
    console.log(`\n⚠️  ВНИМАНИЕ: Будет удалена связь с продуктом для ${stripePayments.length} платежей`);
    console.log('   Это установит product_id = NULL для этих платежей в таблице stripe_payments');
    console.log('\n   Для продолжения запустите скрипт с флагом --confirm');

    if (process.argv.includes('--confirm')) {
      console.log('\n✅ Флаг --confirm найден, продолжаем...\n');

      let updated = 0;
      let errors = 0;

      for (const payment of stripePayments) {
        try {
          const { error: updateError } = await supabase
            .from('stripe_payments')
            .update({ product_id: null })
            .eq('id', payment.id);

          if (updateError) {
            console.error(`   ❌ Ошибка обновления платежа ${payment.id}:`, updateError);
            errors++;
          } else {
            console.log(`   ✅ Удалена связь для платежа ${payment.id} (session: ${payment.session_id})`);
            updated++;
          }
        } catch (error) {
          console.error(`   ❌ Ошибка при обработке платежа ${payment.id}:`, error.message);
          errors++;
        }
      }

      console.log(`\n${'='.repeat(80)}`);
      console.log(`✅ Обработка завершена:`);
      console.log(`   Обновлено: ${updated}`);
      if (errors > 0) {
        console.log(`   Ошибок: ${errors}`);
      }
      console.log(`\n💡 Платежи больше не будут отображаться в продукте id=${PRODUCT_ID}`);
    } else {
      console.log('\n💡 Для выполнения операции запустите:');
      console.log(`   node scripts/remove-cancelled-payment-from-product.js --confirm`);
    }

  } catch (error) {
    logger.error('❌ Ошибка выполнения:', error);
    console.error('❌ Ошибка выполнения:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
