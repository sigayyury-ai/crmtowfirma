const axios = require('axios');

async function analyzeContractorStructure() {
  console.log('🔍 Analyzing contractor structure from existing data...\n');
  
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
  
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', { headers });
    
    if (response.data && response.data.contractors && response.data.contractors.length > 0) {
      const contractor = response.data.contractors[0];
      console.log('📋 First contractor structure:');
      console.log(JSON.stringify(contractor, null, 2));
      
      console.log('\n' + '='.repeat(50) + '\n');
      
      // Попробуем создать контрагента с точно такой же структурой
      console.log('📋 Test: Creating contractor with exact structure...');
      
      const newContractorData = {
        contractor: {
          name: 'Test Exact Structure',
          email: 'test.exact@example.com',
          address: contractor.address || 'Test Address',
          zip: contractor.zip || '12345',
          city: contractor.city || 'Test City',
          country: contractor.country || 'PL',
          nip: contractor.nip || '',
          type: contractor.type || 'person',
          phone: contractor.phone || '',
          altname: contractor.altname || 'Test Exact Structure'
        }
      };
      
      console.log('Data:', JSON.stringify(newContractorData, null, 2));
      
      try {
        const createResponse = await axios.post('https://api2.wfirma.pl/contractors/add', newContractorData, { headers });
        console.log('✅ Status:', createResponse.status);
        console.log('✅ Response:', createResponse.data);
      } catch (error) {
        console.log('❌ Error:', error.response?.data || error.message);
      }
      
    } else {
      console.log('❌ No contractors found in response');
      console.log('Response:', response.data);
    }
    
  } catch (error) {
    console.log('❌ Error getting contractors:', error.response?.data || error.message);
  }
}

analyzeContractorStructure();




