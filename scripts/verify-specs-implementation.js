#!/usr/bin/env node
/**
 * Script to verify implementation of specifications:
 * - 016-pnl-date-filter: PNL insights with historical date filtering
 * - 019-manual-cash-expenses: Manual cash expense entries
 * - 020-pnl-payment-details: Payment details view and unlinking
 */

require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000/api';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'blue');
  console.log('='.repeat(60));
}

function logTest(name, passed, details = '') {
  const status = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(`${status} ${name}`, color);
  if (details) {
    console.log(`  ${details}`);
  }
}

async function testAPI(endpoint, method = 'GET', data = null) {
  try {
    const config = {
      method,
      url: `${API_BASE}${endpoint}`,
      headers: { 'Content-Type': 'application/json' },
    };
    if (data) {
      config.data = data;
    }
    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    const errorDetails = {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      code: error.code,
    };
    return {
      success: false,
      error: errorDetails,
      status: error.response?.status,
    };
  }
}

async function verifySpec016() {
  logSection('SPEC 016: PNL Date Filter & Insights');

  // Test 1: Get insights for 2025
  log('\n1. Testing PNL Insights API for year 2025...');
  const insights2025 = await testAPI('/pnl/insights?year=2025');
  logTest(
    'GET /api/pnl/insights?year=2025',
    insights2025.success && insights2025.data?.success,
    insights2025.success
      ? `Status: ${insights2025.status}, Has data: ${!!insights2025.data?.data}`
      : `Error: ${insights2025.error?.message || JSON.stringify(insights2025.error)} (Status: ${insights2025.status || 'N/A'})`
  );

  if (insights2025.success && insights2025.data?.data) {
    const data = insights2025.data.data;
    logTest('Has revenueMetrics', !!data.revenueMetrics);
    logTest('Has expensesStatistics', !!data.expensesStatistics);
    logTest('Has breakEvenAnalysis', !!data.breakEvenAnalysis);
    logTest('Has yearOverYear', !!data.yearOverYear);
    logTest('Has profitabilityMetrics', !!data.profitabilityMetrics);
    logTest('Has quarterlyAnalysis', !!data.quarterlyAnalysis);
    logTest('Has operationalEfficiency', !!data.operationalEfficiency);
    logTest('Has trendAnalysis', !!data.trendAnalysis);
    logTest('Has stabilityVolatility', !!data.stabilityVolatility);
    logTest('Has cashRunway', !!data.cashRunway);
    logTest('Has expenseEfficiency', !!data.expenseEfficiency);
    logTest('Has predictiveInsights', !!data.predictiveInsights);
    logTest('Has performanceBenchmarks', !!data.performanceBenchmarks);
    logTest('Has monthByMonth', !!data.monthByMonth);
    logTest('Has strategicInsights', !!data.strategicInsights);
    logTest('Has marketingMetrics', !!data.marketingMetrics);
  }

  // Test 2: Historical date filtering
  log('\n2. Testing historical date filtering...');
  const testDate = '2025-06-15';
  const insightsWithDate = await testAPI(`/pnl/insights?year=2025&asOfDate=${testDate}`);
  logTest(
    'GET /api/pnl/insights with asOfDate',
    insightsWithDate.success && insightsWithDate.data?.success,
    insightsWithDate.success
      ? `Status: ${insightsWithDate.status}, Date: ${insightsWithDate.data?.data?.asOfDate || 'not set'}`
      : `Error: ${JSON.stringify(insightsWithDate.error)}`
  );

  return {
    insights: insights2025.success,
    historicalDate: insightsWithDate.success,
  };
}

