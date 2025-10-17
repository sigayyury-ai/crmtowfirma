const axios = require('axios');

async function debugPermissions() {
  console.log('🔍 Debugging wFirma API permissions...\n');
  
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
  
  // Тест 1: contractors (мы знаем, что это работает)
  console.log('📋 Test 1: contractors/find (known working)...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2).substring(0, 200) + '...');
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 2: company_accounts
  console.log('📋 Test 2: company_accounts/find...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/company_accounts/find', { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 3: users
  console.log('📋 Test 3: users/find...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/users/find', { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 4: invoices
  console.log('📋 Test 4: invoices/find...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/invoices/find', { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Тест 5: documents
  console.log('📋 Test 5: documents/find...');
  try {
    const response = await axios.get('https://api2.wfirma.pl/documents/find', { headers });
    console.log('✅ Status:', response.status);
    console.log('✅ Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.log('❌ Error:', error.response?.data || error.message);
  }
}

debugPermissions();




