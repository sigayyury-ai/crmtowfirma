#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function fixDealAggregates(dealId, options = {}) {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    logger.info(`\n🔍 Обработка Deal ID ${dealId}`);
    logger.info('='.repeat(80));

    // 1. Находим проформы по deal_id
    const { data: proformas, error: proformaError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', dealId)
      .order('issued_at', { ascending: false });

    if (proformaError) {
      logger.error('Ошибка при поиске проформ:', proformaError);
      return;
    }

    if (!proformas || proformas.length === 0) {
      logger.warn(`Проформы для Deal ID ${dealId} не найдены`);
      return;
    }

    logger.info(`Найдено проформ: ${proformas.length}`);

    for (const proforma of proformas) {
      logger.info(`\n📋 Проформа: ${proforma.fullnumber || proforma.id}`);
      logger.info(`   Покупатель: ${proforma.buyer_name || proforma.buyer_alt_name || 'N/A'}`);
      logger.info(`   Сумма: ${proforma.total} ${proforma.currency || 'PLN'}`);
      
      const proformaTotal = parseFloat(proforma.total) || 0;
      const proformaCurrency = (proforma.currency || 'PLN').toUpperCase();
      const exchangeRate = parseFloat(proforma.currency_exchange) || (proformaCurrency === 'PLN' ? 1 : null);
      const proformaTotalPln = exchangeRate ? proformaTotal * exchangeRate : proformaTotal;

      // 2. Находим все банковские платежи
      let payments = [];
      
      // Проверяем прямую связь
      const { data: directPayments } = await supabase
        .from('payments')
        .select('*')
        .eq('proforma_id', proforma.id)
        .eq('direction', 'in')
        .is('deleted_at', null);

      if (directPayments && directPayments.length > 0) {
        payments = directPayments;
      } else {
        // Проверяем manual связи
        const { data: manualPayments } = await supabase
          .from('payments')
          .select('*')
          .or(`manual_proforma_id.eq.${proforma.invoiceId || proforma.id},manual_proforma_fullnumber.eq.${proforma.fullnumber}`)
          .eq('direction', 'in')
          .is('deleted_at', null);
        
        if (manualPayments && manualPayments.length > 0) {
          payments = manualPayments;
        }
      }

      // 3. Рассчитываем банковские платежи
      let totalBankPayments = 0;
      let totalBankPaymentsPln = 0;

      payments.forEach(payment => {
        const amount = parseFloat(payment.amount) || 0;
        let amountPln = parseFloat(payment.amount_pln) || 0;

        if (amountPln === 0 && amount > 0) {
          const currency = (payment.currency || 'PLN').toUpperCase();
          if (exchangeRate && currency !== 'PLN') {
            amountPln = amount * exchangeRate;
          } else if (currency === 'PLN') {
            amountPln = amount;
          }
        }

        totalBankPayments += amount;
        totalBankPaymentsPln += amountPln;
      });

      logger.info(`\n   Текущие агрегаты:`);
      logger.info(`     payments_total: ${proforma.payments_total || 0}`);
      logger.info(`     payments_total_pln: ${proforma.payments_total_pln || 0}`);
      logger.info(`     payments_total_cash: ${proforma.payments_total_cash || 0}`);
      logger.info(`     payments_total_cash_pln: ${proforma.payments_total_cash_pln || 0}`);
      logger.info(`     payments_count: ${proforma.payments_count || 0}`);
      logger.info(`\n   Найдено банковских платежей: ${payments.length}`);
      logger.info(`     Сумма банковских платежей: ${totalBankPayments.toFixed(2)} ${proformaCurrency} (${totalBankPaymentsPln.toFixed(2)} PLN)`);

      let updates = {
        updated_at: new Date().toISOString()
      };

      if (options.fullyPaid) {
        // Для полностью оплаченных сделок
        logger.info(`\n   💡 Устанавливаю агрегаты для полностью оплаченной сделки...`);
        updates.payments_total = proformaTotal;
        updates.payments_total_pln = proformaTotalPln;
        updates.payments_count = payments.length || 1;
        updates.payments_currency_exchange = exchangeRate;
      } else if (options.cashRemainder) {
        // Для сделок с наличной оплатой остатка
        logger.info(`\n   💡 Обрабатываю оплату остатка наличными...`);
        
        // Остаток = сумма проформы - банковские платежи
        const cashRemainder = Math.max(0, proformaTotal - totalBankPayments);
        const cashRemainderPln = Math.max(0, proformaTotalPln - totalBankPaymentsPln);

        if (cashRemainder > 0) {
          logger.info(`     Остаток к оплате наличными: ${cashRemainder.toFixed(2)} ${proformaCurrency} (${cashRemainderPln.toFixed(2)} PLN)`);
          
          updates.payments_total = proformaTotal; // Общая сумма = банк + наличные
          updates.payments_total_pln = proformaTotalPln;
          updates.payments_total_cash = cashRemainder;
          updates.payments_total_cash_pln = cashRemainderPln;
          updates.payments_count = payments.length + 1; // +1 за наличный платеж
          updates.payments_currency_exchange = exchangeRate;

          // Создаем или обновляем запись в cash_payments
          logger.info(`     Создаю запись в cash_payments...`);
          
          // Проверяем, есть ли уже cash_payment для этой проформы
          const { data: existingCashPayments } = await supabase
            .from('cash_payments')
            .select('*')
            .eq('deal_id', dealId)
            .eq('proforma_id', proforma.id);

          if (existingCashPayments && existingCashPayments.length > 0) {
            // Обновляем существующую запись
            const cashPayment = existingCashPayments[0];
            const { error: cashUpdateError } = await supabase
              .from('cash_payments')
              .update({
                cash_expected_amount: cashRemainder,
                cash_received_amount: cashRemainder,
                amount_pln: cashRemainderPln,
                currency: proformaCurrency,
                status: 'received',
                confirmed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', cashPayment.id);

            if (cashUpdateError) {
              logger.warn(`     ⚠️  Ошибка при обновлении cash_payments: ${cashUpdateError.message}`);
            } else {
              logger.info(`     ✅ Обновлена запись cash_payments ID: ${cashPayment.id}`);
            }
          } else {
            // Создаем новую запись
            const { data: newCashPayment, error: cashInsertError } = await supabase
              .from('cash_payments')
              .insert({
                deal_id: parseInt(dealId, 10),
                proforma_id: proforma.id,
                proforma_fullnumber: proforma.fullnumber,
                cash_expected_amount: cashRemainder,
                cash_received_amount: cashRemainder,
                amount_pln: cashRemainderPln,
                currency: proformaCurrency,
                status: 'received',
                confirmed_at: new Date().toISOString(),
                source: 'manual',
                note: 'Оплата остатка наличными (исправление агрегатов)',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .select()
              .single();

            if (cashInsertError) {
              logger.warn(`     ⚠️  Ошибка при создании cash_payments: ${cashInsertError.message}`);
            } else {
              logger.info(`     ✅ Создана запись cash_payments ID: ${newCashPayment.id}`);
            }
          }
        } else {
          logger.warn(`     ⚠️  Остаток = 0, наличные не требуются`);
          // Если остаток 0, просто обновляем банковские платежи
          updates.payments_total = totalBankPayments > 0 ? totalBankPayments : proformaTotal;
          updates.payments_total_pln = totalBankPaymentsPln > 0 ? totalBankPaymentsPln : proformaTotalPln;
          updates.payments_count = payments.length || 1;
          updates.payments_currency_exchange = exchangeRate;
        }
      }

      // 4. Обновляем проформу
      logger.info(`\n   🔄 Обновляю агрегаты проформы...`);

      const { error: updateError } = await supabase
        .from('proformas')
        .update(updates)
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('   ❌ Ошибка при обновлении:', updateError);
      } else {
        logger.info('   ✅ Агрегаты успешно обновлены!');
        logger.info(`     payments_total: ${updates.payments_total?.toFixed(2) || 'N/A'}`);
        logger.info(`     payments_total_pln: ${updates.payments_total_pln?.toFixed(2) || 'N/A'}`);
        if (updates.payments_total_cash !== undefined) {
          logger.info(`     payments_total_cash: ${updates.payments_total_cash.toFixed(2)}`);
          logger.info(`     payments_total_cash_pln: ${updates.payments_total_cash_pln.toFixed(2)}`);
        }
        logger.info(`     payments_count: ${updates.payments_count || 'N/A'}`);
      }
    }
  } catch (err) {
    logger.error('Неожиданная ошибка:', err);
    throw err;
  }
}

async function main() {
  try {
    // Deal 1586 - полностью оплачена
    logger.info('\n' + '='.repeat(80));
    logger.info('DEAL 1586 - Полностью оплачена');
    logger.info('='.repeat(80));
    await fixDealAggregates('1586', { fullyPaid: true });

    // Deal 1341 - остаток оплачен наличными
    logger.info('\n' + '='.repeat(80));
    logger.info('DEAL 1341 - Остаток оплачен наличными');
    logger.info('='.repeat(80));
    await fixDealAggregates('1341', { cashRemainder: true });

    logger.info('\n' + '='.repeat(80));
    logger.info('✅ Все сделки обработаны!');
    logger.info('='.repeat(80));

  } catch (error) {
    logger.error('Необработанная ошибка:', error);
    process.exit(1);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
