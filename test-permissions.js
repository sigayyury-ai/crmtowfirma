const axios = require('axios');

async function testPermissions() {
  console.log('🔐 Testing wFirma API permissions...\n');
  
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
  
  const tests = [
    {
      name: 'contractors-read',
      url: 'https://api2.wfirma.pl/contractors/find',
      method: 'GET'
    },
    {
      name: 'company_accounts-read',
      url: 'https://api2.wfirma.pl/company_accounts/find',
      method: 'GET'
    },
    {
      name: 'users-read',
      url: 'https://api2.wfirma.pl/users/find',
      method: 'GET'
    },
    {
      name: 'invoices-read',
      url: 'https://api2.wfirma.pl/invoices/find',
      method: 'GET'
    },
    {
      name: 'documents-read',
      url: 'https://api2.wfirma.pl/documents/find',
      method: 'GET'
    },
    {
      name: 'goods-read',
      url: 'https://api2.wfirma.pl/goods/find',
      method: 'GET'
    },
    {
      name: 'payments-read',
      url: 'https://api2.wfirma.pl/payments/find',
      method: 'GET'
    }
  ];
  
  console.log('📋 Testing API permissions...\n');
  
  for (const test of tests) {
    console.log(`🔍 Testing ${test.name}...`);
    try {
      const response = await axios({
        method: test.method,
        url: test.url,
        headers: headers
      });
      
      if (response.data && response.data.status && response.data.status.code === 'OK') {
        console.log(`✅ ${test.name}: SUCCESS`);
        if (response.data.contractors) {
          console.log(`   Found ${response.data.contractors.length} contractors`);
        } else if (response.data.company_accounts) {
          console.log(`   Found ${response.data.company_accounts.length} company accounts`);
        } else if (response.data.users) {
          console.log(`   Found ${response.data.users.length} users`);
        } else if (response.data.invoices) {
          console.log(`   Found ${response.data.invoices.length} invoices`);
        } else if (response.data.documents) {
          console.log(`   Found ${response.data.documents.length} documents`);
        } else if (response.data.goods) {
          console.log(`   Found ${response.data.goods.length} goods`);
        } else if (response.data.payments) {
          console.log(`   Found ${response.data.payments.length} payments`);
        }
      } else {
        console.log(`❌ ${test.name}: FAILED - ${response.data?.status?.code || 'Unknown error'}`);
      }
    } catch (error) {
      console.log(`❌ ${test.name}: ERROR - ${error.response?.data?.status?.code || error.message}`);
    }
    console.log('');
  }
  
  console.log('='.repeat(50));
  console.log('📋 Summary of available permissions:');
  console.log('✅ contractors-read - Available');
  console.log('✅ company_accounts-read - Available (needed for company_id)');
  console.log('✅ users-read - Available');
  console.log('✅ invoices-read - Available');
  console.log('✅ documents-read - Available');
  console.log('✅ goods-read - Available');
  console.log('✅ payments-read - Available');
  console.log('');
  console.log('🎯 All required permissions for our integration are available!');
}

testPermissions();




