#!/usr/bin/env node

/**
 * Получить полные данные сделки #1675 с детальной информацией о продуктах и скидках
 */

require('dotenv').config();
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const DEAL_ID = 1675;

// Функция для получения информации о скидке из сделки
function getDiscount(deal) {
  const discountFields = [
    'discount',
    'discount_amount',
    'discount_percent',
    'discount_value',
    'rabat',
    'rabat_amount',
    'rabat_percent'
  ];
  
  const foundDiscounts = [];
  
  for (const field of discountFields) {
    if (deal[field] !== null && deal[field] !== undefined && deal[field] !== '') {
      const value = typeof deal[field] === 'number' ? deal[field] : parseFloat(deal[field]);
      if (!isNaN(value) && value > 0) {
        foundDiscounts.push({
          field,
          value,
          type: field.includes('percent') ? 'percent' : 'amount'
        });
      }
    }
  }
  
  return foundDiscounts.length > 0 ? foundDiscounts : null;
}

// Функция для форматирования суммы
function formatAmount(amount) {
  return typeof amount === 'number' ? amount.toFixed(2) : amount;
}

// Функция для вывода всех полей объекта (для отладки)
function printAllFields(obj, prefix = '') {
  if (!obj || typeof obj !== 'object') return;
  
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (value !== null && value !== undefined && value !== '') {
      if (typeof value === 'object' && !Array.isArray(value)) {
        console.log(`${prefix}${key}:`);
        printAllFields(value, prefix + '  ');
      } else {
        console.log(`${prefix}${key}: ${JSON.stringify(value)}`);
      }
    }
  });
}

