#!/usr/bin/env node

/**
 * Скрипт для замены тестовых неоплаченных сессий на live-сессии
 * 
 * Что делает:
 * 1. Находит все тестовые (cs_test_*) неоплаченные сессии
 * 2. Удаляет их из БД
 * 3. Создает новые live-сессии
 * 4. Отправляет уведомления клиентам
 * 
 * ВАЖНО: Всегда используется live режим
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');
const readline = require('readline');

// Проверяем флаг --yes для автоматического подтверждения
const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

let rl = null;
if (!autoConfirm) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(question) {
  if (autoConfirm) {
    console.log(question + ' (auto: yes)');
    return Promise.resolve('yes');
  }
  return new Promise(resolve => rl.question(question, resolve));
}

async function main() {
  // Всегда live режим
  const stripeMode = 'live';
  
  console.log('\n=== Замена тестовых сессий на live ===\n');
  console.log(`📊 Режим: ${stripeMode} (только live режим используется)`);
      console.log('Отмена.');
      if (rl) rl.close();
      process.exit(0);
    }
  }
  
  const repository = new StripeRepository();
  const processor = new StripeProcessorService();
  const schedulerService = new SecondPaymentSchedulerService();
  
  // Получаем все платежи
  console.log('\n🔍 Поиск тестовых неоплаченных сессий...\n');
  
  const allPayments = await repository.listPayments({ limit: 500 });
  
  // Фильтруем тестовые неоплаченные
  const testUnpaid = allPayments.filter(p => 
    p.session_id && 
    p.session_id.startsWith('cs_test_') &&
    (p.payment_status === 'unpaid' || p.payment_status === 'pending')
  );
  
  if (testUnpaid.length === 0) {
    console.log('✅ Тестовых неоплаченных сессий не найдено.');
    if (rl) rl.close();
    process.exit(0);
  }
  
  console.log(`Найдено ${testUnpaid.length} тестовых неоплаченных сессий:\n`);
  
  for (const p of testUnpaid) {
    console.log(`  Deal #${p.deal_id} | ${p.payment_type} | ${p.original_amount} ${p.currency} | ${p.payment_schedule}`);
  }
  
  const confirm = await ask('\nУдалить эти записи и создать новые live-сессии? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes') {
    console.log('Отмена.');
    if (rl) rl.close();
    process.exit(0);
  }
  
  console.log('\n🚀 Начинаем обработку...\n');
  
  const results = {
    success: [],
    failed: []
  };
  
  for (const payment of testUnpaid) {
    const dealId = payment.deal_id;
    console.log(`\n--- Deal #${dealId} ---`);
    
    try {
      // 1. Удаляем тестовую запись из БД
      console.log(`   🗑️  Удаляем тестовую сессию ${payment.session_id.substring(0, 25)}...`);
      
      await repository.deletePayment(payment.id);
      console.log(`   ✅ Удалено`);
      
      // 2. Получаем данные сделки
      const dealResult = await processor.pipedriveClient.getDealWithRelatedData(dealId);
      if (!dealResult.success || !dealResult.deal) {
        throw new Error(`Deal not found: ${dealResult?.error || 'unknown'}`);
      }
      
      const deal = dealResult.deal;
      console.log(`   📋 ${deal.title}`);
      console.log(`   💰 ${deal.value} ${deal.currency || 'PLN'}`);
      console.log(`   📅 Expected Close: ${deal.expected_close_date || 'N/A'}`);
      
      // 3. Определяем параметры для новой сессии
      // Используем те же параметры что были у тестовой сессии
      const paymentType = payment.payment_type;
      const paymentSchedule = payment.payment_schedule;
      const customAmount = parseFloat(payment.original_amount) || null;
      
      console.log(`   🔧 Создаем ${paymentType} сессию (${paymentSchedule})...`);
      
      const sessionContext = {
        trigger: 'manual_fix_test_to_live',
        runId: `fix_live_${Date.now()}`,
        paymentType: paymentType,
        paymentSchedule: paymentSchedule,
        customAmount: paymentType === 'rest' ? customAmount : null,
        skipNotification: false,
        setInvoiceTypeDone: false
      };
      
      // 4. Создаем новую сессию
      const sessionResult = await processor.createCheckoutSessionForDeal(deal, sessionContext);
      
      if (!sessionResult.success) {
        throw new Error(sessionResult.error || 'Failed to create session');
      }
      
      console.log(`   ✅ Новая сессия создана: ${sessionResult.sessionId.substring(0, 25)}...`);
      console.log(`   🔗 URL: ${sessionResult.sessionUrl}`);
      
      // 5. Отправляем уведомление
      try {
        // Получаем все активные платежи для этой сделки
        const activePayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 10
        });
        
        const sessions = [];
        for (const p of activePayments) {
          if (!p.session_id || p.payment_status === 'paid') continue;
          
          let sessionUrl = p.checkout_url || null;
          if (!sessionUrl && p.raw_payload && p.raw_payload.url) {
            sessionUrl = p.raw_payload.url;
          }
          
          if (sessionUrl) {
            sessions.push({
              id: p.session_id,
              url: sessionUrl,
              type: p.payment_type,
              amount: p.original_amount
            });
          }
        }
        
        // Добавляем новую сессию
        sessions.push({
          id: sessionResult.sessionId,
          url: sessionResult.sessionUrl,
          type: paymentType,
          amount: sessionResult.amount
        });
        
        const notificationResult = await processor.sendPaymentNotificationForDeal(dealId, {
          paymentSchedule: paymentSchedule,
          sessions: sessions,
          currency: sessionResult.currency,
          totalAmount: parseFloat(deal.value) || 0
        });
        
        if (notificationResult.success) {
          console.log(`   📨 Уведомление отправлено`);
        } else {
          console.log(`   ⚠️  Уведомление не отправлено: ${notificationResult.error}`);
        }
      } catch (notifyError) {
        console.log(`   ⚠️  Ошибка уведомления: ${notifyError.message}`);
      }
      
      results.success.push({
        dealId,
        oldSession: payment.session_id,
        newSession: sessionResult.sessionId,
        url: sessionResult.sessionUrl
      });
      
    } catch (error) {
      console.log(`   ❌ Ошибка: ${error.message}`);
      logger.error('Failed to process deal', {
        dealId,
        error: error.message,
        stack: error.stack
      });
      
      results.failed.push({
        dealId,
        error: error.message
      });
    }
    
    // Задержка между запросами
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Итоги
  console.log('\n\n=== ИТОГИ ===\n');
  console.log(`✅ Успешно: ${results.success.length}`);
  console.log(`❌ Ошибки: ${results.failed.length}`);
  
  if (results.success.length > 0) {
    console.log('\n📋 Новые live-ссылки:\n');
    for (const r of results.success) {
      console.log(`Deal #${r.dealId}: ${r.url}`);
    }
  }
  
  if (results.failed.length > 0) {
    console.log('\n❌ Не обработаны:\n');
    for (const r of results.failed) {
      console.log(`Deal #${r.dealId}: ${r.error}`);
    }
  }
  
  if (rl) rl.close();
  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch(error => {
  console.error('\n❌ Критическая ошибка:', error.message);
  if (rl) rl.close();
  process.exit(1);
});

