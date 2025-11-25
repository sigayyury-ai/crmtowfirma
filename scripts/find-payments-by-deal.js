#!/usr/bin/env node

/**
 * Поиск платежей по ID сделки
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('❌ Supabase client is not configured.');
  process.exit(1);
}

const DEAL_ID = process.argv[2];
if (!DEAL_ID) {
  console.error('❌ Укажите ID сделки: node scripts/find-payments-by-deal.js <deal_id>');
  process.exit(1);
}

async function main() {
  console.log(`🔍 Поиск платежей для сделки ${DEAL_ID}\n`);
  console.log('='.repeat(80));

  try {
    // 1. Ищем платежи по deal_id в метаданных Stripe
    console.log('\n1️⃣ Поиск платежей Stripe по deal_id:');
    console.log('-'.repeat(50));

    const { data: stripePayments, error: stripeError } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, source, stripe_session_id, stripe_payment_status, description, deal_id')
      .eq('source', 'stripe')
      .eq('deal_id', DEAL_ID)
      .order('operation_date', { ascending: false })
      .limit(50);

    if (stripeError) {
      console.error('❌ Ошибка поиска Stripe платежей:', stripeError);
    } else if (stripePayments && stripePayments.length > 0) {
      console.log(`✅ Найдено ${stripePayments.length} платежей Stripe:`);
      stripePayments.forEach((p, i) => {
        console.log(`  ${i + 1}. ID: ${p.id}, Сумма: ${p.amount} ${p.currency}, Статус: ${p.stripe_payment_status}, Дата: ${p.operation_date}`);
        if (p.stripe_session_id) {
          console.log(`      Session ID: ${p.stripe_session_id}`);
        }
      });
    } else {
      console.log('❌ Платежи Stripe не найдены');
    }

    // 2. Ищем платежи по proforma_id (связанные через проформы)
    console.log('\n2️⃣ Поиск платежей через проформы:');
    console.log('-'.repeat(50));

    // Сначала найдем проформы для этой сделки
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('id, fullnumber, total, currency, pipedrive_deal_id')
      .eq('pipedrive_deal_id', DEAL_ID)
      .limit(20);

    if (proformaError) {
      console.error('❌ Ошибка поиска проформ:', proformaError);
    } else if (proformas && proformas.length > 0) {
      console.log(`✅ Найдено ${proformas.length} проформ:`);
      proformas.forEach((p, i) => {
        console.log(`  ${i + 1}. Проформа: ${p.fullnumber}, Сумма: ${p.total} ${p.currency}, ID: ${p.id}`);
      });

      // Теперь найдем платежи для этих проформ
      const proformaIds = proformas.map(p => p.id);
      const { data: proformaPayments, error: ppError } = await supabase
        .from('payments')
        .select('id, operation_date, amount, currency, source, proforma_id, manual_status, match_status, description')
        .in('proforma_id', proformaIds)
        .order('operation_date', { ascending: false })
        .limit(50);

      if (ppError) {
        console.error('❌ Ошибка поиска платежей по проформам:', ppError);
      } else if (proformaPayments && proformaPayments.length > 0) {
        console.log(`\n✅ Найдено ${proformaPayments.length} платежей по проформам:`);
        proformaPayments.forEach((p, i) => {
          const proforma = proformas.find(pr => pr.id === p.proforma_id);
          console.log(`  ${i + 1}. ID: ${p.id}, Сумма: ${p.amount} ${p.currency}, Проформа: ${proforma?.fullnumber}, Дата: ${p.operation_date}`);
          console.log(`      Статус: manual=${p.manual_status}, match=${p.match_status}`);
        });
      } else {
        console.log('❌ Платежи по проформам не найдены');
      }
    } else {
      console.log('❌ Проформы для этой сделки не найдены');
    }

    // 3. Общий поиск всех платежей с любыми ссылками на эту сделку
    console.log('\n3️⃣ Общий поиск платежей (JSON metadata):');
    console.log('-'.repeat(50));

    const { data: allPayments, error: allError } = await supabase
      .from('payments')
      .select('id, operation_date, amount, currency, source, metadata, description')
      .order('operation_date', { ascending: false })
      .limit(100);

    if (allError) {
      console.error('❌ Ошибка общего поиска:', allError);
    } else {
      const dealPayments = (allPayments || []).filter(p => {
        if (!p.metadata) return false;
        try {
          const meta = typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata;
          return meta.deal_id == DEAL_ID || meta.dealId == DEAL_ID;
        } catch (e) {
          return false;
        }
      });

      if (dealPayments.length > 0) {
        console.log(`✅ Найдено ${dealPayments.length} платежей с deal_id в metadata:`);
        dealPayments.forEach((p, i) => {
          console.log(`  ${i + 1}. ID: ${p.id}, Сумма: ${p.amount} ${p.currency}, Источник: ${p.source}, Дата: ${p.operation_date}`);
        });
      } else {
        console.log('❌ Платежи с deal_id в metadata не найдены');
      }
    }

    // 4. Проверка webhook логов
    console.log('\n4️⃣ Проверка активности webhook (последние 24 часа):');
    console.log('-'.repeat(50));

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const { data: logs, error: logsError } = await supabase
      .from('webhook_logs')
      .select('id, created_at, event_type, payload')
      .gte('created_at', yesterday.toISOString())
      .order('created_at', { ascending: false })
      .limit(20);

    if (logsError) {
      console.error('❌ Ошибка поиска логов webhook:', logsError);
    } else {
      const dealLogs = (logs || []).filter(log => {
        try {
          const payload = typeof log.payload === 'string' ? JSON.parse(log.payload) : log.payload;
          const dealId = payload?.data?.object?.metadata?.deal_id ||
                        payload?.deal_id ||
                        payload?.current?.id;
          return dealId == DEAL_ID;
        } catch (e) {
          return false;
        }
      });

      if (dealLogs.length > 0) {
        console.log(`✅ Найдено ${dealLogs.length} webhook событий для сделки:`);
        dealLogs.forEach((log, i) => {
          console.log(`  ${i + 1}. ${log.event_type} - ${log.created_at}`);
        });
      } else {
        console.log('❌ Webhook события для этой сделки не найдены');
      }
    }

  } catch (error) {
    console.error('❌ Ошибка выполнения:', error.message);
    process.exit(1);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Поиск завершен');
}

if (require.main === module) {
  main();
}

