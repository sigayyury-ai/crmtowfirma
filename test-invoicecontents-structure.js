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

async function testInvoiceContents() {
  try {
    const now = new Date();
    const dateFrom = new Date(now.getFullYear() - 2, 0, 1);
    const dateTo = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59);
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    // Пробуем запросить с параметром, чтобы получить invoicecontents
    const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <parameters>
                <date>
                    <from>${dateFromStr}</from>
                    <to>${dateToStr}</to>
                </date>
                <limit>3</limit>
                <page>1</page>
            </parameters>
            <fields>
                <invoicecontents>1</invoicecontents>
            </fields>
        </invoice>
    </invoices>
</api>`;

    console.log('📤 Request with invoicecontents field:\n');
    console.log(xmlPayload);
    console.log('\n');
    
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
                const contents = invoicecontentsMatch[0];
                console.log(`\nДлина invoicecontents: ${contents.length} символов`);
                console.log(`Первые 500 символов:\n${contents.substring(0, 500)}`);
                
                // Проверяем наличие invoicecontent
                const hasInvoicecontent = contents.includes('<invoicecontent>');
                console.log(`\ninvoicecontent присутствует: ${hasInvoicecontent}`);
                
                if (hasInvoicecontent) {
                  const contentMatches = contents.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
                  console.log(`Найдено invoicecontent элементов: ${contentMatches ? contentMatches.length : 0}`);
                  
                  if (contentMatches) {
                    contentMatches.forEach((content, i) => {
                      const nameMatch = content.match(/<name>([^<]+)<\/name>/);
                      if (nameMatch) {
                        console.log(`  Продукт ${i + 1}: ${nameMatch[1].trim()}`);
                      }
                    });
                  }
                } else {
                  console.log('\n❌ invoicecontent отсутствует внутри invoicecontents');
                  console.log('\nПолное содержимое invoicecontents:');
                  console.log(contents);
                  console.log('\nДлина содержимого (без тегов):', contents.replace(/<[^>]+>/g, '').trim().length);
                  console.log('Содержимое без тегов:', contents.replace(/<[^>]+>/g, '').trim());
                }
              }
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

testInvoiceContents();

