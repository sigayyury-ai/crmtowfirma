#!/usr/bin/env node

/**
 * Получить полные данные сделки #1623 и найти проформу
 */

require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const InvoiceProcessingService = require('../src/services/invoiceProcessing');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = 1623;

async function getDealAndProforma() {
  console.log('🔍 Получение полных данных сделки #1623 и поиск проформы\n');
  console.log('='.repeat(60));
  
  try {
    // Инициализация сервисов
    console.log('\n📦 Инициализация сервисов...');
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // 1. Получаем полные данные сделки
    console.log(`\n📥 Получение полных данных сделки #${DEAL_ID}...`);
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    
    if (!dealResult.success) {
      console.error(`❌ Ошибка получения данных сделки: ${dealResult.error}`);
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const organization = dealResult.organization;
    
    console.log(`\n✅ Данные сделки получены:`);
    console.log(`   ID: ${deal.id}`);
    console.log(`   Title: ${deal.title}`);
    console.log(`   Value: ${deal.value} ${deal.currency}`);
    console.log(`   Status: ${deal.status}`);
    console.log(`   Stage ID: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'N/A'}`);
    console.log(`   Created: ${deal.add_time || 'N/A'}`);
    console.log(`   Updated: ${deal.update_time || 'N/A'}`);
    
    // Поля invoice_type
    const INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const invoiceType = deal[INVOICE_TYPE_FIELD_KEY];
    console.log(`   Invoice Type: ${invoiceType || 'N/A'}`);
    
    // Поля invoice number
    const INVOICE_NUMBER_FIELD_KEY = '0598d1168fe79005061aa3710ec45c3e03dbe8a3';
    const invoiceNumber = deal[INVOICE_NUMBER_FIELD_KEY];
    console.log(`   Invoice Number: ${invoiceNumber || 'N/A'}`);
    
    // Поля WFIRMA invoice ID
    const WFIRMA_INVOICE_ID_FIELD_KEY = process.env.PIPEDRIVE_WFIRMA_INVOICE_ID_FIELD_KEY;
    if (WFIRMA_INVOICE_ID_FIELD_KEY) {
      const wfirmaInvoiceId = deal[WFIRMA_INVOICE_ID_FIELD_KEY];
      console.log(`   wFirma Invoice ID: ${wfirmaInvoiceId || 'N/A'}`);
    }
    
    // Персона
    if (person) {
      console.log(`\n👤 Персона:`);
      console.log(`   ID: ${person.id}`);
      console.log(`   Name: ${person.name || 'N/A'}`);
      console.log(`   Email: ${person.email?.[0]?.value || 'N/A'}`);
      console.log(`   Phone: ${person.phone?.[0]?.value || 'N/A'}`);
    }
    
    // Организация
    if (organization) {
      console.log(`\n🏢 Организация:`);
      console.log(`   ID: ${organization.id}`);
      console.log(`   Name: ${organization.name || 'N/A'}`);
    }
    
    // Продукты
    console.log(`\n📦 Продукты сделки:`);
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    if (productsResult.success && productsResult.products) {
      const products = productsResult.products;
      console.log(`   Количество: ${products.length}`);
      products.forEach((product, index) => {
        console.log(`\n   Продукт ${index + 1}:`);
        console.log(`     ID: ${product.product?.id || product.product_id || product.id || 'N/A'}`);
        console.log(`     Name: ${product.name || product.product?.name || 'N/A'}`);
        console.log(`     Quantity: ${product.quantity || 1}`);
        console.log(`     Item Price: ${product.item_price || 'N/A'}`);
        console.log(`     Sum: ${product.sum || 'N/A'}`);
        console.log(`     Unit: ${product.unit || product.product?.unit || 'N/A'}`);
      });
    } else {
      console.log(`   Продукты не найдены`);
    }
    
    // 2. Находим проформу
    console.log(`\n🔍 Поиск проформы для сделки #${DEAL_ID}...`);
    const existingProforma = await invoiceProcessing.findExistingProformaForDeal(deal);
    
    if (!existingProforma?.found) {
      console.log(`\n⚠️  Проформа не найдена для этой сделки`);
      console.log(`   Это означает, что при следующем webhook будет создана новая проформа`);
      process.exit(0);
    }
    
    console.log(`\n✅ Проформа найдена:`);
    console.log(`   Invoice ID: ${existingProforma.invoiceId}`);
    console.log(`   Invoice Number: ${existingProforma.invoiceNumber || 'N/A'}`);
    console.log(`   Source: ${existingProforma.source || 'N/A'}`);
    
    // 3. Получаем данные проформы из базы данных
    if (supabase && existingProforma.invoiceId) {
      console.log(`\n💾 Получение данных проформы из базы данных...`);
      
      const { data: proformaData, error: proformaError } = await supabase
        .from('proformas')
        .select('*')
        .eq('id', existingProforma.invoiceId)
        .single();
      
      if (!proformaError && proformaData) {
        console.log(`\n✅ Данные проформы из базы:`);
        console.log(`   ID: ${proformaData.id}`);
        console.log(`   Fullnumber: ${proformaData.fullnumber || 'N/A'}`);
        console.log(`   Issued At: ${proformaData.issued_at || 'N/A'}`);
        console.log(`   Currency: ${proformaData.currency || 'N/A'}`);
        console.log(`   Total: ${proformaData.total || 'N/A'}`);
        console.log(`   Payments Total: ${proformaData.payments_total || 0}`);
        console.log(`   Buyer Name: ${proformaData.buyer_name || 'N/A'}`);
        console.log(`   Buyer Email: ${proformaData.buyer_email || 'N/A'}`);
        console.log(`   Status: ${proformaData.status || 'N/A'}`);
        console.log(`   Pipedrive Deal ID: ${proformaData.pipedrive_deal_id || 'N/A'}`);
      } else {
        console.log(`⚠️  Проформа не найдена в базе данных: ${proformaError?.message || 'Unknown error'}`);
      }
      
      // 4. Получаем продукты проформы из базы данных
      console.log(`\n📦 Получение продуктов проформы из базы данных...`);
      
      const { data: proformaProductsData, error: proformaProductsError } = await supabase
        .from('proforma_products')
        .select(`
          name,
          quantity,
          unit_price,
          products (
            id,
            name,
            normalized_name
          )
        `)
        .eq('proforma_id', existingProforma.invoiceId);
      
      if (!proformaProductsError && proformaProductsData) {
        console.log(`\n✅ Продукты проформы из базы (${proformaProductsData.length}):`);
        proformaProductsData.forEach((pp, index) => {
          console.log(`\n   Продукт ${index + 1}:`);
          console.log(`     Name: ${pp.name || 'N/A'}`);
          console.log(`     Quantity: ${pp.quantity || 'N/A'}`);
          console.log(`     Unit Price: ${pp.unit_price || 'N/A'}`);
          if (pp.products) {
            console.log(`     Product ID: ${pp.products.id}`);
            console.log(`     Product Name: ${pp.products.name}`);
            console.log(`     Normalized Name: "${pp.products.normalized_name}"`);
          }
        });
      } else {
        console.log(`⚠️  Продукты проформы не найдены в базе: ${proformaProductsError?.message || 'Unknown error'}`);
      }
    }
    
    console.log(`\n✅ Проверка завершена успешно!`);
    
  } catch (error) {
    console.error(`\n❌ Ошибка при выполнении проверки:`);
    console.error(`   ${error.message}`);
    console.error(`   ${error.stack}`);
    process.exit(1);
  }
}

// Запуск
getDealAndProforma();

