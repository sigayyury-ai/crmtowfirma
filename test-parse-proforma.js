require('dotenv').config();
const axios = require('axios');

const companyId = '885512';
const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';

// Создаем XML клиент
const xmlClient = axios.create({
  baseURL: baseURL,
  headers: {
    'Content-Type': 'application/xml',
    'Accept': 'application/xml',
    'accessKey': process.env.WFIRMA_ACCESS_KEY?.trim(),
    'secretKey': process.env.WFIRMA_SECRET_KEY?.trim(),
    'appKey': process.env.WFIRMA_APP_KEY?.trim()
  },
  timeout: 30000
});

async function testGetProforma() {
  try {
    // Берем одну из найденных проформ
    const proformaId = '383544949'; // CO-PROF 6/2025
    
    console.log(`🔍 Получаем проформу ${proformaId}...\n`);
    
    const endpoint = `/invoices/get/${proformaId}?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
    console.log(`🌐 Endpoint: ${baseURL}${endpoint}\n`);
    
    const response = await xmlClient.get(endpoint);
    
    if (response.data && typeof response.data === 'string') {
      console.log('📄 XML Response:\n');
      console.log(response.data);
      
      // Пробуем найти invoicecontents
      console.log('\n\n🔍 Поиск invoicecontents:\n');
      
      const invoicecontentsMatches = response.data.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/g);
      if (invoicecontentsMatches) {
        console.log(`✅ Найдено ${invoicecontentsMatches.length} invoicecontents блоков\n`);
        invoicecontentsMatches.forEach((contents, i) => {
          console.log(`--- Блок ${i + 1} ---`);
          console.log(contents);
          console.log('\n');
        });
      } else {
        console.log('❌ invoicecontents не найдено');
      }
      
      // Пробуем найти invoicecontent
      console.log('\n🔍 Поиск invoicecontent:\n');
      const invoicecontentMatches = response.data.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
      if (invoicecontentMatches) {
        console.log(`✅ Найдено ${invoicecontentMatches.length} invoicecontent элементов\n`);
        invoicecontentMatches.forEach((content, i) => {
          console.log(`--- Элемент ${i + 1} ---`);
          console.log(content);
          console.log('\n');
          
          // Пробуем извлечь name
          const nameMatch = content.match(/<name>([^<]+)<\/name>/);
          const priceMatch = content.match(/<price>([^<]+)<\/price>/);
          const countMatch = content.match(/<count>([^<]+)<\/count>/);
          
          if (nameMatch) {
            console.log(`   Название: ${nameMatch[1]}`);
          }
          if (priceMatch) {
            console.log(`   Цена: ${priceMatch[1]}`);
          }
          if (countMatch) {
            console.log(`   Количество: ${countMatch[1]}`);
          }
          console.log('');
        });
      } else {
        console.log('❌ invoicecontent не найдено');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testGetProforma();

