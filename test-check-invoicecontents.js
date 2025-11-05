require('dotenv').config();
const axios = require('axios');

const companyId = '885512';
const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';

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

async function checkInvoiceContents() {
  try {
    const now = new Date();
    const dateFrom = new Date(now.getFullYear() - 2, 0, 1);
    const dateTo = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59);
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <parameters>
                <date>
                    <from>${dateFromStr}</from>
                    <to>${dateToStr}</to>
                </date>
                <limit>5</limit>
                <page>1</page>
            </parameters>
        </invoice>
    </invoices>
</api>`;

    const endpoint = `/invoices/find?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
    const response = await xmlClient.post(endpoint, xmlPayload);
    
    if (response.data && typeof response.data === 'string') {
      // Ищем первую CO-PROF проформу
      const invoiceMatches = response.data.match(/<invoice>[\s\S]*?<\/invoice>/g);
      
      if (invoiceMatches) {
        for (const invoiceXml of invoiceMatches) {
          const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
          if (fullnumberMatch && fullnumberMatch[1].trim().startsWith('CO-PROF')) {
            console.log(`\n📋 Проформа: ${fullnumberMatch[1].trim()}\n`);
            
            // Проверяем наличие invoicecontents
            const hasInvoicecontents = invoiceXml.includes('<invoicecontents>');
            console.log(`invoicecontents присутствует: ${hasInvoicecontents}`);
            
            if (hasInvoicecontents) {
              const invoicecontentsMatch = invoiceXml.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/);
              if (invoicecontentsMatch) {
                console.log('\n📦 Полное содержимое invoicecontents:');
                console.log(invoicecontentsMatch[0]);
                
                // Проверяем наличие invoicecontent
                const hasInvoicecontent = invoicecontentsMatch[0].includes('<invoicecontent>');
                console.log(`\ninvoicecontent присутствует: ${hasInvoicecontent}`);
                
                if (hasInvoicecontent) {
                  const contentMatches = invoicecontentsMatch[0].match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
                  console.log(`\nНайдено invoicecontent элементов: ${contentMatches ? contentMatches.length : 0}`);
                  
                  if (contentMatches) {
                    contentMatches.forEach((content, i) => {
                      console.log(`\n--- Элемент ${i + 1} ---`);
                      const nameMatch = content.match(/<name>([^<]+)<\/name>/);
                      const priceMatch = content.match(/<price>([^<]+)<\/price>/);
                      const countMatch = content.match(/<count>([^<]+)<\/count>/);
                      
                      if (nameMatch) {
                        console.log(`  Название: ${nameMatch[1].trim()}`);
                      } else {
                        console.log(`  ❌ Название не найдено`);
                      }
                      if (priceMatch) {
                        console.log(`  Цена: ${priceMatch[1]}`);
                      }
                      if (countMatch) {
                        console.log(`  Количество: ${countMatch[1]}`);
                      }
                    });
                  } else {
                    console.log('❌ Не найдено invoicecontent элементов внутри invoicecontents');
                    console.log('\nСодержимое invoicecontents (первые 500 символов):');
                    console.log(invoicecontentsMatch[0].substring(0, 500));
                  }
                }
              }
            } else {
              console.log('❌ invoicecontents отсутствует в ответе /invoices/find');
              console.log('\nПроверяем, какие теги есть в проформе:');
              const allTags = invoiceXml.match(/<[^>]+>/g);
              const uniqueTags = [...new Set(allTags.map(tag => tag.replace(/<[^/]*\//, '<').replace(/<\/?/, '').replace(/>.*/, '')))];
              console.log('Теги:', uniqueTags.slice(0, 30).join(', '));
            }
            break;
          }
        }
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

checkInvoiceContents();

