#!/usr/bin/env node

/**
 * Run Stripe Payment Auto-Tests
 * 
 * This script runs the full suite of Stripe payment integration tests.
 * Tests verify the complete flow from webhook to notification delivery.
 * 
 * Usage:
 *   node scripts/runStripePaymentTests.js
 * 
 * Environment variables:
 *   TEST_USE_REAL_PIPEDRIVE=true  - Use real Pipedrive API (default: false, uses mocks)
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const StripePaymentTestRunner = require('../tests/integration/stripe-payment/testRunner');
const logger = require('../src/utils/logger');

async function runTests() {
  try {
    logger.info('🚀 Starting Stripe Payment Auto-Tests');
    
    const testRunner = new StripePaymentTestRunner({
      cleanupAfterRun: true
    });

    const results = await testRunner.runTestSuite({
      cleanupAfterRun: true
    });

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Test Results Summary');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${results.summary.total}`);
    console.log(`✅ Passed: ${results.summary.passed}`);
    console.log(`❌ Failed: ${results.summary.failed}`);
    console.log(`⏭️  Skipped: ${results.summary.skipped}`);
    console.log(`⏱️  Duration: ${results.duration}s`);
    console.log('='.repeat(60));

    if (results.summary.failed > 0) {
      console.log('\n❌ Failed Tests:');
      results.tests
        .filter(t => t.status === 'failed')
        .forEach(test => {
          console.log(`  - ${test.name}: ${test.error || 'Unknown error'}`);
        });
    }

    if (results.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      results.errors.forEach(error => {
        console.log(`  - ${error.test || error.type}: ${error.error}`);
      });
    }

    // Exit with appropriate code
    process.exit(results.summary.failed > 0 ? 1 : 0);
  } catch (error) {
    logger.error('Failed to run Stripe payment tests', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ Test execution failed:', error.message);
    process.exit(1);
  }
}

runTests();


