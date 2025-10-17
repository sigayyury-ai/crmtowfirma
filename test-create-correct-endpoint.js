const axios = require('axios');

async function testCreateCorrectEndpoint() {
  console.log('🔧 Testing contractor creation with correct endpoint...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  
  // Тест 1: Создание контрагента через /contractors (без /find)
  console.log('📋 Test 1: Creating contractor via /contractors endpoint...');
  try {
    const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractor>
        <name>Test User Correct Endpoint</name>
        <email>test-correct@example.com</email>
        <street>Test Street 123</street>
        <zip>00-001</zip>
        <city>Warsaw</city>
        <country>PL</country>
        <nip></nip>
        <buyer>1</buyer>
        <seller>1</seller>
    </contractor>
</api>`;
    
    const response = await axios.post('https://api2.wfirma.pl/contractors?inputFormat=xml&outputFormat=xml', xmlData, {
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
  
  // Тест 2: Создание с JSON форматом
  console.log('📋 Test 2: Creating contractor with JSON format...');
  try {
    const jsonData = {
      contractor: {
        name: 'Test User JSON Correct',
        email: 'test-json-correct@example.com',
        street: 'Test Street 456',
        zip: '00-002',
        city: 'Warsaw',
        country: 'PL',
        nip: '',
        buyer: 1,
        seller: 1
      }
    };
    
    const response = await axios.post('https://api2.wfirma.pl/contractors?inputFormat=json&outputFormat=json', jsonData, {
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
  
  // Тест 3: Поиск созданного контрагента
  console.log('📋 Test 3: Searching for created contractor...');
  try {
    const searchXml = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <parameters>
            <conditions>
                <condition>
                    <field>email</field>
                    <operator>eq</operator>
                    <value>test-correct@example.com</value>
                </condition>
            </conditions>
        </parameters>
    </contractors>
</api>`;
    
    const response = await axios.post('https://api2.wfirma.pl/contractors/find?inputFormat=xml&outputFormat=xml', searchXml, {
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
}

testCreateCorrectEndpoint();




