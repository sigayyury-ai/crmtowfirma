#!/usr/bin/env node

/**
 * Диагностика проблем с созданием Stripe платежей для сделок
 * 
 * Использование:
 *   node scripts/diagnose-stripe-payment-creation.js <dealId1> [dealId2] ...
 * 
 * Примеры:
 *   node scripts/diagnose-stripe-payment-creation.js 2092 2088
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeProcessorService = require('../src/services/stripe/processor');
const StripeRepository = require('../src/services/stripe/repository');
const PaymentScheduleService = require('../src/services/stripe/paymentScheduleService');
const DealAmountCalculator = require('../src/services/stripe/dealAmountCalculator');
const logger = require('../src/utils/logger');

async function diagnoseDeal(dealId) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`🔍 ДИАГНОСТИКА СДЕЛКИ #${dealId}`);
  console.log('='.repeat(80));
  
  const issues = [];
  const warnings = [];
  const info = [];
  
  try {
    const processor = new StripeProcessorService();
    const repository = new StripeRepository();
    
    // 1. Проверка: Получение данных сделки
    console.log(`\n📋 Шаг 1: Получение данных сделки...`);
    const dealResult = await processor.pipedriveClient.getDealWithRelatedData(dealId);
    
    if (!dealResult.success || !dealResult.deal) {
      issues.push({
        step: 'Получение данных сделки',
        error: `Не удалось получить данные сделки: ${dealResult?.error || 'unknown'}`,
        critical: true
      });
      console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
      return { dealId, issues, warnings, info };
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const organization = dealResult.organization;
    
    info.push({
      step: 'Данные сделки',
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      status: deal.status,
      stageId: deal.stage_id,
      expectedCloseDate: deal.expected_close_date
    });
    
    console.log(`✅ Сделка найдена: "${deal.title}"`);
    console.log(`   Сумма: ${deal.value} ${deal.currency || 'PLN'}`);
    console.log(`   Статус: ${deal.status}`);
    console.log(`   Stage ID: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'не указана'}`);
    
    // 2. Проверка: Статус сделки
    console.log(`\n📋 Шаг 2: Проверка статуса сделки...`);
    const dealStatus = deal.status;
    if (dealStatus === 'lost' || dealStatus === 'deleted' || deal.deleted === true) {
      issues.push({
        step: 'Статус сделки',
        error: `Сделка закрыта или удалена (status: ${dealStatus})`,
        critical: true,
        solution: 'Нельзя создавать платежи для закрытых/удаленных сделок'
      });
      console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
      return { dealId, issues, warnings, info };
    }
    console.log(`✅ Статус сделки OK: ${dealStatus}`);
    
    // 3. Проверка: invoice_type
    console.log(`\n📋 Шаг 3: Проверка invoice_type...`);
    const invoiceTypeFieldKey = processor.invoiceTypeFieldKey;
    if (invoiceTypeFieldKey && deal[invoiceTypeFieldKey]) {
      const invoiceType = String(deal[invoiceTypeFieldKey]).trim();
      if (invoiceType === '74' || invoiceType.toLowerCase() === 'delete') {
        issues.push({
          step: 'invoice_type',
          error: `invoice_type = Delete (${invoiceType})`,
          critical: true,
          solution: 'Нельзя создавать платежи для сделок с invoice_type = Delete'
        });
        console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
        return { dealId, issues, warnings, info };
      }
      info.push({ step: 'invoice_type', value: invoiceType });
      console.log(`✅ invoice_type: ${invoiceType}`);
    } else {
      console.log(`ℹ️  invoice_type не установлен`);
    }
    
    // 4. Проверка: Продукты в сделке
    console.log(`\n📋 Шаг 4: Проверка продуктов в сделке...`);
    const dealProductsResult = await processor.pipedriveClient.getDealProducts(dealId);
    
    if (!dealProductsResult.success || !dealProductsResult.products || dealProductsResult.products.length === 0) {
      issues.push({
        step: 'Продукты в сделке',
        error: 'В сделке нет продуктов',
        critical: true,
        solution: 'Добавьте хотя бы один продукт в сделку'
      });
      console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
      return { dealId, issues, warnings, info };
    }
    
    const firstProduct = dealProductsResult.products[0];
    info.push({
      step: 'Продукты',
      count: dealProductsResult.products.length,
      firstProduct: {
        name: firstProduct.name || firstProduct.product?.name,
        quantity: firstProduct.quantity,
        itemPrice: firstProduct.item_price,
        sum: firstProduct.sum
      }
    });
    
    console.log(`✅ Найдено продуктов: ${dealProductsResult.products.length}`);
    console.log(`   Первый продукт: ${firstProduct.name || firstProduct.product?.name || 'N/A'}`);
    console.log(`   Количество: ${firstProduct.quantity || 1}`);
    console.log(`   Цена за единицу: ${firstProduct.item_price || 'N/A'}`);
    console.log(`   Сумма: ${firstProduct.sum || 'N/A'}`);
    
    // 5. Проверка: Расчет суммы платежа
    console.log(`\n📋 Шаг 5: Расчет суммы платежа...`);
    const scheduleResult = PaymentScheduleService.determineScheduleFromDeal(deal);
    const paymentSchedule = scheduleResult.schedule;
    
    try {
      const productPrice = DealAmountCalculator.calculatePaymentAmount(
        deal,
        dealProductsResult.products,
        paymentSchedule,
        'single' // Проверяем для single платежа
      );
      
      if (productPrice <= 0 || isNaN(productPrice)) {
        issues.push({
          step: 'Расчет суммы',
          error: `Рассчитанная сумма невалидна: ${productPrice}`,
          critical: true,
          solution: 'Проверьте сумму сделки и цены продуктов'
        });
        console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
      } else {
        info.push({
          step: 'Расчет суммы',
          calculatedAmount: productPrice,
          schedule: paymentSchedule
        });
        console.log(`✅ Рассчитанная сумма: ${productPrice} ${deal.currency || 'PLN'}`);
        console.log(`   График платежей: ${paymentSchedule}`);
      }
    } catch (error) {
      issues.push({
        step: 'Расчет суммы',
        error: `Ошибка расчета суммы: ${error.message}`,
        critical: true,
        solution: 'Проверьте данные продуктов и суммы сделки'
      });
      console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
    }
    
    // 6. Проверка: Email клиента
    console.log(`\n📋 Шаг 6: Проверка email клиента...`);
    const customerEmail = person?.email?.[0]?.value || person?.email || organization?.email?.[0]?.value || organization?.email || null;
    
    if (!customerEmail) {
      issues.push({
        step: 'Email клиента',
        error: 'Не найден email клиента (ни у персоны, ни у организации)',
        critical: true,
        solution: 'Добавьте email контакту или организации в Pipedrive'
      });
      console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
    } else {
      info.push({
        step: 'Email клиента',
        email: customerEmail,
        source: person?.email ? 'person' : 'organization'
      });
      console.log(`✅ Email найден: ${customerEmail}`);
      console.log(`   Источник: ${person?.email ? 'Персона' : 'Организация'}`);
    }
    
    // 7. Проверка: Адрес для VAT
    console.log(`\n📋 Шаг 7: Проверка адреса для VAT...`);
    const crmContext = await processor.getCrmContext(dealId);
    const customerType = crmContext?.isB2B ? 'organization' : 'person';
    const addressParts = processor.extractAddressParts(crmContext);
    const countryCode = processor.extractCountryCode(addressParts);
    const shouldApplyVat = processor.shouldApplyVat({
      customerType,
      companyCountry: countryCode,
      sessionCountry: countryCode
    });
    
    info.push({
      step: 'VAT',
      shouldApplyVat,
      customerType,
      countryCode: countryCode || 'не определен'
    });
    
    console.log(`ℹ️  Применение VAT: ${shouldApplyVat ? 'Да' : 'Нет'}`);
    console.log(`   Тип клиента: ${customerType}`);
    console.log(`   Код страны: ${countryCode || 'не определен'}`);
    
    if (shouldApplyVat) {
      const addressValidation = await processor.ensureAddress({
        dealId,
        shouldApplyVat,
        participant: { address: addressParts },
        crmContext
      });
      
      if (!addressValidation.valid) {
        issues.push({
          step: 'Валидация адреса',
          error: `Валидация адреса не пройдена: ${addressValidation.reason || 'missing_address'}`,
          critical: true,
          solution: 'Добавьте полный адрес клиента в Pipedrive (страна, город, почтовый индекс, адрес)'
        });
        console.log(`❌ КРИТИЧНО: ${issues[issues.length - 1].error}`);
      } else {
        console.log(`✅ Адрес валиден`);
      }
    }
    
    // 8. Проверка: Существующие платежи
    console.log(`\n📋 Шаг 8: Проверка существующих платежей...`);
    const existingPayments = await repository.listPayments({
      dealId: String(dealId),
      limit: 100
    });
    
    const depositPayments = existingPayments.filter(p => 
      (p.payment_type === 'deposit' || p.payment_type === 'first') && p.payment_status === 'paid'
    );
    const restPayments = existingPayments.filter(p => 
      (p.payment_type === 'rest' || p.payment_type === 'second' || p.payment_type === 'final') && p.payment_status === 'paid'
    );
    const singlePayments = existingPayments.filter(p => 
      p.payment_type === 'single' && p.payment_status === 'paid'
    );
    
    info.push({
      step: 'Существующие платежи',
      total: existingPayments.length,
      depositPaid: depositPayments.length,
      restPaid: restPayments.length,
      singlePaid: singlePayments.length
    });
    
    console.log(`ℹ️  Всего платежей: ${existingPayments.length}`);
    console.log(`   Оплаченных депозитов: ${depositPayments.length}`);
    console.log(`   Оплаченных остатков: ${restPayments.length}`);
    console.log(`   Оплаченных единых платежей: ${singlePayments.length}`);
    
    if (singlePayments.length > 0 || (depositPayments.length > 0 && restPayments.length > 0)) {
      warnings.push({
        step: 'Существующие платежи',
        warning: 'Сделка уже полностью оплачена',
        solution: 'Не нужно создавать новые платежи'
      });
      console.log(`⚠️  ПРЕДУПРЕЖДЕНИЕ: Сделка уже полностью оплачена`);
    }
    
    // 9. Попытка создания сессии (тестовая)
    console.log(`\n📋 Шаг 9: Тестовая попытка создания сессии...`);
    try {
      const testResult = await processor.createCheckoutSessionForDeal(deal, {
        trigger: 'diagnostic',
        runId: `diagnostic_${Date.now()}`,
        paymentType: 'single',
        paymentSchedule: paymentSchedule,
        skipNotification: true // Не отправляем уведомление при диагностике
      });
      
      if (!testResult.success) {
        issues.push({
          step: 'Создание сессии',
          error: testResult.error || 'Неизвестная ошибка при создании сессии',
          critical: true,
          solution: 'Проверьте логи выше для деталей'
        });
        console.log(`❌ ОШИБКА: ${testResult.error}`);
      } else {
        console.log(`✅ Тестовая сессия создана успешно!`);
        console.log(`   Session ID: ${testResult.sessionId}`);
        console.log(`   URL: ${testResult.sessionUrl}`);
        console.log(`   Amount: ${testResult.amount} ${testResult.currency}`);
        
        // Удаляем тестовую сессию
        try {
          const stripe = processor.stripe;
          await stripe.checkout.sessions.expire(testResult.sessionId);
          console.log(`   ℹ️  Тестовая сессия удалена`);
        } catch (err) {
          console.log(`   ⚠️  Не удалось удалить тестовую сессию: ${err.message}`);
        }
      }
    } catch (error) {
      issues.push({
        step: 'Создание сессии',
        error: `Исключение при создании сессии: ${error.message}`,
        critical: true,
        stack: error.stack
      });
      console.log(`❌ ИСКЛЮЧЕНИЕ: ${error.message}`);
    }
    
  } catch (error) {
    issues.push({
      step: 'Общая ошибка',
      error: `Критическая ошибка: ${error.message}`,
      critical: true,
      stack: error.stack
    });
    console.log(`❌ КРИТИЧЕСКАЯ ОШИБКА: ${error.message}`);
  }
  
  // Итоговый отчет
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ИТОГОВЫЙ ОТЧЕТ ДЛЯ СДЕЛКИ #${dealId}`);
  console.log('='.repeat(80));
  
  if (issues.length === 0) {
    console.log(`\n✅ Все проверки пройдены успешно! Платеж должен создаваться без проблем.`);
  } else {
    console.log(`\n❌ Найдено проблем: ${issues.length}`);
    issues.forEach((issue, index) => {
      console.log(`\n${index + 1}. ${issue.step}`);
      console.log(`   Ошибка: ${issue.error}`);
      if (issue.solution) {
        console.log(`   Решение: ${issue.solution}`);
      }
      if (issue.stack) {
        console.log(`   Stack trace: ${issue.stack.substring(0, 200)}...`);
      }
    });
  }
  
  if (warnings.length > 0) {
    console.log(`\n⚠️  Предупреждения: ${warnings.length}`);
    warnings.forEach((warning, index) => {
      console.log(`\n${index + 1}. ${warning.step}`);
      console.log(`   Предупреждение: ${warning.warning}`);
      if (warning.solution) {
        console.log(`   Решение: ${warning.solution}`);
      }
    });
  }
  
  return { dealId, issues, warnings, info };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('❌ Ошибка: Укажите хотя бы один ID сделки');
    console.error('\nИспользование:');
    console.error('  node scripts/diagnose-stripe-payment-creation.js <dealId1> [dealId2] ...');
    console.error('\nПримеры:');
    console.error('  node scripts/diagnose-stripe-payment-creation.js 2092');
    console.error('  node scripts/diagnose-stripe-payment-creation.js 2092 2088');
    process.exit(1);
  }
  
  const dealIds = args.map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  
  if (dealIds.length === 0) {
    console.error('❌ Ошибка: Не найдено валидных ID сделок');
    process.exit(1);
  }
  
  console.log(`\n🔍 Начинаю диагностику ${dealIds.length} сделок...\n`);
  
  const results = [];
  for (const dealId of dealIds) {
    try {
      const result = await diagnoseDeal(dealId);
      results.push(result);
    } catch (error) {
      console.error(`\n❌ Критическая ошибка при диагностике сделки #${dealId}:`, error.message);
      results.push({
        dealId,
        issues: [{
          step: 'Диагностика',
          error: error.message,
          critical: true
        }],
        warnings: [],
        info: []
      });
    }
  }
  
  // Общий итог
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📊 ОБЩИЙ ИТОГ`);
  console.log('='.repeat(80));
  
  const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
  const totalWarnings = results.reduce((sum, r) => sum + r.warnings.length, 0);
  
  console.log(`\nВсего проверено сделок: ${results.length}`);
  console.log(`Всего найдено проблем: ${totalIssues}`);
  console.log(`Всего предупреждений: ${totalWarnings}`);
  
  if (totalIssues === 0) {
    console.log(`\n✅ Все сделки прошли проверку успешно!`);
  } else {
    console.log(`\n❌ Есть проблемы, требующие решения. См. детали выше.`);
  }
}

main().catch((error) => {
  logger.error('Script failed', { error: error.message, stack: error.stack });
  console.error('\n❌ Критическая ошибка скрипта:', error.message);
  process.exit(1);
});
