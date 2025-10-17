const axios = require('axios');

async function testCreateXML() {
  console.log('🔧 Testing contractor creation with XML format...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  const companyId = '519763'; // Правильный company_id
  
  const headers = {
    'Content-Type': 'application/xml',
    'Accept': 'application/xml',
    'accessKey': accessKey,
    'secretKey': secretKey,
    'appKey': appKey
  };
  
  // Тест 1: Создание с XML форматом
  console.log('📋 Test 1: Creating contractor with XML format...');
  
  const xmlData = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>Test XML Contractor</name>
            <email>test.xml@example.com</email>
            <address>Test Street 123</address>
            <zip>12345</zip>
            <city>Test City</city>
            <country>PL</country>
            <nip>1234567890</nip>
            <type>person</type>
        </contractor>
    </contractors>
</api>`;
  
  console.log('XML Data:', xmlData);
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml&company_id=${companyId}`,
      xmlData,
      { headers }
    );
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: Минимальная XML структура
  console.log('📋 Test 2: Creating contractor with minimal XML...');
  
  const minimalXmlData = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>Test Minimal XML</name>
            <email>test.minimal.xml@example.com</email>
            <zip>54321</zip>
        </contractor>
    </contractors>
</api>`;
  
  console.log('Minimal XML Data:', minimalXmlData);
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml&company_id=${companyId}`,
      minimalXmlData,
      { headers }
    );
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: Попробуем без company_id в URL
  console.log('📋 Test 3: Creating contractor without company_id in URL...');
  
  const xmlData3 = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>Test No Company ID</name>
            <email>test.nocompany@example.com</email>
            <zip>99999</zip>
        </contractor>
    </contractors>
</api>`;
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml`,
      xmlData3,
      { headers }
    );
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Проверим, создались ли контрагенты
  console.log('📋 Checking if contractors were created...');
  
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
    
    if (response.data && response.data.contractors) {
      const testContractors = response.data.contractors.filter(c => 
        c.email === 'test.xml@example.com' || 
        c.email === 'test.minimal.xml@example.com' || 
        c.email === 'test.nocompany@example.com'
      );
      console.log('✅ Found test contractors:', testContractors.length);
      if (testContractors.length > 0) {
        console.log('✅ Contractors created successfully!');
        testContractors.forEach(c => {
          console.log(`   - ${c.name} (${c.email}) - ID: ${c.id}`);
        });
      } else {
        console.log('❌ No test contractors found');
      }
    } else {
      console.log('❌ No contractors found or unexpected response format');
    }
  } catch (error) {
    console.log('❌ Error checking contractors:', error.response?.data || error.message);
  }
}

testCreateXML();




