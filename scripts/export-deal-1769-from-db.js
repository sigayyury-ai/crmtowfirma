#!/usr/bin/env node

/**
 * Выгрузка всех данных из базы данных для сделки 1769
 * Показывает платежи, сессии, валюты и суммы
 * 
 * Использование:
 *   node scripts/export-deal-1769-from-db.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripeRepository = require('../src/services/stripe/repository');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../src/utils/logger');

const DEAL_ID = process.argv[2] ? parseInt(process.argv[2]) : 1769;

async function exportDealFromDb() {
  try {
    console.log(`\n📥 Выгрузка данных из БД для сделки #${DEAL_ID}...\n`);
    console.log('='.repeat(100));

    const repository = new StripeRepository();

    // Получаем все платежи для этой сделки
    const payments = await repository.listPayments({ dealId: String(DEAL_ID) });

    console.log(`✅ Найдено платежей в БД: ${payments.length}\n`);

    const output = {
      deal_id: DEAL_ID,
      exported_at: new Date().toISOString(),
      payments_count: payments.length,
      payments: payments.map(p => ({
        id: p.id,
        session_id: p.session_id || null,
        payment_type: p.payment_type || null,
        payment_status: p.payment_status || p.status || null,
        currency: p.currency || null,
        amount: p.amount || null,
        original_amount: p.original_amount || null,
        amount_pln: p.amount_pln || null,
        payment_schedule: p.payment_schedule || null,
        created_at: p.created_at || null,
        processed_at: p.processed_at || null,
        status: p.status || null,
        deal_id: p.deal_id || null,
        product_id: p.product_id || null,
        invoice_number: p.invoice_number || null
      }))
    };

    // Выводим детальную информацию
    console.log('💳 ПЛАТЕЖИ В БД:\n');
    payments.forEach((p, i) => {
      console.log(`${i + 1}. ${p.payment_type || 'N/A'}`);
      console.log(`   ID: ${p.id}`);
      console.log(`   Session ID: ${p.session_id || 'N/A'}`);
      console.log(`   Статус: ${p.payment_status || p.status || 'N/A'}`);
      console.log(`   Валюта: ${p.currency || 'N/A'}`);
      console.log(`   amount: ${p.amount || 'N/A'}`);
      console.log(`   original_amount: ${p.original_amount || 'N/A'}`);
      console.log(`   amount_pln: ${p.amount_pln || 'N/A'}`);
      console.log(`   График: ${p.payment_schedule || 'N/A'}`);
      console.log(`   Создан: ${p.created_at || 'N/A'}`);
      console.log(`   Обработан: ${p.processed_at || 'N/A'}`);
      console.log('');
    });

    // Считаем суммы
    const paidPayments = payments.filter(p => p.payment_status === 'paid' || p.status === 'processed');
    
    // Суммируем по валютам
    const totalsByCurrency = {};
    const totalsOriginalByCurrency = {};
    const totalsPln = {};

    paidPayments.forEach(p => {
      const currency = p.currency || 'UNKNOWN';
      
      // amount
      if (p.amount) {
        totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + parseFloat(p.amount);
      }
      
      // original_amount
      if (p.original_amount) {
        totalsOriginalByCurrency[currency] = (totalsOriginalByCurrency[currency] || 0) + parseFloat(p.original_amount);
      }
      
      // amount_pln
      if (p.amount_pln) {
        totalsPln[currency] = (totalsPln[currency] || 0) + parseFloat(p.amount_pln);
      }
    });

    console.log('💰 СУММЫ ОПЛАЧЕННЫХ ПЛАТЕЖЕЙ:\n');
    console.log('   По полю "amount":');
    Object.entries(totalsByCurrency).forEach(([currency, total]) => {
      console.log(`     ${currency}: ${total.toFixed(2)}`);
    });
    
    console.log('   По полю "original_amount":');
    Object.entries(totalsOriginalByCurrency).forEach(([currency, total]) => {
      console.log(`     ${currency}: ${total.toFixed(2)}`);
    });
    
    console.log('   По полю "amount_pln":');
    Object.entries(totalsPln).forEach(([currency, total]) => {
      console.log(`     ${currency}: ${total.toFixed(2)} PLN`);
    });

    // Сохраняем в JSON
    const outputPath = path.join(__dirname, '../tmp/deal-1769-from-db.json');
    const outputDir = path.dirname(outputPath);
    
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (error) {
      // Директория уже существует
    }

    output.summary = {
      totals_by_currency_amount: totalsByCurrency,
      totals_by_currency_original_amount: totalsOriginalByCurrency,
      totals_pln_by_currency: totalsPln
    };

    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), 'utf8');

    console.log(`\n💾 Данные сохранены в: ${outputPath}`);
    console.log('\n✅ Выгрузка завершена!\n');

  } catch (error) {
    console.error('\n❌ Ошибка:', error.message);
    console.error(error.stack);
    logger.error('Export deal from DB failed', { dealId: DEAL_ID, error: error.message, stack: error.stack });
    process.exit(1);
  }
}

exportDealFromDb().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});

