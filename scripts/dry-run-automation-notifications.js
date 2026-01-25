#!/usr/bin/env node

/**
 * Dry-run диагностика автоматизации статусов и уведомлений для предоплаченной сделки
 * 
 * Использование:
 *   node scripts/dry-run-automation-notifications.js <dealId>
 * 
 * Пример:
 *   node scripts/dry-run-automation-notifications.js 2048
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const StripeStatusAutomationService = require('../src/services/crm/stripeStatusAutomationService');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2];

if (!DEAL_ID) {
  console.error('❌ Usage: node scripts/dry-run-automation-notifications.js <dealId>');
  process.exit(1);
}

async function dryRun() {
  console.log(`\n🔍 DRY-RUN: Диагностика автоматизации и уведомлений для сделки #${DEAL_ID}\n`);
  console.log('='.repeat(80));
  
  try {
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();
    const pipedriveClient = new PipedriveClient();
    const automationService = new StripeStatusAutomationService({
      stripeProcessor: processor
    });
    
    // 1. Получаем данные сделки
    console.log('\n1️⃣ ПОЛУЧЕНИЕ ДАННЫХ СДЕЛКИ');
    console.log('-'.repeat(80));
    
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Сделка #${DEAL_ID} не найдена`);
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    
    console.log(`✅ Сделка найдена:`);
    console.log(`   ID: ${deal.id}`);
    console.log(`   Название: ${deal.title}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency}`);
    console.log(`   Статус: ${deal.status}`);
    console.log(`   Stage ID: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'не указана'}`);
    console.log(`   Клиент: ${person?.name || 'N/A'}`);
    console.log(`   Email: ${person?.email?.[0]?.value || person?.email || 'N/A'}`);
    
    // 2. Получаем платежи
    console.log('\n2️⃣ АНАЛИЗ ПЛАТЕЖЕЙ');
    console.log('-'.repeat(80));
    
    const payments = await repository.listPayments({
      dealId: String(DEAL_ID),
      limit: 100
    });
    
    console.log(`📊 Найдено платежей: ${payments.length}`);
    
    if (payments.length === 0) {
      console.log(`❌ Платежи не найдены в базе данных`);
      console.log(`   ⚠️  Это может быть причиной, почему автоматизация не сработала`);
    } else {
      payments.forEach((p, i) => {
        console.log(`\n   Платеж ${i + 1}:`);
        console.log(`     ID: ${p.id}`);
        console.log(`     Session ID: ${p.session_id || 'N/A'}`);
        console.log(`     Тип: ${p.payment_type || 'N/A'}`);
        console.log(`     Статус: ${p.payment_status || 'N/A'}`);
        console.log(`     Сумма: ${p.original_amount || p.amount || 0} ${p.currency || 'N/A'}`);
        console.log(`     Создан: ${p.created_at || 'N/A'}`);
        console.log(`     Обработан: ${p.processed_at || 'N/A'}`);
      });
    }
    
    const paidPayments = payments.filter(p => 
      p.payment_status === 'paid' || p.status === 'processed'
    );
    
    console.log(`\n✅ Оплаченных платежей: ${paidPayments.length}`);
    
    // 3. Проверка автоматизации статусов
    console.log('\n3️⃣ ПРОВЕРКА АВТОМАТИЗАЦИИ СТАТУСОВ');
    console.log('-'.repeat(80));
    
    // Получаем stage IDs для сделки
    const stageIds = await processor.getStageIdsForDeal(DEAL_ID);
    console.log(`📋 Stage IDs для пайплайна:`);
    console.log(`   First Payment: ${stageIds.firstPayment}`);
    console.log(`   Second Payment: ${stageIds.secondPayment}`);
    console.log(`   Camp Waiter: ${stageIds.campWaiter}`);
    console.log(`   Pipeline ID: ${stageIds.pipelineId || 'N/A'}`);
    console.log(`   Pipeline Name: ${stageIds.pipelineName || 'N/A'}`);
    
    console.log(`\n📊 Текущий статус сделки: ${deal.stage_id}`);
    console.log(`   Ожидаемый First Payment: ${stageIds.firstPayment}`);
    console.log(`   Совпадает: ${deal.stage_id === stageIds.firstPayment ? '✅' : '❌'}`);
    
      // Проверяем, должна ли сработать автоматизация
      const shouldTriggerAutomation = paidPayments.length > 0;
      
      // Проверяем, что должно произойти
      const closeDate = deal.expected_close_date || deal.close_date;
      let isSinglePaymentExpected = false;
      
      if (!shouldTriggerAutomation) {
        console.log(`\n❌ Автоматизация НЕ должна сработать - нет оплаченных платежей`);
      } else {
        console.log(`\n✅ Автоматизация ДОЛЖНА сработать - есть оплаченные платежи`);
      
      if (closeDate) {
        const expectedCloseDate = new Date(closeDate);
        const today = new Date();
        const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
        isSinglePaymentExpected = daysDiff < 30;
        console.log(`\n📅 Анализ графика платежей:`);
        console.log(`   Expected Close Date: ${closeDate}`);
        console.log(`   Дней до кемпа: ${daysDiff}`);
        console.log(`   Ожидается один платеж: ${isSinglePaymentExpected ? '✅' : '❌'}`);
      }
      
      // Проверяем тип платежа
      const firstPayment = paidPayments.find(p => 
        p.payment_type === 'deposit' || p.payment_type === 'first' || p.payment_type === 'single'
      );
      const restPayment = paidPayments.find(p => 
        p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final'
      );
      
      console.log(`\n💳 Анализ платежей:`);
      console.log(`   Первый платеж (deposit/first/single): ${firstPayment ? '✅' : '❌'}`);
      console.log(`   Второй платеж (rest/second/final): ${restPayment ? '✅' : '❌'}`);
      
      // Определяем, какой статус должен быть
      let expectedStageId = null;
      let expectedStageName = null;
      let reason = null;
      
      if (firstPayment && restPayment) {
        // Оба платежа оплачены - должен быть Camp Waiter
        expectedStageId = stageIds.campWaiter;
        expectedStageName = 'Camp Waiter';
        reason = 'Оба платежа оплачены';
      } else if (firstPayment && isSinglePaymentExpected) {
        // Один платеж оплачен, и ожидается только один - Camp Waiter
        expectedStageId = stageIds.campWaiter;
        expectedStageName = 'Camp Waiter';
        reason = 'Единственный платеж оплачен';
      } else if (firstPayment && !isSinglePaymentExpected) {
        // Первый платеж оплачен, ожидается второй - Second Payment
        expectedStageId = stageIds.secondPayment;
        expectedStageName = 'Second Payment';
        reason = 'Первый платеж оплачен, ожидается второй';
      } else if (restPayment) {
        // Второй платеж оплачен - Camp Waiter
        expectedStageId = stageIds.campWaiter;
        expectedStageName = 'Camp Waiter';
        reason = 'Второй платеж оплачен';
      }
      
      console.log(`\n🎯 Ожидаемый статус:`);
      console.log(`   Stage ID: ${expectedStageId || 'N/A'}`);
      console.log(`   Название: ${expectedStageName || 'N/A'}`);
      console.log(`   Причина: ${reason || 'N/A'}`);
      
      console.log(`\n📊 Текущий статус:`);
      console.log(`   Stage ID: ${deal.stage_id}`);
      console.log(`   Ожидаемый: ${expectedStageId || 'N/A'}`);
      console.log(`   Совпадает: ${deal.stage_id === expectedStageId ? '✅' : '❌'}`);
      
      if (deal.stage_id !== expectedStageId) {
        console.log(`\n⚠️  ПРОБЛЕМА: Статус не обновлен!`);
        console.log(`   Текущий: ${deal.stage_id}`);
        console.log(`   Ожидаемый: ${expectedStageId}`);
        
        // Проверяем, почему автоматизация не сработала
        console.log(`\n🔍 Проверка причин:`);
        
        // Проверяем, включена ли автоматизация
        const isAutomationEnabled = automationService.isEnabled && automationService.isEnabled();
        console.log(`   Автоматизация включена: ${isAutomationEnabled ? '✅' : '❌'}`);
        
        // Проверяем snapshot
        try {
          const snapshot = await automationService.buildDealSnapshot(DEAL_ID, deal);
          console.log(`\n   📸 Snapshot:`);
          console.log(`      Stripe платежей: ${snapshot.stripePayments?.length || 0}`);
          console.log(`      Проформ: ${snapshot.proformas?.length || 0}`);
          console.log(`      Оплачено PLN: ${snapshot.totals?.stripePaidPln || 0}`);
          console.log(`      Ожидается PLN: ${snapshot.totals?.expectedAmountPln || 0}`);
          
          // Проверяем, что автоматизация должна сработать
          try {
            const canUpdate = await automationService.syncDealStage(DEAL_ID, { 
              reason: 'dry-run-check',
              dryRun: true 
            });
            console.log(`      Автоматизация может сработать: ✅ (проверка выполнена)`);
          } catch (syncError) {
            console.log(`      ❌ Ошибка проверки автоматизации: ${syncError.message}`);
          }
        } catch (snapshotError) {
          console.log(`   ❌ Ошибка при создании snapshot: ${snapshotError.message}`);
        }
      } else {
        console.log(`\n✅ Статус корректный!`);
      }
    }
    
    // 4. Проверка уведомлений
    console.log('\n4️⃣ ПРОВЕРКА УВЕДОМЛЕНИЙ');
    console.log('-'.repeat(80));
    
    const sendpulseId = process.env.SENDPULSE_ID?.trim();
    const sendpulseSecret = process.env.SENDPULSE_SECRET?.trim();
    const hasSendpulse = !!sendpulseId && !!sendpulseSecret;
    
    console.log(`📧 SendPulse конфигурация:`);
    console.log(`   ID: ${sendpulseId ? '✅ установлен' : '❌ не установлен'}`);
    console.log(`   Secret: ${sendpulseSecret ? '✅ установлен' : '❌ не установлен'}`);
    console.log(`   Клиент инициализирован: ${processor.sendpulseClient ? '✅' : '❌'}`);
    
    if (!hasSendpulse || !processor.sendpulseClient) {
      console.log(`\n❌ Уведомления НЕ могут быть отправлены - SendPulse не настроен`);
    } else {
      console.log(`\n✅ SendPulse настроен, уведомления могут быть отправлены`);
      
      // Проверяем, должны ли уйти уведомления
      const customerEmail = person?.email?.[0]?.value || person?.email;
      if (!customerEmail) {
        console.log(`\n❌ Email клиента не найден - уведомления не могут быть отправлены`);
      } else {
        console.log(`\n📧 Email клиента: ${customerEmail}`);
        
        // Проверяем, не отправлялось ли уже уведомление
        const lastNotificationTime = processor.notificationCache?.get(DEAL_ID);
        if (lastNotificationTime) {
          const timeSinceLastNotification = Date.now() - lastNotificationTime;
          const minutesSince = Math.floor(timeSinceLastNotification / 60000);
          console.log(`\n⏭️  Последнее уведомление отправлено: ${minutesSince} минут назад`);
          console.log(`   TTL кэша: ${processor.notificationCacheTTL / 60000} минут`);
          
          if (timeSinceLastNotification < processor.notificationCacheTTL) {
            console.log(`   ⚠️  Уведомление может быть пропущено из-за кэша`);
          }
        } else {
          console.log(`\n✅ Уведомление не отправлялось ранее (нет в кэше)`);
        }
        
        // Проверяем статус сделки
        if (deal.status === 'lost') {
          console.log(`\n❌ Сделка закрыта как потерянная - уведомления не отправляются`);
        } else {
          console.log(`\n✅ Сделка активна - уведомления могут быть отправлены`);
        }
      }
    }
    
    // 5. Итоговая сводка
    console.log('\n5️⃣ ИТОГОВАЯ СВОДКА');
    console.log('='.repeat(80));
    
    const issues = [];
    const recommendations = [];
    
    if (payments.length === 0) {
      issues.push('Платежи не найдены в базе данных');
      recommendations.push('Запустить синхронизацию Stripe платежей: node scripts/runStripeProcessor.js --deal=' + DEAL_ID);
    }
    
    // Пересчитываем isSinglePaymentExpected для итоговой сводки
    let isSinglePaymentExpectedForSummary = false;
    const closeDateForSummary = deal.expected_close_date || deal.close_date;
    if (closeDateForSummary) {
      const expectedCloseDate = new Date(closeDateForSummary);
      const today = new Date();
      const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
      isSinglePaymentExpectedForSummary = daysDiff < 30;
    }
    
    if (paidPayments.length > 0) {
      const expectedStageId = deal.stage_id === stageIds.firstPayment && isSinglePaymentExpectedForSummary
        ? stageIds.campWaiter
        : deal.stage_id === stageIds.firstPayment && !isSinglePaymentExpectedForSummary
        ? stageIds.secondPayment
        : null;
      
      if (expectedStageId && deal.stage_id !== expectedStageId) {
        issues.push(`Статус не обновлен: текущий ${deal.stage_id}, ожидаемый ${expectedStageId}`);
        recommendations.push('Запустить автоматизацию вручную или проверить логи процессора');
      }
    }
    
    if (!hasSendpulse || !processor.sendpulseClient) {
      issues.push('SendPulse не настроен');
      recommendations.push('Проверить переменные окружения SENDPULSE_ID и SENDPULSE_SECRET');
    }
    
    if (issues.length > 0) {
      console.log(`\n⚠️  ОБНАРУЖЕНЫ ПРОБЛЕМЫ:\n`);
      issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
      
      console.log(`\n💡 РЕКОМЕНДАЦИИ:\n`);
      recommendations.forEach((rec, i) => {
        console.log(`   ${i + 1}. ${rec}`);
      });
    } else {
      console.log(`\n✅ Проблем не обнаружено`);
    }
    
  } catch (error) {
    logger.error('Dry-run failed', { dealId: DEAL_ID, error: error.message });
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

dryRun()
  .then(() => {
    console.log('\n' + '='.repeat(80));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Необработанная ошибка:', error);
    process.exit(1);
  });

