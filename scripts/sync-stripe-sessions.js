#!/usr/bin/env node

/**
 * Синхронизация всех Stripe сессий за последние 2 дня из обоих кабинетов
 * 
 * Проверяет наличие сессий в базе данных и:
 * - Добавляет отсутствующие
 * - Обновляет существующие (особенно статусы платежей)
 * - Связывает с клиентами через deal_id
 * 
 * Использование:
 *   node scripts/sync-stripe-sessions.js [--days=2]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const { getRate } = require('../src/services/stripe/exchangeRateService');
const { roundBankers, fromMinorUnit } = require('../src/utils/currency');
const logger = require('../src/utils/logger');

const DAYS_BACK = parseInt(process.argv.find(arg => arg.startsWith('--days='))?.split('=')[1] || '2');


async function fetchSessionsFromStripe(stripe, accountType, daysBack) {
  const sessions = [];
  const twoDaysAgo = Math.floor((Date.now() - daysBack * 24 * 60 * 60 * 1000) / 1000);
  
  console.log(`\n📥 Загрузка сессий из ${accountType} кабинета за последние ${daysBack} дней...`);
  
  let hasMore = true;
  let startingAfter = null;
  let totalFetched = 0;
  
  while (hasMore) {
    const params = {
      limit: 100,
      created: { gte: twoDaysAgo },
      expand: ['data.line_items', 'data.customer']
    };
    
    if (startingAfter) {
      params.starting_after = startingAfter;
    }
    
    try {
      const response = await stripe.checkout.sessions.list(params);
      const batch = response.data || [];
      
      sessions.push(...batch);
      totalFetched += batch.length;
      
      hasMore = response.has_more;
      if (batch.length > 0) {
        startingAfter = batch[batch.length - 1].id;
      } else {
        hasMore = false;
      }
      
      if (batch.length < 100) {
        hasMore = false;
      }
      
      // Логируем прогресс каждые 100 сессий
      if (totalFetched % 100 === 0) {
        console.log(`   Загружено ${totalFetched} сессий...`);
      }
    } catch (error) {
      logger.error(`Ошибка при загрузке сессий из ${accountType} кабинета`, {
        error: error.message,
        startingAfter
      });
      break;
    }
  }
  
  console.log(`   ✅ Загружено ${sessions.length} сессий из ${accountType} кабинета`);
  return sessions;
}

async function convertSessionToPaymentRecord(session, accountType) {
  const dealId = session.metadata?.deal_id || null;
  const currency = (session.currency || 'PLN').toUpperCase();
  const amount = session.amount_total ? fromMinorUnit(session.amount_total, currency) : 0;
  
  // Конвертируем в PLN если нужно
  let amountPln = amount;
  let exchangeRate = 1;
  let exchangeRateFetchedAt = null;
  
  if (currency !== 'PLN') {
    try {
      const rate = await getRate(currency, 'PLN');
      amountPln = roundBankers(amount * rate);
      exchangeRate = roundBankers(rate, 6);
      exchangeRateFetchedAt = new Date().toISOString();
    } catch (error) {
      logger.warn('Не удалось конвертировать валюту', {
        sessionId: session.id,
        currency,
        amount,
        error: error.message
      });
    }
  }
  
  // Получаем данные клиента
  const customerEmail = session.customer_details?.email || session.customer_email || null;
  const customerName = session.customer_details?.name || null;
  
  // Определяем тип платежа из metadata
  const paymentType = session.metadata?.payment_type || null;
  const paymentSchedule = session.metadata?.payment_schedule || null;
  
  // Статус платежа
  const paymentStatus = session.payment_status || 'unpaid';
  const status = paymentStatus === 'paid' ? 'processed' : 'pending_metadata';
  
  const paymentRecord = {
    session_id: session.id,
    deal_id: dealId,
    payment_type: paymentType,
    payment_schedule: paymentSchedule,
    currency,
    original_amount: roundBankers(amount),
    amount_pln: roundBankers(amountPln),
    exchange_rate: exchangeRate,
    exchange_rate_fetched_at: exchangeRateFetchedAt,
    payment_status: paymentStatus,
    status,
    customer_email: customerEmail,
    customer_name: customerName,
    checkout_url: session.url || null,
    created_at: session.created ? new Date(session.created * 1000).toISOString() : new Date().toISOString(),
    processed_at: new Date().toISOString(),
    raw_payload: session
  };
  
  return paymentRecord;
}

async function syncSessions() {
  console.log('🔄 Синхронизация Stripe сессий');
  console.log('='.repeat(80));
  console.log(`Период: последние ${DAYS_BACK} дней`);
  console.log('='.repeat(80));
  
  const repository = new StripeRepository();
  
  if (!repository.isEnabled()) {
    console.error('❌ Supabase не настроен. Невозможно синхронизировать сессии.');
    process.exit(1);
  }
  
  try {
    // 1. Загружаем сессии из PRIMARY кабинета
    const primaryStripe = getStripeClient({ type: 'default' });
    const primarySessions = await fetchSessionsFromStripe(primaryStripe, 'PRIMARY', DAYS_BACK);
    
    // 2. Загружаем сессии из EVENTS кабинета
    const eventsStripe = getStripeClient({ type: 'events' });
    const eventsSessions = await fetchSessionsFromStripe(eventsStripe, 'EVENTS', DAYS_BACK);
    
    const allSessions = [...primarySessions, ...eventsSessions];
    console.log(`\n📊 Всего сессий для обработки: ${allSessions.length}`);
    
    // 3. Проверяем существующие записи в базе данных
    console.log('\n🔍 Проверка существующих записей в базе данных...');
    const existingSessions = new Set();
    
    // Получаем все session_id из базы за последние дни
    const twoDaysAgo = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000).toISOString();
    const { data: existingPayments, error: fetchError } = await repository.supabase
      .from('stripe_payments')
      .select('session_id, payment_status, deal_id')
      .gte('created_at', twoDaysAgo);
    
    if (fetchError) {
      logger.error('Ошибка при получении существующих платежей', { error: fetchError });
    } else {
      (existingPayments || []).forEach(p => {
        if (p.session_id) {
          existingSessions.add(p.session_id);
        }
      });
      console.log(`   ✅ Найдено ${existingSessions.size} существующих записей`);
    }
    
    // 4. Обрабатываем каждую сессию
    console.log('\n💾 Обработка сессий...');
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    const accountTypeMap = new Map();
    primarySessions.forEach(s => accountTypeMap.set(s.id, 'PRIMARY'));
    eventsSessions.forEach(s => accountTypeMap.set(s.id, 'EVENTS'));
    
    for (const session of allSessions) {
      try {
        const sessionId = session.id;
        const accountType = accountTypeMap.get(sessionId) || 'UNKNOWN';
        const exists = existingSessions.has(sessionId);
        
        // Получаем существующую запись если есть
        const existingPayment = exists 
          ? await repository.findPaymentBySessionId(sessionId)
          : null;
        
        // Конвертируем сессию в запись платежа
        const paymentRecord = await convertSessionToPaymentRecord(session, accountType);
        
        // Если запись существует, обновляем статус и другие поля
        if (existingPayment) {
          // Обновляем только если статус изменился или есть важные изменения
          const statusChanged = existingPayment.payment_status !== paymentRecord.payment_status;
          const dealIdChanged = existingPayment.deal_id !== paymentRecord.deal_id && paymentRecord.deal_id;
          
          if (statusChanged || dealIdChanged) {
            // Обновляем запись
            const updateData = {
              payment_status: paymentRecord.payment_status,
              status: paymentRecord.status,
              updated_at: new Date().toISOString()
            };
            
            if (dealIdChanged && paymentRecord.deal_id) {
              updateData.deal_id = paymentRecord.deal_id;
            }
            
            // Обновляем через upsert
            await repository.savePayment({
              ...existingPayment,
              ...paymentRecord,
              ...updateData
            });
            
            updated++;
            console.log(`   ✅ Обновлена: ${sessionId} (${paymentRecord.payment_status})`);
          } else {
            skipped++;
          }
        } else {
          // Создаем новую запись
          await repository.savePayment(paymentRecord);
          added++;
          console.log(`   ➕ Добавлена: ${sessionId} (${paymentRecord.deal_id || 'без deal_id'})`);
        }
      } catch (error) {
        errors++;
        logger.error('Ошибка при обработке сессии', {
          sessionId: session.id,
          error: error.message,
          stack: error.stack
        });
        console.log(`   ❌ Ошибка: ${session.id} - ${error.message}`);
      }
    }
    
    // 5. Итоговая статистика
    console.log('\n' + '='.repeat(80));
    console.log('📊 ИТОГОВАЯ СТАТИСТИКА:');
    console.log('='.repeat(80));
    console.log(`   Всего сессий обработано: ${allSessions.length}`);
    console.log(`   ➕ Добавлено новых: ${added}`);
    console.log(`   🔄 Обновлено существующих: ${updated}`);
    console.log(`   ⏭️  Пропущено (без изменений): ${skipped}`);
    console.log(`   ❌ Ошибок: ${errors}`);
    console.log(`\n   PRIMARY кабинет: ${primarySessions.length} сессий`);
    console.log(`   EVENTS кабинет: ${eventsSessions.length} сессий`);
    
    // Статистика по статусам
    const paidCount = allSessions.filter(s => s.payment_status === 'paid').length;
    const unpaidCount = allSessions.filter(s => s.payment_status !== 'paid').length;
    console.log(`\n   💳 Оплачено: ${paidCount}`);
    console.log(`   ⏳ Не оплачено: ${unpaidCount}`);
    
    // Статистика по deal_id
    const withDealId = allSessions.filter(s => s.metadata?.deal_id).length;
    const withoutDealId = allSessions.length - withDealId;
    console.log(`\n   🔗 С deal_id: ${withDealId}`);
    console.log(`   ⚠️  Без deal_id: ${withoutDealId}`);
    
    if (withoutDealId > 0) {
      console.log(`\n   ⚠️  ВНИМАНИЕ: ${withoutDealId} сессий без deal_id не могут быть связаны с клиентами!`);
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('✅ Синхронизация завершена!');
    console.log('='.repeat(80) + '\n');
    
  } catch (error) {
    logger.error('Критическая ошибка при синхронизации', {
      error: error.message,
      stack: error.stack
    });
    console.error('\n❌ Критическая ошибка:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

syncSessions();

