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

async function testProformaWithExistingContractor() {
  console.log('🔧 Testing Proforma Creation with Existing Contractor...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Use existing contractor (Yuliya Kaborda with email lulk@tut.by)
  console.log('\n📋 Test 1: Using existing contractor...');
  try {
    const existingContractor = {
      id: '156007027',
      name: 'Yuliya Kaborda',
      email: 'lulk@tut.by'
    };

    console.log(`Using existing contractor: ${existingContractor.name} (ID: ${existingContractor.id})`);

    // Test 2: Create Proforma invoice with existing contractor
    console.log('\n📋 Test 2: Creating Proforma invoice...');
    const mockDeal = {
      id: 999,
      title: 'Test Proforma Deal - Camp Service for Yuliya',
      value: 1200,
      currency: 'EUR'
    };

    const result = await invoiceProcessing.createProformaInWfirma(
      mockDeal,
      existingContractor,
      1200 // amount
    );

    if (result.success) {
      console.log('✅ Proforma invoice created successfully in wFirma!');
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

  // Test 3: Test with PLN currency
  console.log('\n📋 Test 3: Testing with PLN currency...');
  try {
    const existingContractor = {
      id: '156007876', // Maksim Sheka
      name: 'Maksim Sheka',
      email: 'sheko.maxim@gmail.com'
    };

    const mockDeal = {
      id: 998,
      title: 'Test PLN Proforma Deal',
      value: 3000,
      currency: 'PLN'
    };

    const result = await invoiceProcessing.createProformaInWfirma(
      mockDeal,
      existingContractor,
      3000
    );

    if (result.success) {
      console.log('✅ PLN Proforma invoice created successfully!');
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Currency: PLN`);
      console.log(`   Amount: 3000 PLN`);
    } else {
      console.error('❌ Failed to create PLN Proforma invoice:', result.error);
    }
  } catch (error) {
    console.error('❌ Error testing PLN currency:', error.message);
  }

  console.log('\n🎉 Proforma creation tests completed!');
}

testProformaWithExistingContractor();




