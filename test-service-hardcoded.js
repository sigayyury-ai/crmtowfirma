// Устанавливаем переменные окружения
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

const WfirmaClient = require('./src/services/wfirma');
const logger = require('./src/utils/logger');

async function testServiceHardcoded() {
  console.log('🔧 Testing wFirma service with hardcoded keys...\n');

  try {
    const wfirmaClient = new WfirmaClient();

    // Test 1: Creating contractor
    console.log('📋 Test 1: Creating contractor with updated service...');
    const newContractorData = {
      name: 'Test Service Hardcoded',
      email: 'test.service.hardcoded@example.com',
      address: 'Test Street 123',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '1234567890',
      type: 'person'
    };

    const createResult = await wfirmaClient.createContractor(newContractorData);
    if (createResult.success) {
      console.log('✅ Success! Contractor created with ID:', createResult.contractorId);
      console.log('✅ Response:', createResult.response);
    } else {
      console.log('❌ Failed to create contractor:', createResult.error, createResult.details);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Getting contractors list
    console.log('📋 Test 2: Getting contractors list...');
    const contractorsResult = await wfirmaClient.getContractors();
    if (contractorsResult.success) {
      console.log('✅ Success! Found', contractorsResult.contractors.length, 'contractors');
      
      // Find our test contractor
      const testContractor = contractorsResult.contractors.find(c => 
        c.email === 'test.service.hardcoded@example.com'
      );
      if (testContractor) {
        console.log('✅ Test contractor found:', testContractor.name, '(ID:', testContractor.id + ')');
      } else {
        console.log('❌ Test contractor not found in list');
      }
    } else {
      console.log('❌ Failed to get contractors:', contractorsResult.error);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Testing connection
    console.log('📋 Test 3: Testing connection...');
    const connectionResult = await wfirmaClient.testConnection();
    if (connectionResult.success) {
      console.log('✅ Connection successful:', connectionResult.message);
    } else {
      console.log('❌ Connection failed:', connectionResult.error);
    }

  } catch (error) {
    console.log('❌ Error during service test:', error.message);
  }
}

testServiceHardcoded();