async function verifySpec019() {
  logSection('SPEC 019: Manual Cash Expenses');

  const year = 2025;
  const month = 1;
  
  // First, find a manual expense category
  log('\n0. Finding manual expense category...');
  const categoriesRes = await testAPI('/pnl/expense-categories');
  let testExpenseCategoryId = null;
  if (categoriesRes.success && Array.isArray(categoriesRes.data?.data)) {
    const manualCategory = categoriesRes.data.data.find(cat => cat.management_type === 'manual');
    if (manualCategory) {
      testExpenseCategoryId = manualCategory.id;
      log(`   Found manual category: ${manualCategory.id} - ${manualCategory.name}`, 'green');
    } else {
      log('   No manual category found, will test with category 20 (may fail)', 'yellow');
      testExpenseCategoryId = 20; // Fallback
    }
  } else {
    log('   Could not fetch categories, using fallback category 20', 'yellow');
    testExpenseCategoryId = 20; // Fallback
  }

  // Test 1: Get manual entries for expense category
  log('\n1. Testing GET manual entries for expense category...');
  const getEntries = await testAPI(
    `/pnl/manual-entries?expenseCategoryId=${testExpenseCategoryId}&year=${year}&month=${month}&entryType=expense`
  );
  logTest(
    'GET /api/pnl/manual-entries (expense)',
    getEntries.success,
    getEntries.success
      ? `Status: ${getEntries.status}, Entries: ${Array.isArray(getEntries.data) ? getEntries.data.length : 'N/A'}`
      : `Error: ${JSON.stringify(getEntries.error)}`
  );

  // Test 2: Create manual expense entry
  log('\n2. Testing POST manual expense entry...');
  const testEntry = {
    expenseCategoryId: testExpenseCategoryId,
    year,
    month,
    amountPln: 100.50,
    notes: 'Test expense entry',
    entryType: 'expense',
  };
  const createEntry = await testAPI('/pnl/manual-entries', 'POST', testEntry);
  const createdEntryIdFromResponse = createEntry.data?.data?.id || createEntry.data?.id;
  logTest(
    'POST /api/pnl/manual-entries',
    createEntry.success && createEntry.data?.success && !!createdEntryIdFromResponse,
    createEntry.success && createEntry.data?.success
      ? `Status: ${createEntry.status}, Entry ID: ${createdEntryIdFromResponse || 'N/A'}`
      : `Error: ${createEntry.error?.message || JSON.stringify(createEntry.error)}`
  );

  let createdEntryId = null;
  let updateSuccess = false;
  let deleteSuccess = false;
  
  const entryId = createEntry.data?.data?.id || createEntry.data?.id;
  if (createEntry.success && createEntry.data?.success && entryId) {
    createdEntryId = entryId;

    // Test 3: Get specific entry
    log('\n3. Testing GET specific manual entry...');
    const getEntry = await testAPI(`/pnl/manual-entries/${createdEntryId}`);
    logTest(
      'GET /api/pnl/manual-entries/:id',
      getEntry.success && getEntry.data?.id === createdEntryId,
      getEntry.success ? `Status: ${getEntry.status}` : `Error: ${getEntry.error?.message || JSON.stringify(getEntry.error)}`
    );

    // Test 4: Update entry
    log('\n4. Testing PUT manual entry...');
    const updateData = { amountPln: 150.75, notes: 'Updated test expense' };
    const updateEntry = await testAPI(`/pnl/manual-entries/${createdEntryId}`, 'PUT', updateData);
    updateSuccess = updateEntry.success && updateEntry.data?.amountPln === 150.75;
    logTest(
      'PUT /api/pnl/manual-entries/:id',
      updateSuccess,
      updateEntry.success ? `Status: ${updateEntry.status}` : `Error: ${updateEntry.error?.message || JSON.stringify(updateEntry.error)}`
    );

    // Test 5: Delete entry
    log('\n5. Testing DELETE manual entry...');
    const deleteEntry = await testAPI(`/pnl/manual-entries/${createdEntryId}`, 'DELETE');
    deleteSuccess = deleteEntry.success;
    logTest(
      'DELETE /api/pnl/manual-entries/:id',
      deleteSuccess,
      deleteEntry.success ? `Status: ${deleteEntry.status}` : `Error: ${deleteEntry.error?.message || JSON.stringify(deleteEntry.error)}`
    );
  } else {
    log('\n3-5. Skipping update/delete tests - entry creation failed', 'yellow');
  }

  return {
    getEntries: getEntries.success,
    createEntry: createEntry.success && !!createdEntryId,
    updateEntry: updateSuccess,
    deleteEntry: deleteSuccess,
  };
}

