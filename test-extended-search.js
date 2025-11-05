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

async function extendedSearch() {
  try {
    console.log('🔍 Расширенный поиск проформ CO-PROF...\n');
    
    // Очень широкий диапазон дат
    const dateFrom = new Date(2015, 0, 1); // С 2015 года
    const dateTo = new Date(2030, 11, 31, 23, 59, 59); // До 2030 года
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    console.log(`Диапазон: ${dateFromStr} - ${dateToStr}\n`);
    
    let page = 1;
    const limit = 100;
    let allProformas = [];
    let hasMore = true;
    
    while (hasMore && page <= 20) {
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
          
          console.log(`Страница ${page}: ${pageProformas} проформ (всего инвойсов: ${invoiceMatches.length})`);
          
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
    
    // Группируем по годам
    const byYear = {};
    allProformas.forEach(p => {
      const year = p.date ? p.date.substring(0, 4) : 'Unknown';
      if (!byYear[year]) {
        byYear[year] = [];
      }
      byYear[year].push(p);
    });
    
    console.log('📅 Группировка по годам:');
    Object.keys(byYear).sort().reverse().forEach(year => {
      console.log(`\n  ${year}: ${byYear[year].length} проформ`);
      byYear[year].forEach(p => {
        console.log(`    - ${p.fullnumber} (${p.date})`);
      });
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

extendedSearch();

