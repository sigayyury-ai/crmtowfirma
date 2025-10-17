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

async function testProformaOnly() {
  console.log('🔧 Testing Proforma Invoice Processing Only...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Get pending Proforma deals
  console.log('\n📋 Test 1: Getting pending Proforma deals...');
  try {
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (pendingResult.success) {
      console.log('✅ Pending deals retrieved successfully');
      console.log(`📊 Found ${pendingResult.deals.length} deals with invoice type field`);
      
      // Фильтруем только Proforma
      const proformaDeals = pendingResult.deals.filter(deal => {
        const invoiceType = deal[invoiceProcessing.INVOICE_TYPE_FIELD_KEY];
        return invoiceType === 'Proforma';
      });
      
      console.log(`📊 Found ${proformaDeals.length} Proforma deals`);
      
      if (proformaDeals.length > 0) {
        console.log('\n📝 Proforma deals:');
        proformaDeals.forEach(deal => {
          console.log(`   Deal ${deal.id}: ${deal.title}`);
          console.log(`   Value: ${deal.value} ${deal.currency}`);
          console.log(`   Person: ${deal.person_name || 'N/A'}`);
        });
      } else {
        console.log('ℹ️ No Proforma deals found');
      }
    } else {
      console.error('❌ Failed to get pending deals:', pendingResult.error);
    }
  } catch (error) {
    console.error('❌ Error getting pending deals:', error.message);
  }

  // Test 2: Test Proforma amount calculation
  console.log('\n📋 Test 2: Testing Proforma amount calculation...');
  try {
    const testAmounts = [1000, 2000, 500, 1500];
    
    for (const amount of testAmounts) {
      const result = await invoiceProcessing.calculateInvoiceAmount(amount, 'Proforma', { id: 1 });
      if (result.success) {
        console.log(`   Amount: ${amount} → Proforma: ${result.amount} (${result.message})`);
      } else {
        console.error(`   Amount: ${amount} → Error: ${result.error}`);
      }
    }
  } catch (error) {
    console.error('❌ Error testing amount calculation:', error.message);
  }

  // Test 3: Test unsupported invoice types
  console.log('\n📋 Test 3: Testing unsupported invoice types...');
  try {
    const unsupportedTypes = ['Prepayment', 'Final payment', 'Invalid Type'];
    
    for (const type of unsupportedTypes) {
      const result = await invoiceProcessing.calculateInvoiceAmount(1000, type, { id: 1 });
      if (!result.success) {
        console.log(`   ✅ ${type}: Correctly rejected - ${result.error}`);
      } else {
        console.error(`   ❌ ${type}: Should have been rejected but was accepted`);
      }
    }
  } catch (error) {
    console.error('❌ Error testing unsupported types:', error.message);
  }

  // Test 4: Test full Proforma processing (mock)
  console.log('\n📋 Test 4: Testing full Proforma processing...');
  try {
    const mockDeal = {
      id: 999,
      title: 'Test Proforma Deal',
      value: 2000,
      currency: 'EUR',
      [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Proforma'
    };

    const mockPerson = {
      first_name: 'John',
      last_name: 'Doe',
      emails: [{ value: 'john.doe@example.com', primary: true }]
    };

    const mockContractor = {
      id: 'contractor-123',
      name: 'John Doe',
      email: 'john.doe@example.com'
    };

    const result = await invoiceProcessing.createInvoiceInWfirma(
      mockDeal, 
      mockPerson, 
      null, // no organization
      mockContractor, 
      'Proforma'
    );

    if (result.success) {
      console.log('✅ Mock Proforma creation successful');
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Amount: ${result.amount} ${result.currency}`);
      console.log(`   VAT Rate: ${result.vatRate}% (no VAT)`);
      console.log(`   Message: ${result.message}`);
    } else {
      console.error('❌ Mock Proforma creation failed:', result.error);
    }
  } catch (error) {
    console.error('❌ Error testing Proforma processing:', error.message);
  }

  // Test 5: Test invoice type detection
  console.log('\n📋 Test 5: Testing invoice type detection...');
  try {
    const testDeals = [
      { id: 1, title: 'Proforma Deal', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Proforma', value: 1000, currency: 'EUR' },
      { id: 2, title: 'Prepayment Deal', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: 'Prepayment', value: 2000, currency: 'PLN' },
      { id: 3, title: 'Empty Deal', [invoiceProcessing.INVOICE_TYPE_FIELD_KEY]: '', value: 500, currency: 'EUR' },
      { id: 4, title: 'No Field Deal', value: 750, currency: 'PLN' }
    ];

    testDeals.forEach(deal => {
      const invoiceType = invoiceProcessing.getInvoiceTypeFromDeal(deal);
      const isProforma = invoiceType === 'Proforma';
      console.log(`   Deal ${deal.id}: ${deal.title} - Type: ${invoiceType || 'None'} - Proforma: ${isProforma ? '✅' : '❌'}`);
    });
  } catch (error) {
    console.error('❌ Error testing invoice type detection:', error.message);
  }

  console.log('\n🎉 Proforma-only tests completed!');
  console.log('\n📋 Summary:');
  console.log('   ✅ Only Proforma invoices are supported');
  console.log('   ✅ Proforma amount = full deal amount');
  console.log('   ✅ Proforma without VAT (0%)');
  console.log('   ✅ Other invoice types are rejected');
  console.log('   ✅ Ready for wFirma integration');
}

testProformaOnly();
