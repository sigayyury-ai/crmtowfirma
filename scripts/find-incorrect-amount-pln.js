#!/usr/bin/env node

/**
 * Поиск сделок с неверными данными в поле amount_pln
 * Проверяет соответствие amount_pln и original_amount с учетом валюты
 * 
 * Использование:
 *   node scripts/find-incorrect-amount-pln.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const PipedriveClient = require('../src/services/pipedrive');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

// Разумные диапазоны курсов валют к PLN (примерные)
const CURRENCY_RATES = {
  'PLN': { min: 0.99, max: 1.01 }, // PLN к PLN = 1
  'EUR': { min: 4.0, max: 5.0 },  // EUR к PLN примерно 4.2-4.5
  'USD': { min: 3.5, max: 5.0 },  // USD к PLN примерно 4.0-4.5
  'GBP': { min: 4.5, max: 6.0 }   // GBP к PLN примерно 5.0-5.5
};

async function findIncorrectAmountPln() {
  try {
    console.log('\n🔍 Поиск сделок с неверными данными в amount_pln...\n');
    console.log('='.repeat(100));

    const repository = new StripeRepository();
    const pipedrive = new PipedriveClient();

    // Получаем все платежи
    const allPayments = await repository.listPayments({ limit: 10000 });
    console.log(`📊 Всего платежей в БД: ${allPayments.length}\n`);

    const issues = [];
    const dealIds = new Set();

    // Проверяем каждый платеж
    for (const payment of allPayments) {
      if (!payment.deal_id) continue;

      const currency = payment.currency || 'PLN';
      const originalAmount = parseFloat(payment.original_amount || payment.amount || 0);
      const amountPln = parseFloat(payment.amount_pln || 0);

      // Пропускаем, если нет данных
      if (!originalAmount || !amountPln) {
        continue;
      }

      // Вычисляем курс конвертации
      const rate = amountPln / originalAmount;

      // Проверяем, соответствует ли курс разумному диапазону
      const expectedRate = CURRENCY_RATES[currency];
      if (!expectedRate) {
        // Неизвестная валюта - проверяем, что курс не слишком странный
        if (rate < 0.1 || rate > 10) {
          issues.push({
            deal_id: payment.deal_id,
            payment_id: payment.id,
            session_id: payment.session_id,
            payment_type: payment.payment_type,
            currency: currency,
            original_amount: originalAmount,
            amount_pln: amountPln,
            calculated_rate: rate,
            issue: `Неизвестная валюта ${currency}, курс ${rate.toFixed(4)} выглядит подозрительно`,
            severity: 'warning'
          });
          dealIds.add(payment.deal_id);
        }
        continue;
      }

      // Проверяем, попадает ли курс в разумный диапазон
      if (rate < expectedRate.min || rate > expectedRate.max) {
        issues.push({
          deal_id: payment.deal_id,
          payment_id: payment.id,
          session_id: payment.session_id,
          payment_type: payment.payment_type,
          currency: currency,
          original_amount: originalAmount,
          amount_pln: amountPln,
          calculated_rate: rate,
          expected_rate_min: expectedRate.min,
          expected_rate_max: expectedRate.max,
          issue: `Курс ${rate.toFixed(4)} выходит за разумные пределы (${expectedRate.min}-${expectedRate.max})`,
          severity: 'error'
        });
        dealIds.add(payment.deal_id);
      }

      // Дополнительная проверка для PLN
      if (currency === 'PLN' && Math.abs(rate - 1.0) > 0.01) {
        issues.push({
          deal_id: payment.deal_id,
          payment_id: payment.id,
          session_id: payment.session_id,
          payment_type: payment.payment_type,
          currency: currency,
          original_amount: originalAmount,
          amount_pln: amountPln,
          calculated_rate: rate,
          issue: `Для PLN курс должен быть ~1.0, но получен ${rate.toFixed(4)}`,
          severity: 'error'
        });
        dealIds.add(payment.deal_id);
      }
    }

    console.log(`✅ Найдено проблемных платежей: ${issues.length}`);
    console.log(`✅ Затронуто сделок: ${dealIds.size}\n`);

    // Группируем по сделкам и получаем данные из CRM
    const dealsWithIssues = [];
    
    for (const dealId of dealIds) {
      try {
        const dealResult = await pipedrive.getDeal(dealId);
        if (!dealResult.success || !dealResult.deal) {
          continue;
        }

        const deal = dealResult.deal;
        const dealIssues = issues.filter(i => i.deal_id === dealId);

        dealsWithIssues.push({
          deal_id: dealId,
          deal_title: deal.title || 'Без названия',
          deal_value: parseFloat(deal.value) || 0,
          deal_currency: deal.currency || 'PLN',
          issues_count: dealIssues.length,
          issues: dealIssues
        });
      } catch (error) {
        logger.error(`Error fetching deal ${dealId}`, { error: error.message });
      }
    }

    // Сортируем по количеству проблем
    dealsWithIssues.sort((a, b) => b.issues_count - a.issues_count);

    // Выводим результаты
    console.log('='.repeat(100));
    console.log('\n📋 СДЕЛКИ С ПРОБЛЕМАМИ:\n');

    dealsWithIssues.forEach((deal, index) => {
      console.log(`${index + 1}. Deal #${deal.deal_id}: ${deal.deal_title}`);
      console.log(`   💰 Сумма в CRM: ${deal.deal_value} ${deal.deal_currency}`);
      console.log(`   ⚠️  Проблемных платежей: ${deal.issues_count}`);
      console.log(`   🔗 Ссылка: https://app.pipedrive.com/deal/${deal.deal_id}`);
      
      deal.issues.forEach((issue, i) => {
        console.log(`\n   Проблема ${i + 1}:`);
        console.log(`      Payment ID: ${issue.payment_id}`);
        console.log(`      Session ID: ${issue.session_id || 'N/A'}`);
        console.log(`      Тип: ${issue.payment_type || 'N/A'}`);
        console.log(`      Валюта: ${issue.currency}`);
        console.log(`      original_amount: ${issue.original_amount}`);
        console.log(`      amount_pln: ${issue.amount_pln}`);
        console.log(`      Курс: ${issue.calculated_rate.toFixed(4)}`);
        if (issue.expected_rate_min) {
          console.log(`      Ожидаемый курс: ${issue.expected_rate_min}-${issue.expected_rate_max}`);
        }
        console.log(`      Проблема: ${issue.issue}`);
      });
      console.log('');
    });

    // Статистика
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    console.log('='.repeat(100));
    console.log('\n📊 СТАТИСТИКА:\n');
    console.log(`   Всего проблемных платежей: ${issues.length}`);
    console.log(`   Критических ошибок: ${errorCount}`);
    console.log(`   Предупреждений: ${warningCount}`);
    console.log(`   Затронуто сделок: ${dealIds.size}`);

    // Сохраняем в JSON
    const outputPath = path.join(__dirname, '../tmp/incorrect-amount-pln.json');
    const outputDir = path.dirname(outputPath);
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Директория уже существует
    }

    const output = {
      exported_at: new Date().toISOString(),
      total_issues: issues.length,
      error_count: errorCount,
      warning_count: warningCount,
      affected_deals_count: dealIds.size,
      deals: dealsWithIssues,
      all_issues: issues
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\n💾 Данные сохранены в: ${outputPath}`);
    console.log('\n✅ Проверка завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Find incorrect amount_pln failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

findIncorrectAmountPln().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});





