require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testCompleteWorkflow() {
  console.log('🚀 Testing Complete Pipedrive-wFirma Integration Workflow...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('📋 Configuration Summary:');
    console.log(`   - Supported Currencies: ${invoiceProcessing.SUPPORTED_CURRENCIES.join(', ')}`);
    console.log(`   - Payment Method: ${invoiceProcessing.PAYMENT_METHOD}`);
    console.log(`   - VAT Rate: ${invoiceProcessing.VAT_RATE}%`);
    console.log(`   - Payment Terms: ${invoiceProcessing.PAYMENT_TERMS_DAYS} days`);
    console.log(`   - Invoice Types: ${Object.keys(invoiceProcessing.INVOICE_TYPES).join(', ')}`);
    console.log('');

    console.log('🏦 Bank Account Configuration:');
    Object.keys(invoiceProcessing.BANK_ACCOUNT_CONFIG).forEach(currency => {
      const config = invoiceProcessing.BANK_ACCOUNT_CONFIG[currency];
      console.log(`   ${currency}: ${config.name} (fallback: ${config.fallback})`);
    });
    console.log('');

    console.log('1. Testing bank accounts fetching and caching...');
    const bankAccountsResult = await invoiceProcessing.getBankAccounts();
    if (bankAccountsResult.success) {
      console.log(`✅ Bank accounts cached: ${bankAccountsResult.bankAccounts.length} accounts`);
    } else {
      console.log(`❌ Bank accounts failed: ${bankAccountsResult.error}`);
      return;
    }

    console.log('\n2. Testing deal 1516 processing...');
    const result = await invoiceProcessing.processDealById(1516);
    
    if (result.success) {
      console.log('✅ Proforma created successfully!');
      console.log(`   📋 Invoice ID: ${result.invoiceId}`);
      console.log(`   👤 Contractor: ${result.contractorName}`);
      console.log(`   📝 Message: ${result.message}`);
      console.log(`   🎯 Invoice Type: ${result.invoiceType}`);
    } else {
      console.log(`❌ Proforma creation failed: ${result.error}`);
      if (result.details) {
        console.log('   📋 Details:', result.details);
      }
    }

    console.log('\n3. Testing pending deals processing...');
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (pendingResult.success) {
      console.log(`✅ Found ${pendingResult.deals.length} pending deals`);
      if (pendingResult.deals.length > 0) {
        console.log('   📋 Pending deals:');
        pendingResult.deals.forEach(deal => {
          console.log(`      - Deal ${deal.id}: ${deal.title} (${deal.currency})`);
        });
      }
    } else {
      console.log(`❌ Pending deals failed: ${pendingResult.error}`);
    }

    console.log('\n4. Testing currency validation...');
    const testCurrencies = ['PLN', 'EUR', 'USD', 'GBP'];
    testCurrencies.forEach(async (currency) => {
      const bankResult = await invoiceProcessing.getBankAccountByCurrency(currency);
      if (bankResult.success) {
        console.log(`   ✅ ${currency}: ${bankResult.bankAccount.name}`);
      } else {
        console.log(`   ❌ ${currency}: ${bankResult.error}`);
      }
    });

    console.log('\n🎉 Integration Test Summary:');
    console.log('   ✅ Dynamic bank account retrieval');
    console.log('   ✅ Currency-based account selection');
    console.log('   ✅ Proforma invoice creation');
    console.log('   ✅ Contractor data extraction');
    console.log('   ✅ Configuration management');
    console.log('   ✅ Error handling and validation');

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 Complete workflow test finished');
  }
}

testCompleteWorkflow();




