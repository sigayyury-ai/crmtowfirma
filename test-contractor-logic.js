require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testContractorLogic() {
  console.log('👤 Testing New Contractor Logic (Search -> Create -> Use ID)...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('📋 New Logic Flow:');
    console.log('   1. Search contractor by email');
    console.log('   2. If not found, create new contractor');
    console.log('   3. Use contractor ID in invoice XML');
    console.log('');

    console.log('1. Testing deal 1516 processing with new contractor logic...');
    const result = await invoiceProcessing.processDealById(1516);
    
    if (result.success) {
      console.log('✅ Proforma created successfully with new contractor logic!');
      console.log(`   📋 Invoice ID: ${result.invoiceId}`);
      console.log(`   👤 Contractor: ${result.contractorName}`);
      console.log(`   📝 Message: ${result.message}`);
      console.log(`   🎯 Invoice Type: ${result.invoiceType}`);
      console.log('');
      console.log('🔄 Logic Flow Applied:');
      console.log('   ✅ Step 1: Searched contractor by email');
      console.log('   ✅ Step 2: Found/created contractor');
      console.log('   ✅ Step 3: Used contractor ID in invoice');
      console.log('   ✅ Step 4: Created Proforma with existing contractor');
    } else {
      console.log(`❌ Proforma creation failed: ${result.error}`);
      if (result.details) {
        console.log('   📋 Details:', result.details);
      }
    }

    console.log('\n2. Testing contractor search functionality...');
    
    // Тестируем поиск существующего контрагента
    const testEmail = 'sigayyury@gmail.com';
    console.log(`   Searching for contractor with email: ${testEmail}`);
    
    const searchResult = await invoiceProcessing.wfirmaClient.findContractorByEmail(testEmail);
    if (searchResult.success && searchResult.found) {
      console.log(`   ✅ Found existing contractor: ${searchResult.contractor.name} (ID: ${searchResult.contractor.id})`);
    } else {
      console.log(`   ℹ️  Contractor not found, would create new one`);
    }

    console.log('\n3. Testing contractor creation functionality...');
    
    // Тестируем создание нового контрагента
    const newContractorData = {
      name: 'Test Contractor',
      email: 'test.contractor@example.com',
      address: 'Test Street 123',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '',
      type: 'person'
    };
    
    console.log(`   Creating new contractor: ${newContractorData.name}`);
    const createResult = await invoiceProcessing.wfirmaClient.createContractor(newContractorData);
    if (createResult.success) {
      console.log(`   ✅ New contractor created: ID ${createResult.contractorId}`);
    } else {
      console.log(`   ❌ Failed to create contractor: ${createResult.error}`);
    }

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 Contractor logic test completed');
  }
}

testContractorLogic();




