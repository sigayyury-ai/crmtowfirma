#!/usr/bin/env node

/**
 * Скрипт для удаления всех тестовых данных из CRM (Pipedrive)
 * 
 * Удаляет:
 * - Сделки с названием, начинающимся с "TEST_AUTO_"
 * - Продукты с названием, начинающимся с "TEST_AUTO_"
 * - Контакты с именем, начинающимся с "TEST_AUTO_"
 * - Задачи (tasks), связанные с тестовыми сделками или имеющие в subject/note "TEST_AUTO_"
 * 
 * ВАЖНО: Этот скрипт удаляет только тестовые данные, помеченные префиксом TEST_AUTO_
 * 
 * Использование:
 *   node scripts/cleanup-test-data-from-crm.js
 * 
 * Для безопасного запуска с подтверждением:
 *   node scripts/cleanup-test-data-from-crm.js --confirm
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

const TEST_PREFIX = 'TEST_AUTO_';

async function findTestDeals(pipedriveClient) {
  logger.info('Searching for test deals...');
  
  const deals = [];
  let start = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const result = await pipedriveClient.getDeals({
        start,
        limit,
        status: 'all' // Include all deals (open, won, lost)
      });

      if (result.success && result.deals) {
        const testDeals = result.deals.filter(deal => 
          deal.title && deal.title.startsWith(TEST_PREFIX)
        );
        deals.push(...testDeals);
        
        hasMore = result.deals.length === limit;
        start += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      logger.error('Error searching for test deals', { error: error.message });
      hasMore = false;
    }
  }

  logger.info(`Found ${deals.length} test deals`);
  return deals;
}

async function findTestProducts(pipedriveClient) {
  logger.info('Searching for test products...');
  
  // Pipedrive API doesn't have a direct search for products by name
  // We'll need to list all products and filter
  const products = [];
  let start = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await pipedriveClient.client.get('/products', {
        params: {
          api_token: pipedriveClient.apiToken,
          start,
          limit
        }
      });

      if (response.data?.success && response.data?.data) {
        const testProducts = response.data.data.filter(product => 
          product.name && product.name.startsWith(TEST_PREFIX)
        );
        products.push(...testProducts);
        
        hasMore = response.data.data.length === limit;
        start += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      logger.error('Error searching for test products', { error: error.message });
      hasMore = false;
    }
  }

  logger.info(`Found ${products.length} test products`);
  return products;
}

async function findTestPersons(pipedriveClient) {
  logger.info('Searching for test persons...');
  
  const persons = [];
  let start = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const response = await pipedriveClient.client.get('/persons', {
        params: {
          api_token: pipedriveClient.apiToken,
          start,
          limit
        }
      });

      if (response.data?.success && response.data?.data) {
        const testPersons = response.data.data.filter(person => 
          person.name && person.name.startsWith(TEST_PREFIX)
        );
        persons.push(...testPersons);
        
        hasMore = response.data.data.length === limit;
        start += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      logger.error('Error searching for test persons', { error: error.message });
      hasMore = false;
    }
  }

  logger.info(`Found ${persons.length} test persons`);
  return persons;
}

async function deleteTestDeals(pipedriveClient, deals) {
  logger.info(`Deleting ${deals.length} test deals...`);
  
  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const deal of deals) {
    try {
      const result = await pipedriveClient.deleteDeal(deal.id);
      if (result.success) {
        deleted++;
        logger.info(`Deleted test deal: ${deal.title} (ID: ${deal.id})`);
      } else {
        failed++;
        errors.push({ id: deal.id, title: deal.title, error: result.error });
        logger.warn(`Failed to delete deal ${deal.id}: ${result.error}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id: deal.id, title: deal.title, error: error.message });
      logger.error(`Error deleting deal ${deal.id}`, { error: error.message });
    }
  }

  return { deleted, failed, errors };
}

async function deleteTestProducts(pipedriveClient, products) {
  logger.info(`Deleting ${products.length} test products...`);
  
  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const product of products) {
    try {
      const response = await pipedriveClient.client.delete(`/products/${product.id}`, {
        params: {
          api_token: pipedriveClient.apiToken
        }
      });

      if (response.data?.success) {
        deleted++;
        logger.info(`Deleted test product: ${product.name} (ID: ${product.id})`);
      } else {
        failed++;
        errors.push({ id: product.id, name: product.name, error: response.data?.error || 'Unknown error' });
        logger.warn(`Failed to delete product ${product.id}: ${response.data?.error}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id: product.id, name: product.name, error: error.message });
      logger.error(`Error deleting product ${product.id}`, { error: error.message });
    }
  }

  return { deleted, failed, errors };
}

async function deleteTestPersons(pipedriveClient, persons) {
  logger.info(`Deleting ${persons.length} test persons...`);
  
  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const person of persons) {
    try {
      const response = await pipedriveClient.client.delete(`/persons/${person.id}`, {
        params: {
          api_token: pipedriveClient.apiToken
        }
      });

      if (response.data?.success) {
        deleted++;
        logger.info(`Deleted test person: ${person.name} (ID: ${person.id})`);
      } else {
        failed++;
        errors.push({ id: person.id, name: person.name, error: response.data?.error || 'Unknown error' });
        logger.warn(`Failed to delete person ${person.id}: ${response.data?.error}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id: person.id, name: person.name, error: error.message });
      logger.error(`Error deleting person ${person.id}`, { error: error.message });
    }
  }

  return { deleted, failed, errors };
}

async function findTestTasks(pipedriveClient, testDealIds) {
  logger.info('Searching for test tasks...');
  
  const testTasks = [];
  const testDealIdsSet = new Set(testDealIds.map(id => String(id)));
  
  // Get all tasks and filter by:
  // 1. Tasks linked to test deals
  // 2. Tasks with TEST_AUTO_ in subject or note
  let start = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const result = await pipedriveClient.getActivities({
        start,
        limit,
        type: 'task'
      });

      if (result.success && result.activities) {
        const filtered = result.activities.filter(task => {
          // Check if task is linked to a test deal
          const dealId = task.deal_id ? String(task.deal_id) : null;
          if (dealId && testDealIdsSet.has(dealId)) {
            return true;
          }
          
          // Check if task subject or note contains TEST_AUTO_
          const subject = task.subject || '';
          const note = task.note || task.public_description || '';
          if (subject.includes(TEST_PREFIX) || note.includes(TEST_PREFIX)) {
            return true;
          }
          
          return false;
        });
        
        testTasks.push(...filtered);
        
        hasMore = result.activities.length === limit;
        start += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      logger.error('Error searching for test tasks', { error: error.message });
      hasMore = false;
    }
  }

  logger.info(`Found ${testTasks.length} test tasks`);
  return testTasks;
}

async function deleteTestTasks(pipedriveClient, tasks) {
  logger.info(`Deleting ${tasks.length} test tasks...`);
  
  let deleted = 0;
  let failed = 0;
  const errors = [];

  for (const task of tasks) {
    try {
      const result = await pipedriveClient.deleteActivity(task.id);
      if (result.success) {
        deleted++;
        logger.info(`Deleted test task: ${task.subject || 'No subject'} (ID: ${task.id})`);
      } else {
        failed++;
        errors.push({ id: task.id, subject: task.subject, error: result.error });
        logger.warn(`Failed to delete task ${task.id}: ${result.error}`);
      }
    } catch (error) {
      failed++;
      errors.push({ id: task.id, subject: task.subject, error: error.message });
      logger.error(`Error deleting task ${task.id}`, { error: error.message });
    }
  }

  return { deleted, failed, errors };
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');

  logger.info('🧹 Starting cleanup of test data from CRM');
  logger.info(`Test prefix: ${TEST_PREFIX}`);

  if (!confirm) {
    console.log('\n⚠️  WARNING: This script will delete all test data from Pipedrive CRM!');
    console.log(`   Looking for items with prefix: "${TEST_PREFIX}"`);
    console.log('\n   To proceed, run with --confirm flag:');
    console.log('   node scripts/cleanup-test-data-from-crm.js --confirm\n');
    process.exit(0);
  }

  try {
    const pipedriveClient = new PipedriveClient();

    // Find all test data
    const [testDeals, testProducts, testPersons] = await Promise.all([
      findTestDeals(pipedriveClient),
      findTestProducts(pipedriveClient),
      findTestPersons(pipedriveClient)
    ]);

    // Find test tasks (after we have test deal IDs)
    const testDealIds = testDeals.map(d => d.id);
    const testTasks = await findTestTasks(pipedriveClient, testDealIds);

    console.log('\n📊 Test Data Summary:');
    console.log(`   Deals: ${testDeals.length}`);
    console.log(`   Products: ${testProducts.length}`);
    console.log(`   Persons: ${testPersons.length}`);
    console.log(`   Tasks: ${testTasks.length}`);
    console.log(`   Total: ${testDeals.length + testProducts.length + testPersons.length + testTasks.length}\n`);

    if (testDeals.length === 0 && testProducts.length === 0 && testPersons.length === 0 && testTasks.length === 0) {
      logger.info('✅ No test data found. Nothing to clean up.');
      return;
    }

    // Delete all test data
    // Delete tasks first (before deals, as tasks are linked to deals)
    const tasksResult = await deleteTestTasks(pipedriveClient, testTasks);
    
    // Then delete deals, products, and persons
    const [dealsResult, productsResult, personsResult] = await Promise.all([
      deleteTestDeals(pipedriveClient, testDeals),
      deleteTestProducts(pipedriveClient, testProducts),
      deleteTestPersons(pipedriveClient, testPersons)
    ]);

    // Summary
    console.log('\n📊 Cleanup Summary:');
    console.log(`   Tasks: ${tasksResult.deleted} deleted, ${tasksResult.failed} failed`);
    console.log(`   Deals: ${dealsResult.deleted} deleted, ${dealsResult.failed} failed`);
    console.log(`   Products: ${productsResult.deleted} deleted, ${productsResult.failed} failed`);
    console.log(`   Persons: ${personsResult.deleted} deleted, ${personsResult.failed} failed`);
    
    const totalDeleted = tasksResult.deleted + dealsResult.deleted + productsResult.deleted + personsResult.deleted;
    const totalFailed = tasksResult.failed + dealsResult.failed + productsResult.failed + personsResult.failed;

    console.log(`\n   Total: ${totalDeleted} deleted, ${totalFailed} failed\n`);

    if (totalFailed > 0) {
      console.log('⚠️  Some items failed to delete. Check logs for details.');
      if (tasksResult.errors.length > 0) {
        console.log('\n   Failed Tasks:');
        tasksResult.errors.forEach(e => console.log(`     - ${e.subject || 'No subject'} (ID: ${e.id}): ${e.error}`));
      }
      if (dealsResult.errors.length > 0) {
        console.log('\n   Failed Deals:');
        dealsResult.errors.forEach(e => console.log(`     - ${e.title} (ID: ${e.id}): ${e.error}`));
      }
      if (productsResult.errors.length > 0) {
        console.log('\n   Failed Products:');
        productsResult.errors.forEach(e => console.log(`     - ${e.name} (ID: ${e.id}): ${e.error}`));
      }
      if (personsResult.errors.length > 0) {
        console.log('\n   Failed Persons:');
        personsResult.errors.forEach(e => console.log(`     - ${e.name} (ID: ${e.id}): ${e.error}`));
      }
    } else {
      logger.info('✅ All test data cleaned up successfully!');
    }

  } catch (error) {
    logger.error('❌ Cleanup failed', {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

main();

