require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');

async function testAppKey() {
  console.log('🔧 Testing wFirma API with appKey...\n');
  
  try {
    const wfirmaClient = new WfirmaClient();
    
    // Проверяем конфигурацию
    console.log('📋 Configuration check:');
    const configCheck = await wfirmaClient.checkConnection();
    console.log(JSON.stringify(configCheck, null, 2));
    console.log('');
    
    // Тестируем подключение
    console.log('🔗 Testing API connection:');
    const connectionTest = await wfirmaClient.testConnection();
    console.log(JSON.stringify(connectionTest, null, 2));
    console.log('');
    
    // Тестируем получение контрагентов
    console.log('👥 Testing contractors list:');
    const contractors = await wfirmaClient.getContractors();
    console.log(JSON.stringify(contractors, null, 2));
    console.log('');
    
    // Тестируем создание контрагента
    console.log('➕ Testing contractor creation:');
    const testContractor = {
      name: 'Test User AppKey',
      email: 'test-appkey@example.com',
      address: 'Test Street 123',
      zip: '00-001',
      country: 'PL',
      type: 'person'
    };
    
    const createResult = await wfirmaClient.createContractor(testContractor);
    console.log(JSON.stringify(createResult, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

testAppKey();




