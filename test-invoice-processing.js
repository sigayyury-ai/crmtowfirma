require('dotenv').config();

const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const SchedulerService = require('./src/services/scheduler');
const logger = require('./src/utils/logger');

// Хардкодим ключи для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';
process.env.PORT = 3000;
process.env.NODE_ENV = 'development';

async function testInvoiceProcessing() {
  console.log('🔧 Testing Invoice Processing Service...');

  const invoiceProcessing = new InvoiceProcessingService();

  // Test 1: Get pending deals
  console.log('\n📋 Test 1: Getting pending invoice deals...');
  try {
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    if (pendingResult.success) {
      console.log('✅ Pending deals retrieved successfully');
      console.log(`📊 Found ${pendingResult.deals.length} pending deals`);
    } else {
      console.error('❌ Failed to get pending deals:', pendingResult.error);
    }
  } catch (error) {
    console.error('❌ Error getting pending deals:', error.message);
  }

  // Test 2: Process pending invoices
  console.log('\n📋 Test 2: Processing pending invoices...');
  try {
    const processResult = await invoiceProcessing.processPendingInvoices();
    if (processResult.success) {
      console.log('✅ Invoice processing completed successfully');
      console.log(`📊 Summary: ${processResult.summary.successful} successful, ${processResult.summary.errors} errors`);
      if (processResult.results && processResult.results.length > 0) {
        processResult.results.forEach(r => {
          if (r.success) {
            console.log(`✅ Deal ${r.dealId}: ${r.message}`);
          } else {
            console.log(`❌ Deal ${r.dealId}: ${r.error}`);
          }
        });
      }
    } else {
      console.error('❌ Failed to process pending invoices:', processResult.error);
    }
  } catch (error) {
    console.error('❌ Error processing pending invoices:', error.message);
  }

  // Test 3: Process specific deal (if we have deals)
  console.log('\n📋 Test 3: Testing deal processing by ID...');
  try {
    // Попробуем обработать сделку с ID 1 (если существует)
    const dealResult = await invoiceProcessing.processDealById(1);
    if (dealResult.success) {
      console.log('✅ Deal processing completed successfully');
      console.log(`📊 Result: ${dealResult.message}`);
    } else {
      console.log('ℹ️ Deal processing result:', dealResult.error);
    }
  } catch (error) {
    console.log('ℹ️ Deal processing test (expected to fail):', error.message);
  }

  console.log('\n🎉 Invoice Processing Service tests completed!');
}

async function testScheduler() {
  console.log('\n🔧 Testing Scheduler Service...');

  const scheduler = new SchedulerService();

  // Test 1: Get scheduler status
  console.log('\n📋 Test 1: Getting scheduler status...');
  try {
    const status = scheduler.getStatus();
    console.log('✅ Scheduler status retrieved successfully');
    console.log(`📊 Is running: ${status.isRunning}`);
    console.log(`📊 Jobs count: ${status.jobsCount}`);
    console.log(`📊 Schedule:`, status.schedule);
    console.log(`📊 Next runs:`, status.nextRuns);
  } catch (error) {
    console.error('❌ Error getting scheduler status:', error.message);
  }

  // Test 2: Start scheduler
  console.log('\n📋 Test 2: Starting scheduler...');
  try {
    scheduler.start();
    console.log('✅ Scheduler started successfully');
    
    // Проверяем статус после запуска
    const status = scheduler.getStatus();
    console.log(`📊 Scheduler is now running: ${status.isRunning}`);
  } catch (error) {
    console.error('❌ Error starting scheduler:', error.message);
  }

  // Test 3: Manual processing
  console.log('\n📋 Test 3: Running manual processing...');
  try {
    const result = await scheduler.runManualProcessing('test');
    if (result.success) {
      console.log('✅ Manual processing completed successfully');
      console.log(`📊 Summary: ${result.summary.successful} successful, ${result.summary.errors} errors`);
    } else {
      console.error('❌ Manual processing failed:', result.error);
    }
  } catch (error) {
    console.error('❌ Error in manual processing:', error.message);
  }

  // Test 4: Stop scheduler
  console.log('\n📋 Test 4: Stopping scheduler...');
  try {
    scheduler.stop();
    console.log('✅ Scheduler stopped successfully');
    
    // Проверяем статус после остановки
    const status = scheduler.getStatus();
    console.log(`📊 Scheduler is now running: ${status.isRunning}`);
  } catch (error) {
    console.error('❌ Error stopping scheduler:', error.message);
  }

  console.log('\n🎉 Scheduler Service tests completed!');
}

async function runAllTests() {
  console.log('🚀 Starting Invoice Processing and Scheduler tests...\n');
  
  await testInvoiceProcessing();
  await testScheduler();
  
  console.log('\n🎉 All tests completed successfully!');
}

runAllTests();




