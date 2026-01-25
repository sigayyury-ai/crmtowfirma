#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = '1534';

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

      // 2. Находим все платежи, связанные с этой проформой
      let payments = [];
      
      // Обычные платежи
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

      // Проверяем Stripe платежи для этой сделки
      const { data: stripePayments, error: stripeError } = await supabase
        .from('stripe_payments')
        .select('*')
        .eq('deal_id', DEAL_ID)
        .eq('status', 'processed')
        .order('created_at', { ascending: false });

      if (!stripeError && stripePayments && stripePayments.length > 0) {
        logger.info(`   Найдено Stripe платежей: ${stripePayments.length}`);
      }

      // Проверяем наличные платежи
      const { data: cashPayments, error: cashError } = await supabase
        .from('cash_payments')
        .select('*')
        .eq('proforma_id', proforma.id)
        .eq('status', 'received')
        .order('confirmed_at', { ascending: false });

      if (!cashError && cashPayments && cashPayments.length > 0) {
        logger.info(`   Найдено наличных платежей: ${cashPayments.length}`);
      }

      logger.info(`\n   Найдено платежей: ${payments.length}`);
      if (payments.length > 0) {
        payments.forEach((p, i) => {
          logger.info(`   ${i + 1}. ${p.operation_date || p.payment_date || 'N/A'}: ${p.amount} ${p.currency || 'PLN'} (${p.payer_name || 'N/A'})`);
        });
      }

      // 3. Рассчитываем правильные агрегаты
      // Пользователь сказал: "все было оплачено", поэтому устанавливаем агрегаты равными сумме проформы
      const proformaTotal = parseFloat(proforma.total) || 0;
      const proformaCurrency = proforma.currency || 'PLN';
      
      // Если платежи найдены, используем их сумму
      let calculatedTotal = proformaTotal;
      let calculatedTotalPln = proformaTotal;
      let paymentsCount = payments.length;

      if (payments.length > 0) {
        // Считаем сумму платежей
        let totalAmount = 0;
        let totalPln = 0;

        payments.forEach(payment => {
          const amount = parseFloat(payment.amount || 0);
          totalAmount += amount;

          // Если есть amount_pln, используем его, иначе конвертируем
          if (payment.amount_pln != null && payment.amount_pln !== undefined) {
            totalPln += parseFloat(payment.amount_pln || 0);
          } else {
            // Используем курс из проформы или 1 для той же валюты
            const exchangeRate = proforma.currency_exchange || (proformaCurrency === 'PLN' ? 1 : 1);
            totalPln += amount * exchangeRate;
          }
        });

        // Добавляем Stripe платежи
        if (stripePayments && stripePayments.length > 0) {
          stripePayments.forEach(sp => {
            const amount = parseFloat(sp.amount_pln || sp.amount || 0);
            totalPln += amount;
            paymentsCount++;
          });
        }

        // Добавляем наличные платежи
        if (cashPayments && cashPayments.length > 0) {
          cashPayments.forEach(cp => {
            const amount = parseFloat(cp.amount_pln || cp.cash_received_amount || 0);
            totalPln += amount;
            paymentsCount++;
          });
        }

        calculatedTotal = totalAmount || proformaTotal;
        calculatedTotalPln = totalPln || proformaTotal;
      }

      // Если платежей не найдено, но все было оплачено, устанавливаем payments_count = 1
      if (paymentsCount === 0) {
        paymentsCount = 1;
        logger.info(`   ⚠️  Платежей не найдено в базе, но все было оплачено. Устанавливаю payments_count = 1`);
      }

      logger.info(`\n   Рассчитанные агрегаты:`);
      logger.info(`     payments_total: ${calculatedTotal} ${proformaCurrency}`);
      logger.info(`     payments_total_pln: ${calculatedTotalPln} PLN`);
      logger.info(`     payments_count: ${paymentsCount}`);

      // 4. Обновляем агрегаты в проформе
      const { error: updateError } = await supabase
        .from('proformas')
        .update({
          payments_total: calculatedTotal,
          payments_total_pln: calculatedTotalPln,
          payments_count: paymentsCount
        })
        .eq('id', proforma.id);

      if (updateError) {
        logger.error('Ошибка при обновлении агрегатов:', updateError);
      } else {
        logger.info(`\n   ✅ Агрегаты успешно обновлены для проформы ${proforma.fullnumber || proforma.id}`);
      }
    }

    logger.info('\n✅ Готово!\n');
  } catch (error) {
    logger.error('Ошибка:', error);
    process.exit(1);
  }
}

fixProformaAggregates();
