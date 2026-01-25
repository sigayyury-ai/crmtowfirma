#!/usr/bin/env node

/**
 * Исправление дат processed_at для платежей от 07.01.2026
 * Устанавливает реальную дату оплаты из Stripe events вместо даты обработки
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

function toIso(secondsOrIso) {
  if (!secondsOrIso && secondsOrIso !== 0) return null;
  if (typeof secondsOrIso === 'string') {
    const parsed = new Date(secondsOrIso);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof secondsOrIso === 'number' && Number.isFinite(secondsOrIso)) {
    return new Date(secondsOrIso * 1000).toISOString();
  }
  return null;
}

function extractPaidTimestamp(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }
  const transitions = rawPayload.status_transitions || {};
  if (Number.isFinite(transitions.paid_at)) {
    return transitions.paid_at;
  }
  if (Number.isFinite(transitions.completed_at)) {
    return transitions.completed_at;
  }
  if (Number.isFinite(rawPayload.created)) {
    return rawPayload.created;
  }
  if (
    rawPayload.payment_intent
    && typeof rawPayload.payment_intent === 'object'
    && Number.isFinite(rawPayload.payment_intent.created)
  ) {
    return rawPayload.payment_intent.created;
  }
  return null;
}

async function fixJanuary7Payments() {
  console.log('🔧 Исправление дат processed_at для платежей от 07.01.2026\n');
  console.log('='.repeat(80));

  try {
    // Находим все платежи от 07.01.2026
    const { data: payments, error } = await supabase
      .from('stripe_payments')
      .select(`
        id,
        session_id,
        created_at,
        processed_at,
        amount_pln,
        customer_name,
        customer_email,
        raw_payload,
        payment_status
      `)
      .or(`processed_at.gte.2026-01-07T00:00:00,created_at.gte.2026-01-07T00:00:00`)
      .or(`processed_at.lte.2026-01-07T23:59:59,created_at.lte.2026-01-07T23:59:59`)
      .eq('payment_status', 'paid')
      .order('processed_at', { ascending: false });

    if (error) {
      console.error('❌ Ошибка поиска платежей:', error);
      return;
    }

    console.log(`Найдено ${payments?.length || 0} платежей от 07.01.2026\n`);

    const updates = [];
    let fixedCount = 0;
    let skippedCount = 0;

    for (const payment of payments || []) {
      let rawPayload = payment.raw_payload;
      if (typeof rawPayload === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload);
        } catch (parseError) {
          logger.warn('Failed to parse raw_payload JSON', {
            id: payment.id,
            session_id: payment.session_id
          });
          skippedCount++;
          continue;
        }
      }

      const paidTimestamp = extractPaidTimestamp(rawPayload);
      if (!paidTimestamp) {
        skippedCount++;
        continue;
      }

      const realProcessedAt = toIso(paidTimestamp);
      if (!realProcessedAt) {
        skippedCount++;
        continue;
      }

      const currentProcessedAt = payment.processed_at;
      const realDate = new Date(realProcessedAt);
      const currentDate = currentProcessedAt ? new Date(currentProcessedAt) : null;

      // Проверяем, нужно ли исправлять
      if (currentDate && realDate.toISOString().split('T')[0] === currentDate.toISOString().split('T')[0]) {
        // Даты совпадают, пропускаем
        skippedCount++;
        continue;
      }

      // Проверяем, что реальная дата в декабре 2025 или начале января 2026
      const realYear = realDate.getFullYear();
      const realMonth = realDate.getMonth() + 1;
      
      if (realYear === 2025 && realMonth === 12) {
        // Реальная дата в декабре 2025 - исправляем
        updates.push({
          id: payment.id,
          session_id: payment.session_id,
          processed_at: realProcessedAt
        });
        fixedCount++;
        
        console.log(`✅ ${payment.customer_name || payment.customer_email || 'N/A'}: ${payment.amount_pln} PLN`);
        console.log(`   Текущая дата: ${currentProcessedAt || 'NULL'} -> Реальная дата: ${realProcessedAt}`);
      } else if (realYear === 2026 && realMonth === 1 && realDate.getDate() <= 7) {
        // Реальная дата в начале января 2026 - тоже может быть неправильной, но оставляем как есть
        skippedCount++;
      } else {
        skippedCount++;
      }
    }

    console.log(`\n📊 Статистика:`);
    console.log(`   Всего платежей: ${payments?.length || 0}`);
    console.log(`   Требуют исправления: ${fixedCount}`);
    console.log(`   Пропущено: ${skippedCount}`);

    if (updates.length === 0) {
      console.log('\n✅ Нет платежей для исправления');
      return;
    }

    console.log(`\n🔧 Исправление ${updates.length} платежей...`);

    // Применяем обновления батчами по 100
    const chunks = [];
    for (let i = 0; i < updates.length; i += 100) {
      chunks.push(updates.slice(i, i + 100));
    }

    for (const chunk of chunks) {
      const { error: updateError } = await supabase
        .from('stripe_payments')
        .upsert(chunk, { onConflict: 'id' });

      if (updateError) {
        console.error('❌ Ошибка обновления:', updateError);
        throw new Error(`Failed to update stripe_payments: ${updateError.message}`);
      }
    }

    console.log(`\n✅ Успешно исправлено ${updates.length} платежей!`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Ошибка выполнения:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  fixJanuary7Payments();
}






