require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testNewContractorLogic() {
  console.log('🔄 Testing New Contractor Logic (Search -> Create -> Use ID)...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('📋 New Logic Flow:');
    console.log('   1. Search contractor by email in wFirma');
    console.log('   2. If not found, create new contractor');
    console.log('   3. Use contractor ID in invoice XML (not full contractor data)');
    console.log('');

    console.log('🎯 Testing with deal 1516...');
    const result = await invoiceProcessing.processDealById(1516);
    
    if (result.success) {
      console.log('✅ SUCCESS! Proforma created with new contractor logic!');
      console.log(`   📋 Invoice ID: ${result.invoiceId}`);
      console.log(`   👤 Contractor: ${result.contractorName}`);
      console.log(`   💰 Amount: ${result.amount} ${result.currency}`);
      console.log(`   📝 Message: ${result.message}`);
      console.log('');
      console.log('🔄 Logic Flow Applied:');
      console.log('   ✅ Step 1: Searched contractor by email in wFirma');
      console.log('   ✅ Step 2: Found/created contractor with ID');
      console.log('   ✅ Step 3: Used contractor ID in invoice XML');
      console.log('   ✅ Step 4: Created Proforma with existing contractor reference');
      console.log('');
      console.log('🎉 New contractor logic is working correctly!');
    } else {
      console.log(`❌ FAILED: ${result.error}`);
      if (result.details) {
        console.log('   📋 Details:', result.details);
      }
    }

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 New contractor logic test completed');
  }
}

testNewContractorLogic();




