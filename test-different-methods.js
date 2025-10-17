const axios = require('axios');

async function testDifferentMethods() {
  console.log('🔧 Testing different HTTP methods and endpoints...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'accessKey': accessKey,
    'secretKey': secretKey,
    'appKey': appKey
  };
  
  const contractorData = {
    contractor: {
      name: 'Test User Methods',
      email: 'test-methods@example.com',
      street: 'Test Street 123',
      zip: '00-001',
      city: 'Warsaw',
      country: 'PL',
      nip: '',
      buyer: 1,
      seller: 1
    }
  };
  
  // Тест 1: PUT метод
  console.log('📋 Test 1: PUT method to /contractors...');
  try {
    const response = await axios.put('https://api2.wfirma.pl/contractors?inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: POST к /contractors/add
  console.log('📋 Test 2: POST to /contractors/add...');
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/add?inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: POST к /contractors/new
  console.log('📋 Test 3: POST to /contractors/new...');
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/new?inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 4: POST к /contractors/create
  console.log('📋 Test 4: POST to /contractors/create...');
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/create?inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 5: POST к /contractors с action=add
  console.log('📋 Test 5: POST to /contractors with action=add...');
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors?action=add&inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 6: POST к /contractors с action=create
  console.log('📋 Test 6: POST to /contractors with action=create...');
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors?action=create&inputFormat=json&outputFormat=json', contractorData, { headers });
    console.log('✅ Success! Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testDifferentMethods();




