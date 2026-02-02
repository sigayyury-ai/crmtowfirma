require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

const DEAL_ID = 2077;

async function getDealProductsAndPrices() {
  console.log(`🔍 Получение информации о продуктах и ценах для сделки #${DEAL_ID}\n`);
  console.log('='.repeat(60));
  
  try {
    // Инициализация сервисов
    console.log('\n📦 Инициализация сервисов...');
    const pipedriveClient = new PipedriveClient();
    
    // 1. Получаем данные сделки из Pipedrive
    console.log(`\n📥 Получение данных сделки #${DEAL_ID} из Pipedrive...`);
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    
    if (!dealResult.success) {
      console.error(`❌ Ошибка получения данных сделки: ${dealResult.error}`);
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const organization = dealResult.organization;
    
    console.log(`\n✅ Данные сделки:`);
    console.log(`   ID: ${deal.id}`);
    console.log(`   Title: ${deal.title}`);
    console.log(`   Value: ${deal.value} ${deal.currency}`);
    console.log(`   Status: ${deal.status}`);
    console.log(`   Stage ID: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'N/A'}`);
    console.log(`   Created: ${deal.add_time || 'N/A'}`);
    console.log(`   Updated: ${deal.update_time || 'N/A'}`);
    
    // Персона
    if (person) {
      console.log(`\n👤 Персона:`);
      console.log(`   ID: ${person.id}`);
      console.log(`   Name: ${person.name || 'N/A'}`);
      console.log(`   Email: ${person.email?.[0]?.value || 'N/A'}`);
      console.log(`   Phone: ${person.phone?.[0]?.value || 'N/A'}`);
    }
    
    // Организация
    if (organization) {
      console.log(`\n🏢 Организация:`);
      console.log(`   ID: ${organization.id}`);
      console.log(`   Name: ${organization.name || 'N/A'}`);
    }
    
    // 2. Получаем продукты сделки из Pipedrive
    console.log(`\n📦 Продукты сделки из Pipedrive:`);
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    if (productsResult.success && productsResult.products) {
      const products = productsResult.products;
      console.log(`   Найдено продуктов: ${products.length}\n`);
      
      products.forEach((product, index) => {
        console.log(`   Продукт ${index + 1}:`);
        console.log(`     Product ID: ${product.product_id || 'N/A'}`);
        console.log(`     Name: ${product.name || 'N/A'}`);
        console.log(`     Quantity: ${product.quantity || 'N/A'}`);
        console.log(`     Item Price: ${product.item_price || 'N/A'} ${deal.currency || 'PLN'}`);
        console.log(`     Sum: ${product.sum || 'N/A'} ${deal.currency || 'PLN'}`);
        console.log(`     Discount: ${product.discount || '0'}%`);
        console.log(`     Discount Amount: ${product.discount_amount || '0'} ${deal.currency || 'PLN'}`);
        console.log(`     Comments: ${product.comments || 'N/A'}`);
        console.log('');
      });
      
      // Итоговая сумма
      const totalSum = products.reduce((sum, p) => {
        const productSum = parseFloat(p.sum) || 0;
        return sum + productSum;
      }, 0);
      console.log(`   💰 Итого по продуктам: ${totalSum} ${deal.currency || 'PLN'}`);
      console.log(`   💰 Сумма сделки: ${deal.value} ${deal.currency || 'PLN'}`);
    } else {
      console.log(`   ⚠️  Продукты не найдены: ${productsResult.error || 'Unknown error'}`);
    }
    
    // 3. Получаем проформу из базы данных
    console.log(`\n💾 Поиск проформы в базе данных...`);
    const { data: proformas, error: proformasError } = await supabase
      .from('proformas')
      .select('*')
      .eq('pipedrive_deal_id', DEAL_ID)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    
    if (proformasError) {
      console.log(`   ⚠️  Ошибка при поиске проформы: ${proformasError.message}`);
    } else if (!proformas || proformas.length === 0) {
      console.log(`   ⚠️  Проформа не найдена для сделки #${DEAL_ID}`);
    } else {
      const proforma = proformas[0];
      console.log(`\n✅ Проформа найдена:`);
      console.log(`   ID: ${proforma.id}`);
      console.log(`   Fullnumber: ${proforma.fullnumber || 'N/A'}`);
      console.log(`   Issued At: ${proforma.issued_at || 'N/A'}`);
      console.log(`   Currency: ${proforma.currency || 'N/A'}`);
      console.log(`   Total: ${proforma.total || 'N/A'} ${proforma.currency || 'PLN'}`);
      console.log(`   Total PLN: ${proforma.total_pln || 'N/A'} PLN`);
      console.log(`   Payments Total: ${proforma.payments_total || 0} ${proforma.currency || 'PLN'}`);
      console.log(`   Payments Total PLN: ${proforma.payments_total_pln || 0} PLN`);
      console.log(`   Payments Count: ${proforma.payments_count || 0}`);
      console.log(`   Buyer Name: ${proforma.buyer_name || 'N/A'}`);
      console.log(`   Buyer Email: ${proforma.buyer_email || 'N/A'}`);
      console.log(`   Status: ${proforma.status || 'N/A'}`);
      
      // 4. Получаем продукты проформы из базы данных
      console.log(`\n📦 Продукты проформы из базы данных:`);
      const { data: proformaProductsData, error: proformaProductsError } = await supabase
        .from('proforma_products')
        .select(`
          id,
          name,
          quantity,
          unit_price,
          line_total,
          product_id,
          products (
            id,
            name,
            normalized_name
          )
        `)
        .eq('proforma_id', proforma.id)
        .order('id', { ascending: true });
      
      if (proformaProductsError) {
        console.log(`   ⚠️  Ошибка при получении продуктов: ${proformaProductsError.message}`);
      } else if (!proformaProductsData || proformaProductsData.length === 0) {
        console.log(`   ⚠️  Продукты не найдены для проформы`);
      } else {
        console.log(`   Найдено продуктов: ${proformaProductsData.length}\n`);
        proformaProductsData.forEach((pp, index) => {
          console.log(`   Продукт ${index + 1}:`);
          console.log(`     ID: ${pp.id}`);
          console.log(`     Name: ${pp.name || 'N/A'}`);
          console.log(`     Quantity: ${pp.quantity || 'N/A'}`);
          console.log(`     Unit Price: ${pp.unit_price || 'N/A'} ${proforma.currency || 'PLN'}`);
          console.log(`     Line Total: ${pp.line_total || 'N/A'} ${proforma.currency || 'PLN'}`);
          if (pp.product_id) {
            console.log(`     Product ID: ${pp.product_id}`);
          }
          if (pp.products) {
            console.log(`     Product Name: ${pp.products.name || 'N/A'}`);
            console.log(`     Normalized Name: "${pp.products.normalized_name || 'N/A'}"`);
          }
          console.log('');
        });
        
        // Итоговая сумма продуктов
        const totalProductsSum = proformaProductsData.reduce((sum, pp) => {
          const lineTotal = parseFloat(pp.line_total) || 0;
          return sum + lineTotal;
        }, 0);
        console.log(`   💰 Итого по продуктам проформы: ${totalProductsSum} ${proforma.currency || 'PLN'}`);
        console.log(`   💰 Сумма проформы: ${proforma.total || 'N/A'} ${proforma.currency || 'PLN'}`);
      }
      
      // 5. Получаем платежи для этой проформы
      console.log(`\n💳 Платежи для проформы:`);
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('payments')
        .select('*')
        .or(`proforma_id.eq.${proforma.id},manual_proforma_id.eq.${proforma.id},proforma_fullnumber.eq.${proforma.fullnumber}`)
        .is('deleted_at', null)
        .order('operation_date', { ascending: false });
      
      if (paymentsError) {
        console.log(`   ⚠️  Ошибка при получении платежей: ${paymentsError.message}`);
      } else if (!paymentsData || paymentsData.length === 0) {
        console.log(`   ⚠️  Платежи не найдены`);
      } else {
        console.log(`   Найдено платежей: ${paymentsData.length}\n`);
        paymentsData.forEach((payment, index) => {
          console.log(`   Платеж ${index + 1}:`);
          console.log(`     ID: ${payment.id}`);
          console.log(`     Date: ${payment.operation_date || 'N/A'}`);
          console.log(`     Amount: ${payment.amount || 'N/A'} ${payment.currency || 'PLN'}`);
          console.log(`     Description: ${payment.description || 'N/A'}`);
          console.log(`     Payer: ${payment.payer_name || 'N/A'}`);
          console.log(`     Source: ${payment.source || 'N/A'}`);
          console.log(`     Manual Status: ${payment.manual_status || 'N/A'}`);
          console.log(`     Match Status: ${payment.match_status || 'N/A'}`);
          console.log('');
        });
      }
    }
    
    console.log(`\n✅ Проверка завершена успешно!`);
    
  } catch (error) {
    console.error(`\n❌ Ошибка при выполнении проверки:`);
    console.error(`   ${error.message}`);
    console.error(`   ${error.stack}`);
    process.exit(1);
  }
}

// Запуск
getDealProductsAndPrices();
