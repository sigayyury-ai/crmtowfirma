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

async function checkAllInvoices() {
  try {
    console.log('🔍 Проверяю все инвойсы в системе...\n');
    
    const dateFrom = new Date(2020, 0, 1);
    const dateTo = new Date(2026, 11, 31, 23, 59, 59);
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    let page = 1;
    const limit = 100;
    let allInvoices = [];
    let hasMore = true;
    
    while (hasMore && page <= 10) {
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
          for (const invoiceXml of invoiceMatches) {
            const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
            const typeMatch = invoiceXml.match(/<type>([^<]+)<\/type>/);
            const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
            const type = typeMatch ? typeMatch[1].trim() : '';
            
            allInvoices.push({
              fullnumber: fullnumber,
              type: type
            });
          }
          
          console.log(`Страница ${page}: найдено ${invoiceMatches.length} инвойсов`);
          
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
    
    console.log(`\n✅ Всего найдено инвойсов: ${allInvoices.length}\n`);
    
    // Группируем по типам
    const byType = {};
    allInvoices.forEach(inv => {
      const type = inv.type || 'unknown';
      if (!byType[type]) {
        byType[type] = [];
      }
      byType[type].push(inv.fullnumber);
    });
    
    console.log('📊 Группировка по типам:');
    Object.keys(byType).forEach(type => {
      console.log(`\n  ${type}: ${byType[type].length} шт.`);
      if (byType[type].length <= 10) {
        byType[type].forEach(num => console.log(`    - ${num}`));
      } else {
        byType[type].slice(0, 5).forEach(num => console.log(`    - ${num}`));
        console.log(`    ... и еще ${byType[type].length - 5}`);
      }
    });
    
    // Проверяем проформы
    const proformas = allInvoices.filter(inv => inv.fullnumber.startsWith('CO-PROF'));
    console.log(`\n📋 Проформ CO-PROF: ${proformas.length}`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

checkAllInvoices();

