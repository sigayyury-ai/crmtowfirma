require('dotenv').config();
const { getMonthlyProformasByProduct } = require('./src/services/vatMargin/wfirmaLookup');

async function testMonthlyProformas() {
  console.log('🧪 Тестирование получения проформ текущего месяца...\n');
  
  try {
    const result = await getMonthlyProformasByProduct();
    
    console.log('✅ Успешно получены данные:\n');
    console.log(`Всего продуктов: ${result.length}\n`);
    
    if (result.length === 0) {
      console.log('⚠️  Проформы за текущий месяц не найдены');
      return;
    }
    
    // Выводим таблицу в консоль
    console.log('┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log('│ Название продукта                          │ Кол-во │ Сумма      │ Валюта │');
    console.log('├─────────────────────────────────────────────────────────────────────────────┤');
    
    result.forEach((item) => {
      const productName = (item.productName || 'Без названия').substring(0, 40);
      const count = item.count.toString().padStart(6);
      const amount = item.totalAmount.toFixed(2).padStart(10);
      const currency = (item.currency || 'PLN').padStart(6);
      
      console.log(`│ ${productName.padEnd(40)} │ ${count} │ ${amount} │ ${currency} │`);
    });
    
    console.log('└─────────────────────────────────────────────────────────────────────────────┘\n');
    
    // Выводим детали первой записи
    if (result.length > 0) {
      const firstItem = result[0];
      console.log('📋 Детали первой записи:');
      console.log(`   Продукт: ${firstItem.productName}`);
      console.log(`   Количество проформ: ${firstItem.count}`);
      console.log(`   Общая сумма: ${firstItem.totalAmount.toFixed(2)} ${firstItem.currency}`);
      console.log(`   Проформы: ${firstItem.invoices.length}`);
      if (firstItem.invoices.length > 0) {
        console.log('   Примеры проформ:');
        firstItem.invoices.slice(0, 3).forEach((inv) => {
          console.log(`     - ${inv.number}: ${inv.amount.toFixed(2)} ${firstItem.currency}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Ошибка при получении проформ:', error.message);
    console.error('Stack:', error.stack);
  }
}

testMonthlyProformas();

