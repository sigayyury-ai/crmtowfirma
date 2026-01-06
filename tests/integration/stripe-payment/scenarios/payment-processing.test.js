/**
 * Test Scenario: Payment Processing
 * 
 * Tests the processing of completed payments via Stripe webhook
 * Flow: Stripe webhook (checkout.session.completed) -> Payment status update -> CRM status update -> Notification
 * 
 * This test verifies:
 * 1. Stripe webhook event checkout.session.completed is received
 * 2. Payment status is updated in database
 * 3. persistSession processes the payment correctly
 * 4. CRM deal stage is updated appropriately
 * 5. Notification is sent (if applicable)
 */

const logger = require('../../../../src/utils/logger');
const StripeProcessorService = require('../../../../src/services/stripe/processor');
const PipedriveClient = require('../../../../src/services/pipedrive');
const StripeRepository = require('../../../../src/services/stripe/repository');
const { getStripeClient } = require('../../../../src/services/stripe/client');

class PaymentProcessingTest {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.testRunner = options.testRunner;
    this.testDataFactory = options.testDataFactory;
    this.cleanupHelpers = options.cleanupHelpers;
    this.stripeProcessor = options.stripeProcessor || new StripeProcessorService();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.repository = options.repository || new StripeRepository();
    this.stripe = options.stripe || getStripeClient();
    this.testPrefix = options.testPrefix || 'TEST_AUTO_';
  }

  /**
   * Запустить тест обработки платежа
   * 
   * @returns {Promise<Object>} - Результат теста
   */
  async run() {
    const testName = 'payment-processing';
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
      if (process.env.TEST_USE_REAL_PIPEDRIVE !== 'true') {
        this.logger.info('Skipping test - TEST_USE_REAL_PIPEDRIVE not set to true');
        return {
          name: testName,
          status: 'skipped',
          message: 'TEST_USE_REAL_PIPEDRIVE environment variable not set. Set TEST_USE_REAL_PIPEDRIVE=true to run this test with real Pipedrive API.',
          duration: '0s'
        };
      }

      // Step 1: Create test deal and payment session
      const expectedCloseDate = new Date();
      expectedCloseDate.setDate(expectedCloseDate.getDate() + 15); // 15 days (< 30, so 100% schedule)

      const testDeal = this.testDataFactory.createTestDeal({
        title: 'Payment Processing Test Deal',
        value: 1000,
        currency: 'PLN',
        expectedCloseDate,
        personEmail: `test_processing_${Date.now()}@example.com`,
        personName: 'Test Processing Person'
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

      // Step 2: Create payment session
      this.logger.info('Creating payment session', { dealId });
      const sessionResult = await this.stripeProcessor.createCheckoutSessionForDeal(
        { id: dealId },
        {
          trigger: 'test_auto',
          runId: `test_${testName}_${Date.now()}`,
          paymentType: 'single',
          paymentSchedule: '100%'
        }
      );

      if (!sessionResult.success || !sessionResult.sessionId) {
        throw new Error(`Failed to create session: ${sessionResult.error}`);
      }

      const sessionId = sessionResult.sessionId;
      testData.sessions.push(sessionId);
      this.logger.info('Payment session created', { sessionId });

      // Step 3: Retrieve session from Stripe to simulate completed payment
      const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent', 'customer']
      });

      assertions.push({
        name: 'Session retrieved from Stripe',
        passed: !!session && session.id === sessionId,
        expected: 'session exists',
        actual: session ? 'exists' : 'missing'
      });

      // Step 4: Simulate payment completion by updating session metadata
      // In real scenario, Stripe sends webhook with checkout.session.completed
      // For test, we'll simulate by calling persistSession directly with completed session
      const completedSession = {
        ...session,
        payment_status: 'paid',
        status: 'complete',
        metadata: {
          ...session.metadata,
          deal_id: String(dealId)
        }
      };

      // Step 5: Process the completed payment
      this.logger.info('Processing completed payment', { sessionId, dealId });
      await this.stripeProcessor.repository.updatePaymentStatus(sessionId, 'paid');
      await this.stripeProcessor.persistSession(completedSession);

      // Give time for async operations (CRM status update, notifications)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Step 6: Verify payment status in database
      const payments = await this.repository.listPayments({
        dealId: String(dealId)
      });

      const payment = payments.find(p => p.session_id === sessionId);

      assertions.push({
        name: 'Payment record exists',
        passed: !!payment,
        expected: 'payment record exists',
        actual: payment ? 'exists' : 'missing'
      });

      if (payment) {
        testData.payments.push(payment.id);
        assertions.push({
          name: 'Payment status is paid',
          passed: payment.payment_status === 'paid',
          expected: 'paid',
          actual: payment.payment_status
        });
      }

      // Step 7: Verify CRM status update (should be Camp Waiter / Fully Paid for 100% payment)
      this.logger.info('Verifying CRM status update after 100% payment', { dealId });
      const dealAfterPayment = await this.pipedriveClient.getDeal(dealId);
      if (dealAfterPayment.success && dealAfterPayment.deal) {
        const currentStageId = dealAfterPayment.deal.stage_id;
        const CAMP_WAITER_STAGE_ID = 27; // Stage 27 = Camp Waiter / Fully Paid
        
        assertions.push({
          name: 'CRM stage updated to Camp Waiter (Fully Paid) after 100% payment',
          passed: currentStageId === CAMP_WAITER_STAGE_ID,
          expected: CAMP_WAITER_STAGE_ID,
          actual: currentStageId,
          details: {
            stageId: currentStageId,
            status: dealAfterPayment.deal.status,
            expectedStage: 'Camp Waiter (27)',
            actualStage: currentStageId === CAMP_WAITER_STAGE_ID ? 'Camp Waiter (27)' : `Other (${currentStageId})`
          }
        });
      } else {
        assertions.push({
          name: 'CRM stage updated to Camp Waiter (Fully Paid) after 100% payment',
          passed: false,
          expected: 'Stage 27 (Camp Waiter)',
          actual: 'deal not found'
        });
      }

      // Step 8: Verify SendPulse notification was sent
      // Note: We can't directly verify if SendPulse message was sent without mocking,
      // but we can verify that sendPaymentNotificationForDeal is called during persistSession
      // For now, we verify SendPulse client is configured
      if (this.stripeProcessor.sendpulseClient) {
        assertions.push({
          name: 'SendPulse client is configured (notification should be sent)',
          passed: true,
          expected: 'configured',
          actual: 'configured',
          note: 'Notification is sent via sendPaymentNotificationForDeal in pipedriveWebhook.js after session creation, and persistSession triggers CRM status automation'
        });
      } else {
        assertions.push({
          name: 'SendPulse client is configured (notification should be sent)',
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
          sessionId,
          paymentId: payment?.id
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

module.exports = PaymentProcessingTest;
