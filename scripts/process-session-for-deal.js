#!/usr/bin/env node

/**
 * Обработка Stripe сессии для сделки (запуск persistSession и всех процессов)
 * Использование: node scripts/process-session-for-deal.js <dealId>
 */

require('dotenv').config();

const { getStripeClient } = require('../src/services/stripe/client');
const StripeProcessorService = require('../src/services/stripe/processor');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2];

if (!DEAL_ID) {
  console.error('❌ Укажите Deal ID');
  console.log('Использование: node scripts/process-session-for-deal.js <dealId>');
  process.exit(1);
}

async function processSession() {
  try {
    const stripe = getStripeClient();
    const processor = new StripeProcessorService();

    console.log(`🔍 Поиск сессий для сделки ${DEAL_ID}...\n`);

    // Получаем все сессии для этой сделки из базы
    const repository = processor.repository;
    const payments = await repository.listPayments({
      dealId: DEAL_ID,
      limit: 10
    });

    // Ищем все сессии, включая уже обработанные
    const sessions = payments.filter(p => p.session_id);

    if (sessions.length === 0) {
      console.log('❌ Сессии не найдены');
      return;
    }

    console.log(`📋 Найдено ${sessions.length} сессий (включая обработанные):\n`);

    console.log(`✅ Найдено ${sessions.length} сессий для обработки:\n`);

    for (const payment of sessions) {
      const sessionId = payment.session_id;
      console.log(`📋 Обработка сессии: ${sessionId}`);

      try {
        // Получаем сессию из Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
          expand: ['line_items', 'payment_intent']
        });

        console.log(`   Статус в Stripe: ${session.status} / ${session.payment_status}`);
        console.log(`   Сумма: ${session.amount_total / 100} ${session.currency.toUpperCase()}`);

        if (session.payment_status === 'paid' && session.status === 'complete') {
          const isAlreadyProcessed = payment.status === 'processed';
          
          if (isAlreadyProcessed) {
            console.log(`\n   ℹ️  Сессия уже обработана, запускаем процессы принудительно...`);
          } else {
            console.log(`\n   ✅ Сессия оплачена, запускаем обработку...`);
            // Запускаем persistSession - это обработает платеж и запустит все процессы
            await processor.persistSession(session);
            console.log(`   ✅ Сессия обработана!`);
          }

          // Принудительно запускаем все процессы (даже если уже обработано):
          console.log(`\n   🔄 Запуск процессов автоматизации...`);
          
          // 1. Обновление статусов в CRM
          console.log(`      → Обновление статусов в CRM...`);
          await processor.triggerCrmStatusAutomation(DEAL_ID, {
            reason: 'manual:process-session'
          });
          console.log(`      ✅ Статусы CRM обновлены`);
          
          // 2. Отправка уведомлений (с forceSend чтобы обойти дедупликацию)
          console.log(`      → Отправка уведомлений...`);
          const notificationResult = await processor.sendPaymentNotificationForDeal(DEAL_ID, {
            paymentSchedule: session.metadata?.payment_schedule || '100%',
            sessions: [session],
            currency: session.currency,
            totalAmount: session.amount_total / 100,
            forceSend: true // Принудительная отправка
          });
          if (notificationResult.success) {
            console.log(`      ✅ Уведомления отправлены`);
          } else {
            console.log(`      ⚠️  Уведомления: ${notificationResult.error || 'пропущены'}`);
          }
          
          console.log(`\n   ✅ Все процессы запущены успешно!`);
        } else {
          console.log(`   ⚠️  Сессия не оплачена (status: ${session.status}, payment_status: ${session.payment_status})`);
        }
      } catch (error) {
        console.error(`   ❌ Ошибка обработки сессии: ${error.message}`);
        logger.error('Failed to process session', { sessionId, error: error.message });
      }

      console.log('');
    }

    console.log('✅ Обработка завершена');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    logger.error('Failed to process sessions', { dealId: DEAL_ID, error: error.message });
    process.exit(1);
  }
}

processSession();

