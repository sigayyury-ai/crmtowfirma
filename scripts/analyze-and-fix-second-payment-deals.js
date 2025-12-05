/**
 * Скрипт для анализа сделок в статусе Second Payment
 * Проверяет платежи и либо обновляет статус, либо создает задачи для крона
 */

require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const { STAGE_IDS, evaluatePaymentStatus } = require('../src/services/crm/statusCalculator');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

// ID сделок для анализа
const dealIds = [1241, 1301, 1586, 1593, 1598, 1606, 1638];

const pipedriveClient = new PipedriveClient();

/**
 * Получить проформы для сделки
 */
async function getProformasForDeal(dealId) {
  try {
    // Сначала ищем по pipedrive_deal_id
    let { data, error } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', dealId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Error fetching proformas by deal_id', { dealId, error: error.message });
    }

    // Если не нашли, пробуем найти по номеру проформы из поля сделки
    if ((!data || data.length === 0) && !error) {
      const dealResult = await pipedriveClient.getDeal(dealId);
      if (dealResult.success && dealResult.deal) {
        const deal = dealResult.deal;
        // Пробуем найти поле с номером проформы (может быть в разных полях)
        const invoiceNumberFieldKey = process.env.PIPEDRIVE_WFIRMA_INVOICE_ID_FIELD_KEY;
        if (invoiceNumberFieldKey && deal[invoiceNumberFieldKey]) {
          const invoiceNumber = String(deal[invoiceNumberFieldKey]).trim();
          console.log(`  Ищем проформу по номеру из сделки: ${invoiceNumber}`);
          
          const { data: proformasByNumber, error: errorByNumber } = await supabase
            .from('proformas')
            .select('*')
            .or(`fullnumber.eq.${invoiceNumber},fullnumber.ilike.%${invoiceNumber}%`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
          
          if (!errorByNumber && proformasByNumber && proformasByNumber.length > 0) {
            console.log(`  Найдено проформ по номеру: ${proformasByNumber.length}`);
            data = proformasByNumber;
          }
        }
      }
    }

    // Для конкретных сделок пробуем найти по известным номерам проформ
    if ((!data || data.length === 0) && !error) {
      const knownProformas = {
        1598: ['CO-PROF 136/2025', 'CO-PROF 136/2025', '136/2025', '136'],
        1606: ['CO-PROF 149/2025', 'CO-PROF 149/2025', '149/2025', '149']
      };
      
      if (knownProformas[dealId]) {
        const proformaNumbers = knownProformas[dealId];
        console.log(`  Ищем проформу по известным номерам: ${proformaNumbers.join(', ')}`);
        
        // Пробуем разные варианты поиска
        for (const proformaNumber of proformaNumbers) {
          // Точное совпадение
          let { data: proformasByKnownNumber, error: errorByKnownNumber } = await supabase
            .from('proformas')
            .select('*')
            .eq('fullnumber', proformaNumber)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
          
          if (!errorByKnownNumber && proformasByKnownNumber && proformasByKnownNumber.length > 0) {
            console.log(`  Найдено проформ по точному номеру "${proformaNumber}": ${proformasByKnownNumber.length}`);
            data = proformasByKnownNumber;
            break;
          }
          
          // Поиск с LIKE
          const { data: proformasByLike, error: errorByLike } = await supabase
            .from('proformas')
            .select('*')
            .ilike('fullnumber', `%${proformaNumber}%`)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });
          
          if (!errorByLike && proformasByLike && proformasByLike.length > 0) {
            console.log(`  Найдено проформ по LIKE "${proformaNumber}": ${proformasByLike.length}`);
            data = proformasByLike;
            break;
          }
        }
      }
    }

    return data || [];
  } catch (error) {
    logger.error('Exception fetching proformas', { dealId, error: error.message });
    return [];
  }
}

/**
 * Получить платежи для проформ
 */
async function getPaymentsForProformas(proformaIds) {
  if (!proformaIds || proformaIds.length === 0) {
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .in('proforma_id', proformaIds)
      .neq('manual_status', 'rejected')
      .order('payment_date', { ascending: true });

    if (error) {
      logger.error('Error fetching payments', { proformaIds, error: error.message });
      return [];
    }

    return data || [];
  } catch (error) {
    logger.error('Exception fetching payments', { proformaIds, error: error.message });
    return [];
  }
}

/**
 * Определить график платежей на основе expected_close_date
 */
