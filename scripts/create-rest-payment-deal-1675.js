#!/usr/bin/env node

/**
 * Создать rest платеж на остаток 310 EUR для сделки 1675
 */

require('dotenv').config();
const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const SendPulseClient = require('../src/services/sendpulse');
const logger = require('../src/utils/logger');

const DEAL_ID = 1675;
const REMAINDER_AMOUNT = 310; // Остаток после deposit

async function createRestPayment() {
  try {
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

    console.log(`🔍 Создание rest платежа для Deal #${DEAL_ID}...\n`);

    // Получаем данные сделки
    const dealResult = await processor.pipedriveClient.getDealWithRelatedData(DEAL_ID);
    if (!dealResult || !dealResult.success) {
      throw new Error(`Failed to fetch deal: ${dealResult?.error || 'unknown'}`);
    }

    const deal = dealResult.deal;
    const person = dealResult.person;
    const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

    console.log(`   Название: ${deal.title}`);
    console.log(`   Email: ${customerEmail}`);
    console.log(`   Сумма сделки: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   Сумма rest платежа: ${REMAINDER_AMOUNT} ${deal.currency || 'EUR'}`);

    // Проверяем существующие платежи
    const allExistingPayments = await repository.listPayments({
      dealId: String(DEAL_ID),
      limit: 100
    });

    const depositPayments = allExistingPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );

    const restPayments = allExistingPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );

    console.log(`\n   Существующие платежи:`);
    console.log(`     Deposit (оплачен): ${depositPayments.length}`);
    console.log(`     Rest (оплачен): ${restPayments.length}`);

    if (depositPayments.length === 0) {
      throw new Error('Deposit платеж не найден. Невозможно создать rest платеж.');
    }

    if (restPayments.length > 0) {
      console.log(`\n   ⚠️  ВНИМАНИЕ: Уже есть оплаченный rest платеж!`);
      const totalPaid = depositPayments.reduce((sum, p) => sum + parseFloat(p.original_amount || 0), 0) +
                       restPayments.reduce((sum, p) => sum + parseFloat(p.original_amount || 0), 0);
      console.log(`     Оплачено всего: ${totalPaid.toFixed(2)} ${deal.currency || 'EUR'}`);
      throw new Error('Сделка уже полностью оплачена');
    }

    // Создаем rest сессию с кастомной суммой
    const sessionContext = {
      trigger: 'manual_rest_payment',
      runId: `rest_${DEAL_ID}_${Date.now()}`,
      paymentType: 'rest',
      paymentSchedule: '100%', // График изменился на 100%
      paymentIndex: 2,
      customAmount: REMAINDER_AMOUNT, // Остаток после deposit
      skipNotification: false,
      setInvoiceTypeDone: false
    };

    console.log(`\n   Создание rest сессии...`);
    const sessionResult = await processor.createCheckoutSessionForDeal(deal, sessionContext);

    if (!sessionResult.success) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }

    console.log(`\n   ✅ Создана rest сессия:`);
    console.log(`      Session ID: ${sessionResult.sessionId}`);
    console.log(`      URL: ${sessionResult.sessionUrl}`);
    console.log(`      Сумма: ${sessionResult.amount} ${sessionResult.currency}`);

    // Сохраняем платеж в базу данных
    const paymentData = {
      session_id: sessionResult.sessionId,
      deal_id: String(DEAL_ID),
      customer_email: customerEmail,
      original_amount: sessionResult.amount,
      currency: sessionResult.currency,
      payment_type: 'rest',
      payment_schedule: '100%',
      status: 'open',
      payment_status: 'unpaid',
      created_at: new Date().toISOString()
    };

    await repository.savePayment(paymentData);
    console.log(`   💾 Платеж сохранен в базу данных`);

    // Отправляем уведомление
    if (sendpulseClient) {
      try {
        const dealWithRelated = await processor.pipedriveClient.getDealWithRelatedData(DEAL_ID);
        const person = dealWithRelated?.person;
        const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
        const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];

        if (sendpulseId) {
          const message = `Привет! Напоминаю о втором платеже.\n\n` +
                         `[Ссылка на оплату](${sessionResult.sessionUrl})\n` +
                         `Ссылка действует 24 часа\n\n` +
                         `Сумма: ${sessionResult.amount.toFixed(2)} ${sessionResult.currency}\n` +
                         `Это остаток после первого платежа.`;

          const notificationResult = await sendpulseClient.sendTelegramMessage(sendpulseId, message);
          
          if (notificationResult.success) {
            console.log(`   📧 Уведомление отправлено в Telegram`);
          } else {
            console.log(`   ⚠️  Не удалось отправить уведомление: ${notificationResult.error}`);
          }
        } else {
          console.log(`   ⚠️  SendPulse ID не найден для персоны`);
        }
      } catch (notifError) {
        console.log(`   ⚠️  Ошибка при отправке уведомления: ${notifError.message}`);
      }
    }

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Rest платеж успешно создан!`);
    console.log(`${'='.repeat(80)}\n`);

  } catch (error) {
    console.error(`\n❌ Ошибка при создании rest платежа:`);
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack trace:`);
      console.error(`   ${error.stack}`);
    }
    process.exit(1);
  }
}

// Запуск
createRestPayment();

