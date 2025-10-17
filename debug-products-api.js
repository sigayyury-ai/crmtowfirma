require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');

// Устанавливаем переменные окружения для тестирования
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function debugProductsAPI() {
  console.log('🔍 Debugging Products API Response...\n');

  const wfirmaClient = new WfirmaClient();
  
  try {
    console.log('1. Calling wFirma getProducts API...');
    const result = await wfirmaClient.getProducts();
    
    console.log('\n📊 API Response:');
    console.log('Success:', result.success);
    console.log('Data type:', typeof result.data);
    console.log('Data content:');
    
    if (typeof result.data === 'string') {
      console.log('Raw XML Response:');
      console.log('='.repeat(80));
      console.log(result.data);
      console.log('='.repeat(80));
    } else {
      console.log('JSON Response:');
      console.log(JSON.stringify(result.data, null, 2));
    }

  } catch (error) {
    console.log('❌ Error:', error.message);
  }
  
  console.log('\n🏁 Debug completed\n');
}

debugProductsAPI();




