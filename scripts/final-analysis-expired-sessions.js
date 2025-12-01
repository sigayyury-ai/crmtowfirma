#!/usr/bin/env node

/**
 * Финальный анализ истекших сессий с учетом графика платежей и существующих платежей
 * Определяет, кому и какие сессии нужно создать
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const EXCLUDED_EMAILS = ['sigayyury@gmail.com', 'victoriusova@gmail.com'];

async function finalAnalysis() {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const sevenDaysAgoDate = new Date(sevenDaysAgo * 1000).toISOString().split('T')[0];

    console.log(`🔍 ФИНАЛЬНЫЙ АНАЛИЗ истекших сессий за последние 7 дней (с ${sevenDaysAgoDate})...\n`);

    // Получаем все истекшие сессии
    const expiredSessions = [];
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = {
        limit: 100,
        expand: ['data.line_items', 'data.customer'],
        created: { gte: sevenDaysAgo },
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
        
        if (!customerEmail || EXCLUDED_EMAILS.includes(customerEmail.toLowerCase())) {
          continue;
        }

        const dealId = session.metadata?.deal_id || null;
        if (!dealId) {
          continue;
        }

        expiredSessions.push({
          sessionId: session.id,
          dealId,
          customerEmail,
          amount: session.amount_total ? (session.amount_total / 100) : null,
          currency: session.currency?.toUpperCase() || 'PLN',
          created: new Date(session.created * 1000).toISOString().split('T')[0],
          paymentType: session.metadata?.payment_type || null,
          paymentSchedule: session.metadata?.payment_schedule || null,
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

    console.log(`📋 Найдено истекших сессий: ${expiredSessions.length}\n`);

    if (expiredSessions.length === 0) {
      console.log('✅ Нет истекших сессий для анализа');
      return;
    }

    // Группируем по dealId
    const dealsMap = new Map();
    for (const expiredSession of expiredSessions) {
      if (!dealsMap.has(expiredSession.dealId)) {
        dealsMap.set(expiredSession.dealId, {
          dealId: expiredSession.dealId,
          expiredSessions: [],
          customerEmail: expiredSession.customerEmail
        });
      }
      dealsMap.get(expiredSession.dealId).expiredSessions.push(expiredSession);
    }

    console.log(`📊 Анализ ${dealsMap.size} сделок...\n`);

    const recommendations = [];

    // Анализируем каждую сделку
    for (const [dealId, dealData] of dealsMap) {
      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult || !dealResult.success) {
          recommendations.push({
            dealId,
            status: 'ERROR',
            error: `Не удалось получить данные сделки: ${dealResult?.error || 'unknown'}`,
            action: null
          });
          continue;
        }

        const deal = dealResult.deal;
        const person = dealResult.person;
        const customerEmail = person?.email?.[0]?.value || person?.email || dealData.customerEmail;

        // Определяем ТЕКУЩИЙ график платежей
        let currentPaymentSchedule = '100%';
        let secondPaymentDate = null;
        const closeDate = deal.expected_close_date || deal.close_date;
        
        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 30) {
            currentPaymentSchedule = '50/50';
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          }
        }

        // Получаем ВСЕ платежи для сделки
        const allPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 100
        });

        // Анализируем существующие платежи
        const depositPayments = allPayments.filter(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') &&
          p.payment_status === 'paid'
        );

        const restPayments = allPayments.filter(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
          p.payment_status === 'paid'
        );

        const singlePayments = allPayments.filter(p => 
          (p.payment_type === 'single' || (!p.payment_type && p.payment_status === 'paid'))
        );

        const openSessions = allPayments.filter(p => 
          p.status === 'open' || (p.status === 'complete' && p.payment_status !== 'paid')
        );

        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';

        // Определяем, что нужно создать
        let action = null;
        let reason = '';

        // Если есть активные сессии - ничего не делаем
        if (openSessions.length > 0) {
          action = 'SKIP';
          reason = `Уже есть активная сессия (${openSessions.length})`;
        }
        // Если график 50/50
        else if (currentPaymentSchedule === '50/50') {
          if (depositPayments.length === 0) {
            // Нужен первый платеж
            action = 'CREATE_FIRST';
            reason = 'График 50/50, первый платеж не оплачен';
          } else if (restPayments.length === 0) {
            // Первый оплачен, проверяем дату второго платежа
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const secondDate = new Date(secondPaymentDate);
            secondDate.setHours(0, 0, 0, 0);
            
            if (secondDate <= today) {
              action = 'CREATE_SECOND';
              reason = 'График 50/50, первый платеж оплачен, дата второго платежа наступила';
            } else {
              action = 'SKIP';
              reason = `График 50/50, первый платеж оплачен, второй платеж еще не нужен (дата: ${secondPaymentDate.toISOString().split('T')[0]})`;
            }
          } else {
            action = 'SKIP';
            reason = 'График 50/50, оба платежа оплачены';
          }
        }
        // Если график 100%
        else {
          // ВАЖНО: Проверяем историю платежей!
          // Если был оплачен депозит (когда график был 50/50), нужно создать второй платеж
          if (depositPayments.length > 0 && restPayments.length === 0) {
            action = 'CREATE_REST';
            reason = 'График 100%, но был оплачен депозит (график изменился с 50/50), нужен остаток';
          } else if (singlePayments.length > 0 || (depositPayments.length > 0 && restPayments.length > 0)) {
            action = 'SKIP';
            reason = 'Платеж уже полностью оплачен';
          } else {
            action = 'CREATE_SINGLE';
            reason = 'График 100%, платежей нет';
          }
        }

        recommendations.push({
          dealId,
          dealTitle: deal.title,
          customerEmail,
          dealValue,
          currency,
          currentPaymentSchedule,
          closeDate,
          secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null,
          existingPayments: {
            deposit: depositPayments.length,
            rest: restPayments.length,
            single: singlePayments.length,
            open: openSessions.length
          },
          action,
          reason,
          amountToCreate: action === 'CREATE_FIRST' ? dealValue / 2 :
                          action === 'CREATE_SECOND' ? dealValue / 2 :
                          action === 'CREATE_REST' ? dealValue - depositPayments.reduce((sum, p) => sum + parseFloat(p.original_amount || 0), 0) :
                          action === 'CREATE_SINGLE' ? dealValue : null
        });

      } catch (error) {
        recommendations.push({
          dealId,
          status: 'ERROR',
          error: error.message,
          action: null
        });
      }
    }

    // Выводим результаты
    console.log('\n' + '='.repeat(100));
    console.log('📊 РЕЗУЛЬТАТЫ ФИНАЛЬНОГО АНАЛИЗА');
    console.log('='.repeat(100) + '\n');

    const createFirst = recommendations.filter(r => r.action === 'CREATE_FIRST');
    const createSecond = recommendations.filter(r => r.action === 'CREATE_SECOND');
    const createRest = recommendations.filter(r => r.action === 'CREATE_REST');
    const createSingle = recommendations.filter(r => r.action === 'CREATE_SINGLE');
    const skip = recommendations.filter(r => r.action === 'SKIP');
    const errors = recommendations.filter(r => r.status === 'ERROR');

    console.log(`✅ НУЖНО СОЗДАТЬ ПЕРВЫЙ ПЛАТЕЖ (deposit, 50%): ${createFirst.length}`);
    if (createFirst.length > 0) {
      createFirst.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   📧 Клиент: ${item.customerEmail}`);
        console.log(`   💰 Сумма: ${item.amountToCreate.toFixed(2)} ${item.currency} (50% от ${item.dealValue.toFixed(2)})`);
        console.log(`   📅 График: ${item.currentPaymentSchedule}`);
        console.log(`   📅 Начало лагеря: ${item.closeDate || 'N/A'}`);
        console.log(`   📅 Дата второго платежа: ${item.secondPaymentDate || 'N/A'}`);
        console.log(`   ℹ️  Причина: ${item.reason}`);
      });
    }

    console.log(`\n✅ НУЖНО СОЗДАТЬ ВТОРОЙ ПЛАТЕЖ (rest, 50%): ${createSecond.length}`);
    if (createSecond.length > 0) {
      createSecond.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   📧 Клиент: ${item.customerEmail}`);
        console.log(`   💰 Сумма: ${item.amountToCreate.toFixed(2)} ${item.currency} (50% от ${item.dealValue.toFixed(2)})`);
        console.log(`   📅 График: ${item.currentPaymentSchedule}`);
        console.log(`   📅 Дата второго платежа: ${item.secondPaymentDate}`);
        console.log(`   ⚠️  Дата наступила или просрочена!`);
        console.log(`   ℹ️  Причина: ${item.reason}`);
      });
    }

    console.log(`\n✅ НУЖНО СОЗДАТЬ ОСТАТОК (rest, после депозита): ${createRest.length}`);
    if (createRest.length > 0) {
      createRest.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   📧 Клиент: ${item.customerEmail}`);
        console.log(`   💰 Сумма: ${item.amountToCreate.toFixed(2)} ${item.currency} (остаток после депозита)`);
        console.log(`   📅 График: ${item.currentPaymentSchedule} (был 50/50, изменился на 100%)`);
        console.log(`   📅 Начало лагеря: ${item.closeDate || 'N/A'}`);
        console.log(`   ⚠️  ВАЖНО: Был оплачен депозит, когда график был 50/50, теперь график 100%`);
        console.log(`   ℹ️  Причина: ${item.reason}`);
      });
    }

    console.log(`\n✅ НУЖНО СОЗДАТЬ ЕДИНЫЙ ПЛАТЕЖ (100%): ${createSingle.length}`);
    if (createSingle.length > 0) {
      createSingle.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   📧 Клиент: ${item.customerEmail}`);
        console.log(`   💰 Сумма: ${item.amountToCreate.toFixed(2)} ${item.currency}`);
        console.log(`   📅 График: ${item.currentPaymentSchedule}`);
        console.log(`   📅 Начало лагеря: ${item.closeDate || 'N/A'}`);
        console.log(`   ℹ️  Причина: ${item.reason}`);
      });
    }

    console.log(`\n⏸️  ПРОПУСКАЕМ (уже есть активные или все оплачено): ${skip.length}`);
    if (skip.length > 0) {
      skip.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.dealTitle} - ${item.reason}`);
      });
    }

    if (errors.length > 0) {
      console.log(`\n❌ ОШИБКИ: ${errors.length}`);
      errors.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.error}`);
      });
    }

    console.log('\n' + '='.repeat(100));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(100));
    console.log(`Всего истекших сессий: ${expiredSessions.length}`);
    console.log(`Всего сделок для анализа: ${dealsMap.size}`);
    console.log(`\nНужно создать:`);
    console.log(`  ✅ Первых платежей (deposit): ${createFirst.length}`);
    console.log(`  ✅ Вторых платежей (rest, 50/50): ${createSecond.length}`);
    console.log(`  ✅ Остатков (rest, после депозита): ${createRest.length}`);
    console.log(`  ✅ Единых платежей (single): ${createSingle.length}`);
    console.log(`  ⏸️  Пропустить: ${skip.length}`);
    console.log(`  ❌ Ошибок: ${errors.length}`);

    console.log('\n' + '='.repeat(100));
    console.log('🎯 РЕКОМЕНДАЦИИ ПО ДЕЙСТВИЯМ');
    console.log('='.repeat(100));
    
    const totalToCreate = createFirst.length + createSecond.length + createRest.length + createSingle.length;
    if (totalToCreate > 0) {
      console.log(`\n📋 Всего нужно создать ${totalToCreate} сессий:`);
      console.log(`\n1. Для сделок с графиком 50/50 без первого платежа:`);
      createFirst.forEach(item => {
        console.log(`   - Deal #${item.dealId} → ${item.customerEmail} → ${item.amountToCreate.toFixed(2)} ${item.currency} (deposit)`);
      });
      
      console.log(`\n2. Для сделок с графиком 50/50 со вторым платежом:`);
      createSecond.forEach(item => {
        console.log(`   - Deal #${item.dealId} → ${item.customerEmail} → ${item.amountToCreate.toFixed(2)} ${item.currency} (rest)`);
      });
      
      console.log(`\n3. Для сделок с графиком 100%, но с оплаченным депозитом:`);
      createRest.forEach(item => {
        console.log(`   - Deal #${item.dealId} → ${item.customerEmail} → ${item.amountToCreate.toFixed(2)} ${item.currency} (rest)`);
      });
      
      console.log(`\n4. Для сделок с графиком 100% без платежей:`);
      createSingle.forEach(item => {
        console.log(`   - Deal #${item.dealId} → ${item.customerEmail} → ${item.amountToCreate.toFixed(2)} ${item.currency} (single)`);
      });
    } else {
      console.log(`\n✅ Все сессии уже созданы или не требуются!`);
    }

  } catch (error) {
    logger.error('Ошибка при анализе:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

finalAnalysis();
