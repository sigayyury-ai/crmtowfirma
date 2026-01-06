#!/usr/bin/env node

/**
 * Создание Stripe Checkout Session для конкретной сделки
 * Используется для создания сессий по запросу клиента на определенную дату
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const SendPulseClient = require('../src/services/sendpulse');
const logger = require('../src/utils/logger');

async function createSessionForDeal(dealId) {
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

    console.log(`🔍 Создание сессии для Deal #${dealId}...\n`);

    // Получаем данные сделки
    const dealResult = await processor.pipedriveClient.getDealWithRelatedData(dealId);
    if (!dealResult || !dealResult.success) {
      throw new Error(`Failed to fetch deal: ${dealResult?.error || 'unknown'}`);
    }

    const deal = dealResult.deal;
    const person = dealResult.person;
    const customerEmail = person?.email?.[0]?.value || person?.email || 'N/A';

    console.log(`   Название: ${deal.title}`);
    console.log(`   Email: ${customerEmail}`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'PLN'}`);

    // Получаем ВСЕ существующие платежи для сделки
    const allExistingPayments = await repository.listPayments({
      dealId: String(dealId),
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

    // ВАЖНО: Используем исходную схему из первого оплаченного платежа, а не пересчитываем
    // Это исправляет проблему, когда expected_close_date изменился, но клиент уже оплатил deposit по схеме 50/50
    const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
    const schedulerService = new SecondPaymentSchedulerService();
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
    
    // Определяем ТЕКУЩИЙ график платежей (для справки)
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

    // ВАЖНО: Если есть исходная схема из первого платежа - используем её
    // Это гарантирует, что если клиент оплатил deposit по схеме 50/50, то второй платеж будет по той же схеме
    let effectivePaymentSchedule = currentPaymentSchedule;
    if (initialSchedule.schedule === '50/50') {
      effectivePaymentSchedule = '50/50';
      console.log(`   📊 Исходная схема из первого платежа: ${initialSchedule.schedule}`);
      console.log(`   📊 Текущая схема (по expected_close_date): ${currentPaymentSchedule}`);
      console.log(`   ✅ Используем исходную схему: ${effectivePaymentSchedule} (клиент уже оплатил deposit по этой схеме)`);
    } else {
      console.log(`   📊 Текущий график платежей: ${currentPaymentSchedule}`);
      if (initialSchedule.schedule) {
        console.log(`   📊 Исходная схема из первого платежа: ${initialSchedule.schedule}`);
      }
    }
    if (depositPayments.length > 0) {
      console.log(`   ⚠️  Найден оплаченный депозит (${depositPayments.length} шт.)`);
    }
    if (restPayments.length > 0) {
      console.log(`   ⚠️  Найден оплаченный остаток (${restPayments.length} шт.)`);
    }
    if (singlePayments.length > 0) {
      console.log(`   ⚠️  Найден единый платеж (${singlePayments.length} шт.)`);
    }

    // Определяем, что нужно создать
    let paymentType = null;
    let paymentSchedule = effectivePaymentSchedule; // Используем эффективную схему (исходную, если есть)
    let customAmount = null;
    let paymentIndex = null;

    // Если график 50/50 (используем эффективную схему)
    if (effectivePaymentSchedule === '50/50') {
      if (depositPayments.length === 0) {
        paymentType = 'deposit';
        paymentIndex = 1;
        console.log(`   ✅ Создаем первый платеж (deposit, 50%)`);
      } else if (restPayments.length === 0) {
        paymentType = 'rest';
        paymentIndex = 2;
        console.log(`   ✅ Создаем второй платеж (rest, 50%)`);
      } else {
        throw new Error('Оба платежа уже оплачены');
      }
    }
    // Если график 100%
    else {
      if (depositPayments.length > 0 && restPayments.length === 0) {
        paymentType = 'rest';
        paymentSchedule = '100%';
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

    // Создаем сессию
    const sessionContext = {
      trigger: 'manual_scheduled',
      runId: `scheduled_${Date.now()}`,
      paymentType,
      paymentSchedule,
      paymentIndex,
      skipNotification: false, // Отправим уведомление
      setInvoiceTypeDone: true // Ставим invoice_type в Done, чтобы не триггерить повторные уведомления
    };

    if (customAmount !== null) {
      sessionContext.customAmount = customAmount;
    }

    const sessionResult = await processor.createCheckoutSessionForDeal(deal, sessionContext);

    if (!sessionResult.success) {
      throw new Error(sessionResult.error || 'Failed to create session');
    }

    console.log(`\n   ✅ Создана новая сессия: ${sessionResult.sessionId}`);
    console.log(`   🔗 URL: ${sessionResult.sessionUrl}`);

    // Сохраняем платеж в базу данных
    const paymentData = {
      session_id: sessionResult.sessionId,
      deal_id: String(dealId),
      customer_email: customerEmail,
      original_amount: sessionResult.amount,
      currency: sessionResult.currency,
      payment_type: paymentType,
      payment_schedule: paymentSchedule,
      status: 'open',
      payment_status: 'unpaid',
      created_at: new Date().toISOString()
    };

    await repository.savePayment(paymentData);
    console.log(`   💾 Платеж сохранен в базу данных`);

    // Отправляем уведомление
    if (sendpulseClient) {
      try {
        const SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';
        const sendpulseId = person?.[SENDPULSE_ID_FIELD_KEY];

        if (sendpulseId) {
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
          
          if (notifyResult.success) {
            console.log(`   📨 Уведомление отправлено в Telegram`);
            
            // Phase 9: Update SendPulse contact custom field with deal_id
            try {
              await sendpulseClient.updateContactCustomField(sendpulseId, {
                deal_id: String(dealId)
              });
              logger.debug('SendPulse contact deal_id updated', { dealId, sendpulseId });
            } catch (error) {
              logger.warn('Failed to update SendPulse contact deal_id', {
                dealId,
                sendpulseId,
                error: error.message
              });
            }
          } else {
            console.log(`   ⚠️  Не удалось отправить уведомление: ${notifyResult.error}`);
          }
        } else {
          console.log(`   ℹ️  SendPulse ID не найден, уведомление пропущено`);
        }
      } catch (notifyError) {
        logger.warn('Failed to send notification', { dealId, error: notifyError.message });
        console.log(`   ⚠️  Ошибка отправки уведомления: ${notifyError.message}`);
      }
    } else {
      console.log(`   ℹ️  SendPulse не настроен, уведомление пропущено`);
    }

    console.log(`\n✅ Сессия успешно создана для Deal #${dealId}`);

  } catch (error) {
    logger.error('Error creating session', { dealId, error: error.message });
    console.error(`❌ Ошибка: ${error.message}`);
    process.exit(1);
  }
}

// Получаем dealId из аргументов командной строки
const dealId = process.argv[2];
if (!dealId) {
  console.error('❌ Укажите dealId: node scripts/create-session-for-deal.js <dealId>');
  process.exit(1);
}

createSessionForDeal(dealId);
