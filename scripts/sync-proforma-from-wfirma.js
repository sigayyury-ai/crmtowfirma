#!/usr/bin/env node

/**
 * Синхронизирует проформу из wFirma в Supabase и связывает со сделкой
 * 
 * Использование:
 *   node scripts/sync-proforma-from-wfirma.js <wfirmaId> <dealId> [fullnumber]
 * 
 * Пример:
 *   node scripts/sync-proforma-from-wfirma.js 432065033 2059 "CO-PROF 2/2026"
 */

require('dotenv').config();
const { WfirmaLookup } = require('../src/services/vatMargin/wfirmaLookup');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function syncProformaFromWfirma(wfirmaId, dealId, expectedFullnumber = null) {
  try {
    console.log(`\n🔄 Синхронизация проформы из wFirma...\n`);
    console.log(`   ID wFirma: ${wfirmaId}`);
    console.log(`   Deal ID: ${dealId}`);
    if (expectedFullnumber) {
      console.log(`   Ожидаемый номер: ${expectedFullnumber}`);
    }

    const wfirmaLookup = new WfirmaLookup();
    const invoiceProcessing = new InvoiceProcessingService();

    // 1. Получаем проформу из wFirma
    console.log(`\n📥 Получение проформы из wFirma...`);
    const proforma = await wfirmaLookup.getFullProformaById(wfirmaId);
    
    if (!proforma) {
      console.error(`❌ Проформа ${wfirmaId} не найдена в wFirma`);
      process.exit(1);
    }

    console.log(`✅ Проформа получена из wFirma:`);
    console.log(`   Номер: ${proforma.fullnumber || 'N/A'}`);
    console.log(`   Дата: ${proforma.date || 'N/A'}`);
    console.log(`   Валюта: ${proforma.currency || 'N/A'}`);
    console.log(`   Сумма: ${proforma.total || 'N/A'}`);
    console.log(`   Плательщик: ${proforma.buyer?.name || 'N/A'}`);

    // Проверяем номер, если указан
    if (expectedFullnumber && proforma.fullnumber !== expectedFullnumber) {
      console.warn(`\n⚠️  Предупреждение: номер проформы не совпадает`);
      console.warn(`   Ожидалось: ${expectedFullnumber}`);
      console.warn(`   Получено: ${proforma.fullnumber}`);
    }

    // 2. Сохраняем проформу в Supabase
    console.log(`\n💾 Сохранение проформы в Supabase...`);
    
    const issueDate = proforma.date ? new Date(proforma.date) : new Date();
    
    await invoiceProcessing.persistProformaToDatabase(wfirmaId, {
      invoiceNumber: proforma.fullnumber,
      issueDate: issueDate,
      currency: proforma.currency || 'PLN',
      totalAmount: typeof proforma.total === 'number' ? proforma.total : parseFloat(proforma.total) || 0,
      fallbackProduct: (proforma.products && proforma.products.length > 0)
        ? proforma.products[0]
        : null,
      fallbackBuyer: proforma.buyer || null
    });

    console.log(`✅ Проформа сохранена в Supabase`);

    // 3. Связываем со сделкой
    console.log(`\n🔗 Связывание проформы со сделкой #${dealId}...`);
    
    const { data: updated, error: updateError } = await supabase
      .from('proformas')
      .update({
        pipedrive_deal_id: String(dealId),
        updated_at: new Date().toISOString()
      })
      .eq('id', String(wfirmaId))
      .select('id, fullnumber, pipedrive_deal_id, buyer_name');

    if (updateError) {
      console.error(`❌ Ошибка при связывании со сделкой:`, updateError);
      process.exit(1);
    }

    if (!updated || updated.length === 0) {
      console.error(`❌ Проформа не найдена в базе после сохранения`);
      process.exit(1);
    }

    console.log(`✅ Проформа успешно связана со сделкой:`);
    console.log(`   ID: ${updated[0].id}`);
    console.log(`   Номер: ${updated[0].fullnumber}`);
    console.log(`   Deal ID: ${updated[0].pipedrive_deal_id}`);
    console.log(`   Плательщик: ${updated[0].buyer_name || 'N/A'}`);

    console.log(`\n✅ Синхронизация завершена успешно!`);

  } catch (error) {
    logger.error('Неожиданная ошибка:', error);
    console.error(`\n❌ Критическая ошибка: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Использование: node scripts/sync-proforma-from-wfirma.js <wfirmaId> <dealId> [fullnumber]');
  console.error('Пример: node scripts/sync-proforma-from-wfirma.js 432065033 2059 "CO-PROF 2/2026"');
  process.exit(1);
}

const wfirmaId = args[0];
const dealId = parseInt(args[1], 10);
const expectedFullnumber = args[2] || null;

if (isNaN(dealId)) {
  console.error('Deal ID должен быть числом');
  process.exit(1);
}

syncProformaFromWfirma(wfirmaId, dealId, expectedFullnumber);
