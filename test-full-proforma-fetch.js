require('dotenv').config();
const { WfirmaLookup } = require('./src/services/vatMargin/wfirmaLookup');

async function testFullProformaFetch() {
  try {
    console.log('🔍 Testing full proforma fetch logic...\n');
    
    const lookup = new WfirmaLookup();
    
    // Получаем все проформы
    const result = await lookup.getMonthlyProformasByProduct({});
    
    console.log(`\n✅ Результат: найдено ${result.length} продуктов\n`);
    
    if (result.length > 0) {
      result.forEach((item, index) => {
        console.log(`${index + 1}. ${item.productName} (${item.currency})`);
        console.log(`   Количество проформ: ${item.count}`);
        console.log(`   Общая сумма: ${item.totalAmount} ${item.currency}`);
        console.log(`   Проформы: ${item.invoices.map(inv => inv.number || inv.fullnumber).join(', ')}`);
        console.log('');
      });
    } else {
      console.log('❌ Проформы не найдены');
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testFullProformaFetch();

