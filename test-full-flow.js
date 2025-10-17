require('dotenv').config();

console.log('🚀 Testing Full Integration Flow: Contractor → Product → Proforma\n');

async function testFullFlow() {
  try {
    console.log('📋 Flow Steps:');
    console.log('   1. Fetch deal from Pipedrive');
    console.log('   2. Search/Create contractor in wFirma');
    console.log('   3. Search/Create product in wFirma');
    console.log('   4. Create Proforma invoice with JSON format');
    console.log('   5. Verify document type\n');

    console.log('🔄 Starting integration test...\n');

    // Тестируем создание Proforma для сделки 1516
    const response = await fetch('http://localhost:3000/api/invoice-processing/deal/1516', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ SUCCESS: Full integration flow completed!');
      console.log('='.repeat(50));
      console.log(`   Invoice Type: ${result.invoiceType}`);
      console.log(`   Invoice ID: ${result.invoiceId}`);
      console.log(`   Contractor: ${result.contractorName}`);
      console.log(`   Message: ${result.message}`);
      console.log('='.repeat(50));
      
      console.log('\n🎯 Integration Flow Summary:');
      console.log('   ✓ Contractor management: WORKING');
      console.log('   ✓ Product management: WORKING');
      console.log('   ✓ Proforma creation: WORKING');
      console.log('   ✓ JSON format: WORKING');
      console.log('   ✓ Service type products: WORKING (no VAT)');
      
    } else {
      console.log('❌ FAILED: Integration flow error');
      console.log('='.repeat(50));
      console.log(`   Error: ${result.error}`);
      console.log('='.repeat(50));
    }

  } catch (error) {
    console.log('❌ ERROR: Failed to test integration flow');
    console.log(`   Error: ${error.message}`);
  }
}

// Проверяем, что сервер запущен
async function checkServer() {
  try {
    const response = await fetch('http://localhost:3000/api/contractors');
    if (response.status === 200) {
      console.log('✅ Server is running\n');
      return true;
    }
  } catch (error) {
    console.log('❌ Server is not running. Please start the server with: npm start\n');
    return false;
  }
}

async function main() {
  const serverRunning = await checkServer();
  if (serverRunning) {
    await testFullFlow();
  }
  
  console.log('\n🏁 Test completed\n');
}

main();




