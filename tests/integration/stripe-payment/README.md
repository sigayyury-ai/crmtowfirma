# Stripe Payment Auto-Tests

End-to-end integration tests for Stripe payment processing flow.

## Overview

These tests verify the complete flow from webhook trigger to notification delivery:
1. Webhook received from Pipedrive
2. Payment session created in Stripe
3. Payment processed and saved to database
4. Notification sent via SendPulse
5. SendPulse contact updated with deal_id

## Test Structure

```
tests/integration/stripe-payment/
├── README.md                    # This file
├── testRunner.js                # Main test runner service
├── fixtures/                    # Test data fixtures
│   ├── test-deals.json
│   └── test-products.json
├── helpers/                     # Test helper functions
│   ├── testDataFactory.js
│   ├── mockHelpers.js
│   └── cleanupHelpers.js
└── scenarios/                   # Test scenarios
    ├── deposit-payment.test.js
    ├── rest-payment.test.js
    ├── single-payment.test.js
    ├── payment-processing.test.js
    ├── expired-sessions.test.js
    └── refunds.test.js
```

## Running Tests

### Manual Run
```bash
npm run test:stripe-payment
```

### Cron Schedule
Tests run automatically once per day via cron (configured in `src/services/scheduler.js`)

## Test Data Isolation

- Each test run creates isolated test data
- Test data is cleaned up after each run
- Uses Stripe test mode for all operations
- Uses dedicated test deals in Pipedrive (marked with test prefix)

## Logging

Test results are logged to:
- Console (for manual runs)
- Log files (for cron runs)
- Database table `stripe_payment_test_runs` (for history)

