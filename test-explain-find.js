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

async function explainFind() {
  try {
    console.log('📚 ОБЪЯСНЕНИЕ: Как получить проформы без знания ID\n');
    console.log('='.repeat(80));
    
    // 1. Используем endpoint /invoices/find (не /invoices/get/{id})
    console.log('\n1️⃣ Используем endpoint: /invoices/find');
    console.log('   Это поисковый endpoint, который возвращает список инвойсов');
    console.log('   по заданным критериям (даты, фильтры и т.д.)\n');
    
    // 2. Формируем XML запрос с фильтрами
    const dateFrom = new Date(2025, 7, 1); // Август 2025
    const dateTo = new Date(2025, 9, 30, 23, 59, 59); // Сентябрь 2025
    
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
                <limit>100</limit>
                <page>1</page>
            </parameters>
        </invoice>
    </invoices>
</api>`;

    console.log('2️⃣ XML запрос с параметрами:');
    console.log('   - Фильтр по датам: от ' + dateFromStr + ' до ' + dateToStr);
    console.log('   - Пагинация: limit=100, page=1');
    console.log('   - Это вернет все инвойсы за этот период (не только проформы)\n');
    
    console.log('XML запрос:');
    console.log(xmlPayload);
    console.log('\n');
    
    // 3. Делаем запрос
    const endpoint = `/invoices/find?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
    console.log('3️⃣ Endpoint:', baseURL + endpoint);
    console.log('\n');
    
    const response = await xmlClient.post(endpoint, xmlPayload);
    
    if (response.data && typeof response.data === 'string') {
      console.log('4️⃣ Ответ API содержит все инвойсы за период:\n');
      
      // Считаем все инвойсы
      const allInvoices = response.data.match(/<invoice>[\s\S]*?<\/invoice>/g) || [];
      console.log(`   Всего инвойсов в ответе: ${allInvoices.length}`);
      
      // Фильтруем только CO-PROF
      const proformas = [];
      allInvoices.forEach(invoiceXml => {
        const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
        const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
        
        if (fullnumber.startsWith('CO-PROF')) {
          const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
          const dateMatch = invoiceXml.match(/<date>([^<]+)<\/date>/);
          proformas.push({
            id: idMatch ? idMatch[1] : null,
            fullnumber: fullnumber,
            date: dateMatch ? dateMatch[1] : ''
          });
        }
      });
      
      console.log(`   Из них проформ CO-PROF: ${proformas.length}\n`);
      
      console.log('5️⃣ Алгоритм работы:\n');
      console.log('   a) Отправляем запрос /invoices/find с фильтром по датам');
      console.log('   b) Получаем ВСЕ инвойсы за период (и проформы, и обычные FV)');
      console.log('   c) Парсим XML ответ и фильтруем по номеру (CO-PROF)');
      console.log('   d) Если есть пагинация - переходим на следующую страницу');
      console.log('   e) Для каждой проформы можем получить полные данные через /invoices/get/{id}\n');
      
      if (proformas.length > 0) {
        console.log('6️⃣ Пример найденных проформ:\n');
        proformas.forEach((p, i) => {
          console.log(`   ${i + 1}. ${p.fullnumber} (ID: ${p.id})`);
          console.log(`      Теперь можем получить полные данные: GET /invoices/get/${p.id}`);
        });
      }
      
      console.log('\n' + '='.repeat(80));
      console.log('\n📝 ВАЖНО:');
      console.log('   - /invoices/find - для поиска по критериям (не нужен ID)');
      console.log('   - /invoices/get/{id} - для получения конкретного инвойса (нужен ID)');
      console.log('   - /invoices/find может вернуть invoicecontents пустыми, поэтому');
      console.log('     для получения полных данных используем /invoices/get/{id}');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

explainFind();