function determinePaymentSchedule(deal) {
  const closeDate = deal.expected_close_date || deal.close_date;
  if (!closeDate) {
    return { schedule: '100%', secondPaymentDate: null };
  }

  try {
    const expectedCloseDate = new Date(closeDate);
    const today = new Date();
    const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));

    if (daysDiff >= 30) {
      const secondPaymentDate = new Date(expectedCloseDate);
      secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
      return { schedule: '50/50', secondPaymentDate };
    } else {
      return { schedule: '100%', secondPaymentDate: null };
    }
  } catch (error) {
    logger.warn('Failed to determine payment schedule', {
      dealId: deal.id,
      closeDate,
      error: error.message
    });
    return { schedule: '100%', secondPaymentDate: null };
  }
}

/**
 * Проверить, оплачены ли все платежи
 */
function checkPaymentsStatus(deal, proformas, payments, schedule) {
  const dealValue = parseFloat(deal.value) || 0;
  const currency = deal.currency || 'PLN';

  // Считаем общую сумму оплаченных платежей
  let totalPaid = 0;
  let totalPaidPln = 0;

  for (const payment of payments) {
    const amount = parseFloat(payment.amount || 0);
    totalPaid += amount;

    // Если есть PLN сумма, используем её, иначе конвертируем
    if (payment.amount_pln !== null && payment.amount_pln !== undefined) {
      totalPaidPln += parseFloat(payment.amount_pln || 0);
    } else {
      // Используем курс из проформы или 1 для той же валюты
      const proforma = proformas.find(p => p.id === payment.proforma_id);
      const exchangeRate = proforma?.currency_exchange || (currency === 'PLN' ? 1 : null);
      if (exchangeRate) {
        totalPaidPln += amount * exchangeRate;
      } else {
        // Если нет курса, используем сумму как есть (предполагаем PLN)
        totalPaidPln += amount;
      }
    }
  }

  // Если нет PLN суммы, используем обычную сумму
  const paidAmountPln = totalPaidPln > 0 ? totalPaidPln : totalPaid;

  // Оцениваем статус платежей
  const evaluation = evaluatePaymentStatus({
    expectedAmountPln: dealValue,
    paidAmountPln: paidAmountPln,
    scheduleType: schedule.schedule,
    manualPaymentsCount: payments.length
  });

  return {
    totalPaid,
    totalPaidPln: paidAmountPln,
    expectedAmount: dealValue,
    paidRatio: evaluation.paidRatio,
    targetStageId: evaluation.targetStageId,
    targetStageName: evaluation.targetStageName,
    reason: evaluation.reason,
    isFullyPaid: evaluation.paidRatio >= 0.95,
    paymentsCount: payments.length
  };
}

/**
 * Анализировать сделку
 */
