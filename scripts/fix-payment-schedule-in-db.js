#!/usr/bin/env node

/**
 * Скрипт для исправления неправильных схем платежей в базе данных
 * 
 * Исправляет payment_schedule с '100%' на '50/50' для сделок, где:
 * - Первый платеж (deposit) был создан с схемой 50/50
 * - Но в базе есть записи с payment_schedule = '100%'
 * 
 * Использование:
 *   node scripts/fix-payment-schedule-in-db.js <dealId>
 *   node scripts/fix-payment-schedule-in-db.js <dealId> --dry-run
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const SecondPaymentSchedulerService = require('../src/services/stripe/secondPaymentSchedulerService');
const logger = require('../src/utils/logger');

async function fixPaymentScheduleForDeal(dealId, dryRun = false) {
  const repository = new StripeRepository();
  const schedulerService = new SecondPaymentSchedulerService();

  console.log(`\n🔍 Проверка схем платежей для Deal #${dealId}...\n`);

  try {
    // Получаем исходную схему из первого платежа
    const initialSchedule = await schedulerService.getInitialPaymentSchedule(dealId);
    
    if (!initialSchedule.schedule) {
      console.log(`⚠️  Исходная схема не найдена для Deal #${dealId}`);
      console.log(`   Возможно, первый платеж еще не создан или схема не была сохранена.\n`);
      return { success: false, reason: 'no_initial_schedule' };
    }

    console.log(`📊 Исходная схема из первого платежа: ${initialSchedule.schedule}`);
    
    if (initialSchedule.schedule !== '50/50') {
      console.log(`ℹ️  Исходная схема не 50/50, исправление не требуется.\n`);
      return { success: true, reason: 'not_50_50' };
    }

    // Получаем все платежи для сделки
    const allPayments = await repository.listPayments({ dealId: String(dealId) });
    
    // Находим платежи с неправильной схемой
    const incorrectPayments = allPayments.filter(p => 
      p.payment_schedule === '100%' || 
      (p.payment_schedule !== '50/50' && p.payment_schedule !== null)
    );

    if (incorrectPayments.length === 0) {
      console.log(`✅ Все платежи имеют правильную схему (50/50 или null).\n`);
      return { success: true, fixed: 0 };
    }

    console.log(`\n⚠️  Найдено платежей с неправильной схемой: ${incorrectPayments.length}`);
    incorrectPayments.forEach(p => {
      console.log(`   - Payment ID: ${p.id || p.session_id}`);
      console.log(`     Session ID: ${p.session_id}`);
      console.log(`     Тип: ${p.payment_type}`);
      console.log(`     Текущая схема: ${p.payment_schedule || 'null'}`);
      console.log(`     Статус: ${p.payment_status}`);
      console.log(`     Создан: ${p.created_at?.split('T')[0] || 'N/A'}`);
      console.log('');
    });

    if (dryRun) {
      console.log(`🔍 DRY RUN: Платежи НЕ будут обновлены.\n`);
      return { success: true, dryRun: true, wouldFix: incorrectPayments.length };
    }

    // Обновляем платежи в базе данных
    console.log(`\n🔧 Исправляю схемы платежей...\n`);
    
    const supabase = require('../src/services/supabaseClient');
    let fixedCount = 0;
    const errors = [];

    for (const payment of incorrectPayments) {
      try {
        const { error } = await supabase
          .from('stripe_payments')
          .update({ 
            payment_schedule: '50/50',
            updated_at: new Date().toISOString()
          })
          .eq('session_id', payment.session_id);

        if (error) {
          logger.error(`Ошибка при обновлении платежа ${payment.session_id}`, { error });
          errors.push({ sessionId: payment.session_id, error: error.message });
        } else {
          fixedCount++;
          console.log(`   ✅ Исправлен: ${payment.session_id} (${payment.payment_type})`);
        }
      } catch (error) {
        logger.error(`Ошибка при обновлении платежа ${payment.session_id}`, { error });
        errors.push({ sessionId: payment.session_id, error: error.message });
      }
    }

    console.log(`\n📊 Результат:`);
    console.log(`   ✅ Исправлено: ${fixedCount}`);
    if (errors.length > 0) {
      console.log(`   ❌ Ошибок: ${errors.length}`);
      errors.forEach(e => {
        console.log(`      - ${e.sessionId}: ${e.error}`);
      });
    }
    console.log('');

    return { 
      success: errors.length === 0, 
      fixed: fixedCount, 
      errors: errors.length > 0 ? errors : null 
    };

  } catch (error) {
    logger.error(`Ошибка при исправлении схем платежей для Deal #${dealId}`, {
      error: error.message,
      stack: error.stack
    });
    console.error(`\n❌ Ошибка: ${error.message}\n`);
    return { success: false, error: error.message };
  }
}

async function main() {
  const dealId = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!dealId) {
    console.error('Usage: node scripts/fix-payment-schedule-in-db.js <dealId> [--dry-run]');
    process.exit(1);
  }

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - изменения не будут применены\n');
  }

  const result = await fixPaymentScheduleForDeal(dealId, dryRun);

  if (result.success) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

main().catch(error => {
  logger.error('Script failed:', error);
  console.error('❌ Произошла ошибка:', error.message);
  process.exit(1);
});

