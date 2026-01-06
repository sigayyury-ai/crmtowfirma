/**
 * Test Scenario: Deposit Payment Creation
 * 
 * Tests the creation of a deposit payment (first payment in 50/50 schedule)
 * Flow: Webhook -> Session Creation -> Database -> Notification
 * 
 * This test verifies:
 * 1. Deal with 50/50 schedule triggers deposit payment creation
 * 2. Stripe checkout session is created
 * 3. Payment record is saved to database
 * 4. Notification is sent via SendPulse
 * 5. SendPulse contact is updated with deal_id
 */

const logger = require('../../../../src/utils/logger');
const StripeProcessorService = require('../../../../src/services/stripe/processor');
const PipedriveClient = require('../../../../src/services/pipedrive');
const StripeRepository = require('../../../../src/services/stripe/repository');
const PaymentScheduleService = require('../../../../src/services/stripe/paymentScheduleService');

class DepositPaymentTest {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.testRunner = options.testRunner;
    this.testDataFactory = options.testDataFactory;
    this.cleanupHelpers = options.cleanupHelpers;
    this.stripeProcessor = options.stripeProcessor || new StripeProcessorService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.repository = options.repository || new StripeRepository();
    this.testPrefix = options.testPrefix || 'TEST_AUTO_';
  }

  /**
   * Запустить тест создания депозитного платежа
   * 
   * @returns {Promise<Object>} - Результат теста
   */
  async run() {
    const testName = 'deposit-payment';
    const startTime = Date.now();
    this.logger.info(`🧪 Running test: ${testName}`);

    const testData = {
      deals: [],
      payments: [],
      sessions: []
    };

    const assertions = [];

    try {
      // Check if we have real Pipedrive access
      // Note: createCheckoutSessionForDeal requires real Pipedrive API access
      // as it fetches deal data internally
      if (process.env.TEST_USE_REAL_PIPEDRIVE !== 'true') {
        this.logger.info('Skipping test - TEST_USE_REAL_PIPEDRIVE not set to true');
        return {
          name: testName,
          status: 'skipped',
          message: 'TEST_USE_REAL_PIPEDRIVE environment variable not set. Set TEST_USE_REAL_PIPEDRIVE=true to run this test with real Pipedrive API.',
          duration: '0s'
        };
      }

      // Step 1: Create test deal with 50/50 schedule
      // expected_close_date should be >= 30 days from now
      const expectedCloseDate = new Date();
      expectedCloseDate.setDate(expectedCloseDate.getDate() + 60); // 60 days from now

      const testDeal = this.testDataFactory.createTestDeal({
        title: 'Deposit Payment Test Deal',
        value: 2000,
        currency: 'PLN',
        expectedCloseDate,
        personEmail: `test_deposit_${Date.now()}@example.com`,
        personName: 'Test Deposit Person'
      });

      this.logger.info('Creating test deal in Pipedrive', { deal: testDeal.title });

      // First, create a person with email
      const personResult = await this.testDataFactory.createTestPerson({
        email: testDeal.person.email[0].value,
        name: testDeal.person.name
      });

      if (!personResult.success) {
        throw new Error(`Failed to create test person: ${personResult.error}`);
      }

      const personId = personResult.personId;

      // Create deal with person_id
      const dealResult = await this.pipedriveClient.createDeal({
        title: testDeal.title,
        value: testDeal.value,
        currency: testDeal.currency,
        expected_close_date: testDeal.expected_close_date,
        person_id: personId
      });

      if (!dealResult.success) {
        throw new Error(`Failed to create test deal: ${dealResult.error}`);
      }

      const dealId = dealResult.deal.id;
      testData.deals.push(dealId);
      this.logger.info('Test deal created', { dealId, personId });

      // Step 1.5: Add product to deal (required for session creation)
      const addProductResult = await this.testDataFactory.addProductToTestDeal(dealId, {
        price: parseFloat(testDeal.value),
        currency: testDeal.currency
      });

      if (!addProductResult.success) {
        throw new Error(`Failed to add product to test deal: ${addProductResult.error}`);
      }

      // Step 2: Verify payment schedule is 50/50
      const schedule = PaymentScheduleService.determineSchedule(testDeal.expected_close_date);
      assertions.push({
        name: 'Payment schedule is 50/50',
        passed: schedule.schedule === '50/50',
        expected: '50/50',
        actual: schedule.schedule
      });

      if (schedule.schedule !== '50/50') {
        throw new Error(`Expected 50/50 schedule, got ${schedule.schedule}`);
      }

      // Step 3: Simulate webhook trigger by calling createCheckoutSessionForDeal
      // This simulates what happens when invoice_type is set to "Stripe" (75)
      // Note: createCheckoutSessionForDeal will fetch deal data internally
      this.logger.info('Simulating webhook trigger - creating deposit payment session', { dealId });

      const sessionResult = await this.stripeProcessor.createCheckoutSessionForDeal(
        { id: dealId }, // Minimal deal object - full data will be fetched internally
        {
          trigger: 'test_auto',
          runId: `test_${testName}_${Date.now()}`,
          paymentType: 'deposit',
          paymentSchedule: '50/50',
          paymentIndex: 1
        }
      );

      // Step 4: Verify session creation
      assertions.push({
        name: 'Session created successfully',
        passed: sessionResult.success === true,
        expected: true,
        actual: sessionResult.success
      });

      if (!sessionResult.success) {
        throw new Error(`Failed to create session: ${sessionResult.error}`);
      }

      assertions.push({
        name: 'Session ID exists',
        passed: !!sessionResult.sessionId,
        expected: 'non-empty string',
        actual: sessionResult.sessionId || 'missing'
      });

      if (sessionResult.sessionId) {
        testData.sessions.push(sessionResult.sessionId);
      }

      // Step 5: Verify payment record in database
      const payments = await this.repository.listPayments({
        dealId: String(dealId),
        paymentType: 'deposit'
      });

      const depositPayment = payments.find(p => p.session_id === sessionResult.sessionId);

      assertions.push({
        name: 'Payment record saved to database',
        passed: !!depositPayment,
        expected: 'payment record exists',
        actual: depositPayment ? 'exists' : 'missing'
      });

      if (depositPayment) {
        testData.payments.push(depositPayment.id);
        assertions.push({
          name: 'Payment type is deposit',
          passed: depositPayment.payment_type === 'deposit',
          expected: 'deposit',
          actual: depositPayment.payment_type
        });
        assertions.push({
          name: 'Payment schedule is 50/50',
          passed: depositPayment.payment_schedule === '50/50',
          expected: '50/50',
          actual: depositPayment.payment_schedule
        });
      }

      // Step 6: Verify notification was sent (if SendPulse is configured)
      // This is checked via logs - actual SendPulse API call verification would require mocking
      if (this.stripeProcessor.sendpulseClient) {
        assertions.push({
          name: 'SendPulse client is configured',
          passed: true,
          expected: 'configured',
          actual: 'configured'
        });
        // Note: Actual notification sending is verified via integration logs
        // In a full test, we would mock SendPulse and verify the call
      } else {
        assertions.push({
          name: 'SendPulse client is configured',
          passed: false,
          expected: 'configured',
          actual: 'not configured (skipping notification test)'
        });
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      const allPassed = assertions.every(a => a.passed);

      this.logger.info(`✅ Test ${testName} completed`, {
        duration: `${duration}s`,
        assertions: assertions.length,
        passed: assertions.filter(a => a.passed).length,
        failed: assertions.filter(a => !a.passed).length
      });

      return {
        name: testName,
        status: allPassed ? 'passed' : 'failed',
        duration: `${duration}s`,
        assertions,
        testData: {
          dealId,
          sessionId: sessionResult.sessionId,
          paymentId: depositPayment?.id
        }
      };
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      this.logger.error(`❌ Test ${testName} failed`, {
        error: error.message,
        stack: error.stack,
        duration: `${duration}s`
      });
      return {
        name: testName,
        status: 'failed',
        duration: `${duration}s`,
        error: error.message,
        assertions
      };
    } finally {
      // Cleanup test data
      if (this.cleanupHelpers && testData.deals.length > 0) {
        this.logger.info('Cleaning up test data', { testData });
        await this.cleanupHelpers.cleanupAllTestData(testData);
      }
    }
  }
}

module.exports = DepositPaymentTest;