async function analyzeDeal(dealId) {
  try {
    console.log(`\n=== Анализ сделки #${dealId} ===`);

    // Получаем данные сделки
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      console.log(`❌ Сделка #${dealId} не найдена`);
      return { dealId, error: 'Deal not found' };
    }

    const deal = dealResult.deal;
    const currentStageId = deal.stage_id;

    console.log(`Название: ${deal.title}`);
    console.log(`Текущий статус: ${currentStageId} (${currentStageId === STAGE_IDS.SECOND_PAYMENT ? 'Second Payment' : 'Другой'})`);
    console.log(`Сумма: ${deal.value} ${deal.currency}`);
    console.log(`Дата начала: ${deal.expected_close_date || deal.close_date || 'не указана'}`);

    // Проверяем, что сделка в статусе Second Payment
    if (currentStageId !== STAGE_IDS.SECOND_PAYMENT) {
      console.log(`⚠️  Сделка не в статусе Second Payment (текущий: ${currentStageId})`);
      return { dealId, skipped: true, reason: 'Not in Second Payment stage' };
    }

    // Получаем проформы
    const proformas = await getProformasForDeal(dealId);
    if (proformas.length === 0) {
      console.log(`⚠️  Проформы не найдены для сделки #${dealId}`);
      return { dealId, skipped: true, reason: 'No proformas found' };
    }

    console.log(`Найдено проформ: ${proformas.length}`);
    proformas.forEach(p => {
      console.log(`  - ${p.fullnumber || p.id}: ${p.total} ${p.currency || deal.currency}`);
    });

    // Получаем платежи
    const proformaIds = proformas.map(p => p.id);
    const payments = await getPaymentsForProformas(proformaIds);

    console.log(`Найдено платежей: ${payments.length}`);
    if (payments.length > 0) {
      payments.forEach(p => {
        console.log(`  - ${p.payment_date || 'без даты'}: ${p.amount} ${p.currency || deal.currency} (${p.manual_status || 'approved'})`);
      });
    }

    // Определяем график платежей
    // Если сделка в статусе Second Payment, предполагаем график 50/50
    let schedule = determinePaymentSchedule(deal);
    if (currentStageId === STAGE_IDS.SECOND_PAYMENT && schedule.schedule === '100%') {
      console.log(`⚠️  Сделка в статусе Second Payment, но график определяется как 100%`);
      console.log(`   Принудительно устанавливаем график 50/50 для анализа`);
      const closeDate = deal.expected_close_date || deal.close_date;
      if (closeDate) {
        const secondPaymentDate = new Date(closeDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        schedule = { schedule: '50/50', secondPaymentDate };
      }
    }
    
    console.log(`График платежей: ${schedule.schedule}`);
    if (schedule.secondPaymentDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const secondPaymentDateObj = new Date(schedule.secondPaymentDate);
      secondPaymentDateObj.setHours(0, 0, 0, 0);
      const isDateReached = secondPaymentDateObj <= today;
      console.log(`Дата второго платежа: ${schedule.secondPaymentDate.toISOString().split('T')[0]} (${isDateReached ? 'наступила' : 'еще не наступила'})`);
    }

    // Проверяем, почему сделка не попадает в крон-задачи (для графика 50/50)
    if (schedule.schedule === '50/50' && schedule.secondPaymentDate) {
      console.log(`\n🔍 Проверка условий для крон-задачи (график 50/50):`);
      
      // Условие 1: Первый платеж должен быть оплачен
      const expectedFirstPayment = parseFloat(deal.value || 0) / 2;
      const firstPayments = payments.filter(p => {
        if (!p.payment_date || !schedule.secondPaymentDate) return false;
        const paymentDate = new Date(p.payment_date);
        paymentDate.setHours(0, 0, 0, 0);
        const secondPaymentDateObj = new Date(schedule.secondPaymentDate);
        secondPaymentDateObj.setHours(0, 0, 0, 0);
        return paymentDate < secondPaymentDateObj;
      });
      const firstPaymentTotal = firstPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
      const firstPaymentPaid = firstPaymentTotal >= expectedFirstPayment * 0.9;
      console.log(`  1. Первый платеж оплачен: ${firstPaymentPaid ? '✅' : '❌'} (ожидается: ${expectedFirstPayment}, оплачено: ${firstPaymentTotal.toFixed(2)})`);
      
      // Условие 2: Дата второго платежа должна наступить
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const secondPaymentDateObj = new Date(schedule.secondPaymentDate);
      secondPaymentDateObj.setHours(0, 0, 0, 0);
      const isDateReached = secondPaymentDateObj <= today;
      console.log(`  2. Дата второго платежа наступила: ${isDateReached ? '✅' : '❌'} (дата: ${schedule.secondPaymentDate.toISOString().split('T')[0]})`);
      
      // Условие 3: Второй платеж не должен быть оплачен
      const secondPayments = payments.filter(p => {
        if (!p.payment_date || !schedule.secondPaymentDate) return false;
        const paymentDate = new Date(p.payment_date);
        paymentDate.setHours(0, 0, 0, 0);
        const secondPaymentDateObj = new Date(schedule.secondPaymentDate);
        secondPaymentDateObj.setHours(0, 0, 0, 0);
        return paymentDate >= secondPaymentDateObj;
      });
      const secondPaymentTotal = secondPayments.reduce((sum, p) => parseFloat(p.amount || 0) + sum, 0);
      const expectedSecondPayment = parseFloat(deal.value || 0) / 2;
      const secondPaymentPaid = secondPaymentTotal >= expectedSecondPayment * 0.9;
      console.log(`  3. Второй платеж НЕ оплачен: ${!secondPaymentPaid ? '✅' : '❌'} (ожидается: ${expectedSecondPayment}, оплачено: ${secondPaymentTotal.toFixed(2)})`);
      
      const shouldBeInCron = firstPaymentPaid && isDateReached && !secondPaymentPaid;
      console.log(`  Итого: ${shouldBeInCron ? '✅ Должна быть в крон-задачах' : '❌ Не должна быть в крон-задачах'}`);
    }

    // Проверяем статус платежей
    const paymentStatus = checkPaymentsStatus(deal, proformas, payments, schedule);
    console.log(`\nСтатус платежей:`);
    console.log(`  Ожидаемая сумма: ${paymentStatus.expectedAmount} ${deal.currency}`);
    console.log(`  Оплачено: ${paymentStatus.totalPaidPln.toFixed(2)} ${deal.currency}`);
    console.log(`  Процент оплаты: ${(paymentStatus.paidRatio * 100).toFixed(2)}%`);
    console.log(`  Целевой статус: ${paymentStatus.targetStageName} (${paymentStatus.targetStageId})`);
    console.log(`  Причина: ${paymentStatus.reason}`);

    return {
      dealId,
      deal,
      proformas,
      payments,
      schedule,
      paymentStatus,
      currentStageId,
      needsUpdate: paymentStatus.isFullyPaid && currentStageId !== STAGE_IDS.CAMP_WAITER,
      needsCronTask: !paymentStatus.isFullyPaid && schedule.schedule === '50/50' && schedule.secondPaymentDate
    };

  } catch (error) {
    logger.error('Error analyzing deal', { dealId, error: error.message });
    return { dealId, error: error.message };
  }
}

