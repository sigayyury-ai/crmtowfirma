require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testDynamicBankAccounts() {
  console.log('🏦 Testing Dynamic Bank Accounts Integration...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('1. Testing bank accounts fetching...');
    const bankAccountsResult = await invoiceProcessing.getBankAccounts();
    
    if (bankAccountsResult.success) {
      console.log('✅ Bank accounts fetched successfully');
      console.log(`📊 Found ${bankAccountsResult.bankAccounts.length} bank accounts:`);
      bankAccountsResult.bankAccounts.forEach((account, index) => {
        console.log(`   Account ${index + 1}:`);
        console.log(`   - ID: ${account.id}`);
        console.log(`   - Name: ${account.name}`);
        console.log(`   - Currency: ${account.currency}`);
        console.log(`   - Number: ${account.number}`);
        console.log(`   - Bank: ${account.bankName}`);
        console.log('');
      });
    } else {
      console.log(`❌ Failed to fetch bank accounts: ${bankAccountsResult.error}`);
      return;
    }

    console.log('2. Testing bank account selection by currency...');
    
    // Тестируем PLN
    console.log('\n   Testing PLN currency:');
    const plnResult = await invoiceProcessing.getBankAccountByCurrency('PLN');
    if (plnResult.success) {
      console.log(`   ✅ PLN Account: ${plnResult.bankAccount.name} (ID: ${plnResult.bankAccount.id})`);
      console.log(`   📋 Details: ${plnResult.bankAccount.number} - ${plnResult.bankAccount.bankName}`);
    } else {
      console.log(`   ❌ PLN Account error: ${plnResult.error}`);
    }

    // Тестируем EUR
    console.log('\n   Testing EUR currency:');
    const eurResult = await invoiceProcessing.getBankAccountByCurrency('EUR');
    if (eurResult.success) {
      console.log(`   ✅ EUR Account: ${eurResult.bankAccount.name} (ID: ${eurResult.bankAccount.id})`);
      console.log(`   📋 Details: ${eurResult.bankAccount.number} - ${eurResult.bankAccount.bankName}`);
    } else {
      console.log(`   ❌ EUR Account error: ${eurResult.error}`);
    }

    // Тестируем USD
    console.log('\n   Testing USD currency:');
    const usdResult = await invoiceProcessing.getBankAccountByCurrency('USD');
    if (usdResult.success) {
      console.log(`   ✅ USD Account: ${usdResult.bankAccount.name} (ID: ${usdResult.bankAccount.id})`);
      console.log(`   📋 Details: ${usdResult.bankAccount.number} - ${usdResult.bankAccount.bankName}`);
    } else {
      console.log(`   ❌ USD Account error: ${usdResult.error}`);
    }

    // Тестируем неизвестную валюту
    console.log('\n   Testing unknown currency (GBP):');
    const gbpResult = await invoiceProcessing.getBankAccountByCurrency('GBP');
    if (gbpResult.success) {
      console.log(`   ⚠️  GBP Account: ${gbpResult.bankAccount.name} (fallback)`);
    } else {
      console.log(`   ❌ GBP Account error: ${gbpResult.error}`);
    }

    console.log('\n3. Testing configuration...');
    console.log('📋 Bank Account Configuration:');
    Object.keys(invoiceProcessing.BANK_ACCOUNT_CONFIG).forEach(currency => {
      const config = invoiceProcessing.BANK_ACCOUNT_CONFIG[currency];
      console.log(`   ${currency}:`);
      console.log(`     - Name: ${config.name}`);
      console.log(`     - Fallback: ${config.fallback}`);
    });

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 Test completed');
  }
}

testDynamicBankAccounts();




