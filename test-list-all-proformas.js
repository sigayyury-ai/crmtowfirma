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

async function listAllProformas() {
  try {
    console.log('🔍 Загружаю все проформы CO-PROF...\n');
    
    // Широкий диапазон дат
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
          for (const invoiceXml of invoiceMatches) {
            const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
            const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
            
            // Проверяем, что это CO-PROF (не CO-FV)
            if (fullnumber.startsWith('CO-PROF')) {
              const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
              const numberMatch = invoiceXml.match(/<number>([^<]+)<\/number>/);
              const dateMatch = invoiceXml.match(/<date>([^<]+)<\/date>/);
              const totalMatch = invoiceXml.match(/<total>([^<]+)<\/total>/);
              const currencyMatch = invoiceXml.match(/<currency>([^<]+)<\/currency>/);
              
              allProformas.push({
                id: idMatch ? idMatch[1] : null,
                number: numberMatch ? numberMatch[1].trim() : '',
                fullnumber: fullnumber,
                date: dateMatch ? dateMatch[1] : '',
                total: totalMatch ? parseFloat(totalMatch[1]) : 0,
                currency: currencyMatch ? currencyMatch[1].trim() : 'PLN'
              });
            }
          }
          
          // Проверяем, есть ли еще страницы
          if (invoiceMatches.length < limit) {
            hasMore = false;
          } else {
            page++;
            console.log(`Загружена страница ${page - 1}, найдено проформ: ${allProformas.length}...`);
          }
        } else {
          hasMore = false;
        }
      } else {
        hasMore = false;
      }
    }
    
    console.log(`\n✅ Всего найдено проформ: ${allProformas.length}\n`);
    console.log('='.repeat(100));
    console.log('СПИСОК ВСЕХ ПРОФОРМ CO-PROF:');
    console.log('='.repeat(100));
    console.log('');
    
    // Сортируем по дате (от новых к старым)
    allProformas.sort((a, b) => {
      if (a.date > b.date) return -1;
      if (a.date < b.date) return 1;
      return 0;
    });
    
    // Группируем по годам
    const byYear = {};
    allProformas.forEach(proforma => {
      const year = proforma.date ? proforma.date.substring(0, 4) : 'Unknown';
      if (!byYear[year]) {
        byYear[year] = [];
      }
      byYear[year].push(proforma);
    });
    
    // Выводим по годам
    Object.keys(byYear).sort().reverse().forEach(year => {
      console.log(`\n📅 ${year} год (${byYear[year].length} проформ):`);
      console.log('-'.repeat(100));
      
      byYear[year].forEach((proforma, index) => {
        const totalStr = `${proforma.total.toFixed(2)} ${proforma.currency}`;
        console.log(`${String(index + 1).padStart(3)}. ${proforma.fullnumber.padEnd(20)} | ID: ${String(proforma.id).padEnd(10)} | Дата: ${proforma.date.padEnd(12)} | Сумма: ${totalStr.padStart(15)}`);
      });
    });
    
    console.log('\n' + '='.repeat(100));
    console.log(`\nВсего проформ: ${allProformas.length}`);
    console.log(`Страниц обработано: ${page - 1}`);
    
    // Выводим проформы с номером 133, если есть
    const with133 = allProformas.filter(p => p.fullnumber.includes('133') || p.number.includes('133'));
    if (with133.length > 0) {
      console.log(`\n🔍 Проформы с номером 133 (${with133.length}):`);
      with133.forEach(p => {
        console.log(`  - ${p.fullnumber} (ID: ${p.id}, Дата: ${p.date})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data?.substring(0, 500));
    }
  }
}

listAllProformas();

