const axios = require('axios');

async function testContractorsAdd() {
  console.log('🔧 Testing /contractors/add endpoint with different data formats...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  
  // Тест 1: JSON формат с минимальными данными
  console.log('📋 Test 1: JSON with minimal data...');
  try {
    const minimalData = {
      contractor: {
        name: 'Test Minimal',
        email: 'test-minimal@example.com'
      }
    };
    
    const response = await axios.post('https://api2.wfirma.pl/contractors/add?inputFormat=json&outputFormat=json', minimalData, {
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
  
  // Тест 2: XML формат
  console.log('📋 Test 2: XML format...');
  try {
    const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractor>
        <name>Test XML Add</name>
        <email>test-xml-add@example.com</email>
        <street>Test Street 123</street>
        <zip>00-001</zip>
        <city>Warsaw</city>
        <country>PL</country>
        <buyer>1</buyer>
        <seller>1</seller>
    </contractor>
</api>`;
    
    const response = await axios.post('https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml', xmlData, {
      headers: {
        'Content-Type': 'application/xml',
        'Accept': 'application/xml',
        'accessKey': accessKey,
        'secretKey': secretKey,
        'appKey': appKey
      }
    });
    
    console.log('✅ Success! Response:');
    console.log(response.data);
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: JSON с полными данными
  console.log('📋 Test 3: JSON with full data...');
  try {
    const fullData = {
      contractor: {
        name: 'Test Full Data',
        email: 'test-full@example.com',
        street: 'Test Street 456',
        zip: '00-002',
        city: 'Warsaw',
        country: 'PL',
        nip: '',
        regon: '',
        phone: '',
        buyer: 1,
        seller: 1,
        payment_days: 7,
        discount_percent: 0
      }
    };
    
    const response = await axios.post('https://api2.wfirma.pl/contractors/add?inputFormat=json&outputFormat=json', fullData, {
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
  
  // Тест 4: Проверяем, создался ли контрагент
  console.log('📋 Test 4: Checking if contractor was created...');
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
    
    // Ищем наших тестовых контрагентов
    const contractors = response.data.contractors;
    const testContractors = contractors.filter(c => 
      c.contractor.email && (
        c.contractor.email.includes('test-minimal') ||
        c.contractor.email.includes('test-xml-add') ||
        c.contractor.email.includes('test-full')
      )
    );
    
    console.log('✅ Found test contractors:');
    console.log(JSON.stringify(testContractors, null, 2));
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testContractorsAdd();