/**
 * Обновить статус сделки
 */
async function updateDealStage(dealId, targetStageId) {
  try {
    console.log(`\n🔄 Обновление статуса сделки #${dealId} на ${targetStageId}...`);
    const result = await pipedriveClient.updateDealStage(dealId, targetStageId);
    if (result.success) {
      console.log(`✅ Статус успешно обновлен`);
      return { success: true };
    } else {
      console.log(`❌ Ошибка обновления статуса`);
      return { success: false, error: 'Update failed' };
    }
  } catch (error) {
    logger.error('Error updating deal stage', { dealId, targetStageId, error: error.message });
    console.log(`❌ Ошибка: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Главная функция
 */
async function main() {
  console.log('=== Анализ сделок в статусе Second Payment ===\n');
  console.log(`Проверяем сделки: ${dealIds.join(', ')}\n`);

  const results = [];

  for (const dealId of dealIds) {
    const analysis = await analyzeDeal(dealId);

    if (analysis.error) {
      results.push({ dealId, action: 'error', error: analysis.error });
      continue;
    }

    if (analysis.skipped) {
      results.push({ dealId, action: 'skipped', reason: analysis.reason });
      continue;
    }

    // Если все платежи оплачены - обновляем статус
    if (analysis.needsUpdate) {
      console.log(`\n✅ Все платежи оплачены! Обновляем статус на Camp Waiter...`);
      const updateResult = await updateDealStage(dealId, STAGE_IDS.CAMP_WAITER);
      results.push({
        dealId,
        action: 'updated',
        fromStage: analysis.currentStageId,
        toStage: STAGE_IDS.CAMP_WAITER,
        success: updateResult.success
      });
    } else if (analysis.needsCronTask) {
      console.log(`\n⚠️  Не все платежи оплачены. Сделка должна быть в крон-задачах.`);
      console.log(`   Проверьте, почему она не попадает в findAllUpcomingTasks()`);
      results.push({
        dealId,
        action: 'needs_cron_task',
        paymentStatus: analysis.paymentStatus,
        schedule: analysis.schedule
      });
    } else {
      console.log(`\nℹ️  Сделка не требует действий`);
      results.push({
        dealId,
        action: 'no_action',
        paymentStatus: analysis.paymentStatus
      });
    }
  }

  // Итоговая сводка
  console.log('\n\n=== ИТОГОВАЯ СВОДКА ===\n');
  const updated = results.filter(r => r.action === 'updated');
  const needsCron = results.filter(r => r.action === 'needs_cron_task');
  const noAction = results.filter(r => r.action === 'no_action');
  const errors = results.filter(r => r.action === 'error' || r.action === 'skipped');

  console.log(`✅ Обновлено статусов: ${updated.length}`);
  updated.forEach(r => {
    console.log(`   - Сделка #${r.dealId}: ${r.fromStage} → ${r.toStage}`);
  });

  console.log(`\n⚠️  Требуют задач в кроне: ${needsCron.length}`);
  needsCron.forEach(r => {
    console.log(`   - Сделка #${r.dealId}: оплачено ${(r.paymentStatus.paidRatio * 100).toFixed(2)}%`);
  });

  console.log(`\nℹ️  Не требуют действий: ${noAction.length}`);
  noAction.forEach(r => {
    console.log(`   - Сделка #${r.dealId}: ${r.paymentStatus.reason}`);
  });

  if (errors.length > 0) {
    console.log(`\n❌ Ошибки/пропуски: ${errors.length}`);
    errors.forEach(r => {
      console.log(`   - Сделка #${r.dealId}: ${r.error || r.reason}`);
    });
  }

  return results;
}

// Запускаем анализ
if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error('Критическая ошибка:', error);
      process.exit(1);
    });
}

module.exports = { analyzeDeal, main };

