require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');

// Устанавливаем переменные окружения для тестирования
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function verifyProformaDocument() {
  console.log('🔍 Verifying Proforma document type...\n');

  const wfirmaClient = new WfirmaClient();
  
  // ID последнего созданного документа
  const invoiceId = '388491190';
  
  try {
    console.log(`1. Fetching invoice ${invoiceId} details...`);
    
    // Получаем детали документа
    const response = await wfirmaClient.request('GET', `/invoices/${invoiceId}`);
    
    if (response.success && response.data) {
      console.log('✅ Invoice details fetched successfully');
      
      // Проверяем тип документа
      const invoice = response.data.invoice || response.data;
      
      console.log('\n📄 Document Details:');
      console.log('='.repeat(50));
      console.log(`   ID: ${invoice.id || 'N/A'}`);
      console.log(`   Number: ${invoice.number || 'N/A'}`);
      console.log(`   Kind: ${invoice.kind || 'N/A'}`);
      console.log(`   Type: ${invoice.type || 'N/A'}`);
      console.log(`   Status: ${invoice.status || 'N/A'}`);
      console.log(`   Issue Date: ${invoice.issue_date || invoice.date || 'N/A'}`);
      console.log(`   Payment Date: ${invoice.payment_date || invoice.paymentdate || 'N/A'}`);
      console.log(`   Currency: ${invoice.currency || 'N/A'}`);
      console.log(`   Total: ${invoice.total || invoice.amount || 'N/A'}`);
      console.log('='.repeat(50));
      
      // Проверяем, является ли это Proforma
      const isProforma = invoice.kind === 'proforma' || 
                        invoice.type === 'proforma' ||
                        (invoice.number && invoice.number.includes('PRO'));
      
      if (isProforma) {
        console.log('\n✅ SUCCESS: Document is confirmed as PROFORMA!');
        console.log(`   Document kind: ${invoice.kind}`);
      } else {
        console.log('\n❌ WARNING: Document does not appear to be a Proforma');
        console.log(`   Document kind: ${invoice.kind}`);
        console.log(`   Document type: ${invoice.type}`);
      }
      
      // Выводим полный ответ для отладки
      console.log('\n🔧 Full API Response:');
      console.log(JSON.stringify(response.data, null, 2));
      
    } else {
      console.log('❌ Failed to fetch invoice details:', response.error);
    }
    
  } catch (error) {
    console.log('❌ Error verifying document:', error.message);
    if (error.response) {
      console.log('   Status:', error.response.status);
      console.log('   Data:', error.response.data);
    }
  }
  
  console.log('\n🏁 Verification completed\n');
}

verifyProformaDocument();




