#!/usr/bin/env node

/**
 * Создание Stripe Checkout Session для конкретной сделки
 * 
 * Использует ту же логику, что и API эндпоинт:
 * POST /api/pipedrive/deals/:id/diagnostics/actions/create-stripe-session
 * 
 * Использование:
 *   node scripts/create-session-for-deal.js <dealId> [paymentType] [paymentSchedule] [customAmount]
 * 
 * Примеры:
 *   node scripts/create-session-for-deal.js 1775
 *   node scripts/create-session-for-deal.js 1775 deposit 50/50
 *   node scripts/create-session-for-deal.js 1775 rest 50/50 475
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const StripeRepository = require('../src/services/stripe/repository');
const logger = require('../src/utils/logger');

async function createSessionForDeal(dealId, options = {}) {
  const { paymentType, paymentSchedule, customAmount, sendNotification = true } = options;

  try {
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();
    const schedulerService = new SecondPaymentSchedulerService();

    console.log(`🔍 Создание сессии для Deal #${dealId}...\n`);

    // Получаем данные сделки
    const dealResult = await processor.pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Deal not found: ${dealResult?.error || 'unknown'}`);
    }

    const deal = dealResult.deal;
    const person = dealResult.person;
    const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

    console.log(`   Название: ${deal.title}`);
    console.log(`   Email: ${customerEmail}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'не указана'}`);

    // ВАЖНО: Определяем схему на основе expected_close_date
    const scheduleResult = PaymentScheduleService.determineScheduleFromDeal(deal);
    const currentSchedule = scheduleResult.schedule;
    const secondPaymentDate = scheduleResult.secondPaymentDate;

    console.log(`   📊 Схема платежей (по expected_close_date): ${currentSchedule}`);
    if (secondPaymentDate) {
      console.log(`   📅 Дата второго платежа: ${secondPaymentDate.toISOString().split('T')[0]}`);
    }

    // Получаем исходную схему из первого платежа (если есть)
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
    
    // Используем исходную схему, если она была 50/50 (клиент уже оплатил deposit)
    let effectivePaymentSchedule = currentSchedule;
    if (initialSchedule.schedule === '50/50') {
      effectivePaymentSchedule = '50/50';
      console.log(`   📊 Исходная схема из первого платежа: ${initialSchedule.schedule}`);
      console.log(`   ✅ Используем исходную схему: ${effectivePaymentSchedule} (клиент уже оплатил deposit по этой схеме)`);
    } else {
      console.log(`   📊 Используем схему по expected_close_date: ${effectivePaymentSchedule}`);
    }

    // Получаем существующие платежи
    const allPayments = await repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });

    const depositPayments = allPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );

    const restPayments = allPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );

    const singlePayments = allPayments.filter(p => 
      p.payment_type === 'single' && p.payment_status === 'paid'
    );

    if (depositPayments.length > 0) {
      console.log(`   ⚠️  Найден оплаченный депозит (${depositPayments.length} шт.)`);
    }
    if (restPayments.length > 0) {
      console.log(`   ⚠️  Найден оплаченный остаток (${restPayments.length} шт.)`);
    }
    if (singlePayments.length > 0) {
      console.log(`   ⚠️  Найден единый платеж (${singlePayments.length} шт.)`);
    }

    // Определяем параметры для создания сессии
    const sessionContext = {
      trigger: 'manual_scheduled',
      runId: `scheduled_${Date.now()}`,
      paymentType: paymentType || null, // Будет определен автоматически если не указан
      paymentSchedule: paymentSchedule || effectivePaymentSchedule, // Используем эффективную схему
      customAmount: customAmount || null,
      skipNotification: !sendNotification,
      setInvoiceTypeDone: true
    };

    // Если paymentType не указан, определяем автоматически
    if (!sessionContext.paymentType) {
      if (effectivePaymentSchedule === '50/50') {
        if (depositPayments.length === 0) {
          sessionContext.paymentType = 'deposit';
          sessionContext.paymentIndex = 1;
          console.log(`   ✅ Создаем первый платеж (deposit, 50%)`);
        } else if (restPayments.length === 0) {
          sessionContext.paymentType = 'rest';
          sessionContext.paymentIndex = 2;
          console.log(`   ✅ Создаем второй платеж (rest, 50%)`);
        } else {
          throw new Error('Оба платежа уже оплачены');
        }
      } else {
        if (depositPayments.length > 0 && restPayments.length === 0) {
          sessionContext.paymentType = 'rest';
          sessionContext.paymentSchedule = '100%';
          const dealValue = parseFloat(deal.value) || 0;
          const paidAmount = depositPayments.reduce((sum, p) => sum + parseFloat(p.original_amount || 0), 0);
          sessionContext.customAmount = dealValue - paidAmount;
          console.log(`   ✅ Создаем остаток (rest) после депозита: ${sessionContext.customAmount.toFixed(2)} ${deal.currency || 'PLN'}`);
        } else if (singlePayments.length > 0 || (depositPayments.length > 0 && restPayments.length > 0)) {
          throw new Error('Платеж уже полностью оплачен');
        } else {
          sessionContext.paymentType = 'single';
          console.log(`   ✅ Создаем единый платеж (single, 100%)`);
        }
      }
    } else {
      console.log(`   ✅ Создаем платеж типа: ${sessionContext.paymentType}`);
    }

    // Создаем сессию
    const sessionResult = await processor.createCheckoutSessionForDeal(deal, sessionContext);

    if (!sessionResult.success) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }

    console.log(`\n✅ Stripe Checkout Session created successfully!`);
    console.log(`📋 Session ID: ${sessionResult.sessionId}`);
    console.log(`🔗 Payment URL: ${sessionResult.sessionUrl}`);
    console.log(`💰 Amount: ${sessionResult.amount} ${sessionResult.currency}`);

    if (sendNotification) {
      try {
        // Получаем все платежи для уведомления
        const existingPayments = await repository.listPayments({
          dealId: String(dealId),
          limit: 10
        });

        const sessions = [];
        for (const p of existingPayments) {
          if (!p.session_id) continue;
          
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

        // Добавляем новую созданную сессию
        sessions.push({
          id: sessionResult.sessionId,
          url: sessionResult.sessionUrl,
          type: sessionContext.paymentType || 'payment',
          amount: sessionResult.amount
        });

        // Отправляем уведомление
        const notificationResult = await processor.sendPaymentNotificationForDeal(dealId, {
          paymentSchedule: effectivePaymentSchedule,
          sessions: sessions,
          currency: sessionResult.currency,
          totalAmount: parseFloat(deal.value) || 0
        });

        if (notificationResult.success) {
          console.log(`📨 Уведомление отправлено`);
        } else {
          console.log(`⚠️  Уведомление не отправлено: ${notificationResult.error}`);
        }
      } catch (notifyError) {
        logger.warn('Failed to send notification', { dealId, error: notifyError.message });
        console.log(`⚠️  Ошибка отправки уведомления: ${notifyError.message}`);
      }
    }

    return {
      success: true,
      sessionId: sessionResult.sessionId,
      sessionUrl: sessionResult.sessionUrl,
      amount: sessionResult.amount,
      currency: sessionResult.currency
    };
  } catch (error) {
    logger.error('Failed to create session', {
      dealId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dealId = args[0];

  if (!dealId) {
    console.error('❌ Ошибка: не указан Deal ID');
    console.error('\nИспользование:');
    console.error('  node scripts/create-session-for-deal.js <dealId> [paymentType] [paymentSchedule] [customAmount]');
    console.error('\nПримеры:');
    console.error('  node scripts/create-session-for-deal.js 1775');
    console.error('  node scripts/create-session-for-deal.js 1775 deposit 50/50');
    console.error('  node scripts/create-session-for-deal.js 1775 rest 50/50 475');
    process.exit(1);
  }

  const paymentType = args[1] || null;
  const paymentSchedule = args[2] || null;
  const customAmount = args[3] ? parseFloat(args[3]) : null;

  if (customAmount !== null && isNaN(customAmount)) {
    console.error(`❌ Ошибка: customAmount должно быть числом, получено: ${args[3]}`);
    process.exit(1);
  }

  try {
    const result = await createSessionForDeal(dealId, {
      paymentType,
      paymentSchedule,
      customAmount,
      sendNotification: true
    });

    console.log(`\n✅ Сессия успешно создана для Deal #${dealId}\n`);
    process.exit(0);
  } catch (error) {
    console.error(`\n❌ Ошибка: ${error.message}\n`);
    process.exit(1);
  }
}

main();
