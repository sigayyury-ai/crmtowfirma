#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = '1421';

async function fixProformaCashAggregates() {
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
      logger.info(`     payments_total_cash: ${proforma.payments_total_cash || 0}`);
      logger.info(`     payments_total_cash_pln: ${proforma.payments_total_cash_pln || 0}`);

      // 2. Находим все обычные платежи
      let payments = [];
      
      const { data: regularPayments, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .eq('proforma_id', proforma.id)
        .eq('direction', 'in')
        .is('deleted_at', null)
        .order('operation_date', { ascending: false });

      if (paymentsError) {
        logger.warn('Ошибка при поиске платежей:', paymentsError);
      } else if (regularPayments && regularPayments.length > 0) {
        payments = regularPayments;
      }

      // Проверяем платежи по manual_proforma_fullnumber
      if (payments.length === 0 && proforma.fullnumber) {
        const { data: manualPayments, error: manualError } = await supabase
          .from('payments')
          .select('*')
          .eq('manual_proforma_fullnumber', proforma.fullnumber)
          .eq('direction', 'in')
          .is('deleted_at', null)
          .order('operation_date', { ascending: false });

        if (!manualError && manualPayments && manualPayments.length > 0) {
          logger.info(`   Найдено платежей по manual_proforma_fullnumber: ${manualPayments.length}`);
          payments = manualPayments;
        }
      }

      logger.info(`\n   Найдено обычных платежей: ${payments.length}`);
      if (payments.length > 0) {
        payments.forEach((p, i) => {
          logger.info(`   ${i + 1}. ${p.operation_date || p.payment_date || 'N/A'}: ${p.amount} ${p.currency || 'PLN'} (${p.payer_name || 'N/A'})`);
        });
      }

      // 3. Находим наличные платежи (вторая часть оплаты)
      // Сначала ищем по proforma_id
      let cashPayments = [];
      const { data: cashByProforma, error: cashError1 } = await supabase
        .from('cash_payments')
        .select('*')
        .eq('proforma_id', proforma.id)
        .in('status', ['received', 'pending', 'pending_confirmation'])
        .order('confirmed_at', { ascending: false });

      if (!cashError1 && cashByProforma && cashByProforma.length > 0) {
        cashPayments = cashByProforma;
      }

      // Если не найдено, ищем по deal_id
      if (cashPayments.length === 0) {
        const { data: cashByDeal, error: cashError2 } = await supabase
          .from('cash_payments')
          .select('*')
          .eq('deal_id', DEAL_ID)
          .in('status', ['received', 'pending', 'pending_confirmation'])
          .order('confirmed_at', { ascending: false });

        if (!cashError2 && cashByDeal && cashByDeal.length > 0) {
          logger.info(`   Наличные платежи найдены по deal_id`);
          cashPayments = cashByDeal;
        }
      }

      logger.info(`\n   Найдено наличных платежей: ${cashPayments?.length || 0}`);
      if (cashPayments && cashPayments.length > 0) {
        cashPayments.forEach((cp, i) => {
          const amountPln = cp.amount_pln || cp.cash_received_amount || cp.cash_expected_amount || 0;
          logger.info(`   ${i + 1}. ${cp.confirmed_at || cp.expected_date || 'N/A'}: ${amountPln} PLN (статус: ${cp.status})`);
        });
      }

      // 4. Рассчитываем правильные агрегаты
      const proformaTotal = parseFloat(proforma.total) || 0;
      const proformaCurrency = proforma.currency || 'PLN';
      const exchangeRate = parseFloat(proforma.currency_exchange) || (proformaCurrency === 'PLN' ? 1 : 1);

      // Считаем сумму обычных платежей
      let totalPayments = 0;
      let totalPaymentsPln = 0;

      payments.forEach(payment => {
        const amount = parseFloat(payment.amount || 0);
        totalPayments += amount;

        // Если есть amount_pln, используем его, иначе конвертируем
        if (payment.amount_pln != null && payment.amount_pln !== undefined) {
          totalPaymentsPln += parseFloat(payment.amount_pln || 0);
        } else {
          totalPaymentsPln += amount * exchangeRate;
        }
      });

      // Считаем сумму наличных платежей
      let totalCash = 0;
      let totalCashPln = 0;

      if (cashPayments && cashPayments.length > 0) {
        cashPayments.forEach(cp => {
          const cashReceived = parseFloat(cp.cash_received_amount || cp.cash_expected_amount || 0);
          totalCash += cashReceived;

          // Используем amount_pln, если есть, иначе конвертируем
          if (cp.amount_pln != null && cp.amount_pln !== undefined) {
            totalCashPln += parseFloat(cp.amount_pln);
          } else if (cp.currency === 'PLN') {
            totalCashPln += cashReceived;
          } else {
            totalCashPln += cashReceived * exchangeRate;
          }
        });
      } else {
        // Если наличные платежи не найдены, но пользователь подтверждает наличную оплату второй части,
        // рассчитываем остаток как наличные
        const remainingAmount = proformaTotal - totalPayments;
        if (remainingAmount > 0) {
          logger.info(`   ⚠️  Наличные платежи не найдены в базе, но вторая часть была наличными.`);
          logger.info(`   💡 Рассчитываю остаток как наличный платеж: ${remainingAmount} ${proformaCurrency}`);
          totalCash = remainingAmount;
          totalCashPln = remainingAmount * exchangeRate;
        }
      }

      // Общая сумма всех платежей
      const calculatedTotal = totalPayments + totalCash;
      const calculatedTotalPln = totalPaymentsPln + totalCashPln;
      // Если наличный платеж был рассчитан как остаток, добавляем его к количеству
      const cashPaymentsCount = cashPayments?.length || (totalCash > 0 ? 1 : 0);
      const paymentsCount = payments.length + cashPaymentsCount;

      logger.info(`\n   Рассчитанные агрегаты:`);
      logger.info(`     Обычные платежи: ${totalPayments} ${proformaCurrency} (${totalPaymentsPln} PLN)`);
      logger.info(`     Наличные платежи: ${totalCash} ${proformaCurrency} (${totalCashPln} PLN)`);
      logger.info(`     Общая сумма: ${calculatedTotal} ${proformaCurrency}`);
      logger.info(`     Общая сумма PLN: ${calculatedTotalPln} PLN`);
      logger.info(`     Количество платежей: ${paymentsCount}`);

      // 5. Обновляем агрегаты в проформе
      const { error: updateError } = await supabase
        .from('proformas')
        .update({
          payments_total: calculatedTotal,
          payments_total_pln: calculatedTotalPln,
          payments_count: paymentsCount,
          payments_total_cash: totalCash,
          payments_total_cash_pln: totalCashPln
        })
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('Ошибка при обновлении агрегатов:', updateError);
      } else {
        logger.info(`\n   ✅ Агрегаты успешно обновлены для проформы ${proforma.fullnumber || proforma.id}`);
        logger.info(`      payments_total: ${calculatedTotal} ${proformaCurrency}`);
        logger.info(`      payments_total_pln: ${calculatedTotalPln} PLN`);
        logger.info(`      payments_count: ${paymentsCount}`);
        logger.info(`      payments_total_cash: ${totalCash} ${proformaCurrency}`);
        logger.info(`      payments_total_cash_pln: ${totalCashPln} PLN`);
      }
    }

    logger.info('\n✅ Готово!\n');
  } catch (error) {
    logger.error('Ошибка:', error);
    process.exit(1);
  }
}

fixProformaCashAggregates();
