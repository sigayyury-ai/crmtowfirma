require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');

// Устанавливаем переменные окружения для тестирования
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testProductCreation() {
  console.log('🧪 Testing Product Creation in wFirma\n');

  const wfirmaClient = new WfirmaClient();
  
  // Тестовые данные продукта
  const productData = {
    name: 'Test Service Product',
    price: 100,
    unit: 'szt.',
    code: `TEST_${Date.now()}`
  };

  console.log('📦 Product Data:');
  console.log(JSON.stringify(productData, null, 2));
  console.log();

  try {
    console.log('🔄 Attempting to create product...\n');
    
    const result = await wfirmaClient.createProduct(productData);
    
    if (result.success) {
      console.log('✅ SUCCESS: Product created!');
      console.log('='.repeat(40));
      console.log(`   Product ID: ${result.productId}`);
      console.log(`   Response: ${JSON.stringify(result.data, null, 2)}`);
      console.log('='.repeat(40));
    } else {
      console.log('❌ FAILED: Product creation failed');
      console.log('='.repeat(40));
      console.log(`   Error: ${result.error}`);
      console.log('='.repeat(40));
    }

  } catch (error) {
    console.log('💥 ERROR: Exception during product creation');
    console.log(`   Error: ${error.message}`);
  }
  
  console.log('\n🏁 Test completed\n');
}

testProductCreation();




