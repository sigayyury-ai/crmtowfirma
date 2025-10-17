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

async function testProformaWithContractor() {
  console.log('🔧 Testing Proforma Creation with Contractor in Invoice...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Create Proforma with new contractor
  console.log('\n📋 Test 1: Creating Proforma with new contractor...');
  try {
    const contractorData = {
      name: 'Test Customer for Proforma Invoice',
      email: 'test.proforma.invoice@example.com',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: ''
    };

    const mockDeal = {
      id: 999,
      title: 'Test Proforma Deal - Camp Service',
      value: 1500,
      currency: 'EUR'
    };

    const result = await invoiceProcessing.createProformaInWfirma(
      mockDeal,
      contractorData,
      1500
    );

    if (result.success) {
      console.log('✅ Proforma invoice created successfully!');
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Message: ${result.message}`);
      console.log(`   Response: ${result.response ? 'XML response received' : 'No response data'}`);
      
      if (result.response) {
        console.log('\n📄 XML Response:');
        console.log(result.response);
      }
    } else {
      console.error('❌ Failed to create Proforma invoice:', result.error);
      if (result.details) {
        console.error('   Details:', result.details);
      }
    }
  } catch (error) {
    console.error('❌ Error creating Proforma invoice:', error.message);
  }

  // Test 2: Test with PLN currency
  console.log('\n📋 Test 2: Testing with PLN currency...');
  try {
    const contractorData = {
      name: 'PLN Test Customer',
      email: 'pln.test.invoice@example.com',
      zip: '00-001',
      city: 'Warsaw',
      country: 'PL',
      business_id: ''
    };

    const mockDeal = {
      id: 998,
      title: 'Test PLN Proforma Deal',
      value: 2500,
      currency: 'PLN'
    };

    const result = await invoiceProcessing.createProformaInWfirma(
      mockDeal,
      contractorData,
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
  } catch (error) {
    console.error('❌ Error testing PLN currency:', error.message);
  }

  // Test 3: Test with company (business_id)
  console.log('\n📋 Test 3: Testing with company contractor...');
  try {
    const contractorData = {
      name: 'Test Company Ltd',
      email: 'company@example.com',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '1234567890'
    };

    const mockDeal = {
      id: 997,
      title: 'Test Company Proforma Deal',
      value: 5000,
      currency: 'EUR'
    };

    const result = await invoiceProcessing.createProformaInWfirma(
      mockDeal,
      contractorData,
      5000
    );

    if (result.success) {
      console.log('✅ Company Proforma invoice created successfully!');
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Company: ${contractorData.name}`);
      console.log(`   NIP: ${contractorData.business_id}`);
    } else {
      console.error('❌ Failed to create Company Proforma invoice:', result.error);
    }
  } catch (error) {
    console.error('❌ Error testing company contractor:', error.message);
  }

  console.log('\n🎉 Proforma creation with contractor tests completed!');
}

testProformaWithContractor();