async function verifySpec020() {
  logSection('SPEC 020: PNL Payment Details');

  const year = 2025;
  const month = 1;
  
  // First, find a category with payments
  log('\n0. Finding category with payments...');
  let testCategoryId = null;
  let testPayment = null;
  
  // Try multiple categories to find one with payments
  for (let catId = 1; catId <= 10; catId++) {
    const testPayments = await testAPI(`/pnl/payments?categoryId=${catId}&year=${year}&month=${month}`);
    if (testPayments.success && Array.isArray(testPayments.data?.data) && testPayments.data.data.length > 0) {
      testCategoryId = catId;
      testPayment = testPayments.data.data[0];
      log(`   Found category ${catId} with ${testPayments.data.data.length} payments`, 'green');
      break;
    }
  }
  
  if (!testCategoryId) {
    log('   No category with payments found, using category 1', 'yellow');
    testCategoryId = 1;
  }

  // Test 1: Get payments by category and month
  log('\n1. Testing GET payments by category and month...');
  const getPayments = await testAPI(`/pnl/payments?categoryId=${testCategoryId}&year=${year}&month=${month}`);
  logTest(
    'GET /api/pnl/payments',
    getPayments.success,
    getPayments.success
      ? `Status: ${getPayments.status}, Payments: ${Array.isArray(getPayments.data?.data) ? getPayments.data.data.length : 'N/A'}`
      : `Error: ${getPayments.error?.message || JSON.stringify(getPayments.error)}`
  );
  
  if (getPayments.success && Array.isArray(getPayments.data?.data) && getPayments.data.data.length > 0) {
    testPayment = getPayments.data.data[0];
  }

  // Test 2: Get expenses by category and month
  log('\n2. Testing GET expenses by category and month...');
  const testExpenseCategoryId = 20;
  const getExpenses = await testAPI(
    `/pnl/expenses?expenseCategoryId=${testExpenseCategoryId}&year=${year}&month=${month}`
  );
  logTest(
    'GET /api/pnl/expenses',
    getExpenses.success,
    getExpenses.success
      ? `Status: ${getExpenses.status}, Expenses: ${Array.isArray(getExpenses.data) ? getExpenses.data.length : 'N/A'}`
      : `Error: ${JSON.stringify(getExpenses.error)}`
  );

  // Test 3: Unlink payment (if we have a payment)
  if (testPayment && testPayment.id) {
    log('\n3. Testing PUT unlink payment...');
    log(`   Using payment ID: ${testPayment.id}, source: ${testPayment.source || 'unknown'}`);
    const unlinkPayment = await testAPI(`/pnl/payments/${testPayment.id}/unlink`, 'PUT', {
      source: testPayment.source || 'bank',
    });
    logTest(
      'PUT /api/pnl/payments/:id/unlink',
      unlinkPayment.success,
      unlinkPayment.success
        ? `Status: ${unlinkPayment.status}, Category cleared: ${unlinkPayment.data?.income_category_id === null}`
        : `Error: ${JSON.stringify(unlinkPayment.error)}`
    );

    // Re-link payment back for cleanup
    if (unlinkPayment.success) {
      log('\n4. Re-linking payment for cleanup...');
      const relinkData = { income_category_id: testCategoryId };
      const relinkPayment = await testAPI(`/api/payments/${testPayment.id}`, 'PUT', relinkData);
      logTest(
        'PUT /api/payments/:id (re-link)',
        relinkPayment.success,
        relinkPayment.success ? `Status: ${relinkPayment.status}` : `Error: ${JSON.stringify(relinkPayment.error)}`
      );
    }
  } else {
    log('\n3. Skipping unlink test - no payments found', 'yellow');
  }

  return {
    getPayments: getPayments.success,
    getExpenses: getExpenses.success,
    unlinkPayment: getPayments.success && getPayments.data?.length > 0,
  };
}

async function main() {
  log('\n🔍 Starting specification verification...', 'blue');
  log(`API Base URL: ${API_BASE}\n`);

  const results = {
    spec016: {},
    spec019: {},
    spec020: {},
  };

  try {
    // Verify Spec 016
    results.spec016 = await verifySpec016();

    // Verify Spec 019
    results.spec019 = await verifySpec019();

    // Verify Spec 020
    results.spec020 = await verifySpec020();

    // Summary
    logSection('SUMMARY');
    log('\nSpec 016 (PNL Date Filter & Insights):', 'blue');
    log(`  Insights API: ${results.spec016.insights ? '✓' : '✗'}`);
    log(`  Historical Date: ${results.spec016.historicalDate ? '✓' : '✗'}`);

    log('\nSpec 019 (Manual Cash Expenses):', 'blue');
    log(`  Get Entries: ${results.spec019.getEntries ? '✓' : '✗'}`);
    log(`  Create Entry: ${results.spec019.createEntry ? '✓' : '✗'}`);
    log(`  Update Entry: ${results.spec019.updateEntry ? '✓' : '✗'}`);
    log(`  Delete Entry: ${results.spec019.deleteEntry ? '✓' : '✗'}`);

    log('\nSpec 020 (PNL Payment Details):', 'blue');
    log(`  Get Payments: ${results.spec020.getPayments ? '✓' : '✗'}`);
    log(`  Get Expenses: ${results.spec020.getExpenses ? '✓' : '✗'}`);
    log(`  Unlink Payment: ${results.spec020.unlinkPayment ? '✓' : '✗'}`);

    const allPassed =
      results.spec016.insights &&
      results.spec016.historicalDate &&
      results.spec019.getEntries &&
      results.spec019.createEntry &&
      results.spec020.getPayments &&
      results.spec020.getExpenses;

    log('\n' + '='.repeat(60));
    if (allPassed) {
      log('✅ All core functionality verified!', 'green');
    } else {
      log('⚠️  Some tests failed. Check details above.', 'yellow');
    }
    log('='.repeat(60) + '\n');
  } catch (error) {
    log(`\n❌ Error during verification: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifySpec016, verifySpec019, verifySpec020 };
