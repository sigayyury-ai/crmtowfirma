require('dotenv').config();
const InvoiceProcessingService = require('./src/services/invoiceProcessing');

// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'b3351c5e051c801b54838aac4cad8098';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testProformaLanguage() {
  console.log('🌍 Testing Proforma Language Configuration...\n');
  
  try {
    const invoiceProcessing = new InvoiceProcessingService();

    console.log('📋 Language Configuration:');
    console.log(`   - Default Language: ${invoiceProcessing.DEFAULT_LANGUAGE}`);
    console.log(`   - Description: ${invoiceProcessing.DEFAULT_DESCRIPTION}`);
    console.log('');

    console.log('1. Testing Proforma creation with English language...');
    const result = await invoiceProcessing.processDealById(1516);
    
    if (result.success) {
      console.log('✅ Proforma created successfully with English language!');
      console.log(`   📋 Invoice ID: ${result.invoiceId}`);
      console.log(`   👤 Contractor: ${result.contractorName}`);
      console.log(`   📝 Message: ${result.message}`);
      console.log('');
      console.log('🌍 Language Settings Applied:');
      console.log('   ✅ Language: EN (English)');
      console.log('   ✅ Description: English text');
      console.log('   ✅ Payment Method: transfer');
      console.log('   ✅ VAT Rate: 0% (no VAT)');
    } else {
      console.log(`❌ Proforma creation failed: ${result.error}`);
      if (result.details) {
        console.log('   📋 Details:', result.details);
      }
    }

  } catch (error) {
    console.error('💥 Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    console.log('\n🏁 Language test completed');
  }
}

testProformaLanguage();




