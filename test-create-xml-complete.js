const axios = require('axios');

async function testCreateXMLComplete() {
  console.log('🔧 Testing contractor creation with complete XML format...\n');
  
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
  
  // Тест 1: Создание с company_id в XML теле
  console.log('📋 Test 1: Creating contractor with company_id in XML body...');
  
  const xmlData1 = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>Test Complete XML</name>
            <email>test.complete.xml@example.com</email>
            <address>Test Street 123</address>
            <zip>12345</zip>
            <city>Test City</city>
            <country>PL</country>
            <nip>1234567890</nip>
            <type>person</type>
            <company_id>${companyId}</company_id>
        </contractor>
    </contractors>
</api>`;
  
  console.log('XML Data:', xmlData1);
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml`,
      xmlData1,
      { headers }
    );
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: Создание с company_id в корне XML
  console.log('📋 Test 2: Creating contractor with company_id in root...');
  
  const xmlData2 = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <company_id>${companyId}</company_id>
    <contractors>
        <contractor>
            <name>Test Root Company ID</name>
            <email>test.root.company@example.com</email>
            <address>Test Street 456</address>
            <zip>54321</zip>
            <city>Test City 2</city>
            <country>PL</country>
            <nip>0987654321</nip>
            <type>person</type>
        </contractor>
    </contractors>
</api>`;
  
  console.log('XML Data:', xmlData2);
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml`,
      xmlData2,
      { headers }
    );
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: Создание с company_id в URL и полными данными
  console.log('📋 Test 3: Creating contractor with company_id in URL...');
  
  const xmlData3 = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>Test URL Company ID</name>
            <email>test.url.company@example.com</email>
            <address>Test Street 789</address>
            <zip>98765</zip>
            <city>Test City 3</city>
            <country>PL</country>
            <nip>1122334455</nip>
            <type>person</type>
        </contractor>
    </contractors>
</api>`;
  
  try {
    const response = await axios.post(
      `https://api2.wfirma.pl/contractors/add?inputFormat=xml&outputFormat=xml&company_id=${companyId}`,
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
        c.email === 'test.complete.xml@example.com' || 
        c.email === 'test.root.company@example.com' || 
        c.email === 'test.url.company@example.com'
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

testCreateXMLComplete();




