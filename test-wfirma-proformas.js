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

async function testFindProformas() {
  try {
    console.log('🔍 Testing wFirma API /invoices/find endpoint...\n');
    
    // Используем диапазон дат: последние 2 года
    const now = new Date();
    const dateFrom = new Date(now.getFullYear() - 2, 0, 1);
    const dateTo = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59);
    
    const dateFromStr = dateFrom.toISOString().split('T')[0];
    const dateToStr = dateTo.toISOString().split('T')[0];
    
    console.log('📅 Date range:', dateFromStr, 'to', dateToStr);
    
    // Строим XML запрос
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

    console.log('\n📤 XML Request:');
    console.log(xmlPayload);
    
    const endpoint = `/invoices/find?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
    console.log(`\n🌐 Endpoint: ${baseURL}${endpoint}\n`);
    
    const response = await xmlClient.post(endpoint, xmlPayload);
    
    console.log('✅ Response received');
    console.log('Response status:', response.status);
    console.log('Response type:', typeof response.data);
    
    if (typeof response.data === 'string') {
      console.log('Response length:', response.data.length);
      console.log('\n📄 Response preview (first 2000 chars):');
      console.log(response.data.substring(0, 2000));
      
      // Проверяем наличие invoice тегов
      const invoiceMatches = response.data.match(/<invoice>[\s\S]*?<\/invoice>/g);
      console.log(`\n📊 Found ${invoiceMatches ? invoiceMatches.length : 0} invoice tags in XML`);
      
      // Проверяем наличие CO-PROF
      const coProfMatches = response.data.match(/CO-PROF/g);
      console.log(`📊 Found ${coProfMatches ? coProfMatches.length : 0} CO-PROF mentions`);
      
      // Проверяем наличие CO-FV
      const coFvMatches = response.data.match(/CO-FV/g);
      console.log(`📊 Found ${coFvMatches ? coFvMatches.length : 0} CO-FV mentions`);
      
      // Ищем все номера проформ/инвойсов
      const numberMatches = response.data.match(/<number>([^<]+)<\/number>/g);
      const fullnumberMatches = response.data.match(/<fullnumber>([^<]+)<\/fullnumber>/g);
      
      console.log(`\n📋 Found ${numberMatches ? numberMatches.length : 0} <number> tags`);
      console.log(`📋 Found ${fullnumberMatches ? fullnumberMatches.length : 0} <fullnumber> tags`);
      
      if (numberMatches && numberMatches.length > 0) {
        console.log('\n📝 Sample numbers (first 10):');
        numberMatches.slice(0, 10).forEach((match, i) => {
          const num = match.replace(/<\/?number>/g, '');
          console.log(`  ${i + 1}. ${num}`);
        });
      }
      
      if (fullnumberMatches && fullnumberMatches.length > 0) {
        console.log('\n📝 Sample fullnumbers (first 10):');
        fullnumberMatches.slice(0, 10).forEach((match, i) => {
          const num = match.replace(/<\/?fullnumber>/g, '');
          console.log(`  ${i + 1}. ${num}`);
        });
      }
      
      // Парсим все проформы и показываем их
      console.log('\n\n📋 ПАРСИНГ ПРОФОРМ:\n');
      
      if (invoiceMatches) {
        const proformas = [];
        
        for (const invoiceXml of invoiceMatches) {
          // Извлекаем данные
          const idMatch = invoiceXml.match(/<id>(\d+)<\/id>/);
          const numberMatch = invoiceXml.match(/<number>([^<]+)<\/number>/);
          const fullnumberMatch = invoiceXml.match(/<fullnumber>([^<]+)<\/fullnumber>/);
          const dateMatch = invoiceXml.match(/<date>([^<]+)<\/date>/);
          const totalMatch = invoiceXml.match(/<total>([^<]+)<\/total>/);
          const currencyMatch = invoiceXml.match(/<currency>([^<]+)<\/currency>/);
          const typeMatch = invoiceXml.match(/<type>([^<]+)<\/type>/);
          
          const fullnumber = fullnumberMatch ? fullnumberMatch[1].trim() : '';
          const number = numberMatch ? numberMatch[1].trim() : '';
          
          // Проверяем, что это CO-PROF (не CO-FV)
          if (fullnumber.startsWith('CO-PROF') || number.startsWith('CO-PROF')) {
            // Извлекаем продукты
            const products = [];
            const invoicecontentsMatches = invoiceXml.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/g);
            
            if (invoicecontentsMatches) {
              for (const contentsXml of invoicecontentsMatches) {
                const contentMatches = contentsXml.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
                
                if (contentMatches) {
                  for (const contentXml of contentMatches) {
                    const nameMatch = contentXml.match(/<name>([^<]+)<\/name>/);
                    const priceMatch = contentXml.match(/<price>([^<]+)<\/price>/);
                    const countMatch = contentXml.match(/<count>([^<]+)<\/count>/);
                    
                    if (nameMatch) {
                      products.push({
                        name: nameMatch[1].trim(),
                        price: priceMatch ? parseFloat(priceMatch[1]) : 0,
                        count: countMatch ? parseFloat(countMatch[1]) : 1
                      });
                    }
                  }
                } else {
                  // Прямой поиск в invoicecontents
                  const nameMatch = contentsXml.match(/<name>([^<]+)<\/name>/);
                  const priceMatch = contentsXml.match(/<price>([^<]+)<\/price>/);
                  const countMatch = contentsXml.match(/<count>([^<]+)<\/count>/);
                  
                  if (nameMatch) {
                    products.push({
                      name: nameMatch[1].trim(),
                      price: priceMatch ? parseFloat(priceMatch[1]) : 0,
                      count: countMatch ? parseFloat(countMatch[1]) : 1
                    });
                  }
                }
              }
            }
            
            // Если нет продуктов, ищем напрямую в invoice
            if (products.length === 0) {
              const directContentMatches = invoiceXml.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
              if (directContentMatches) {
                for (const contentXml of directContentMatches) {
                  const nameMatch = contentXml.match(/<name>([^<]+)<\/name>/);
                  const priceMatch = contentXml.match(/<price>([^<]+)<\/price>/);
                  const countMatch = contentXml.match(/<count>([^<]+)<\/count>/);
                  
                  if (nameMatch) {
                    products.push({
                      name: nameMatch[1].trim(),
                      price: priceMatch ? parseFloat(priceMatch[1]) : 0,
                      count: countMatch ? parseFloat(countMatch[1]) : 1
                    });
                  }
                }
              }
            }
            
            proformas.push({
              id: idMatch ? idMatch[1] : null,
              number: number,
              fullnumber: fullnumber,
              date: dateMatch ? dateMatch[1] : null,
              total: totalMatch ? parseFloat(totalMatch[1]) : 0,
              currency: currencyMatch ? currencyMatch[1].trim() : 'PLN',
              type: typeMatch ? typeMatch[1].trim() : null,
              products: products
            });
          }
        }
        
        console.log(`✅ Найдено ${proformas.length} проформ CO-PROF:\n`);
        
        proformas.forEach((proforma, index) => {
          console.log(`${index + 1}. ${proforma.fullnumber || proforma.number}`);
          console.log(`   ID: ${proforma.id}`);
          console.log(`   Дата: ${proforma.date}`);
          console.log(`   Сумма: ${proforma.total} ${proforma.currency}`);
          console.log(`   Тип: ${proforma.type}`);
          console.log(`   Продукты (${proforma.products.length}):`);
          if (proforma.products.length > 0) {
            proforma.products.forEach((product, pIndex) => {
              console.log(`     ${pIndex + 1}. ${product.name} - ${product.price} ${proforma.currency} x ${product.count}`);
            });
          } else {
            console.log(`     ⚠️  Нет продуктов в invoicecontents`);
          }
          console.log('');
        });
        
        // Сводка по продуктам
        const productMap = new Map();
        proformas.forEach(proforma => {
          proforma.products.forEach(product => {
            const key = `${product.name}::${proforma.currency}`;
            if (!productMap.has(key)) {
              productMap.set(key, {
                productName: product.name,
                currency: proforma.currency,
                count: 0,
                totalAmount: 0
              });
            }
            const group = productMap.get(key);
            group.count += 1;
            group.totalAmount += product.price * product.count;
          });
        });
        
        console.log('\n📊 ГРУППИРОВКА ПО ПРОДУКТАМ:\n');
        const groupedProducts = Array.from(productMap.values()).sort((a, b) => 
          a.productName.localeCompare(b.productName)
        );
        
        groupedProducts.forEach((item, index) => {
          console.log(`${index + 1}. ${item.productName} (${item.currency})`);
          console.log(`   Количество проформ: ${item.count}`);
          console.log(`   Общая сумма: ${item.totalAmount.toFixed(2)} ${item.currency}`);
          console.log('');
        });
      }
      
      // Проверяем на ошибки
      if (response.data.includes('<code>ERROR</code>') || response.data.includes('<error>')) {
        console.log('\n❌ ERROR in response!');
        const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
        if (errorMatch) {
          console.log('Error message:', errorMatch[1]);
        }
      }
    } else {
      console.log('Response data:', JSON.stringify(response.data, null, 2));
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testFindProformas();

