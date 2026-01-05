#!/usr/bin/env node

/**
 * Скрипт для проверки застрявших платежей и сделок
 * Проверяет все сделки в статусах "First Payment" (18) и "Second Payment" (32)
 * 
 * Что проверяет:
 * 1. Выставлена ли оплата через Stripe или проформы
 * 2. Отправлены ли сообщения (проверка SendPulse ID)
 * 3. Есть ли активные (не истекшие) checkout сессии
 * 4. Нужно ли создать новую сессию (если старая истекла)
 * 5. Нужно ли отправить напоминание (сессия старше 24 часов)
 * 
 * Использование:
 *   node scripts/check-stuck-payments.js [--fix] [--deal-id=ID]
 * 
 * Опции:
 *   --fix          Автоматически исправлять проблемы (создавать сессии, отправлять напоминания)
 *   --deal-id=ID   Проверить только конкретную сделку
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');
const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const ProformaRepository = require('../src/services/proformaRepository');
const SendPulseClient = require('../src/services/sendpulse');
const logger = require('../src/utils/logger');

const STAGE_IDS = {
  FIRST_PAYMENT: 18,
  SECOND_PAYMENT: 32
};

const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';

// Парсинг аргументов командной строки
const args = process.argv.slice(2);
const options = {
  fix: args.includes('--fix'),
  dealId: args.find(arg => arg.startsWith('--deal-id='))?.split('=')[1] || null
};

async function checkStuckPayments() {
  try {
    const pipedriveClient = new PipedriveClient();
    const stripeProcessor = new StripeProcessorService();
    const stripeRepository = new StripeRepository();
    const proformaRepository = new ProformaRepository();
    let sendpulseClient = null;
    
    try {
      if (process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET) {
        sendpulseClient = new SendPulseClient();
      }
    } catch (error) {
      logger.warn('SendPulse not available', { error: error.message });
    }

    console.log('🔍 Поиск сделок в статусах First Payment и Second Payment...\n');

    // Получаем все открытые сделки
    const dealsResult = await pipedriveClient.getDeals({
      limit: 500,
      start: 0,
      status: 'open'
    });

    if (!dealsResult.success) {
      console.error('❌ Ошибка получения сделок:', dealsResult.error);
      return;
    }

    // Фильтруем сделки по стадиям и опционально по deal ID
    let targetDeals = dealsResult.deals.filter(deal => 
      deal.stage_id === STAGE_IDS.FIRST_PAYMENT || deal.stage_id === STAGE_IDS.SECOND_PAYMENT
    );
    
    if (options.dealId) {
      targetDeals = targetDeals.filter(deal => String(deal.id) === String(options.dealId));
      if (targetDeals.length === 0) {
        console.log(`❌ Сделка #${options.dealId} не найдена в статусах First Payment или Second Payment`);
        return;
      }
    }

    console.log(`📊 Найдено сделок: ${targetDeals.length}\n`);
    console.log('='.repeat(100));

    const results = {
      total: targetDeals.length,
      withStripePayments: 0,
      withProformas: 0,
      withActiveSessions: 0,
      withExpiredSessions: 0,
      withoutPayments: 0,
      needsReminder: 0,
      needsNewSession: 0,
      stuck: []
    };

    for (const deal of targetDeals) {
      const dealId = String(deal.id);
      const stageName = deal.stage_id === STAGE_IDS.FIRST_PAYMENT ? 'First Payment' : 'Second Payment';
      
      // Получаем полные данные сделки с персоной
      const fullDealResult = await pipedriveClient.getDealWithRelatedData(dealId);
      const fullDeal = fullDealResult?.deal || deal;
      const person = fullDealResult?.person || deal.person;
      
      console.log(`\n📋 Deal #${dealId}: ${fullDeal.title || deal.title}`);
      console.log(`   Статус: ${stageName} (${fullDeal.stage_id || deal.stage_id})`);
      console.log(`   Сумма: ${fullDeal.value || deal.value} ${fullDeal.currency || deal.currency || 'PLN'}`);
      console.log(`   Клиент: ${person?.name || 'N/A'}`);

      // Определяем дату закрытия заранее для использования в dealInfo
      const closeDate = fullDeal.expected_close_date || fullDeal.close_date;
      let daysUntilClose = null;
      
      if (closeDate) {
        const expectedCloseDate = new Date(closeDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        expectedCloseDate.setHours(0, 0, 0, 0);
        daysUntilClose = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
      }

      const dealInfo = {
        dealId: fullDeal.id || deal.id,
        title: fullDeal.title || deal.title,
        stageId: fullDeal.stage_id || deal.stage_id,
        stageName,
        value: fullDeal.value || deal.value,
        currency: fullDeal.currency || deal.currency || 'PLN',
        personName: person?.name || 'N/A',
        personEmail: person?.email?.[0]?.value || person?.email || 'N/A',
        expectedCloseDate: closeDate || null,
        daysUntilClose: daysUntilClose !== null ? daysUntilClose : null,
        issues: [],
        recommendations: []
      };

      // 1. Проверяем Stripe платежи
      const stripePayments = await stripeRepository.listPayments({
        dealId: dealId,
        limit: 10
      });

      const paidStripePayments = stripePayments?.filter(p => p.payment_status === 'paid') || [];
      const unpaidStripePayments = stripePayments?.filter(p => p.payment_status !== 'paid') || [];

      console.log(`   💳 Stripe платежей: ${stripePayments?.length || 0} (оплачено: ${paidStripePayments.length}, не оплачено: ${unpaidStripePayments.length})`);

      // Инициализируем массивы для сессий (до блока if)
      const activeSessions = [];
      const expiredSessions = [];

      if (stripePayments && stripePayments.length > 0) {
        results.withStripePayments++;
        
        // Проверяем каждую неоплаченную сессию в Stripe API
        
        for (const payment of unpaidStripePayments) {
          if (payment.session_id) {
            try {
              const session = await stripeProcessor.stripe.checkout.sessions.retrieve(payment.session_id);
              const isExpired = session.status === 'expired' || session.status === 'canceled';
              const isPaid = session.payment_status === 'paid';
              const hoursSinceCreated = session.created ? Math.floor((Date.now() - session.created * 1000) / (1000 * 60 * 60)) : 0;
              
              if (isPaid) {
                // Сессия оплачена, но статус в БД не обновлен
                console.log(`      ✅ Сессия ${payment.session_id} оплачена в Stripe, но статус в БД не обновлен`);
                dealInfo.issues.push(`Сессия ${payment.session_id} оплачена, но статус в БД не обновлен`);
                dealInfo.recommendations.push(`Обновить статус платежа ${payment.session_id} в БД`);
              } else if (isExpired) {
                expiredSessions.push({
                  payment,
                  session,
                  hoursSinceCreated
                });
                console.log(`      ⚠️  Истекшая сессия: ${payment.session_id} (${hoursSinceCreated}ч назад)`);
                dealInfo.issues.push(`Сессия ${payment.session_id} истекла ${hoursSinceCreated}ч назад`);
                dealInfo.recommendations.push(`Создать новую сессию вместо ${payment.session_id}`);
              } else {
                // Активная сессия
                activeSessions.push({
                  payment,
                  session,
                  hoursSinceCreated
                });
                results.withActiveSessions++;
                console.log(`      ✅ Активная сессия: ${payment.session_id} (${hoursSinceCreated}ч назад)`);
                
                // Проверяем, нужно ли напоминание (сессия старше 24 часов)
                if (hoursSinceCreated >= 24) {
                  results.needsReminder++;
                  dealInfo.issues.push(`Сессия ${payment.session_id} активна ${hoursSinceCreated}ч, но не оплачена - нужно напоминание`);
                  dealInfo.recommendations.push(`Отправить напоминание о платеже ${payment.session_id}`);
                }
              }
            } catch (error) {
              console.log(`      ⚠️  Ошибка проверки сессии ${payment.session_id}: ${error.message}`);
              dealInfo.issues.push(`Ошибка проверки сессии ${payment.session_id}: ${error.message}`);
            }
          }
        }

        // Проверяем истекшие сессии
        if (expiredSessions.length > 0) {
          results.withExpiredSessions += expiredSessions.length;
          results.needsNewSession++;
        }
      }

      // 2. Проверяем проформы
      const proformas = await proformaRepository.findByDealId(dealId);
      console.log(`   📄 Проформ: ${proformas?.length || 0}`);
      
      if (proformas && proformas.length > 0) {
        results.withProformas++;
        proformas.forEach(p => {
          console.log(`      - ${p.fullnumber || p.id}: ${p.total} ${p.currency}`);
        });
      }

      // 3. Проверяем, есть ли вообще платежи
      if ((!stripePayments || stripePayments.length === 0) && (!proformas || proformas.length === 0)) {
        results.withoutPayments++;
        dealInfo.issues.push('Нет ни Stripe платежей, ни проформ');
        dealInfo.recommendations.push('Создать Stripe сессию или проформу');
        console.log(`   ⚠️  НЕТ ПЛАТЕЖЕЙ!`);
      }

      // 4. Проверяем отправку уведомлений (через SendPulse ID)
      const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];
      
      if (sendpulseId) {
        console.log(`   📧 SendPulse ID: ${sendpulseId} (уведомления возможны)`);
      } else {
        console.log(`   ⚠️  SendPulse ID отсутствует - уведомления не отправляются`);
        dealInfo.issues.push('SendPulse ID не найден - уведомления не отправляются');
      }

      // 4.5. Выводим информацию о дате закрытия сделки (уже определена выше)
      let isCloseDateRelevant = false;
      
      if (closeDate) {
        console.log(`   📅 Дата закрытия: ${closeDate} (${daysUntilClose > 0 ? `через ${daysUntilClose} дней` : daysUntilClose === 0 ? 'сегодня' : `${Math.abs(daysUntilClose)} дней назад`})`);
        // Дата закрытия релевантна для определения, застряла ли сделка
        isCloseDateRelevant = true;
      } else {
        console.log(`   📅 Дата закрытия: не указана`);
      }

      // 5. Определяем, застряла ли сделка
      // Сделка застряла, если:
      // - Есть проблемы (issues), НО учитываем дату закрытия
      // - Нет активных сессий И есть истекшие сессии (нужна новая сессия)
      // - Нет платежей вообще (ни Stripe, ни проформ) - для First Payment это критично, ЕСЛИ дата закрытия близко
      // - Для Second Payment: первый платеж оплачен, но нет второго платежа, ЕСЛИ дата закрытия уже прошла
      const hasActiveSessions = activeSessions && activeSessions.length > 0;
      const hasExpiredSessions = expiredSessions && expiredSessions.length > 0;
      const hasAnyPayments = (stripePayments && stripePayments.length > 0) || (proformas && proformas.length > 0);
      
      const isSecondPaymentStage = dealInfo.stageId === STAGE_IDS.SECOND_PAYMENT;
      const hasPaidFirstPayment = paidStripePayments.length > 0;
      
      // Фильтруем issues с учетом даты закрытия
      const relevantIssues = [];
      
      // Истекшие сессии - всегда проблема
      if (hasExpiredSessions && !hasActiveSessions) {
        relevantIssues.push('expired_sessions');
      }
      
      // Проблемы с платежами - только если дата закрытия релевантна
      if (!hasAnyPayments) {
        if (isSecondPaymentStage) {
          // Second Payment: проблема только если дата закрытия уже прошла или близко (в пределах 60 дней)
          // Учитываем что второй платеж обычно выставляется за месяц до закрытия или в день закрытия
          if (!isCloseDateRelevant || daysUntilClose <= 60) {
            if (!hasPaidFirstPayment) {
              relevantIssues.push('no_payments');
            }
          } else {
            console.log(`   ℹ️  Дата закрытия через ${daysUntilClose} дней - второй платеж еще не требуется`);
          }
        } else {
          // First Payment: проблема только если дата закрытия близко (меньше 30 дней) или уже прошла
          if (!isCloseDateRelevant || daysUntilClose <= 30) {
            relevantIssues.push('no_payments');
          } else {
            console.log(`   ℹ️  Дата закрытия через ${daysUntilClose} дней - первый платеж еще не требуется`);
            // Убираем issue о отсутствии платежей, если дата закрытия далеко
            const noPaymentsIssueIndex = dealInfo.issues.findIndex(i => i.includes('Нет ни Stripe платежей'));
            if (noPaymentsIssueIndex >= 0) {
              dealInfo.issues.splice(noPaymentsIssueIndex, 1);
              const noPaymentsRecIndex = dealInfo.recommendations.findIndex(r => r.includes('Создать Stripe сессию'));
              if (noPaymentsRecIndex >= 0) {
                dealInfo.recommendations.splice(noPaymentsRecIndex, 1);
              }
            }
          }
        }
      }
      
      // SendPulse ID - не критично для определения "застрявшей", но оставляем в issues
      const sendPulseIssueIndex = dealInfo.issues.findIndex(i => i.includes('SendPulse ID'));
      if (sendPulseIssueIndex >= 0) {
        // Оставляем issue, но не считаем это критичным для "застрявшей"
      }
      
      const isStuck = 
        relevantIssues.length > 0 ||
        (hasExpiredSessions && !hasActiveSessions) ||
        (dealInfo.issues.some(i => i.includes('оплачена, но статус'))); // Оплаченные, но не обновленные - всегда проблема

      if (isStuck) {
        results.stuck.push(dealInfo);
        console.log(`   🚨 ЗАСТРЯВШАЯ СДЕЛКА!`);
        
        // Автоматическое исправление, если включено
        if (options.fix) {
          console.log(`   🔧 Попытка автоматического исправления...`);
          
          // 1. Если нет платежей и это First Payment - создаем Stripe сессию
          if (!hasAnyPayments && dealInfo.stageId === STAGE_IDS.FIRST_PAYMENT) {
            try {
              console.log(`      💳 Создание Stripe сессии для Deal #${dealId}...`);
              const sessionResult = await stripeProcessor.createCheckoutSessionForDeal(fullDeal, {
                trigger: 'manual_fix',
                runId: `fix_${Date.now()}`,
                paymentType: 'single',
                paymentSchedule: '100%'
              });
              
              if (sessionResult.success) {
                console.log(`      ✅ Сессия создана: ${sessionResult.sessionId}`);
                dealInfo.fixed = true;
                dealInfo.fixAction = `Создана Stripe сессия ${sessionResult.sessionId}`;
              } else {
                console.log(`      ❌ Ошибка создания сессии: ${sessionResult.error}`);
                dealInfo.fixError = sessionResult.error;
              }
            } catch (error) {
              console.log(`      ❌ Ошибка: ${error.message}`);
              dealInfo.fixError = error.message;
            }
          }
          
          // 2. Если есть истекшие сессии - создаем новые
          if (expiredSessions.length > 0) {
            for (const expired of expiredSessions) {
              try {
                console.log(`      💳 Создание новой сессии вместо истекшей ${expired.payment.session_id}...`);
                const sessionResult = await stripeProcessor.createCheckoutSessionForDeal(fullDeal, {
                  trigger: 'manual_fix',
                  runId: `fix_${Date.now()}`,
                  paymentType: expired.payment.payment_type || 'single',
                  paymentSchedule: expired.payment.payment_schedule || '100%'
                });
                
                if (sessionResult.success) {
                  console.log(`      ✅ Новая сессия создана: ${sessionResult.sessionId}`);
                  if (!dealInfo.fixActions) dealInfo.fixActions = [];
                  dealInfo.fixActions.push(`Создана новая сессия ${sessionResult.sessionId} вместо ${expired.payment.session_id}`);
                } else {
                  console.log(`      ❌ Ошибка создания сессии: ${sessionResult.error}`);
                }
              } catch (error) {
                console.log(`      ❌ Ошибка: ${error.message}`);
              }
            }
          }
        }
      }

      console.log('   ' + '-'.repeat(96));
    }

    // Итоговая сводка
    console.log('\n' + '='.repeat(100));
    console.log('📊 ИТОГОВАЯ СВОДКА:');
    console.log('='.repeat(100));
    console.log(`Всего сделок проверено: ${results.total}`);
    console.log(`С Stripe платежами: ${results.withStripePayments}`);
    console.log(`С проформами: ${results.withProformas}`);
    console.log(`С активными сессиями: ${results.withActiveSessions}`);
    console.log(`С истекшими сессиями: ${results.withExpiredSessions}`);
    console.log(`Без платежей: ${results.withoutPayments}`);
    console.log(`Требуют напоминания: ${results.needsReminder}`);
    console.log(`Требуют новой сессии: ${results.needsNewSession}`);
    console.log(`\n🚨 ЗАСТРЯВШИХ СДЕЛОК: ${results.stuck.length}`);

    if (results.stuck.length > 0) {
      console.log('\n' + '='.repeat(100));
      console.log('🚨 СПИСОК ЗАСТРЯВШИХ СДЕЛОК:');
      console.log('='.repeat(100));
      
      results.stuck.forEach((deal, index) => {
        console.log(`\n${index + 1}. Deal #${deal.dealId}: ${deal.title}`);
        console.log(`   Статус: ${deal.stageName}`);
        console.log(`   Клиент: ${deal.personName}`);
        console.log(`   Сумма: ${deal.value} ${deal.currency}`);
        console.log(`   Проблемы:`);
        deal.issues.forEach(issue => {
          console.log(`     - ${issue}`);
        });
        console.log(`   Рекомендации:`);
        deal.recommendations.forEach(rec => {
          console.log(`     - ${rec}`);
        });
      });

      // Сохраняем результаты в файл
      const fs = require('fs');
      const outputFile = `tmp/stuck-payments-${new Date().toISOString().split('T')[0]}.json`;
      fs.mkdirSync('tmp', { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
      console.log(`\n💾 Результаты сохранены в: ${outputFile}`);
    }

  } catch (error) {
    console.error('❌ Ошибка:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

checkStuckPayments();

