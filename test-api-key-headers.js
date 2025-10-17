const axios = require('axios');

async function testApiKeyHeaders() {
  console.log('🔧 Testing wFirma API with API Key in headers...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  
  // Тест 1: Получение списка контрагентов
  console.log('📋 Test 1: Getting contractors list...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'accessKey': accessKey,
        'secretKey': secretKey,
        'appKey': appKey
      }
    });
    
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: Создание контрагента
  console.log('📋 Test 2: Creating contractor...');
  try {
    const contractorData = {
      contractor: {
        name: 'Test User Headers',
        email: 'test-headers@example.com',
        address: 'Test Street 123',
        zip: '00-001',
        country: 'PL',
        type: 'person'
      }
    };
    
    const response = await axios.post('https://api2.wfirma.pl/contractors/find', contractorData, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'accessKey': accessKey,
        'secretKey': secretKey,
        'appKey': appKey
      }
    });
    
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: Другой endpoint
  console.log('📋 Test 3: Testing other endpoint...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors', {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'accessKey': accessKey,
        'secretKey': secretKey,
        'appKey': appKey
      }
    });
    
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testApiKeyHeaders();




