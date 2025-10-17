require('dotenv').config();

const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const logger = require('./src/utils/logger');

// Хардкодим ключи для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';
process.env.PORT = 3000;
process.env.NODE_ENV = 'development';

async function testRealProformaCreation() {
  console.log('🔧 Testing Real Proforma Invoice Creation in wFirma...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Create a test contractor first
  console.log('\n📋 Test 1: Creating test contractor...');
  try {
    const contractorData = {
      name: 'Test Customer for Proforma',
      email: 'test.proforma@example.com',
      address: 'Test Address 123',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '',
      type: 'person'
    };

    const contractorResult = await invoiceProcessing.userManagement.findOrCreateContractor(contractorData);
    
    if (contractorResult.success) {
      console.log('✅ Test contractor created/found successfully');
      console.log(`   Contractor ID: ${contractorResult.contractor.id}`);
      console.log(`   Name: ${contractorResult.contractor.name}`);
      console.log(`   Email: ${contractorResult.contractor.email}`);
      console.log(`   Source: ${contractorResult.source}`);
    } else {
      console.error('❌ Failed to create/find test contractor:', contractorResult.error);
      return;
    }

    // Test 2: Create Proforma invoice
    console.log('\n📋 Test 2: Creating Proforma invoice...');
    try {
      const mockDeal = {
        id: 999,
        title: 'Test Proforma Deal - Camp Service',
        value: 1500,
        currency: 'EUR'
      };

      const result = await invoiceProcessing.createProformaInWfirma(
        mockDeal,
        contractorResult.contractor,
        1500 // amount
      );

      if (result.success) {
        console.log('✅ Proforma invoice created successfully in wFirma!');
        console.log(`   Invoice ID: ${result.invoiceId}`);
        console.log(`   Message: ${result.message}`);
        console.log(`   Response: ${result.response ? 'XML response received' : 'No response data'}`);
      } else {
        console.error('❌ Failed to create Proforma invoice:', result.error);
        if (result.details) {
          console.error('   Details:', result.details);
        }
      }
    } catch (error) {
      console.error('❌ Error creating Proforma invoice:', error.message);
    }

  } catch (error) {
    console.error('❌ Error in contractor creation:', error.message);
  }

  // Test 3: Test with PLN currency
  console.log('\n📋 Test 3: Testing with PLN currency...');
  try {
    const contractorData = {
      name: 'PLN Test Customer',
      email: 'pln.test@example.com',
      address: 'PLN Address 456',
      zip: '00-001',
      city: 'Warsaw',
      country: 'PL',
      business_id: '',
      type: 'person'
    };

    const contractorResult = await invoiceProcessing.userManagement.findOrCreateContractor(contractorData);
    
    if (contractorResult.success) {
      const mockDeal = {
        id: 998,
        title: 'Test PLN Proforma Deal',
        value: 2500,
        currency: 'PLN'
      };

      const result = await invoiceProcessing.createProformaInWfirma(
        mockDeal,
        contractorResult.contractor,
        2500
      );

      if (result.success) {
        console.log('✅ PLN Proforma invoice created successfully!');
        console.log(`   Invoice ID: ${result.invoiceId}`);
        console.log(`   Currency: PLN`);
        console.log(`   Amount: 2500 PLN`);
      } else {
        console.error('❌ Failed to create PLN Proforma invoice:', result.error);
      }
    }
  } catch (error) {
    console.error('❌ Error testing PLN currency:', error.message);
  }

  console.log('\n🎉 Real Proforma creation tests completed!');
}

testRealProformaCreation();




