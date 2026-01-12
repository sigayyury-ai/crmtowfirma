#!/usr/bin/env node

/**
 * Скрипт для создания новых Stripe Checkout Sessions для истекших сессий
 * 
 * Исключает тестовые email: sigayyury@gmail.com, victoriusova@gmail.com
 * 
 * ЛОГИКА СОЗДАНИЯ СЕССИЙ (с учетом всего флоу):
 * 1. Проверяет существующие платежи для каждой сделки
 * 2. Определяет текущий график платежей (50/50 если >30 дней до начала лагеря)
 * 3. Учитывает историю платежей:
 *    - Если график 50/50 и нет первого платежа → создает deposit (50%)
 *    - Если график 50/50 и первый оплачен → создает rest (50%), если дата наступила
 *    - Если график 100% и был оплачен депозит → создает rest (остаток после депозита)
 *    - Если график 100% и нет платежей → создает single (100%)
 * 4. Правильно рассчитывает сумму остатка для случаев, когда график изменился с 50/50 на 100%
 * 
 * Обновляет данные в базе stripe_payments
 * Отправляет уведомление в Pipedrive через SendPulse
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const SendPulseClient = require('../src/services/sendpulse');
const logger = require('../src/utils/logger');

// Email адреса для исключения
const EXCLUDED_EMAILS = ['sigayyury@gmail.com', 'victoriusova@gmail.com'];

// Deal ID для исключения (например, для отложенного создания)
const EXCLUDED_DEAL_IDS = process.env.EXCLUDED_DEAL_IDS 
  ? process.env.EXCLUDED_DEAL_IDS.split(',').map(id => String(id.trim()))
  : [];

async function recreateExpiredSessions() {
  try {
    const stripe = getStripeClient();
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();
    
    // Инициализация SendPulse (если настроен)
    let sendpulseClient = null;
    try {
      if (process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET) {
        sendpulseClient = new SendPulseClient();
        logger.info('SendPulse client initialized');
      }
    } catch (error) {
      logger.warn('SendPulse not available, notifications will be skipped', { error: error.message });
    }

    // Фильтр: последние 7 дней
    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const sevenDaysAgoDate = new Date(sevenDaysAgo * 1000).toISOString().split('T')[0];

    console.log(`🔍 Поиск истекших сессий за последние 7 дней (с ${sevenDaysAgoDate})...\n`);

    const expiredSessions = [];
    let hasMore = true;
    let startingAfter = null;

    // Получаем все истекшие сессии
    while (hasMore) {
      const params = {
        limit: 100,
        expand: ['data.line_items', 'data.customer'],
        created: {
          gte: sevenDaysAgo
        },
        status: 'expired'
      };

      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const sessions = await stripe.checkout.sessions.list(params);

      for (const session of sessions.data) {
        if (session.created < sevenDaysAgo) {
          hasMore = false;
          break;
        }

        const customerEmail = session.customer_details?.email || session.customer_email || null;
        
        // Пропускаем исключенные email
        if (!customerEmail || EXCLUDED_EMAILS.includes(customerEmail.toLowerCase())) {
          continue;
        }

        // Проверяем, что это не тестовая сессия
        const dealId = session.metadata?.deal_id || null;
        if (!dealId) {
          logger.warn('Session without deal_id, skipping', { sessionId: session.id, customerEmail });
          continue;
        }

        // Пропускаем исключенные dealId
        if (EXCLUDED_DEAL_IDS.includes(String(dealId))) {
          logger.info('Deal excluded from processing', { dealId, sessionId: session.id });
          continue;
        }

        // Проверяем, нет ли уже активной сессии для этого deal
        // ВАЖНО: Проверяем как в БД, так и напрямую в Stripe API
        const existingPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 10
        });

        // Проверяем активные сессии в Stripe API напрямую
        // ВАЖНО: Не используем status: 'open' фильтр, так как он может быть медленным
        // Вместо этого проверяем все сессии для этого deal и фильтруем по статусу
        let hasActiveSessionInStripe = false;
        try {
          // Получаем все сессии за последние 7 дней (включая истекшие)
          // Это быстрее, чем фильтр по status: 'open'
          const allSessions = await stripe.checkout.sessions.list({
            limit: 100,
            created: {
              gte: sevenDaysAgo
            }
          });
          
          // Фильтруем по deal_id и проверяем статус
          hasActiveSessionInStripe = allSessions.data.some(s => {
            const sessionDealId = s.metadata?.deal_id || s.metadata?.dealId;
            return String(sessionDealId) === String(dealId) && s.status === 'open';
          });
        } catch (error) {
          logger.warn('Failed to check active sessions in Stripe', { dealId, error: error.message });
        }

        // Проверяем статус в БД (но только для реально активных сессий)
        // Используем Promise.all для проверки всех сессий в БД
        let hasActiveSessionInDb = false;
        if (existingPayments.length > 0) {
          const sessionChecks = await Promise.all(
            existingPayments.map(async (p) => {
              if (!p.session_id) return false;
              
              // Если статус 'complete', сессия точно оплачена - пропускаем
              if (p.status === 'complete') return true;
              
              // Если статус 'open', проверяем реальный статус в Stripe
              if (p.status === 'open') {
                try {
                  const stripeSession = await stripe.checkout.sessions.retrieve(p.session_id);
                  // Если сессия реально открыта (не истекла), значит есть активная сессия
                  return stripeSession.status === 'open';
                } catch (error) {
                  // Если сессия не найдена или ошибка, считаем что активной нет
                  return false;
                }
              }
              
              return false;
            })
          );
          
          hasActiveSessionInDb = sessionChecks.some(r => r === true);
        }

        if (hasActiveSessionInStripe || hasActiveSessionInDb) {
          logger.info('Deal already has active session, skipping', { 
            dealId, 
            sessionId: session.id,
            hasActiveSessionInStripe,
            hasActiveSessionInDb
          });
          continue;
        }

        expiredSessions.push({
          sessionId: session.id,
          dealId,
          customerEmail,
          amount: session.amount_total ? (session.amount_total / 100) : null,
          currency: session.currency?.toUpperCase() || 'PLN',
          created: new Date(session.created * 1000).toISOString().split('T')[0],
          metadata: session.metadata || {}
        });
      }

      hasMore = sessions.has_more;
      if (sessions.data.length > 0) {
        startingAfter = sessions.data[sessions.data.length - 1].id;
      } else {
        hasMore = false;
      }
    }

    console.log(`📋 Найдено истекших сессий для обработки: ${expiredSessions.length}\n`);

    if (expiredSessions.length === 0) {
      console.log('✅ Нет истекших сессий для обработки');
      return;
    }

    const results = {
      created: 0,
      errors: [],
      skipped: []
    };

    // Обрабатываем каждую сессию
    for (const expiredSession of expiredSessions) {
      try {
        console.log(`\n🔄 Обработка сессии ${expiredSession.sessionId} для Deal #${expiredSession.dealId}`);
        console.log(`   Email: ${expiredSession.customerEmail}`);
        console.log(`   Сумма: ${expiredSession.amount} ${expiredSession.currency}`);

        // Получаем данные сделки
        const dealResult = await processor.pipedriveClient.getDeal(expiredSession.dealId);
        if (!dealResult || !dealResult.success) {
          throw new Error(`Failed to fetch deal: ${dealResult?.error || 'unknown'}`);
        }

        const deal = dealResult.deal;

        // Получаем ВСЕ существующие платежи для сделки
        const allExistingPayments = await repository.listPayments({
          dealId: String(expiredSession.dealId),
          limit: 100
        });

        // Анализируем существующие платежи
        const depositPayments = allExistingPayments.filter(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') &&
          p.payment_status === 'paid'
        );

        const restPayments = allExistingPayments.filter(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'paid'
        );

        const singlePayments = allExistingPayments.filter(p => 
          (p.payment_type === 'single' || (!p.payment_type && p.payment_status === 'paid'))
        );

        // Определяем ТЕКУЩИЙ график платежей (50/50 если >30 дней до expected_close_date)
        let currentPaymentSchedule = '100%';
        let secondPaymentDate = null;
        const closeDate = deal.expected_close_date || deal.close_date;
        
        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 30) {
            currentPaymentSchedule = '50/50';
            // Дата второго платежа = expected_close_date - 1 месяц
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          }
        }

        console.log(`   Текущий график платежей: ${currentPaymentSchedule}`);
        if (depositPayments.length > 0) {
          console.log(`   ⚠️  Найден оплаченный депозит (${depositPayments.length} шт.)`);
        }
        if (restPayments.length > 0) {
          console.log(`   ⚠️  Найден оплаченный остаток (${restPayments.length} шт.)`);
        }
        if (singlePayments.length > 0) {
          console.log(`   ⚠️  Найден единый платеж (${singlePayments.length} шт.)`);
        }

        // Определяем, что нужно создать, учитывая историю платежей
        let paymentType = null;
        let paymentSchedule = currentPaymentSchedule;
        let customAmount = null;
        let paymentIndex = null;

        // Если график 50/50
        if (currentPaymentSchedule === '50/50') {
          if (depositPayments.length === 0) {
            // Нужен первый платеж
            paymentType = 'deposit';
            paymentIndex = 1;
            console.log(`   ✅ Создаем первый платеж (deposit, 50%)`);
          } else if (restPayments.length === 0) {
            // Первый оплачен, проверяем дату второго платежа
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const secondDate = new Date(secondPaymentDate);
            secondDate.setHours(0, 0, 0, 0);
            
            if (secondDate <= today) {
              paymentType = 'rest';
              paymentIndex = 2;
              console.log(`   ✅ Создаем второй платеж (rest, 50%) - дата наступила`);
            } else {
              throw new Error(`Второй платеж еще не нужен (дата: ${secondPaymentDate.toISOString().split('T')[0]})`);
            }
          } else {
            throw new Error('Оба платежа уже оплачены');
          }
        }
        // Если график 100%
        else {
          // ВАЖНО: Проверяем историю платежей!
          // Если был оплачен депозит (когда график был 50/50), нужно создать остаток
          if (depositPayments.length > 0 && restPayments.length === 0) {
            paymentType = 'rest';
            paymentSchedule = '100%'; // Текущий график
            // Рассчитываем сумму остатка
            const dealValue = parseFloat(deal.value) || 0;
            const paidAmount = depositPayments.reduce((sum, p) => sum + parseFloat(p.original_amount || 0), 0);
            customAmount = dealValue - paidAmount;
            console.log(`   ✅ Создаем остаток (rest) после депозита: ${customAmount.toFixed(2)} ${deal.currency || 'PLN'}`);
            console.log(`   ⚠️  ВАЖНО: Был оплачен депозит ${paidAmount.toFixed(2)}, когда график был 50/50`);
          } else if (singlePayments.length > 0 || (depositPayments.length > 0 && restPayments.length > 0)) {
            throw new Error('Платеж уже полностью оплачен');
          } else {
            paymentType = 'single';
            console.log(`   ✅ Создаем единый платеж (single, 100%)`);
          }
        }

        if (!paymentType) {
          throw new Error('Не удалось определить тип платежа');
        }

        const sessionContext = {
          trigger: 'manual_recreate',
          runId: `recreate_${Date.now()}`,
          paymentType,
          paymentSchedule,
          paymentIndex,
          skipNotification: true // Отправим уведомление отдельно
        };

        // Если нужно создать остаток после депозита, передаем кастомную сумму
        if (customAmount !== null) {
          sessionContext.customAmount = customAmount;
        }

        const sessionResult = await processor.createCheckoutSessionForDeal(deal, sessionContext);

        if (!sessionResult.success) {
          throw new Error(sessionResult.error || 'Failed to create session');
        }

        console.log(`   ✅ Создана новая сессия: ${sessionResult.sessionId}`);
        console.log(`   🔗 URL: ${sessionResult.sessionUrl}`);

        // Проверяем, что сессия имеет deal_id в metadata (для автоматизации статусов)
        try {
          const stripe = getStripeClient();
          const createdSession = await stripe.checkout.sessions.retrieve(sessionResult.sessionId);
          const sessionDealId = createdSession.metadata?.deal_id;
          
          if (sessionDealId !== String(expiredSession.dealId)) {
            logger.warn('Deal ID mismatch in session metadata', {
              expected: expiredSession.dealId,
              actual: sessionDealId
            });
            console.log(`   ⚠️  Предупреждение: deal_id в metadata не совпадает`);
          } else {
            console.log(`   ✅ deal_id корректно сохранен в metadata сессии`);
          }
        } catch (checkError) {
          logger.warn('Failed to verify session metadata', { error: checkError.message });
        }

        // Сохраняем платеж в базу данных для отслеживания
        // ВАЖНО: Сессия со статусом 'open' не сохраняется автоматически при создании
        // Сохранение происходит только через webhook при оплате
        // Но мы сохраняем заранее, чтобы платеж был привязан к сделке
        // repository.js автоматически обработает отсутствие колонки payment_schedule если её нет в БД
        const paymentData = {
          session_id: sessionResult.sessionId,
          deal_id: String(expiredSession.dealId),
          customer_email: expiredSession.customerEmail,
          original_amount: sessionResult.amount,
          currency: sessionResult.currency,
          payment_type: paymentType,
          payment_schedule: paymentSchedule, // Сохраняем график платежей
          status: 'open',
          payment_status: 'unpaid', // Сессия еще не оплачена
          created_at: new Date().toISOString()
        };

        await repository.savePayment(paymentData);
        console.log(`   💾 Платеж сохранен в базу данных (deal_id: ${expiredSession.dealId})`);
        
        // Проверяем, что платеж действительно сохранен
        const savedPayment = await repository.findPaymentBySessionId(sessionResult.sessionId);
        if (savedPayment && savedPayment.deal_id === String(expiredSession.dealId)) {
          console.log(`   ✅ Подтверждено: платеж привязан к сделке Deal #${expiredSession.dealId}`);
        } else {
          throw new Error('Платеж не был сохранен или deal_id не совпадает');
        }

        // Отправляем уведомление в Pipedrive через SendPulse
        if (sendpulseClient) {
          try {
            // Получаем person из сделки для SendPulse ID
            const dealWithRelated = await processor.pipedriveClient.getDealWithRelatedData(expiredSession.dealId);
            const person = dealWithRelated?.person;
            const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
            const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY] || person?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'];

            if (sendpulseId) {
              // Формируем сообщение с информацией о сроке действия и второй ссылке
              let message = `🔔 Новая ссылка на оплату\n\n`;
              message += `Сумма: ${sessionResult.amount} ${sessionResult.currency}\n`;
              
              if (paymentType === 'deposit') {
                message += `График: 50/50 (первый платеж)\n\n`;
                message += `⏰ Ссылка доступна 24 часа для оплаты\n`;
                message += `📧 Вторую ссылку на оплату пришлём позже\n\n`;
              } else if (paymentType === 'rest') {
                if (depositPayments.length > 0) {
                  message += `График: Остаток после депозита\n\n`;
                } else {
                  message += `График: 50/50 (второй платеж)\n\n`;
                }
                message += `⏰ Ссылка доступна 24 часа для оплаты\n\n`;
              } else {
                message += `График: 100%\n\n`;
                message += `⏰ Ссылка доступна 24 часа для оплаты\n\n`;
              }
              
              message += `[Оплатить](${sessionResult.sessionUrl})`;

              const notifyResult = await sendpulseClient.sendTelegramMessage(sendpulseId, message);
              
              // Phase 9: Update SendPulse contact custom field with deal_id
              if (notifyResult.success) {
                try {
                  await sendpulseClient.updateContactCustomField(sendpulseId, {
                    deal_id: String(deal.id)
                  });
                  logger.debug('SendPulse contact deal_id updated', { dealId: deal.id, sendpulseId });
                } catch (error) {
                  logger.warn('Failed to update SendPulse contact deal_id', {
                    dealId: deal.id,
                    sendpulseId,
                    error: error.message
                  });
                }
              }
              
              if (notifyResult.success) {
                console.log(`   📨 Уведомление отправлено в Telegram`);
              } else {
                console.log(`   ⚠️  Не удалось отправить уведомление: ${notifyResult.error}`);
              }
            } else {
              console.log(`   ℹ️  SendPulse ID не найден в person, уведомление пропущено`);
            }
          } catch (notifyError) {
            logger.warn('Failed to send notification', {
              dealId: expiredSession.dealId,
              error: notifyError.message
            });
            console.log(`   ⚠️  Ошибка отправки уведомления: ${notifyError.message}`);
          }
        } else {
          console.log(`   ℹ️  SendPulse не настроен, уведомление пропущено`);
        }

        results.created++;

      } catch (error) {
        logger.error('Error recreating session', {
          sessionId: expiredSession.sessionId,
          dealId: expiredSession.dealId,
          error: error.message
        });
        results.errors.push({
          sessionId: expiredSession.sessionId,
          dealId: expiredSession.dealId,
          error: error.message
        });
        console.log(`   ❌ Ошибка: ${error.message}`);
      }
    }

    console.log(`\n\n📊 РЕЗУЛЬТАТЫ:`);
    console.log(`✅ Создано новых сессий: ${results.created}`);
    console.log(`❌ Ошибок: ${results.errors.length}`);
    
    if (results.errors.length > 0) {
      console.log(`\n❌ Ошибки:`);
      results.errors.forEach(err => {
        console.log(`   Deal #${err.dealId}: ${err.error}`);
      });
    }

    console.log(`\n\n✅ АВТОМАТИЗАЦИЯ:`);
    console.log(`После оплаты сессии автоматически произойдет:`);
    console.log(`   1. Webhook получит событие checkout.session.completed`);
    console.log(`   2. Платеж будет обработан через persistSession()`);
    console.log(`   3. Статус сделки обновится автоматически:`);
    console.log(`      - Первый платеж (deposit, 50%) → Second Payment (ID: 32)`);
    console.log(`      - Единый платеж (single, 100%) → Camp Waiter (ID: 27)`);
    console.log(`      - Второй платеж (rest, 50%) → Camp Waiter (ID: 27)`);
    console.log(`      - Остаток после депозита (rest) → Camp Waiter (ID: 27)`);
    console.log(`   4. invoice_type обновится на "Done" (73) после оплаты`);
    console.log(`   5. Все данные будут сохранены в stripe_payments с deal_id`);
    console.log(`\n💡 Никаких ручных действий не требуется!`);
    console.log(`\n📋 ЛОГИКА СОЗДАНИЯ СЕССИЙ:`);
    console.log(`   ✅ Учитывает существующие платежи`);
    console.log(`   ✅ Учитывает историю графика платежей`);
    console.log(`   ✅ Правильно рассчитывает сумму остатка`);
    console.log(`   ✅ Создает правильный тип платежа (deposit/rest/single)`);

  } catch (error) {
    logger.error('Ошибка при создании новых сессий:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

recreateExpiredSessions();
