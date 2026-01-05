# Quick Start: Автотесты Stripe платежей

## Prerequisites

1. **Environment Variables**:
   ```bash
   STRIPE_MODE=test
   STRIPE_TEST_SECRET_KEY=sk_test_...
   STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_test_...
   PIPEDRIVE_API_TOKEN=...
   SENDPULSE_ID=...
   SENDPULSE_SECRET=...
   SENDPULSE_TEST_TELEGRAM_ID=...  # Optional: test Telegram ID
   ```

2. **Dependencies**: All existing project dependencies (no new packages required)

3. **Database**: Supabase connection configured

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Test Environment

Ensure `STRIPE_MODE=test` is set in `.env` file.

### 3. Verify Test Access

- Pipedrive API token has permissions to create/delete deals
- Stripe test mode keys are valid
- SendPulse credentials are configured (optional for notification tests)

## Running Tests

### Manual Execution

Run tests manually via CLI script:

```bash
node tests/scripts/runStripePaymentTests.js
```

**Options**:
```bash
# Run specific test
node tests/scripts/runStripePaymentTests.js --test deposit_payment_creation

# Skip cleanup (for debugging)
node tests/scripts/runStripePaymentTests.js --skip-cleanup

# Verbose logging
node tests/scripts/runStripePaymentTests.js --verbose

# Custom correlation ID
node tests/scripts/runStripePaymentTests.js --correlation-id my-test-123
```

### Automated Execution

Tests run automatically via cron scheduler:

- **Schedule**: Daily at 3:00 AM (Europe/Warsaw timezone)
- **Trigger**: `SchedulerService.runStripePaymentTests({ trigger: 'cron' })`
- **Logs**: Available in Winston logs with correlation IDs

### Programmatic Execution

Run tests programmatically:

```javascript
const StripePaymentTestRunner = require('./src/services/stripe/testRunner');

const runner = new StripePaymentTestRunner();

const result = await runner.runTestSuite({
  correlationId: 'my-test-run',
  testFilter: ['deposit_payment_creation', 'single_payment_creation']
});

console.log(`Tests: ${result.testRun.passedTests}/${result.testRun.totalTests} passed`);
```

## Test Scenarios

### 1. Deposit Payment Creation (50/50)

Tests the full flow of creating a deposit payment:
- Creates test deal with 50/50 schedule
- Simulates Pipedrive webhook
- Verifies Checkout Session creation
- Verifies database record
- Verifies notification sent

### 2. Rest Payment Creation (50/50)

Tests the creation of second payment:
- Creates test deal with paid deposit
- Simulates cron trigger for second payment
- Verifies Checkout Session creation
- Verifies notification sent

### 3. Single Payment Creation (100%)

Tests the creation of single payment:
- Creates test deal with 100% schedule
- Simulates Pipedrive webhook
- Verifies Checkout Session creation
- Verifies database record
- Verifies notification sent

### 4. Payment Processing

Tests successful payment processing:
- Creates test deal with Checkout Session
- Simulates Stripe webhook `checkout.session.completed`
- Verifies payment status updated
- Verifies CRM stage updated
- Verifies invoice sent

### 5. Expired Session Handling

Tests expired session recovery:
- Creates test deal with Checkout Session
- Simulates session expiration
- Verifies expired session detection
- Verifies new session creation
- Verifies notification sent

### 6. Refund Processing

Tests refund processing:
- Creates test deal with paid payment
- Simulates Stripe webhook `charge.refunded`
- Verifies refund logged
- Verifies CRM stage recalculated

## Checking Results

### Logs

Test results are logged via Winston:

```bash
# View recent test runs
grep "StripePaymentTest" logs/combined.log

# View specific test run
grep "correlationId:abc123" logs/combined.log

# View failures only
grep "test.*failed" logs/error.log
```

### Test Summary

Each test run logs a summary:

```
[INFO] StripePaymentTest: Test run completed
  correlationId: abc123
  totalTests: 6
  passedTests: 5
  failedTests: 1
  duration: 450000ms
  failures: [
    {
      testName: "expired_session_handling",
      error: "Session expiration detection failed"
    }
  ]
```

## Troubleshooting

### Test Data Not Cleaned Up

If test data remains after execution:

```bash
# Manual cleanup
node tests/scripts/cleanupTestData.js

# Or via service
const runner = new StripePaymentTestRunner();
await runner.cleanupTestData({ olderThan: Date.now() - 7 * 24 * 60 * 60 * 1000 });
```

### Tests Failing Due to External Services

If tests fail due to Pipedrive/Stripe/SendPulse unavailability:

- Check API credentials
- Verify network connectivity
- Check service status pages
- Review error logs for specific API errors

### Stripe Webhook Signature Verification

For manual testing, webhook signature verification can be bypassed:

```javascript
// In test code, use test mode which may have relaxed signature checks
// Or use Stripe CLI to generate valid signatures
```

## Next Steps

1. **Monitor Daily Runs**: Check logs daily for test results
2. **Investigate Failures**: Review failed tests and fix issues
3. **Extend Coverage**: Add more edge case tests as needed
4. **Performance Monitoring**: Track test execution time trends

## Related Documentation

- [Specification](./spec.md): Full feature specification
- [Data Model](./data-model.md): Data structures and relationships
- [API Contracts](./contracts/api.md): Service API documentation
- [Research](./research.md): Design decisions and rationale

