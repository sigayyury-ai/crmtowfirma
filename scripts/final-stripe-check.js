require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function finalStripeCheck() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('🔍 Финальная проверка состояния Stripe платежей...');

    // Получаем статистику по платежам
    const { data: allPayments, error } = await supabase
      .from('stripe_payments')
      .select('payment_status, deal_id')
      .limit(1000);

    if (error) {
      logger.error('Ошибка получения платежей:', error);
      return;
    }

    const stats = {
      total: allPayments?.length || 0,
      paid: 0,
      unpaid: 0,
      event_placeholder: 0,
      with_deal_id: 0,
      without_deal_id: 0
    };

    allPayments?.forEach(payment => {
      // Подсчет по статусам
      if (payment.payment_status === 'paid') stats.paid++;
      else if (payment.payment_status === 'unpaid') stats.unpaid++;
      else if (payment.payment_status === 'event_placeholder') stats.event_placeholder++;

      // Подсчет по deal_id
      if (payment.deal_id) stats.with_deal_id++;
      else stats.without_deal_id++;
    });

    logger.info('📊 ИТОГОВАЯ СТАТИСТИКА:');
    logger.info(`   Всего платежей: ${stats.total}`);
    logger.info(`   Оплаченных (paid): ${stats.paid}`);
    logger.info(`   Неоплаченных (unpaid): ${stats.unpaid}`);
    logger.info(`   Event placeholders: ${stats.event_placeholder}`);
    logger.info(`   С deal_id: ${stats.with_deal_id}`);
    logger.info(`   Без deal_id: ${stats.without_deal_id}`);

    // Анализ проблем
    const issues = [];

    if (stats.unpaid > 0) {
      issues.push(`⚠️  ${stats.unpaid} платежей со статусом 'unpaid'`);
    }

    if (stats.without_deal_id > 0) {
      issues.push(`⚠️  ${stats.without_deal_id} платежей без deal_id (нужно связать вручную)`);
    }

    if (stats.event_placeholder > 0) {
      issues.push(`ℹ️  ${stats.event_placeholder} event placeholders (системные записи)`);
    }

    logger.info('\n🔧 ПРОБЛЕМЫ ТРЕБУЮЩИЕ ВНИМАНИЯ:');
    if (issues.length === 0) {
      logger.info('✅ Все платежи в порядке!');
    } else {
      issues.forEach(issue => logger.info(`   ${issue}`));
    }

    // Рекомендации
    logger.info('\n💡 РЕКОМЕНДАЦИИ:');

    if (stats.without_deal_id > 0) {
      logger.info('1. Свяжите платежи без deal_id с соответствующими сделками:');
      logger.info('   - Используйте order_id из метаданных для поиска');
      logger.info('   - Или имя клиента для ручного поиска в Pipedrive');
      logger.info('   - Обновите deal_id в таблице stripe_payments');
    }

    if (stats.unpaid > 0) {
      logger.info('2. Проверьте статус unpaid платежей в Stripe Dashboard');
      logger.info('   - Возможно, они действительно не оплачены');
      logger.info('   - Или webhook не пришел');
    }

    logger.info('3. Настройте webhook в Stripe Dashboard:');
    logger.info('   - URL: https://invoices.comoon.io/api/webhooks/stripe');
    logger.info('   - Events: checkout.session.completed, payment_intent.succeeded, etc.');

    logger.info('4. Примените миграцию checkout_url:');
    logger.info('   - ALTER TABLE stripe_payments ADD COLUMN IF NOT EXISTS checkout_url TEXT;');

    // Финальный статус
    const hasCriticalIssues = stats.unpaid > 0 || stats.without_deal_id > 5;
    if (hasCriticalIssues) {
      logger.warn('\n⚠️  Есть критические проблемы требующие внимания');
    } else {
      logger.info('\n✅ Система работает нормально, мелкие проблемы исправлены');
    }

  } catch (error) {
    logger.error('❌ Ошибка финальной проверки:', error);
  }
}

finalStripeCheck();
