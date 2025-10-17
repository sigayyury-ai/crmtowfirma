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

async function testInvoiceTypes() {
  console.log('🔧 Testing Invoice Types Processing...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Get pending deals with invoice type field
  console.log('\n📋 Test 1: Getting pending deals with invoice type...');
  try {
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (pendingResult.success) {
      console.log('✅ Pending deals retrieved successfully');
      console.log(`📊 Found ${pendingResult.deals.length} deals with invoice type field`);
      
      if (pendingResult.deals.length > 0) {
        console.log('\n📝 Deals with invoice type:');
        pendingResult.deals.forEach(deal => {
          const invoiceType = deal[invoiceProcessing.INVOICE_TYPE_FIELD_KEY];
          console.log(`   Deal ${deal.id}: ${deal.title} - Invoice Type: ${invoiceType}`);
          console.log(`   Value: ${deal.value} ${deal.currency}`);
        });
      } else {
        console.log('ℹ️ No deals found with invoice type field set');
      }
    } else {
      console.error('❌ Failed to get pending deals:', pendingResult.error);
    }
  } catch (error) {
    console.error('❌ Error getting pending deals:', error.message);
  }

  // Test 2: Test invoice type detection
  console.log('\n📋 Test 2: Testing invoice type detection...');
  try {
    const testDeals = [
      { id: 1, title: 'Test Deal 1', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Proforma', value: 1000, currency: 'EUR' },
      { id: 2, title: 'Test Deal 2', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Prepayment', value: 2000, currency: 'PLN' },
      { id: 3, title: 'Test Deal 3', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Final payment', value: 1500, currency: 'EUR' },
      { id: 4, title: 'Test Deal 4', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: '', value: 500, currency: 'PLN' },
      { id: 5, title: 'Test Deal 5', value: 750, currency: 'EUR' } // No invoice type field
    ];

    testDeals.forEach(deal => {
      const invoiceType = invoiceProcessing.getInvoiceTypeFromDeal(deal);
      console.log(`   Deal ${deal.id}: ${deal.title} - Detected Type: ${invoiceType || 'None'}`);
    });
  } catch (error) {
    console.error('❌ Error testing invoice type detection:', error.message);
  }

  // Test 3: Test amount calculation
  console.log('\n📋 Test 3: Testing amount calculation...');
  try {
    const testCases = [
      { type: 'Proforma', amount: 1000 },
      { type: 'Prepayment', amount: 1000 },
      { type: 'Final payment', amount: 1000 }
    ];

    for (const testCase of testCases) {
      const result = await invoiceProcessing.calculateInvoiceAmount(testCase.amount, testCase.type, { id: 1 });
      if (result.success) {
        console.log(`   ${testCase.type}: ${testCase.amount} → ${result.amount} (${result.message})`);
      } else {
        console.error(`   ${testCase.type}: Error - ${result.error}`);
      }
    }
  } catch (error) {
    console.error('❌ Error testing amount calculation:', error.message);
  }

  // Test 4: Test full invoice processing (mock)
  console.log('\n📋 Test 4: Testing full invoice processing...');
  try {
    const mockDeal = {
      id: 999,
      title: 'Test Invoice Deal',
      value: 2000,
      currency: 'EUR',
      [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Proforma'
    };

    const mockPerson = {
      first_name: 'John',
      last_name: 'Doe',
      emails: [{ value: 'john.doe@example.com', primary: true }]
    };

    const mockOrganization = null;

    const mockContractor = {
      id: 'contractor-123',
      name: 'John Doe',
      email: 'john.doe@example.com'
    };

    const result = await invoiceProcessing.createInvoiceInWfirma(
      mockDeal, 
      mockPerson, 
      mockOrganization, 
      mockContractor, 
      'Proforma'
    );

    if (result.success) {
      console.log('✅ Mock invoice creation successful');
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Amount: ${result.amount} ${result.currency}`);
      console.log(`   Message: ${result.message}`);
    } else {
      console.error('❌ Mock invoice creation failed:', result.error);
    }
  } catch (error) {
    console.error('❌ Error testing invoice processing:', error.message);
  }

  console.log('\n🎉 Invoice Types tests completed!');
}

testInvoiceTypes();




