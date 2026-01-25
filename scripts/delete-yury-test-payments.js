#!/usr/bin/env node

/**
 * Удаление тестовых платежей от Yury Sihai на сумму 1 EUR для Deal #2041 и #2039
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const TEST_DEAL_IDS = ['2041', '2039', '2040']; // Добавил 2040 тоже, так как там тоже тестовый платеж

async function deleteYuryTestPayments() {
  console.log('\n🔍 Поиск тестовых платежей от Yury Sihai для Deal #2041, #2039, #2040...\n');

  try {
    // Ищем все платежи для этих сделок
    const { data: stripePayments, error: stripeError } = await supabase
      .from('stripe_payments')
      .select('*')
      .in('deal_id', TEST_DEAL_IDS)
      .order('created_at', { ascending: false });

    if (stripeError) {
      logger.error('Ошибка при поиске Stripe платежей:', stripeError);
      process.exit(1);
    }

    // Также ищем платежи от Yury Sihai на сумму 1 EUR (независимо от deal_id)
    const { data: yuryPayments, error: yuryError } = await supabase
      .from('stripe_payments')
      .select('*')
      .or(`customer_name.ilike.%Yury Sihai%,customer_email.ilike.%yury%`)
      .eq('currency', 'EUR')
      .order('created_at', { ascending: false });

    if (yuryError) {
      logger.error('Ошибка при поиске платежей Yury Sihai:', yuryError);
    }

    // Фильтруем платежи на сумму ~1 EUR
    const oneEuroPayments = (yuryPayments || []).filter(p => {
      const amount = parseFloat(p.original_amount || p.amount || 0);
      return Math.abs(amount - 1.0) < 0.01; // Точность до 1 цента
    });

    // Объединяем платежи из обеих выборок
    const allPayments = [...(stripePayments || []), ...oneEuroPayments];
    
    // Убираем дубликаты по id
    const uniquePayments = Array.from(new Map(allPayments.map(p => [p.id, p])).values());

    console.log(`Найдено платежей для удаления: ${uniquePayments.length}\n`);

    if (uniquePayments.length === 0) {
      console.log('✅ Тестовых платежей не найдено.\n');
      return;
    }

    // Показываем что будет удалено
    console.log('📋 Платежи для удаления:\n');
    uniquePayments.forEach((payment, index) => {
      console.log(`${index + 1}. Payment ID: ${payment.id}`);
      console.log(`   Deal ID: ${payment.deal_id || 'N/A'}`);
      console.log(`   Session ID: ${payment.session_id || 'N/A'}`);
      console.log(`   Клиент: ${payment.customer_name || payment.customer_email || 'N/A'}`);
      console.log(`   Сумма: ${payment.original_amount || payment.amount || 0} ${payment.currency || 'N/A'}`);
      console.log(`   Статус: ${payment.payment_status || 'N/A'} (${payment.status || 'N/A'})`);
      console.log(`   Создан: ${payment.created_at || 'N/A'}`);
      console.log('');
    });

    // Удаляем платежи
    console.log('🗑️  Начинаем удаление...\n');

    let deleted = 0;
    let errors = 0;

    // Удаляем по session_id (более надежно)
    const sessionIds = uniquePayments.map(p => p.session_id).filter(Boolean);
    
    if (sessionIds.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < sessionIds.length; i += batchSize) {
        const batch = sessionIds.slice(i, i + batchSize);
        const { error } = await supabase
          .from('stripe_payments')
          .delete()
          .in('session_id', batch);

        if (error) {
          logger.error(`Ошибка при удалении батча (${i}-${i + batch.length}):`, error);
          errors++;
        } else {
          deleted += batch.length;
          console.log(`✅ Удалено ${batch.length} платежей (батч ${Math.floor(i / batchSize) + 1})`);
        }
      }
    }

    // Удаляем платежи без session_id по id
    const paymentsWithoutSession = uniquePayments.filter(p => !p.session_id);
    if (paymentsWithoutSession.length > 0) {
      const paymentIds = paymentsWithoutSession.map(p => p.id);
      const { error } = await supabase
        .from('stripe_payments')
        .delete()
        .in('id', paymentIds);

      if (error) {
        logger.error('Ошибка при удалении платежей без session_id:', error);
        errors++;
      } else {
        deleted += paymentIds.length;
        console.log(`✅ Удалено ${paymentIds.length} платежей без session_id`);
      }
    }

    // Удаляем связанные stripe_event_items
    if (sessionIds.length > 0) {
      const { data: eventItems, error: eventItemsError } = await supabase
        .from('stripe_event_items')
        .select('id')
        .in('session_id', sessionIds);

      if (!eventItemsError && eventItems && eventItems.length > 0) {
        const eventItemIds = eventItems.map(e => e.id);
        const { error: deleteEventItemsError } = await supabase
          .from('stripe_event_items')
          .delete()
          .in('id', eventItemIds);

        if (!deleteEventItemsError) {
          console.log(`✅ Удалено ${eventItemIds.length} связанных stripe_event_items`);
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ УДАЛЕНИЕ ЗАВЕРШЕНО');
    console.log('='.repeat(80));
    console.log(`Удалено платежей: ${deleted}`);
    console.log(`Ошибок: ${errors}`);
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    logger.error('Критическая ошибка:', error);
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

deleteYuryTestPayments();






