#!/usr/bin/env node

/**
 * Детальный анализ истекших сессий с учетом графика платежей
 * Определяет, кому и какие сессии нужно создать
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { getStripeClient } = require('../src/services/stripe/client');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const EXCLUDED_EMAILS = ['sigayyury@gmail.com', 'victoriusova@gmail.com'];

async function analyzeExpiredSessions() {
  try {
    const stripe = getStripeClient();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();

    const sevenDaysAgo = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000);
    const sevenDaysAgoDate = new Date(sevenDaysAgo * 1000).toISOString().split('T')[0];

    console.log(`🔍 Анализ истекших сессий за последние 7 дней (с ${sevenDaysAgoDate})...\n`);

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

    const analysis = {
      needFirstPayment: [],
      needSecondPayment: [],
      needSinglePayment: [],
      alreadyHaveActive: [],
      errors: []
    };

    // Анализируем каждую сделку
    for (const [dealId, dealData] of dealsMap) {
      try {
        // Получаем данные сделки
        const dealResult = await pipedriveClient.getDealWithRelatedData(dealId);
        if (!dealResult || !dealResult.success) {
          analysis.errors.push({
            dealId,
            error: `Failed to fetch deal: ${dealResult?.error || 'unknown'}`
          });
          continue;
        }

        const deal = dealResult.deal;
        const person = dealResult.person;
        const customerEmail = person?.email?.[0]?.value || person?.email || dealData.customerEmail;

        // Определяем график платежей
        let paymentSchedule = '100%';
        let secondPaymentDate = null;
        const closeDate = deal.expected_close_date || deal.close_date;
        
        if (closeDate) {
          const expectedCloseDate = new Date(closeDate);
          const today = new Date();
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          if (daysDiff >= 30) {
            paymentSchedule = '50/50';
            // Дата второго платежа = expected_close_date - 1 месяц
            secondPaymentDate = new Date(expectedCloseDate);
            secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
          }
        }

        // Получаем все платежи для сделки
        const allPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 100
        });

        // Анализируем существующие платежи
        const depositPayment = allPayments.find(p => 
          (p.payment_type === 'deposit' || p.payment_type === 'first') &&
          p.payment_status === 'paid'
        );

        const restPayment = allPayments.find(p => 
          (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final')
        );

        const hasActiveSession = allPayments.some(p => {
          if (!p.session_id) return false;
          return p.status === 'complete' || p.status === 'open';
        });

        // Определяем, что нужно создать
        const dealValue = parseFloat(deal.value) || 0;
        const currency = deal.currency || 'PLN';

        if (hasActiveSession) {
          analysis.alreadyHaveActive.push({
            dealId,
            dealTitle: deal.title,
            customerEmail,
            reason: 'Уже есть активная сессия'
          });
          continue;
        }

        if (paymentSchedule === '50/50') {
          if (!depositPayment) {
            // Нужен первый платеж (deposit)
            analysis.needFirstPayment.push({
              dealId,
              dealTitle: deal.title,
              customerEmail,
              amount: dealValue / 2,
              currency,
              paymentSchedule: '50/50',
              paymentType: 'deposit',
              expectedCloseDate: closeDate,
              secondPaymentDate: secondPaymentDate?.toISOString().split('T')[0] || null
            });
          } else if (!restPayment) {
            // Первый платеж оплачен, нужен второй
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const secondDate = new Date(secondPaymentDate);
            secondDate.setHours(0, 0, 0, 0);
            
            if (secondDate <= today) {
              analysis.needSecondPayment.push({
                dealId,
                dealTitle: deal.title,
                customerEmail,
                amount: dealValue / 2,
                currency,
                paymentSchedule: '50/50',
                paymentType: 'rest',
                expectedCloseDate: closeDate,
                secondPaymentDate: secondPaymentDate.toISOString().split('T')[0],
                daysUntilSecondPayment: Math.ceil((secondPaymentDate - today) / (1000 * 60 * 60 * 24))
              });
            }
          }
        } else {
          // График 100% - нужен единый платеж
          const singlePayment = allPayments.find(p => 
            (p.payment_type === 'single' || !p.payment_type) &&
            p.payment_status === 'paid'
          );

          if (!singlePayment) {
            analysis.needSinglePayment.push({
              dealId,
              dealTitle: deal.title,
              customerEmail,
              amount: dealValue,
              currency,
              paymentSchedule: '100%',
              paymentType: 'single',
              expectedCloseDate: closeDate
            });
          }
        }

      } catch (error) {
        analysis.errors.push({
          dealId,
          error: error.message
        });
      }
    }

    // Выводим результаты
    console.log('\n' + '='.repeat(80));
    console.log('📊 РЕЗУЛЬТАТЫ АНАЛИЗА');
    console.log('='.repeat(80) + '\n');

    console.log(`✅ Нужно создать первый платеж (deposit, 50%): ${analysis.needFirstPayment.length}`);
    if (analysis.needFirstPayment.length > 0) {
      console.log('\n📋 Список сделок для первого платежа:');
      analysis.needFirstPayment.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   Клиент: ${item.customerEmail}`);
        console.log(`   Сумма: ${item.amount.toFixed(2)} ${item.currency} (50% от ${(item.amount * 2).toFixed(2)})`);
        console.log(`   График: ${item.paymentSchedule}`);
        console.log(`   Начало лагеря: ${item.expectedCloseDate || 'N/A'}`);
        console.log(`   Дата второго платежа: ${item.secondPaymentDate || 'N/A'}`);
      });
    }

    console.log(`\n✅ Нужно создать второй платеж (rest, 50%): ${analysis.needSecondPayment.length}`);
    if (analysis.needSecondPayment.length > 0) {
      console.log('\n📋 Список сделок для второго платежа:');
      analysis.needSecondPayment.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   Клиент: ${item.customerEmail}`);
        console.log(`   Сумма: ${item.amount.toFixed(2)} ${item.currency} (50% от ${(item.amount * 2).toFixed(2)})`);
        console.log(`   График: ${item.paymentSchedule}`);
        console.log(`   Дата второго платежа: ${item.secondPaymentDate}`);
        console.log(`   Дней до платежа: ${item.daysUntilSecondPayment}`);
        console.log(`   ⚠️  Дата наступила или просрочена!`);
      });
    }

    console.log(`\n✅ Нужно создать единый платеж (100%): ${analysis.needSinglePayment.length}`);
    if (analysis.needSinglePayment.length > 0) {
      console.log('\n📋 Список сделок для единого платежа:');
      analysis.needSinglePayment.forEach((item, index) => {
        console.log(`\n${index + 1}. Deal #${item.dealId}: ${item.dealTitle}`);
        console.log(`   Клиент: ${item.customerEmail}`);
        console.log(`   Сумма: ${item.amount.toFixed(2)} ${item.currency}`);
        console.log(`   График: ${item.paymentSchedule}`);
        console.log(`   Начало лагеря: ${item.expectedCloseDate || 'N/A'}`);
      });
    }

    console.log(`\n⏸️  Уже есть активные сессии: ${analysis.alreadyHaveActive.length}`);
    if (analysis.alreadyHaveActive.length > 0) {
      analysis.alreadyHaveActive.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.dealTitle} - ${item.reason}`);
      });
    }

    if (analysis.errors.length > 0) {
      console.log(`\n❌ Ошибки: ${analysis.errors.length}`);
      analysis.errors.forEach((item, index) => {
        console.log(`   ${index + 1}. Deal #${item.dealId}: ${item.error}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('📝 ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(80));
    console.log(`Всего истекших сессий: ${expiredSessions.length}`);
    console.log(`Всего сделок для анализа: ${dealsMap.size}`);
    console.log(`\nНужно создать:`);
    console.log(`  - Первых платежей (deposit): ${analysis.needFirstPayment.length}`);
    console.log(`  - Вторых платежей (rest): ${analysis.needSecondPayment.length}`);
    console.log(`  - Единых платежей (single): ${analysis.needSinglePayment.length}`);
    console.log(`  - Уже есть активные: ${analysis.alreadyHaveActive.length}`);
    console.log(`  - Ошибок: ${analysis.errors.length}`);

  } catch (error) {
    logger.error('Ошибка при анализе:', error);
    console.error('❌ Критическая ошибка:', error.message);
    process.exit(1);
  }
}

analyzeExpiredSessions();