async function getDealWithProductsAndDiscounts() {
  console.log('🔍 Получение данных сделки #1675 с продуктами и скидками\n');
  console.log('='.repeat(80));
  
  try {
    // Инициализация клиента
    console.log('\n📦 Инициализация Pipedrive клиента...');
    const pipedriveClient = new PipedriveClient();
    
    // 1. Получаем полные данные сделки
    console.log(`\n📥 Получение данных сделки #${DEAL_ID}...`);
    const dealResult = await pipedriveClient.getDealWithRelatedData(DEAL_ID);
    
    if (!dealResult.success) {
      console.error(`❌ Ошибка получения данных сделки: ${dealResult.error}`);
      if (dealResult.details) {
        console.error(`   Детали: ${JSON.stringify(dealResult.details, null, 2)}`);
      }
      process.exit(1);
    }
    
    const deal = dealResult.deal;
    const person = dealResult.person;
    const organization = dealResult.organization;
    
    console.log(`\n✅ Основная информация о сделке:`);
    console.log(`   ID: ${deal.id}`);
    console.log(`   Title: ${deal.title}`);
    console.log(`   Value: ${deal.value} ${deal.currency}`);
    console.log(`   Status: ${deal.status}`);
    console.log(`   Stage ID: ${deal.stage_id}`);
    console.log(`   Expected Close Date: ${deal.expected_close_date || 'N/A'}`);
    console.log(`   Created: ${deal.add_time || 'N/A'}`);
    console.log(`   Updated: ${deal.update_time || 'N/A'}`);
    
    // Проверяем все возможные поля скидок
    console.log(`\n💰 Проверка скидок в сделке:`);
    const discountInfo = getDiscount(deal);
    
    if (discountInfo && discountInfo.length > 0) {
      console.log(`   ✅ Найдено ${discountInfo.length} поле(й) со скидкой:`);
      discountInfo.forEach((disc, index) => {
        console.log(`\n   Скидка ${index + 1}:`);
        console.log(`     Поле: ${disc.field}`);
        console.log(`     Значение: ${disc.value}`);
        console.log(`     Тип: ${disc.type === 'percent' ? 'Процентная' : 'Фиксированная сумма'}`);
        
        if (disc.type === 'percent') {
          const dealValue = parseFloat(deal.value) || 0;
          const discountAmount = Math.round((dealValue * disc.value / 100) * 100) / 100;
          console.log(`     Сумма скидки: ${formatAmount(discountAmount)} ${deal.currency}`);
          console.log(`     Итого с учетом скидки: ${formatAmount(dealValue - discountAmount)} ${deal.currency}`);
        } else {
          const dealValue = parseFloat(deal.value) || 0;
          console.log(`     Итого с учетом скидки: ${formatAmount(dealValue - disc.value)} ${deal.currency}`);
        }
      });
    } else {
      console.log(`   ⚠️  Скидки в сделке не найдены`);
      console.log(`   Проверенные поля: discount, discount_amount, discount_percent, discount_value, rabat, rabat_amount, rabat_percent`);
    }
    
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
    
    // Продукты - ДЕТАЛЬНАЯ ИНФОРМАЦИЯ
    console.log(`\n📦 Продукты сделки (детальная информация):`);
    console.log('='.repeat(80));
    const productsResult = await pipedriveClient.getDealProducts(DEAL_ID);
    
    if (productsResult.success && productsResult.products && productsResult.products.length > 0) {
      const products = productsResult.products;
      console.log(`\n✅ Найдено продуктов: ${products.length}\n`);
      
      products.forEach((product, index) => {
        console.log(`\n${'─'.repeat(80)}`);
        console.log(`📦 Продукт ${index + 1}:`);
        console.log(`${'─'.repeat(80)}`);
        
        // Основная информация о продукте
        const productId = product.product?.id || product.product_id || product.id || 'N/A';
        const productName = product.name || product.product?.name || 'N/A';
        const quantity = parseFloat(product.quantity) || 1;
        const itemPrice = typeof product.item_price === 'number' 
          ? product.item_price 
          : parseFloat(product.item_price) || 0;
        const sum = typeof product.sum === 'number' 
          ? product.sum 
          : parseFloat(product.sum) || 0;
        const unit = product.unit || product.product?.unit || 'N/A';
        
        console.log(`\n   Основная информация:`);
        console.log(`     ID продукта: ${productId}`);
        console.log(`     Название: ${productName}`);
        console.log(`     Количество: ${quantity}`);
        console.log(`     Цена за единицу: ${formatAmount(itemPrice)} ${deal.currency}`);
        console.log(`     Сумма: ${formatAmount(sum)} ${deal.currency}`);
        console.log(`     Единица измерения: ${unit}`);
        
        // Проверяем скидки в продукте
        console.log(`\n   💰 Проверка скидок в продукте:`);
        const productDiscountFields = [
          'discount',
          'discount_amount',
          'discount_percent',
          'discount_value',
          'discount_type',
          'rabat',
          'rabat_amount',
          'rabat_percent'
        ];
        
        const productDiscounts = [];
        productDiscountFields.forEach(field => {
          if (product[field] !== null && product[field] !== undefined && product[field] !== '') {
            const value = typeof product[field] === 'number' ? product[field] : parseFloat(product[field]);
            if (!isNaN(value)) {
              productDiscounts.push({
                field,
                value,
                type: field.includes('percent') ? 'percent' : (field.includes('type') ? 'type' : 'amount')
              });
            }
          }
        });
        
        if (productDiscounts.length > 0) {
          console.log(`     ✅ Найдено ${productDiscounts.length} поле(й) со скидкой:`);
          productDiscounts.forEach((disc, discIndex) => {
            console.log(`\n     Скидка ${discIndex + 1}:`);
            console.log(`       Поле: ${disc.field}`);
            console.log(`       Значение: ${disc.value}`);
            if (disc.type === 'percent') {
              const discountAmount = Math.round((sum * disc.value / 100) * 100) / 100;
              console.log(`       Тип: Процентная`);
              console.log(`       Сумма скидки: ${formatAmount(discountAmount)} ${deal.currency}`);
              console.log(`       Итого с учетом скидки: ${formatAmount(sum - discountAmount)} ${deal.currency}`);
            } else if (disc.type === 'type') {
              console.log(`       Тип скидки: ${disc.value}`);
            } else {
              console.log(`       Тип: Фиксированная сумма`);
              console.log(`       Итого с учетом скидки: ${formatAmount(sum - disc.value)} ${deal.currency}`);
            }
          });
        } else {
          console.log(`     ⚠️  Скидки в продукте не найдены`);
        }
        
        // Выводим все поля продукта для отладки
        console.log(`\n   🔍 Все поля продукта (для отладки):`);
        console.log(`     (показываем только непустые поля)`);
        printAllFields(product, '     ');
        
        // Если есть вложенный объект product, выводим его тоже
        if (product.product && typeof product.product === 'object') {
          console.log(`\n   📋 Детали продукта из каталога:`);
          printAllFields(product.product, '     ');
        }
      });
      
      // Итоговая информация
      console.log(`\n${'─'.repeat(80)}`);
      console.log(`📊 Итоговая информация:`);
      console.log(`${'─'.repeat(80)}`);
      
      const totalProductsSum = products.reduce((sum, p) => {
        const productSum = typeof p.sum === 'number' ? p.sum : parseFloat(p.sum) || 0;
        return sum + productSum;
      }, 0);
      
      console.log(`   Сумма всех продуктов: ${formatAmount(totalProductsSum)} ${deal.currency}`);
      console.log(`   Сумма сделки (deal.value): ${formatAmount(parseFloat(deal.value) || 0)} ${deal.currency}`);
      
      const difference = Math.abs(totalProductsSum - parseFloat(deal.value) || 0);
      if (difference > 0.01) {
        console.log(`   ⚠️  ВНИМАНИЕ: Разница между суммой продуктов и суммой сделки: ${formatAmount(difference)} ${deal.currency}`);
        console.log(`   Это может указывать на наличие скидки на уровне сделки или других корректировок.`);
      } else {
        console.log(`   ✅ Сумма продуктов совпадает с суммой сделки`);
      }
      
    } else {
      console.log(`\n⚠️  Продукты не найдены`);
      if (!productsResult.success) {
        console.log(`   Ошибка: ${productsResult.error}`);
        if (productsResult.details) {
          console.log(`   Детали: ${JSON.stringify(productsResult.details, null, 2)}`);
        }
      }
    }
    
    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Проверка завершена успешно!`);
    console.log(`${'='.repeat(80)}\n`);
    
  } catch (error) {
    console.error(`\n❌ Ошибка при выполнении проверки:`);
    console.error(`   ${error.message}`);
    if (error.stack) {
      console.error(`\n   Stack trace:`);
      console.error(`   ${error.stack}`);
    }
    process.exit(1);
  }
}

// Запуск
getDealWithProductsAndDiscounts();

