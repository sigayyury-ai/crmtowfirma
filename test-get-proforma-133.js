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

async function getProforma133() {
  try {
    console.log('🔍 Ищу проформу CO-PROF 133/2025...\n');
    
    // Ищем проформу в ноябре - расширенный диапазон
    const dateFrom = new Date(2024, 10, 1); // 1 ноября 2024
    const dateTo = new Date(2025, 11, 31, 23, 59, 59); // 31 декабря 2025
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    console.log(`Поиск в диапазоне: ${dateFromStr} - ${dateToStr}\n`);
    
    let page = 1;
    const limit = 100;
    let foundProforma = null;
    let foundId = null;
    
    while (!foundProforma && page <= 10) {
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
            const numberMatch = invoiceXml.match(/<number>([^<]+)<\/number>/);
            const number = numberMatch ? numberMatch[1].trim() : '';
            
            // Ищем точное совпадение CO-PROF 133/2025
            if (fullnumber === 'CO-PROF 133/2025' || fullnumber.includes('133/2025')) {
              foundProforma = fullnumber;
              const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
              foundId = idMatch ? idMatch[1] : null;
              console.log(`✅ Найдена проформа на странице ${page}: ${foundProforma}, ID: ${foundId}\n`);
              break;
            }
            
            // Также ищем по номеру 133
            if (number === '133' || number.includes('133')) {
              const dateMatch = invoiceXml.match(/<date>([^<]+)<\/date>/);
              const date = dateMatch ? dateMatch[1] : '';
              // Проверяем, что дата в ноябре 2025
              if (date.startsWith('2025-11')) {
                foundProforma = fullnumber || `CO-PROF ${number}/2025`;
                const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
                foundId = idMatch ? idMatch[1] : null;
                console.log(`✅ Найдена проформа на странице ${page}: ${foundProforma}, ID: ${foundId}, Дата: ${date}\n`);
                break;
              }
            }
          }
        }
        
        // Проверяем, есть ли еще страницы
        const hasMore = invoiceMatches && invoiceMatches.length === limit;
        if (!foundProforma && hasMore) {
          page++;
          console.log(`Проверяю страницу ${page}...`);
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    if (foundId) {
          console.log('📄 Получаю полную информацию...\n');
          
          // Получаем полную информацию через /invoices/get
          const getEndpoint = `/invoices/get/${foundId}?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
          const fullResponse = await xmlClient.get(getEndpoint);
          
          if (fullResponse.data && typeof fullResponse.data === 'string') {
            console.log(`📋 ПОЛНАЯ ИНФОРМАЦИЯ О ПРОФОРМЕ ${foundProforma}:\n`);
            console.log('='.repeat(80));
            console.log(fullResponse.data);
            console.log('='.repeat(80));
            
            // Парсим и выводим в читаемом виде
            const fullInvoiceMatch = fullResponse.data.match(/<invoice>[\s\S]*?<\/invoice>/);
            if (fullInvoiceMatch) {
              const invoiceXmlParsed = fullInvoiceMatch[0];
              
              // Основные поля
              const id = invoiceXmlParsed.match(/<id>(\d+)<\/id>/)?.[1];
              const number = invoiceXmlParsed.match(/<number>([^<]+)<\/number>/)?.[1];
              const fullnumber = invoiceXmlParsed.match(/<fullnumber>([^<]+)<\/fullnumber>/)?.[1];
              const date = invoiceXmlParsed.match(/<date>([^<]+)<\/date>/)?.[1];
              const total = invoiceXmlParsed.match(/<total>([^<]+)<\/total>/)?.[1];
              const currency = invoiceXmlParsed.match(/<currency>([^<]+)<\/currency>/)?.[1];
              const description = invoiceXmlParsed.match(/<description>([^<]*)<\/description>/)?.[1];
              
              console.log('\n📊 ОСНОВНЫЕ ДАННЫЕ:');
              console.log(`ID: ${id}`);
              console.log(`Номер: ${number}`);
              console.log(`Полный номер: ${fullnumber}`);
              console.log(`Дата: ${date}`);
              console.log(`Сумма: ${total} ${currency || 'PLN'}`);
              console.log(`Описание: ${description || '—'}`);
              
              // Контрагент
              const contractorName = invoiceXmlParsed.match(/<contractor>[\s\S]*?<altname>([^<]+)<\/altname>/)?.[1];
              const contractorEmail = invoiceXmlParsed.match(/<contractor>[\s\S]*?<email>([^<]+)<\/email>/)?.[1];
              
              if (contractorName) {
                console.log('\n👤 КОНТРАГЕНТ:');
                console.log(`Имя: ${contractorName}`);
                if (contractorEmail) {
                  console.log(`Email: ${contractorEmail}`);
                }
              }
              
              // Продукты
              const invoicecontentsMatch = invoiceXmlParsed.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/);
              if (invoicecontentsMatch) {
                const contents = invoicecontentsMatch[0];
                const contentMatches = contents.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
                
                if (contentMatches) {
                  console.log('\n📦 ПРОДУКТЫ:');
                  contentMatches.forEach((content, index) => {
                    const name = content.match(/<name>([^<]+)<\/name>/)?.[1];
                    const price = content.match(/<price>([^<]+)<\/price>/)?.[1];
                    const count = content.match(/<count>([^<]+)<\/count>/)?.[1];
                    const goodId = content.match(/<good>[\s\S]*?<id>(\d+)<\/id>/)?.[1];
                    
                    console.log(`\n  ${index + 1}. ${name || 'Без названия'}`);
                    console.log(`     Цена: ${price || '0'} ${currency || 'PLN'}`);
                    console.log(`     Количество: ${count || '1'}`);
                    if (goodId) {
                      console.log(`     Good ID: ${goodId}`);
                    }
                  });
                }
              }
            }
          }
          
      return;
    } else {
      console.log('❌ Проформа CO-PROF 133/2025 не найдена в диапазоне ноябрь 2024 - декабрь 2025');
      console.log('\n🔍 Пробую поискать все проформы с "133" в номере...\n');
      
      // Пробуем еще раз найти все проформы с 133
      page = 1;
      const allWith133 = [];
      
      while (page <= 5) {
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
          const matches = response.data.match(/CO-PROF[^<]*133[^<]*/g);
          if (matches) {
            matches.forEach(match => {
              const fullnumberMatch = match.match(/CO-PROF[^<]+/);
              if (fullnumberMatch && !allWith133.includes(fullnumberMatch[0])) {
                allWith133.push(fullnumberMatch[0]);
              }
            });
          }
          
          const invoiceMatches = response.data.match(/<invoice>[\s\S]*?<\/invoice>/g);
          if (!invoiceMatches || invoiceMatches.length < limit) {
            break;
          }
          page++;
        } else {
          break;
        }
      }
      
      if (allWith133.length > 0) {
        console.log('Найдены проформы с "133":');
        allWith133.forEach(p => console.log(`  - ${p}`));
      } else {
        console.log('Проформы с "133" не найдены');
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data?.substring(0, 500));
    }
  }
}

getProforma133();

