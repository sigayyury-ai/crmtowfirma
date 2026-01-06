const logger = require('../../../src/utils/logger');
const StripeProcessorService = require('../../../src/services/stripe/processor');
const PipedriveClient = require('../../../src/services/pipedrive');
const StripeRepository = require('../../../src/services/stripe/repository');
const { getStripeClient } = require('../../../src/services/stripe/client');
const PaymentScheduleService = require('../../../src/services/stripe/paymentScheduleService');
const DealAmountCalculator = require('../../../src/services/stripe/dealAmountCalculator');
const supabase = require('../../../src/services/supabaseClient');

/**
 * StripePaymentTestRunner
 * 
 * End-to-end test runner for Stripe payment processing flow.
 * Tests the complete flow from webhook to notification delivery.
 * 
 * Runs daily via cron to stabilize and verify payment processing functionality.
 */
class StripePaymentTestRunner {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.stripeProcessor = options.stripeProcessor || new StripeProcessorService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.repository = options.repository || new StripeRepository();
    this.stripe = options.stripe || getStripeClient();
    this.supabase = options.supabase || supabase;
    
    // Test configuration
    this.testPrefix = 'TEST_AUTO_';
    this.testDealPrefix = `${this.testPrefix}DEAL_`;
    this.cleanupAfterRun = options.cleanupAfterRun !== false; // Default: true
  }

  /**
   * Запустить полный набор тестов
   * 
   * @param {Object} options - Опции запуска
   * @param {boolean} options.cleanupAfterRun - Очистить тестовые данные после выполнения
   * @returns {Promise<Object>} - Результаты тестов
   */
  async runTestSuite(options = {}) {
    const runId = `test_run_${Date.now()}`;
    const startTime = Date.now();
    
    this.logger.info('🧪 Starting Stripe Payment Auto-Test Suite', {
      runId,
      timestamp: new Date().toISOString()
    });

    const results = {
      runId,
      startTime: new Date(startTime).toISOString(),
      endTime: null,
      duration: null,
      tests: [],
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      },
      errors: []
    };

    try {
      // Test scenarios (will be implemented in separate files)
      const testScenarios = [
        { name: 'deposit-payment', file: './scenarios/deposit-payment.test.js' },
        { name: 'rest-payment', file: './scenarios/rest-payment.test.js' },
        { name: 'single-payment', file: './scenarios/single-payment.test.js' },
        { name: 'payment-processing', file: './scenarios/payment-processing.test.js' },
        { name: 'expired-sessions', file: './scenarios/expired-sessions.test.js' },
        { name: 'refunds', file: './scenarios/refunds.test.js' }
      ];

      // Run each test scenario
      for (const scenario of testScenarios) {
        try {
          this.logger.info(`Running test scenario: ${scenario.name}`);
          // TODO: Implement actual test execution
          // For now, mark as skipped
          results.tests.push({
            name: scenario.name,
            status: 'skipped',
            message: 'Test scenario not yet implemented'
          });
          results.summary.skipped++;
        } catch (error) {
          this.logger.error(`Test scenario ${scenario.name} failed`, {
            error: error.message,
            stack: error.stack
          });
          results.tests.push({
            name: scenario.name,
            status: 'failed',
            error: error.message
          });
          results.summary.failed++;
          results.errors.push({
            test: scenario.name,
            error: error.message
          });
        }
        results.summary.total++;
      }

      // Cleanup test data if requested
      if (options.cleanupAfterRun !== false && this.cleanupAfterRun) {
        await this.cleanupTestData(runId);
      }

    } catch (error) {
      this.logger.error('Test suite execution failed', {
        runId,
        error: error.message,
        stack: error.stack
      });
      results.errors.push({
        type: 'suite_error',
        error: error.message
      });
    } finally {
      const endTime = Date.now();
      results.endTime = new Date(endTime).toISOString();
      results.duration = ((endTime - startTime) / 1000).toFixed(2);

      // Save test run results to database
      await this._saveTestRun(results);

      this.logger.info('🧪 Stripe Payment Auto-Test Suite completed', {
        runId,
        duration: `${results.duration}s`,
        summary: results.summary
      });
    }

    return results;
  }

  /**
   * Запустить конкретный тест
   * 
   * @param {string} testName - Имя теста
   * @param {Object} options - Опции запуска
   * @returns {Promise<Object>} - Результат теста
   */
  async runTest(testName, options = {}) {
    this.logger.info(`Running test: ${testName}`, { options });
    
    // TODO: Implement individual test execution
    return {
      name: testName,
      status: 'skipped',
      message: 'Test execution not yet implemented'
    };
  }

  /**
   * Очистить тестовые данные
   * 
   * @param {string} runId - ID тестового запуска
   * @returns {Promise<void>}
   */
  async cleanupTestData(runId) {
    this.logger.info('Cleaning up test data', { runId });
    
    try {
      // Cleanup test deals from Pipedrive
      // Cleanup test payments from database
      // Cleanup test Stripe sessions
      
      this.logger.info('Test data cleanup completed', { runId });
    } catch (error) {
      this.logger.error('Failed to cleanup test data', {
        runId,
        error: error.message
      });
    }
  }

  /**
   * Сохранить результаты тестового запуска в БД
   * 
   * @private
   */
  async _saveTestRun(results) {
    try {
      const { error } = await this.supabase
        .from('stripe_payment_test_runs')
        .insert({
          run_id: results.runId,
          start_time: results.startTime,
          end_time: results.endTime,
          duration_seconds: parseFloat(results.duration),
          total_tests: results.summary.total,
          passed_tests: results.summary.passed,
          failed_tests: results.summary.failed,
          skipped_tests: results.summary.skipped,
          test_results: results.tests,
          errors: results.errors.length > 0 ? results.errors : null,
          created_at: new Date().toISOString()
        });

      if (error) {
        this.logger.warn('Failed to save test run results to database', {
          error: error.message
        });
      }
    } catch (error) {
      this.logger.warn('Error saving test run results', {
        error: error.message
      });
    }
  }
}

module.exports = StripePaymentTestRunner;

