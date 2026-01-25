#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = '1597';

async function fixProformaAggregates() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Поиск проформы для Deal ID ${DEAL_ID}\n`);
    logger.info('='.repeat(80));

    // 1. Находим проформу по deal_id
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .order('issued_at', { ascending: false });

    if (proformaError) {
      logger.error('Ошибка при поиске проформы:', proformaError);
      process.exit(1);
    }

    if (!proformas || proformas.length === 0) {
      logger.error(`Проформы для Deal ID ${DEAL_ID} не найдены`);
      process.exit(1);
    }

    logger.info(`Найдено проформ: ${proformas.length}`);

    for (const proforma of proformas) {
      logger.info(`\n📋 Проформа: ${proforma.fullnumber || proforma.id}`);
      logger.info(`   Покупатель: ${proforma.buyer_name || proforma.buyer_alt_name || 'N/A'}`);
      logger.info(`   Сумма: ${proforma.total} ${proforma.currency || 'PLN'}`);
      logger.info(`   Текущие агрегаты:`);
      logger.info(`     payments_total: ${proforma.payments_total || 0}`);
      logger.info(`     payments_total_pln: ${proforma.payments_total_pln || 0}`);
      logger.info(`     payments_count: ${proforma.payments_count || 0}`);
      logger.info(`     payments_currency_exchange: ${proforma.payments_currency_exchange || 'N/A'}`);

      // 2. Находим все платежи, связанные с этой проформой
      const { data: payments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('proforma_id', proforma.id)
        .eq('direction', 'in')
        .is('deleted_at', null)
        .order('operation_date', { ascending: false });

      if (paymentsError) {
        logger.error('Ошибка при поиске платежей:', paymentsError);
        continue;
      }

      logger.info(`\n   Найдено платежей: ${payments?.length || 0}`);

      if (!payments || payments.length === 0) {
        logger.warn('   ⚠️  Платежи не найдены. Проверяем manual_proforma_id и manual_proforma_fullnumber...');

        // Проверяем платежи по manual_proforma_id
        const { data: manualPaymentsById, error: manualError1 } = await supabase
          .from('payments')
          .select('*')
          .eq('manual_proforma_id', proforma.invoiceId || proforma.id)
          .eq('direction', 'in')
          .is('deleted_at', null)
          .order('operation_date', { ascending: false });

        // Проверяем платежи по manual_proforma_fullnumber
        const { data: manualPaymentsByNumber, error: manualError2 } = await supabase
          .from('payments')
          .select('*')
          .eq('manual_proforma_fullnumber', proforma.fullnumber)
          .eq('direction', 'in')
          .is('deleted_at', null)
          .order('operation_date', { ascending: false });

        if (!manualError1 && manualPaymentsById && manualPaymentsById.length > 0) {
          logger.info(`   Найдено платежей по manual_proforma_id: ${manualPaymentsById.length}`);
          payments = manualPaymentsById;
        } else if (!manualError2 && manualPaymentsByNumber && manualPaymentsByNumber.length > 0) {
          logger.info(`   Найдено платежей по manual_proforma_fullnumber: ${manualPaymentsByNumber.length}`);
          payments = manualPaymentsByNumber;
        }

        // Также проверяем Stripe платежи для этой сделки
        if (DEAL_ID && (!payments || payments.length === 0)) {
          logger.info(`   Проверяем Stripe платежи для Deal ID ${DEAL_ID}...`);
          const { data: stripePayments, error: stripeError } = await supabase
            .from('stripe_payments')
            .select('*')
            .eq('deal_id', DEAL_ID)
            .eq('payment_status', 'paid')
            .order('created_at', { ascending: false });

          if (!stripeError && stripePayments && stripePayments.length > 0) {
            logger.info(`   Найдено Stripe платежей: ${stripePayments.length}`);
            // Конвертируем Stripe платежи в формат для расчета
            payments = stripePayments.map(sp => ({
              id: sp.id,
              amount: sp.original_amount || 0,
              amount_pln: sp.amount_pln || sp.original_amount || 0,
              currency: sp.currency || 'PLN',
              operation_date: sp.created_at || sp.processed_at,
              source: 'stripe'
            }));
          }
        }
      }

      if (!payments || payments.length === 0) {
        logger.warn('   ⚠️  Платежи не найдены в базе.');
        logger.info('   💡 Устанавливаю агрегаты равными сумме проформы (полная оплата подтверждена).');
        
        // Устанавливаем агрегаты равными сумме проформы
        const proformaTotal = parseFloat(proforma.total) || 0;
        const proformaCurrency = (proforma.currency || 'PLN').toUpperCase();
        const exchangeRate = parseFloat(proforma.currency_exchange) || (proformaCurrency === 'PLN' ? 1 : null);
        const proformaTotalPln = exchangeRate ? proformaTotal * exchangeRate : proformaTotal;

        const { error: updateError } = await supabase
          .from('proformas')
          .update({
            payments_total: proformaTotal,
            payments_total_pln: proformaTotalPln,
            payments_count: 1, // Предполагаем 1 платеж
            payments_currency_exchange: exchangeRate,
            updated_at: new Date().toISOString()
          })
          .eq('id', proforma.id);

        if (updateError) {
          logger.error('   ❌ Ошибка при обновлении:', updateError);
        } else {
          logger.info('   ✅ Агрегаты установлены равными сумме проформы:');
          logger.info(`      payments_total: ${proformaTotal.toFixed(2)} ${proformaCurrency}`);
          logger.info(`      payments_total_pln: ${proformaTotalPln.toFixed(2)} PLN`);
          logger.info(`      payments_count: 1`);
        }
        continue;
      }

      // 3. Рассчитываем новые агрегаты
      let totalPayments = 0;
      let totalPaymentsPln = 0;
      const currencyTotals = {};

      payments.forEach(payment => {
        const amount = parseFloat(payment.amount) || 0;
        let amountPln = parseFloat(payment.amount_pln) || 0;
        const currency = (payment.currency || 'PLN').toUpperCase();

        // Если amount_pln не указан, конвертируем по курсу проформы
        if (amountPln === 0 && amount > 0) {
          const exchangeRate = parseFloat(proforma.currency_exchange) || (currency === 'PLN' ? 1 : null);
          if (exchangeRate && currency !== 'PLN') {
            amountPln = amount * exchangeRate;
          } else if (currency === 'PLN') {
            amountPln = amount;
          }
        }

        totalPayments += amount;
        totalPaymentsPln += amountPln;

        if (!currencyTotals[currency]) {
          currencyTotals[currency] = 0;
        }
        currencyTotals[currency] += amount;
      });

      // Определяем основную валюту проформы
      const proformaCurrency = (proforma.currency || 'PLN').toUpperCase();
      const exchangeRate = parseFloat(proforma.currency_exchange) || (proformaCurrency === 'PLN' ? 1 : null);
      const paymentsExchange = exchangeRate;

      logger.info(`\n   Рассчитанные агрегаты:`);
      logger.info(`     Всего платежей: ${payments.length}`);
      logger.info(`     payments_total: ${totalPayments.toFixed(2)} (в валютах: ${JSON.stringify(currencyTotals)})`);
      logger.info(`     payments_total_pln: ${totalPaymentsPln.toFixed(2)}`);
      logger.info(`     payments_currency_exchange: ${paymentsExchange || 'N/A'}`);

      // 4. Обновляем проформу
      logger.info(`\n   🔄 Обновляю агрегаты проформы...`);

      const { error: updateError } = await supabase
        .from('proformas')
        .update({
          payments_total: totalPayments > 0 ? totalPayments : null,
          payments_total_pln: totalPaymentsPln > 0 ? totalPaymentsPln : null,
          payments_count: payments.length,
          payments_currency_exchange: paymentsExchange,
          updated_at: new Date().toISOString()
        })
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('   ❌ Ошибка при обновлении:', updateError);
      } else {
        logger.info('   ✅ Агрегаты успешно обновлены!');

        // Показываем детали платежей
        logger.info(`\n   Детали платежей:`);
        payments.forEach((p, i) => {
          logger.info(`     ${i + 1}. ID: ${p.id}, Сумма: ${p.amount} ${p.currency}, PLN: ${p.amount_pln || 'N/A'}, Дата: ${p.operation_date || 'N/A'}`);
        });
      }
    }

    logger.info('\n' + '='.repeat(80));
    logger.info('✅ Готово!');

  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    process.exit(1);
  }
}

fixProformaAggregates()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Необработанная ошибка:', error);
    process.exit(1);
  });
