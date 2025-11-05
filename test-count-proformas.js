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

async function countProformas() {
  try {
    console.log('🔍 Подсчитываю все проформы CO-PROF...\n');
    
    const dateFrom = new Date(2020, 0, 1);
    const dateTo = new Date(2026, 11, 31, 23, 59, 59);
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    let page = 1;
    const limit = 100;
    let allProformas = [];
    let hasMore = true;
    
    while (hasMore && page <= 50) {
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <parameters>
                <date>
                    <from>${dateFromStr}</from>
                    <to>${dateToStr}</to>
                </date>
                <limit>${limit}</limit>
                <page>${page}</page>
            </parameters>
        </invoice>
    </invoices>
</api>`;

      const endpoint = `/invoices/find?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
      const response = await xmlClient.post(endpoint, xmlPayload);
      
      if (response.data && typeof response.data === 'string') {
        const invoiceMatches = response.data.match(/<invoice>[\s\S]*?<\/invoice>/g);
        
        if (invoiceMatches) {
          let pageProformas = 0;
          for (const invoiceXml of invoiceMatches) {
            const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
            const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
            
            if (fullnumber.startsWith('CO-PROF')) {
              pageProformas++;
              const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
              const dateMatch = invoiceXml.match(/<date>([^<]+)<\/date>/);
              allProformas.push({
                id: idMatch ? idMatch[1] : null,
                fullnumber: fullnumber,
                date: dateMatch ? dateMatch[1] : ''
              });
            }
          }
          
          console.log(`Страница ${page}: найдено ${pageProformas} проформ (всего инвойсов: ${invoiceMatches.length})`);
          
          if (invoiceMatches.length < limit) {
            hasMore = false;
          } else {
            page++;
          }
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`\n✅ Всего найдено проформ: ${allProformas.length}\n`);
    
    // Показываем список проформ
    allProformas.forEach((p, i) => {
      console.log(`${i + 1}. ${p.fullnumber} (ID: ${p.id}, Дата: ${p.date})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
    }
  }
}

countProformas();

