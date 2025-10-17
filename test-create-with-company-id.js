const axios = require('axios');

async function testCreateWithCompanyId() {
  console.log('🔧 Testing contractor creation with company_id...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  const companyId = '519766'; // Найденный company_id из счетов
  
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'accessKey': accessKey,
    'secretKey': secretKey,
    'appKey': appKey
  };
  
  const contractorData = {
    contractor: {
      name: 'Test Contractor with Company ID',
      email: 'test.company.id@example.com',
      address: 'Test Street 123',
      zip: '12345',
      city: 'Test City',
      country: 'PL',
      nip: '1234567890',
      type: 'person'
    },
    company_id: companyId
  };
  
  console.log('📋 Test 1: Creating contractor with company_id...');
  console.log('Data:', JSON.stringify(contractorData, null, 2));
  
  try {
    const response = await axios.post('https://api2.wfirma.pl/contractors/add', contractorData, { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: Попробуем без company_id в теле, но с параметром
  console.log('📋 Test 2: Creating contractor with company_id as parameter...');
  
  const contractorData2 = {
    contractor: {
      name: 'Test Contractor Param',
      email: 'test.param@example.com',
      address: 'Test Street 456',
      zip: '54321',
      city: 'Test City 2',
      country: 'PL',
      nip: '0987654321',
      type: 'person'
    }
  };
  
  try {
    const response = await axios.post(`https://api2.wfirma.pl/contractors/add?company_id=${companyId}`, contractorData2, { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: Проверим, создались ли контрагенты
  console.log('📋 Test 3: Checking if contractors were created...');
  
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', { headers });
    if (response.data && response.data.contractors) {
      const testContractors = response.data.contractors.filter(c => 
        c.email === 'test.company.id@example.com' || c.email === 'test.param@example.com'
      );
      console.log('✅ Found test contractors:', testContractors.length);
      if (testContractors.length > 0) {
        console.log('✅ Contractors created successfully!');
        testContractors.forEach(c => {
          console.log(`   - ${c.name} (${c.email}) - ID: ${c.id}`);
        });
      }
    } else {
      console.log('❌ No contractors found or unexpected response format');
    }
  } catch (error) {
    console.log('❌ Error checking contractors:', error.response?.data || error.message);
  }
}

testCreateWithCompanyId();




