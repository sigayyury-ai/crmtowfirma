const axios = require('axios');

async function findCompanyId() {
  console.log('🔍 Finding correct company_id...\n');
  
  const appKey = '8e76feba50499c61fddd0905b4f310ea';
  const accessKey = '61d2eee61d9104b2c9e5e1766af27633';
  const secretKey = 'd096f54b74c3f4adeb2fd4ab362cd085';
  
  // Тест 1: Попробуем получить информацию о компании
  console.log('📋 Test 1: Getting company information...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/company', {
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
  
  // Тест 2: Попробуем получить список компаний
  console.log('📋 Test 2: Getting companies list...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/companies', {
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
  
  // Тест 3: Попробуем без company_id
  console.log('📋 Test 3: Testing without company_id...');
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
  
  // Тест 4: Попробуем разные company_id
  const possibleCompanyIds = ['519763', '1', '0', '1123'];
  
  for (const companyId of possibleCompanyIds) {
    console.log(`📋 Test 4.${possibleCompanyIds.indexOf(companyId) + 1}: Testing company_id = ${companyId}...`);
    try {
      const response = await axios.get(`https://api2.wfirma.pl/contractors/find?company_id=${companyId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'accessKey': accessKey,
          'secretKey': secretKey,
          'appKey': appKey
        }
      });
      
      console.log(`✅ Success with company_id = ${companyId}! Response:`);
      console.log(JSON.stringify(response.data, null, 2));
      break; // Если успешно, прекращаем тестирование
    } catch (error) {
      console.error(`❌ Error with company_id = ${companyId}:`, error.response?.data || error.message);
    }
    console.log('');
  }
}

findCompanyId();




