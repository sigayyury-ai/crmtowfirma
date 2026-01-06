require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function generateLinkingReport() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info('📋 Генерирую отчет для связывания платежей...');

    // Получаем платежи без deal_id
    const { data: orphanPayments, error } = await supabase
      .from('stripe_payments')
      .select('*')
      .is('deal_id', null)
      .eq('payment_status', 'paid')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      logger.error('Ошибка получения платежей:', error);
      return;
    }

    if (!orphanPayments || orphanPayments.length === 0) {
      logger.info('✅ Нет платежей без deal_id');
      return;
    }

    logger.info(`\n🔍 Найдено ${orphanPayments.length} платежей без deal_id\n`);

    // Группируем платежи по клиентам
    const byCustomer = {};
    orphanPayments.forEach(payment => {
      const customer = payment.customer_name || 'Unknown';
      if (!byCustomer[customer]) byCustomer[customer] = [];
      byCustomer[customer].push(payment);
    });

    logger.info('💰 Платежи по клиентам:');
    logger.info('='.repeat(80));

    Object.keys(byCustomer).forEach(customer => {
      const payments = byCustomer[customer];
      const totalAmount = payments.reduce((sum, p) => sum + (p.original_amount || 0), 0);

      logger.info(`\n👤 Клиент: ${customer}`);
      logger.info(`   📊 Всего платежей: ${payments.length}, Сумма: €${totalAmount}`);
      logger.info(`   🔍 Рекомендация: поискать в Pipedrive по имени "${customer}"`);

      payments.forEach((payment, index) => {
        const orderId = payment.raw_payload?.metadata?.order_id || 'N/A';
        const sessionId = payment.session_id?.substring(0, 20) + '...';

        logger.info(`      ${index + 1}. €${payment.original_amount} - ${sessionId} (Order: ${orderId})`);
      });
    });

    logger.info('\n📝 SQL команды для ручного связывания:');
    logger.info('='.repeat(80));

    orphanPayments.slice(0, 10).forEach((payment, index) => {
      const sessionId = payment.session_id;
      logger.info(`-- ${index + 1}. ${payment.customer_name} - €${payment.original_amount}`);
      logger.info(`UPDATE stripe_payments SET deal_id = 'XXXX' WHERE session_id = '${sessionId}';`);
      logger.info('');
    });

    if (orphanPayments.length > 10) {
      logger.info(`... и еще ${orphanPayments.length - 10} платежей`);
    }

    logger.info('\n🎯 Следующие шаги:');
    logger.info('1. Найдите соответствующую сделку в Pipedrive по имени клиента');
    logger.info('2. Скопируйте ID сделки из URL в Pipedrive');
    logger.info('3. Замените XXXX в SQL командах выше на реальный deal_id');
    logger.info('4. Выполните SQL команды в Supabase SQL Editor');
    logger.info('5. Запустите скрипт проверки статуса для обновленных сделок');

  } catch (error) {
    logger.error('❌ Ошибка генерации отчета:', error);
  }
}

generateLinkingReport();
