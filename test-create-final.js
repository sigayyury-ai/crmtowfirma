const axios = require('axios');

async function testCreateFinal() {
  console.log('🔧 Final test: Creating contractor with correct company_account.id...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  const companyAccountId = '519763'; // Правильный company_account.id из контрагентов
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'accessKey': accessKey,
    'secretKey': secretKey,
    'appKey': appKey
  };
  
  // Тест 1: Создание с company_account в структуре контрагента
  console.log('📋 Test 1: Creating contractor with company_account in structure...');
  
  const contractorData1 = {
    contractor: {
      name: 'Test Final Contractor',
      email: 'test.final@example.com',
      address: 'Test Street 999',
      zip: '99999',
      city: 'Test City',
      country: 'PL',
      nip: '9999999999',
      type: 'person',
      company_account: {
        id: companyAccountId
      }
    }
  };
  
  console.log('Data:', JSON.stringify(contractorData1, null, 2));
  
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/add', contractorData1, { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: Создание с company_id в корне
  console.log('📋 Test 2: Creating contractor with company_id in root...');
  
  const contractorData2 = {
    contractor: {
      name: 'Test Final Contractor 2',
      email: 'test.final2@example.com',
      address: 'Test Street 888',
      zip: '88888',
      city: 'Test City 2',
      country: 'PL',
      nip: '8888888888',
      type: 'person'
    },
    company_id: companyAccountId
  };
  
  console.log('Data:', JSON.stringify(contractorData2, null, 2));
  
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/add', contractorData2, { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: Минимальная структура как у существующих
  console.log('📋 Test 3: Creating contractor with minimal structure...');
  
  const contractorData3 = {
    contractor: {
      name: 'Test Minimal',
      email: 'test.minimal@example.com',
      address: 'Test Street 777',
      zip: '77777',
      city: 'Test City 3',
      country: 'PL',
      nip: '7777777777',
      type: 'person',
      tax_id_type: 'none',
      altname: 'Test Minimal',
      buyer: 1,
      seller: 1,
      payment_days: 7,
      remind: 1,
      visibility: 1,
      company_account: {
        id: companyAccountId
      }
    }
  };
  
  console.log('Data:', JSON.stringify(contractorData3, null, 2));
  
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/add', contractorData3, { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', response.data);
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Проверим, создались ли контрагенты
  console.log('📋 Checking if contractors were created...');
  
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', { headers });
    if (response.data && response.data.contractors) {
      const testContractors = response.data.contractors.filter(c => 
        c.email === 'test.final@example.com' || 
        c.email === 'test.final2@example.com' || 
        c.email === 'test.minimal@example.com'
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

testCreateFinal();




