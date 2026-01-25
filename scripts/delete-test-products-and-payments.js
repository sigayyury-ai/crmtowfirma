#!/usr/bin/env node

/**
 * Скрипт для удаления тестовых продуктов и Stripe платежей из базы данных
 * 
 * Удаляет:
 * - Тестовые продукты (с названиями содержащими test, demo, TEST_AUTO_ и т.д.)
 * - Тестовые Stripe платежи (с session_id начинающимся с cs_test_)
 * - Связанные данные (payment_product_links, proforma_products)
 * 
 * ВАЖНО: Перед удалением показывает список что будет удалено и требует подтверждения
 * 
 * Использование:
 *   node scripts/delete-test-products-and-payments.js [--confirm]
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');
const readline = require('readline');

// Паттерны для поиска тестовых данных (те же что в find-test-products-and-payments.js)
const TEST_PATTERNS = {
  products: [
    'test',
    'тест',
    'TEST_AUTO_',
    'demo',
    'демо',
    'sample',
    'пример',
    'проверка',
    'trial',
    'temporary'
  ],
  stripeSessions: /^cs_test_/
};

// Проверяем флаг --confirm для автоматического подтверждения
const autoConfirm = process.argv.includes('--confirm') || process.argv.includes('-y');

let rl = null;
if (!autoConfirm) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function ask(question) {
  if (autoConfirm) {
    console.log(question + ' (auto: yes)');
    return Promise.resolve('yes');
  }
  return new Promise(resolve => rl.question(question, resolve));
}

async function findTestProducts() {
  logger.info('🔍 Поиск тестовых продуктов...');
  
  try {
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, normalized_name, calculation_status, created_at')
      .order('id');

    if (error) {
      logger.error('Ошибка при получении продуктов:', error);
      return [];
    }

    const testProducts = products.filter(product => {
      const name = (product.name || '').toLowerCase();
      const normalizedName = (product.normalized_name || '').toLowerCase();
      
      return TEST_PATTERNS.products.some(pattern => 
        name.includes(pattern.toLowerCase()) || 
        normalizedName.includes(pattern.toLowerCase())
      );
    });

    logger.info(`Найдено тестовых продуктов: ${testProducts.length}`);
    return testProducts;
  } catch (error) {
    logger.error('Ошибка при поиске тестовых продуктов:', error);
    return [];
  }
}

async function findTestStripePayments() {
  logger.info('🔍 Поиск тестовых Stripe платежей...');
  
  try {
    const { data: payments, error } = await supabase
      .from('stripe_payments')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('Ошибка при получении Stripe платежей:', error);
      return [];
    }

    const testPayments = payments.filter(payment => {
      if (payment.session_id && TEST_PATTERNS.stripeSessions.test(payment.session_id)) {
        return true;
      }
      
      const customerName = (payment.customer_name || '').toLowerCase();
      const customerEmail = (payment.customer_email || '').toLowerCase();
      const companyName = (payment.company_name || '').toLowerCase();
      
      return TEST_PATTERNS.products.some(pattern => 
        customerName.includes(pattern.toLowerCase()) || 
        customerEmail.includes(pattern.toLowerCase()) ||
        companyName.includes(pattern.toLowerCase())
      );
    });

    logger.info(`Найдено тестовых Stripe платежей: ${testPayments.length}`);
    return testPayments;
  } catch (error) {
    logger.error('Ошибка при поиске тестовых Stripe платежей:', error);
    return [];
  }
}

async function findTestStripeEventData() {
  logger.info('🔍 Поиск тестовых данных в Stripe event таблицах...');
  
  const eventData = {
    eventItems: [],
    eventSummary: [],
    eventParticipants: []
  };

  try {
    // Ищем тестовые stripe_event_items
    const { data: eventItems, error: itemsError } = await supabase
      .from('stripe_event_items')
      .select('id, session_id, event_key, event_label, customer_email, customer_name')
      .limit(10000);

    if (!itemsError && eventItems) {
      eventData.eventItems = eventItems.filter(item => {
        return isTestData(item.event_key) || 
               isTestData(item.event_label) || 
               isTestData(item.customer_email) ||
               isTestData(item.customer_name) ||
               (item.session_id && TEST_PATTERNS.stripeSessions.test(item.session_id));
      });
    }

    // Ищем тестовые stripe_event_summary
    const { data: eventSummary, error: summaryError } = await supabase
      .from('stripe_event_summary')
      .select('event_key, event_label')
      .limit(1000);

    if (!summaryError && eventSummary) {
      eventData.eventSummary = eventSummary.filter(item => {
        return isTestData(item.event_key) || isTestData(item.event_label);
      });
    }

    // Ищем тестовые stripe_event_participants
    const { data: eventParticipants, error: participantsError } = await supabase
      .from('stripe_event_participants')
      .select('id, event_key, email, display_name')
      .limit(10000);

    if (!participantsError && eventParticipants) {
      eventData.eventParticipants = eventParticipants.filter(item => {
        return isTestData(item.email) || isTestData(item.display_name);
      });
    }

    logger.info(`Найдено тестовых event items: ${eventData.eventItems.length}`);
    logger.info(`Найдено тестовых event summary: ${eventData.eventSummary.length}`);
    logger.info(`Найдено тестовых event participants: ${eventData.eventParticipants.length}`);

    return eventData;
  } catch (error) {
    logger.error('Ошибка при поиске тестовых Stripe event данных:', error);
    return eventData;
  }
}

function isTestData(value) {
  if (!value) return false;
  const lowerValue = String(value).toLowerCase();
  return TEST_PATTERNS.products.some(pattern => lowerValue.includes(pattern.toLowerCase()));
}

async function findRelatedData(testProducts, testPayments) {
  logger.info('🔍 Поиск связанных данных...');
  
  const relatedData = {
    paymentProductLinks: [],
    proformaProducts: [],
    stripeEventItems: []
  };

  try {
    // Находим связи через payment_product_links
    if (testProducts.length > 0) {
      const productIds = testProducts.map(p => p.id);
      
      const { data: paymentLinks, error: linksError } = await supabase
        .from('payment_product_links')
        .select('id, payment_id, product_id, linked_at')
        .in('product_id', productIds);

      if (!linksError && paymentLinks) {
        relatedData.paymentProductLinks.push(...paymentLinks);
      }

      // Находим связи через proforma_products
      const { data: proformaProducts, error: proformaError } = await supabase
        .from('proforma_products')
        .select('id, proforma_id, product_id')
        .in('product_id', productIds);

      if (!proformaError && proformaProducts) {
        relatedData.proformaProducts = proformaProducts;
      }
    }

    // Находим связи Stripe платежей с продуктами
    if (testPayments.length > 0) {
      const paymentIds = testPayments.map(p => p.id);
      
      const { data: stripePaymentLinks, error: stripeLinksError } = await supabase
        .from('payment_product_links')
        .select('id, payment_id, product_id, linked_at')
        .in('payment_id', paymentIds);

      if (!stripeLinksError && stripePaymentLinks) {
        // Добавляем только новые связи (не дублируем)
        const existingIds = new Set(relatedData.paymentProductLinks.map(l => l.id));
        relatedData.paymentProductLinks.push(
          ...stripePaymentLinks.filter(l => !existingIds.has(l.id))
        );
      }

      // Находим связанные stripe_event_items (если есть такая таблица)
      const sessionIds = testPayments.map(p => p.session_id).filter(Boolean);
      if (sessionIds.length > 0) {
        const { data: eventItems, error: eventItemsError } = await supabase
          .from('stripe_event_items')
          .select('id, session_id, event_key')
          .in('session_id', sessionIds);

        if (!eventItemsError && eventItems) {
          relatedData.stripeEventItems = eventItems;
        }
      }
    }

    return relatedData;
  } catch (error) {
    logger.error('Ошибка при поиске связанных данных:', error);
    return relatedData;
  }
}

function printSummary(testProducts, testPayments, relatedData, eventData) {
  console.log('\n' + '='.repeat(80));
  console.log('📊 СВОДКА ДАННЫХ ДЛЯ УДАЛЕНИЯ');
  console.log('='.repeat(80));

  console.log(`\n📦 Тестовых продуктов: ${testProducts.length}`);
  if (testProducts.length > 0) {
    testProducts.forEach((p, i) => {
      console.log(`   ${i + 1}. ID: ${p.id} - "${p.name || 'Нет названия'}"`);
    });
  }

  console.log(`\n💳 Тестовых Stripe платежей: ${testPayments.length}`);
  if (testPayments.length > 0) {
    const paidCount = testPayments.filter(p => p.payment_status === 'paid').length;
    const unpaidCount = testPayments.length - paidCount;
    console.log(`   Оплаченных: ${paidCount}, Неоплаченных: ${unpaidCount}`);
    testPayments.slice(0, 5).forEach((p, i) => {
      console.log(`   ${i + 1}. Session: ${p.session_id?.substring(0, 30)}... | Deal: ${p.deal_id || 'N/A'}`);
    });
    if (testPayments.length > 5) {
      console.log(`   ... и еще ${testPayments.length - 5} платежей`);
    }
  }

  console.log(`\n🔗 Связанные данные:`);
  console.log(`   Связи payment_product_links: ${relatedData.paymentProductLinks.length}`);
  console.log(`   Связи proforma_products: ${relatedData.proformaProducts.length}`);
  console.log(`   Stripe event items (связанные): ${relatedData.stripeEventItems.length}`);

  console.log(`\n📊 Тестовые Stripe event данные:`);
  console.log(`   Stripe event items: ${eventData.eventItems.length}`);
  console.log(`   Stripe event summary: ${eventData.eventSummary.length}`);
  console.log(`   Stripe event participants: ${eventData.eventParticipants.length}`);

  const totalRecords = testProducts.length + testPayments.length + 
    relatedData.paymentProductLinks.length + relatedData.proformaProducts.length +
    relatedData.stripeEventItems.length +
    eventData.eventItems.length + eventData.eventSummary.length + eventData.eventParticipants.length;

  console.log(`\n📈 ВСЕГО записей для удаления: ${totalRecords}`);
  console.log('='.repeat(80) + '\n');
}

async function deleteRelatedData(relatedData, eventData) {
  logger.info('🗑️  Удаление связанных данных...');
  
  let deleted = 0;
  let errors = 0;

  // Удаляем payment_product_links
  if (relatedData.paymentProductLinks.length > 0) {
    const linkIds = relatedData.paymentProductLinks.map(l => l.id);
    const { error } = await supabase
      .from('payment_product_links')
      .delete()
      .in('id', linkIds);

    if (error) {
      logger.error('Ошибка при удалении payment_product_links:', error);
      errors++;
    } else {
      deleted += linkIds.length;
      logger.info(`Удалено payment_product_links: ${linkIds.length}`);
    }
  }

  // Удаляем proforma_products
  if (relatedData.proformaProducts.length > 0) {
    const proformaProductIds = relatedData.proformaProducts.map(p => p.id);
    const { error } = await supabase
      .from('proforma_products')
      .delete()
      .in('id', proformaProductIds);

    if (error) {
      logger.error('Ошибка при удалении proforma_products:', error);
      errors++;
    } else {
      deleted += proformaProductIds.length;
      logger.info(`Удалено proforma_products: ${proformaProductIds.length}`);
    }
  }

  // stripe_event_items удалятся автоматически через CASCADE при удалении stripe_payments
  // Но можем удалить вручную для ясности
  if (relatedData.stripeEventItems.length > 0) {
    const eventItemIds = relatedData.stripeEventItems.map(e => e.id);
    const { error } = await supabase
      .from('stripe_event_items')
      .delete()
      .in('id', eventItemIds);

    if (error) {
      // Это не критично, так как они удалятся через CASCADE
      logger.warn('Предупреждение при удалении stripe_event_items (возможно удалятся автоматически):', error.message);
    } else {
      deleted += eventItemIds.length;
      logger.info(`Удалено stripe_event_items: ${eventItemIds.length}`);
    }
  }

  // Удаляем тестовые stripe_event_items (независимо от платежей)
  if (eventData.eventItems.length > 0) {
    const eventItemIds = eventData.eventItems.map(e => e.id);
    const { error } = await supabase
      .from('stripe_event_items')
      .delete()
      .in('id', eventItemIds);

    if (error) {
      logger.error('Ошибка при удалении тестовых stripe_event_items:', error);
      errors++;
    } else {
      deleted += eventItemIds.length;
      logger.info(`Удалено тестовых stripe_event_items: ${eventItemIds.length}`);
    }
  }

  // Удаляем тестовые stripe_event_summary
  if (eventData.eventSummary.length > 0) {
    const eventKeys = eventData.eventSummary.map(e => e.event_key);
    const { error } = await supabase
      .from('stripe_event_summary')
      .delete()
      .in('event_key', eventKeys);

    if (error) {
      logger.error('Ошибка при удалении stripe_event_summary:', error);
      errors++;
    } else {
      deleted += eventKeys.length;
      logger.info(`Удалено stripe_event_summary: ${eventKeys.length}`);
    }
  }

  // Удаляем тестовые stripe_event_participants
  if (eventData.eventParticipants.length > 0) {
    const participantIds = eventData.eventParticipants.map(e => e.id);
    const { error } = await supabase
      .from('stripe_event_participants')
      .delete()
      .in('id', participantIds);

    if (error) {
      logger.error('Ошибка при удалении stripe_event_participants:', error);
      errors++;
    } else {
      deleted += participantIds.length;
      logger.info(`Удалено stripe_event_participants: ${participantIds.length}`);
    }
  }

  return { deleted, errors };
}

async function deleteStripePayments(testPayments) {
  logger.info('🗑️  Удаление тестовых Stripe платежей...');
  
  if (testPayments.length === 0) {
    return { deleted: 0, errors: 0 };
  }

  let deleted = 0;
  let errors = 0;

  // Удаляем по session_id (более надежно чем по id)
  const sessionIds = testPayments.map(p => p.session_id).filter(Boolean);
  
  if (sessionIds.length > 0) {
    // Удаляем батчами по 100 для избежания проблем с большими запросами
    const batchSize = 100;
    for (let i = 0; i < sessionIds.length; i += batchSize) {
      const batch = sessionIds.slice(i, i + batchSize);
      const { error } = await supabase
        .from('stripe_payments')
        .delete()
        .in('session_id', batch);

      if (error) {
        logger.error(`Ошибка при удалении батча Stripe платежей (${i}-${i + batch.length}):`, error);
        errors++;
      } else {
        deleted += batch.length;
      }
    }
  }

  // Удаляем платежи без session_id по id
  const paymentsWithoutSession = testPayments.filter(p => !p.session_id);
  if (paymentsWithoutSession.length > 0) {
    const paymentIds = paymentsWithoutSession.map(p => p.id);
    const { error } = await supabase
      .from('stripe_payments')
      .delete()
      .in('id', paymentIds);

    if (error) {
      logger.error('Ошибка при удалении Stripe платежей без session_id:', error);
      errors++;
    } else {
      deleted += paymentIds.length;
    }
  }

  logger.info(`Удалено Stripe платежей: ${deleted}, ошибок: ${errors}`);
  return { deleted, errors };
}

async function deleteProducts(testProducts) {
  logger.info('🗑️  Удаление тестовых продуктов...');
  
  if (testProducts.length === 0) {
    return { deleted: 0, errors: 0 };
  }

  let deleted = 0;
  let errors = 0;

  const productIds = testProducts.map(p => p.id);
  
  // Удаляем батчами
  const batchSize = 100;
  for (let i = 0; i < productIds.length; i += batchSize) {
    const batch = productIds.slice(i, i + batchSize);
    const { error } = await supabase
      .from('products')
      .delete()
      .in('id', batch);

    if (error) {
      logger.error(`Ошибка при удалении батча продуктов (${i}-${i + batch.length}):`, error);
      errors++;
    } else {
      deleted += batch.length;
      logger.info(`Удалено продуктов: ${batch.length} (батч ${Math.floor(i / batchSize) + 1})`);
    }
  }

  logger.info(`Удалено продуктов: ${deleted}, ошибок: ${errors}`);
  return { deleted, errors };
}

async function main() {
  try {
    if (!supabase) {
      logger.error('❌ Supabase client is not initialized.');
      process.exit(1);
    }

    console.log('\n🔍 Поиск тестовых данных для удаления...\n');

    // Находим тестовые данные
    const [testProducts, testPayments, eventData] = await Promise.all([
      findTestProducts(),
      findTestStripePayments(),
      findTestStripeEventData()
    ]);

    // Находим связанные данные
    const relatedData = await findRelatedData(testProducts, testPayments);

    // Проверяем есть ли что удалять
    const hasDataToDelete = testProducts.length > 0 || 
                            testPayments.length > 0 || 
                            eventData.eventItems.length > 0 ||
                            eventData.eventSummary.length > 0 ||
                            eventData.eventParticipants.length > 0 ||
                            relatedData.paymentProductLinks.length > 0 ||
                            relatedData.proformaProducts.length > 0 ||
                            relatedData.stripeEventItems.length > 0;

    if (!hasDataToDelete) {
      console.log('✅ Тестовых данных не найдено. Нечего удалять.\n');
      if (rl) rl.close();
      return;
    }

    // Показываем сводку
    printSummary(testProducts, testPayments, relatedData, eventData);

    // Запрашиваем подтверждение
    if (!autoConfirm) {
      console.log('⚠️  ВНИМАНИЕ: Это действие необратимо!');
      console.log('   Все перечисленные выше данные будут удалены из базы данных.\n');
    }

    const confirm = await ask('Продолжить удаление? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('❌ Удаление отменено.\n');
      if (rl) rl.close();
      return;
    }

    console.log('\n🚀 Начинаем удаление...\n');

    // Удаляем в правильном порядке
    // 1. Связанные данные и event данные
    const relatedResult = await deleteRelatedData(relatedData, eventData);
    
    // 2. Stripe платежи
    const paymentsResult = await deleteStripePayments(testPayments);
    
    // 3. Продукты (в последнюю очередь)
    const productsResult = await deleteProducts(testProducts);

    // Итоги
    console.log('\n' + '='.repeat(80));
    console.log('✅ УДАЛЕНИЕ ЗАВЕРШЕНО');
    console.log('='.repeat(80));
    console.log(`Связанные данные и event данные: ${relatedResult.deleted} удалено, ${relatedResult.errors} ошибок`);
    console.log(`Stripe платежи: ${paymentsResult.deleted} удалено, ${paymentsResult.errors} ошибок`);
    console.log(`Продукты: ${productsResult.deleted} удалено, ${productsResult.errors} ошибок`);
    
    const totalDeleted = relatedResult.deleted + paymentsResult.deleted + productsResult.deleted;
    const totalErrors = relatedResult.errors + paymentsResult.errors + productsResult.errors;
    
    console.log(`\n📊 ВСЕГО: ${totalDeleted} записей удалено, ${totalErrors} ошибок`);
    console.log('='.repeat(80) + '\n');

    if (totalErrors > 0) {
      console.log('⚠️  Были ошибки при удалении. Проверьте логи для деталей.\n');
    }

  } catch (error) {
    logger.error('❌ Критическая ошибка при удалении тестовых данных', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Критическая ошибка:', error.message);
    if (rl) rl.close();
    process.exit(1);
  } finally {
    if (rl) rl.close();
  }
}

main();

