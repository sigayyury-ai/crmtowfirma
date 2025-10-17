require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');
const logger = require('./src/utils/logger');

async function testUpdatedService() {
  console.log('🔧 Testing updated wFirma service...\n');

  try {
    const wfirmaClient = new WfirmaClient();

    // Test 1: Creating contractor
    console.log('📋 Test 1: Creating contractor with updated service...');
    const newContractorData = {
      name: 'Test Updated Service',
      email: 'test.updated.service@example.com',
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
        c.email === 'test.updated.service@example.com'
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

testUpdatedService();




