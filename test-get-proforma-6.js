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

async function getProforma6() {
  try {
    const invoiceId = '383544949'; // CO-PROF 6/2025
    
    console.log('📋 Получаю все поля проформы CO-PROF 6/2025 (ID: 383544949)...\n');
    
    const endpoint = `/invoices/get/${invoiceId}?outputFormat=xml&inputFormat=xml&company_id=${companyId}`;
    const response = await xmlClient.get(endpoint);
    
    if (response.data && typeof response.data === 'string') {
      console.log('='.repeat(100));
      console.log('ПОЛНЫЙ XML ОТВЕТ:');
      console.log('='.repeat(100));
      console.log(response.data);
      console.log('='.repeat(100));
      
      // Парсим XML
      const invoiceMatch = response.data.match(/<invoice>[\s\S]*?<\/invoice>/);
      if (invoiceMatch) {
        const invoiceXml = invoiceMatch[0];
        
        console.log('\n\n📊 РАСПАРСЕННЫЕ ПОЛЯ:\n');
        console.log('='.repeat(100));
        
        // Извлекаем все основные поля
        const extractField = (xml, fieldName) => {
          const match = xml.match(new RegExp(`<${fieldName}>([^<]*)<\/${fieldName}>`));
          return match ? match[1] : null;
        };
        
        const fields = [
          'id', 'number', 'fullnumber', 'date', 'total', 'total_composed',
          'currency', 'description', 'type', 'paymentmethod', 'paymentdate',
          'paymentstate', 'netto', 'netto_service', 'netto_good', 'tax',
          'alreadypaid', 'remaining', 'created', 'modified', 'price_type',
          'disposaldate', 'header', 'footer', 'template', 'schema',
          'correction_type', 'simplified_invoice', 'corrections',
          'currency_exchange', 'currency_label', 'currency_date'
        ];
        
        console.log('ОСНОВНЫЕ ПОЛЯ:');
        console.log('-'.repeat(100));
        fields.forEach(field => {
          const value = extractField(invoiceXml, field);
          if (value !== null && value !== '') {
            console.log(`  ${field.padEnd(25)}: ${value}`);
          }
        });
        
        // Контрагент
        console.log('\nКОНТРАГЕНТ:');
        console.log('-'.repeat(100));
        const contractorMatch = invoiceXml.match(/<contractor>[\s\S]*?<\/contractor>/);
        if (contractorMatch) {
          const contractorXml = contractorMatch[0];
          const contractorFields = ['id', 'altname', 'phone', 'email'];
          contractorFields.forEach(field => {
            const value = extractField(contractorXml, field);
            if (value !== null && value !== '') {
              console.log(`  ${field.padEnd(25)}: ${value}`);
            }
          });
        }
        
        // Детали контрагента
        const contractorDetailMatch = invoiceXml.match(/<contractor_detail>[\s\S]*?<\/contractor_detail>/);
        if (contractorDetailMatch) {
          const contractorDetailXml = contractorDetailMatch[0];
          console.log('\nДЕТАЛИ КОНТРАГЕНТА:');
          console.log('-'.repeat(100));
          const detailFields = ['name', 'nip', 'street', 'zip', 'city', 'country', 'phone', 'email', 'account_number'];
          detailFields.forEach(field => {
            const value = extractField(contractorDetailXml, field);
            if (value !== null && value !== '') {
              console.log(`  ${field.padEnd(25)}: ${value}`);
            }
          });
        }
        
        // Компания
        const companyDetailMatch = invoiceXml.match(/<company_detail>[\s\S]*?<\/company_detail>/);
        if (companyDetailMatch) {
          const companyDetailXml = companyDetailMatch[0];
          console.log('\nДЕТАЛИ КОМПАНИИ:');
          console.log('-'.repeat(100));
          const companyFields = ['name', 'altname', 'nip', 'street', 'building_number', 'flat_number', 'zip', 'city', 'country', 'phone', 'email', 'bank_name', 'bank_account', 'bank_swift'];
          companyFields.forEach(field => {
            const value = extractField(companyDetailXml, field);
            if (value !== null && value !== '') {
              console.log(`  ${field.padEnd(25)}: ${value}`);
            }
          });
        }
        
        // Продукты (invoicecontents)
        console.log('\nПРОДУКТЫ (invoicecontents):');
        console.log('-'.repeat(100));
        const invoicecontentsMatch = invoiceXml.match(/<invoicecontents>[\s\S]*?<\/invoicecontents>/);
        if (invoicecontentsMatch) {
          const contentsXml = invoicecontentsMatch[0];
          const contentMatches = contentsXml.match(/<invoicecontent>[\s\S]*?<\/invoicecontent>/g);
          
          if (contentMatches) {
            contentMatches.forEach((content, index) => {
              console.log(`\n  Продукт ${index + 1}:`);
              const productFields = ['id', 'name', 'count', 'unit_count', 'price', 'netto', 'brutto', 'discount', 'discount_percent', 'unit', 'classification', 'lumpcode', 'final_account', 'gtu'];
              productFields.forEach(field => {
                const value = extractField(content, field);
                if (value !== null && value !== '') {
                  console.log(`    ${field.padEnd(25)}: ${value}`);
                }
              });
              
              // Good ID
              const goodIdMatch = content.match(/<good>[\s\S]*?<id>(\d+)<\/id>/);
              if (goodIdMatch) {
                console.log(`    ${'good.id'.padEnd(25)}: ${goodIdMatch[1]}`);
              }
              
              // VAT Code
              const vatCodeMatch = content.match(/<vat_code>[\s\S]*?<id>(\d+)<\/id>/);
              if (vatCodeMatch) {
                console.log(`    ${'vat_code.id'.padEnd(25)}: ${vatCodeMatch[1]}`);
              }
            });
          }
        }
        
        // VAT Contents
        console.log('\nVAT CONTENTS:');
        console.log('-'.repeat(100));
        const vatContentsMatch = invoiceXml.match(/<vat_contents>[\s\S]*?<\/vat_contents>/);
        if (vatContentsMatch) {
          const vatContentsXml = vatContentsMatch[0];
          const vatContentMatches = vatContentsXml.match(/<vat_content>[\s\S]*?<\/vat_content>/g);
          
          if (vatContentMatches) {
            vatContentMatches.forEach((vatContent, index) => {
              console.log(`\n  VAT Content ${index + 1}:`);
              const vatFields = ['id', 'object_name', 'object_id', 'netto', 'tax', 'brutto', 'gtu'];
              vatFields.forEach(field => {
                const value = extractField(vatContent, field);
                if (value !== null && value !== '') {
                  console.log(`    ${field.padEnd(25)}: ${value}`);
                }
              });
              
              const vatCodeIdMatch = vatContent.match(/<vat_code>[\s\S]*?<id>(\d+)<\/id>/);
              if (vatCodeIdMatch) {
                console.log(`    ${'vat_code.id'.padEnd(25)}: ${vatCodeIdMatch[1]}`);
              }
            });
          }
        }
        
        // Другие поля (теги с вложенностью)
        console.log('\nДРУГИЕ ПОЛЯ:');
        console.log('-'.repeat(100));
        
        const nestedFields = [
          { tag: 'series', subTag: 'id', name: 'series.id' },
          { tag: 'parent', subTag: 'id', name: 'parent.id' },
          { tag: 'order', subTag: 'id', name: 'order.id' },
          { tag: 'company_account', subTag: 'id', name: 'company_account.id' },
          { tag: 'warehouse', subTag: 'id', name: 'warehouse.id' },
        ];
        
        nestedFields.forEach(({ tag, subTag, name }) => {
          const match = invoiceXml.match(new RegExp(`<${tag}>[\\s\\S]*?<${subTag}>(\\d+)<\\/${subTag}>[\\s\\S]*?<\\/${tag}>`));
          if (match) {
            console.log(`  ${name.padEnd(25)}: ${match[1]}`);
          }
        });
        
        // Tags
        const tagsMatch = extractField(invoiceXml, 'tags');
        if (tagsMatch) {
          console.log(`\n  ${'tags'.padEnd(25)}: ${tagsMatch}`);
        }
        
        // Hash
        const hashMatch = extractField(invoiceXml, 'hash');
        if (hashMatch) {
          console.log(`  ${'hash'.padEnd(25)}: ${hashMatch}`);
        }
        
        console.log('\n' + '='.repeat(100));
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

getProforma6();

