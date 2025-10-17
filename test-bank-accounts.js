#!/usr/bin/env node

/**
 * Тестовый скрипт для получения банковских счетов из wFirma API
 */

require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');

// Устанавливаем переменные окружения для wFirma
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testBankAccounts() {
  console.log('🏦 Testing wFirma Bank Accounts API...\n');
  
  try {
    const wfirmaClient = new WfirmaClient();
    
    // Тестируем подключение
    console.log('1. Testing connection...');
    const connectionTest = await wfirmaClient.testConnection();
    if (connectionTest.success) {
      console.log('✅ Connection successful');
    } else {
      console.log('❌ Connection failed:', connectionTest.error);
      return;
    }
    
    // Получаем банковские счета
    console.log('\n2. Fetching bank accounts...');
    const bankAccountsResult = await wfirmaClient.getBankAccounts();
    
    if (bankAccountsResult.success) {
      console.log('✅ Bank accounts fetched successfully');
      console.log(`📊 Found ${bankAccountsResult.bankAccounts.length} bank accounts:`);
      
      bankAccountsResult.bankAccounts.forEach((account, index) => {
        console.log(`\n   Account ${index + 1}:`);
        console.log(`   - ID: ${account.id}`);
        console.log(`   - Name: ${account.name}`);
        console.log(`   - Currency: ${account.currency}`);
        console.log(`   - Number: ${account.number}`);
      });
      
      // Ищем счета для PLN и EUR
      const plnAccount = bankAccountsResult.bankAccounts.find(acc => acc.currency === 'PLN');
      const eurAccount = bankAccountsResult.bankAccounts.find(acc => acc.currency === 'EUR');
      
      console.log('\n3. Currency-specific accounts:');
      if (plnAccount) {
        console.log(`✅ PLN Account: ${plnAccount.name} (ID: ${plnAccount.id})`);
      } else {
        console.log('❌ No PLN account found');
      }
      
      if (eurAccount) {
        console.log(`✅ EUR Account: ${eurAccount.name} (ID: ${eurAccount.id})`);
      } else {
        console.log('❌ No EUR account found');
      }
      
    } else {
      console.log('❌ Failed to fetch bank accounts:', bankAccountsResult.error);
      if (bankAccountsResult.details) {
        console.log('Details:', bankAccountsResult.details);
      }
    }
    
  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Запускаем тест
testBankAccounts().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test crashed:', error);
  process.exit(1);
});
