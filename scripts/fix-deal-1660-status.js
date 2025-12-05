#!/usr/bin/env node

/**
 * Исправление статуса Deal #1660 - оба платежа оплачены, но статус не обновлен
 */

require('dotenv').config();
const StripeRepository = require('../src/services/stripe/repository');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');

async function fixDealStatus() {
  const DEAL_ID = 1660;
  
  console.log(`🔧 Исправление статуса Deal #${DEAL_ID}\n`);
  console.log('='.repeat(80));
  
  try {
    const repository = new StripeRepository();
    const processor = new StripeProcessorService();
    const pipedriveClient = new PipedriveClient();
    
    // 1. Получаем данные сделки
    console.log(`\n📥 Получение данных сделки #${DEAL_ID}...`);
    const dealResult = await pipedriveClient.getDeal(DEAL_ID);
    if (!dealResult.success || !dealResult.deal) {
      console.error(`❌ Не удалось получить данные сделки`);
      return;
    }
    
    const deal = dealResult.deal;
    console.log(`✅ Сделка: ${deal.title}`);
    console.log(`   Текущий статус: stage_id = ${deal.stage_id}`);
    
    // 2. Получаем все платежи
    console.log(`\n💳 Получение платежей...`);
    const allPayments = await repository.listPayments({ dealId: String(DEAL_ID) });
    console.log(`✅ Найдено платежей: ${allPayments.length}`);
    
    const depositPayment = allPayments.find(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') &&
      p.payment_status === 'paid'
    );
    
    const restPayment = allPayments.find(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') &&
      p.payment_status === 'paid'
    );
    
    console.log(`\n📊 Статус платежей:`);
    console.log(`   Первый платеж (deposit): ${depositPayment ? '✅ Оплачен' : '❌ Не найден'}`);
    if (depositPayment) {
      console.log(`      Session ID: ${depositPayment.session_id}`);
      console.log(`      Amount: ${depositPayment.original_amount || depositPayment.amount} ${depositPayment.currency}`);
    }
    
    console.log(`   Второй платеж (rest): ${restPayment ? '✅ Оплачен' : '❌ Не найден'}`);
    if (restPayment) {
      console.log(`      Session ID: ${restPayment.session_id}`);
      console.log(`      Amount: ${restPayment.original_amount || restPayment.amount} ${restPayment.currency}`);
    }
    
    // 3. Проверяем, нужно ли обновлять статус
    const STAGES = {
      CAMP_WAITER_ID: 27,
      SECOND_PAYMENT_ID: 32
    };
    
    const hasBothPayments = !!depositPayment && !!restPayment;
    const currentStageId = deal.stage_id;
    const shouldBeInCampWaiter = hasBothPayments && currentStageId !== STAGES.CAMP_WAITER_ID;
    
    console.log(`\n🔍 Анализ:`);
    console.log(`   Оба платежа оплачены: ${hasBothPayments ? '✅' : '❌'}`);
    console.log(`   Текущий статус: ${currentStageId}`);
    console.log(`   Ожидаемый статус: ${STAGES.CAMP_WAITER_ID} (Camp Waiter)`);
    console.log(`   Нужно обновить: ${shouldBeInCampWaiter ? '✅ ДА' : '❌ НЕТ'}`);
    
    if (!shouldBeInCampWaiter) {
      if (!hasBothPayments) {
        console.log(`\n⚠️  Не все платежи оплачены, статус не обновляется`);
      } else {
        console.log(`\n✅ Статус уже правильный`);
      }
      return;
    }
    
    // 4. Обновляем статус
    console.log(`\n🔄 Обновление статуса...`);
    try {
      await processor.triggerCrmStatusAutomation(DEAL_ID, {
        reason: 'stripe:both-payments-complete-manual-fix'
      });
      
      console.log(`✅ Статус обновлен!`);
      console.log(`   Сделка должна быть переведена в стадию ${STAGES.CAMP_WAITER_ID} (Camp Waiter)`);
      
      // Проверяем результат
      console.log(`\n🔍 Проверка результата...`);
      const updatedDealResult = await pipedriveClient.getDeal(DEAL_ID);
      if (updatedDealResult.success && updatedDealResult.deal) {
        const updatedStageId = updatedDealResult.deal.stage_id;
        console.log(`   Новый статус: stage_id = ${updatedStageId}`);
        if (updatedStageId === STAGES.CAMP_WAITER_ID) {
          console.log(`   ✅ Успешно обновлено!`);
        } else {
          console.log(`   ⚠️  Статус не изменился (возможно, требуется время для обновления)`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Ошибка при обновлении статуса:`, error.message);
      throw error;
    }
    
    console.log(`\n${'='.repeat(80)}\n`);
    
  } catch (error) {
    console.error(`\n❌ Ошибка:`);
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   ${error.stack}`);
    }
    process.exit(1);
  }
}

fixDealStatus();

