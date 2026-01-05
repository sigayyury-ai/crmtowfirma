# API Contracts: Автотесты Stripe платежей

## Overview

Автотесты не предоставляют публичных API endpoints. Вместо этого они выполняются через:
1. Cron scheduler (автоматически)
2. CLI script (ручной запуск)
3. Internal service methods (для интеграции)

## Internal Service API

### StripePaymentTestRunner

Сервис для выполнения тестов Stripe платежей.

#### `runTestSuite(options)`

Запускает полный набор тестов.

**Parameters**:
```typescript
{
  correlationId?: string;      // Optional: correlation ID for logging
  skipCleanup?: boolean;        // Optional: skip cleanup after tests
  testFilter?: string[];       // Optional: filter specific tests
}
```

**Returns**:
```typescript
{
  success: boolean;
  testRun: {
    id: string;
    startedAt: timestamp;
    finishedAt: timestamp;
    durationMs: number;
    status: 'completed' | 'failed' | 'timeout';
    totalTests: number;
    passedTests: number;
    failedTests: number;
    skippedTests: number;
    results: TestResult[];
  };
  summary: {
    totalDuration: number;
    averageTestDuration: number;
    failures: TestResult[];
  };
}
```

**Errors**:
- `TestExecutionError`: Общая ошибка выполнения тестов
- `TestTimeoutError`: Превышено время выполнения
- `TestDataCreationError`: Ошибка создания тестовых данных

#### `runTest(testName, options)`

Запускает один конкретный тест.

**Parameters**:
```typescript
{
  testName: string;             // Name of test to run
  correlationId?: string;        // Optional: correlation ID
  skipCleanup?: boolean;         // Optional: skip cleanup
}
```

**Returns**:
```typescript
{
  success: boolean;
  testResult: TestResult;
}
```

#### `cleanupTestData(options)`

Очищает тестовые данные.

**Parameters**:
```typescript
{
  olderThan?: timestamp;         // Optional: cleanup data older than this
  dealIds?: string[];           // Optional: specific deal IDs to cleanup
  force?: boolean;               // Optional: force cleanup even if not marked as test
}
```

**Returns**:
```typescript
{
  cleaned: {
    deals: number;
    sessions: number;
    payments: number;
  };
  errors: Array<{
    type: string;
    id: string;
    error: string;
  }>;
}
```

## Cron Integration

### Scheduler Service

Тесты интегрируются в существующий `SchedulerService` через новую cron задачу.

**Schedule**: `0 3 * * *` (3:00 AM daily, Europe/Warsaw timezone)

**Method**: `runStripePaymentTests({ trigger: 'cron' })`

**Logging**: All results logged via Winston with correlation ID

## CLI Script

### `tests/scripts/runStripePaymentTests.js`

Скрипт для ручного запуска тестов.

**Usage**:
```bash
node tests/scripts/runStripePaymentTests.js [options]
```

**Options**:
- `--test <name>`: Run specific test
- `--skip-cleanup`: Skip cleanup after tests
- `--verbose`: Verbose logging
- `--correlation-id <id>`: Use specific correlation ID

**Exit Codes**:
- `0`: All tests passed
- `1`: One or more tests failed
- `2`: Execution error

## Test Methods

### `testDepositPaymentCreation()`

Тест создания первого платежа (deposit) для графика 50/50.

**Flow**:
1. Create test deal with 50/50 schedule
2. Set `invoice_type = '75'`
3. Simulate Pipedrive webhook
4. Verify Checkout Session creation
5. Verify database record
6. Verify notification sent
7. Cleanup

**Assertions**:
- Deal created successfully
- Checkout Session created with correct metadata
- Payment saved to database with `payment_type = 'deposit'`
- Notification sent via SendPulse
- `invoice_type` reset to null

### `testRestPaymentCreation()`

Тест создания второго платежа (rest) для графика 50/50.

**Flow**:
1. Create test deal with paid deposit
2. Wait for second payment date
3. Simulate cron trigger
4. Verify Checkout Session creation
5. Verify notification sent
6. Cleanup

**Assertions**:
- Second payment session created
- Payment saved with `payment_type = 'rest'`
- Notification sent with correct schedule info

### `testSinglePaymentCreation()`

Тест создания единого платежа (100%) для графика 100%.

**Flow**:
1. Create test deal with 100% schedule
2. Set `invoice_type = '75'`
3. Simulate Pipedrive webhook
4. Verify Checkout Session creation
5. Verify database record
6. Verify notification sent
7. Cleanup

**Assertions**:
- Checkout Session created with `payment_type = 'single'`
- Payment saved with `payment_schedule = '100%'`
- Notification sent with 100% schedule info

### `testPaymentProcessing()`

Тест обработки успешной оплаты через Stripe webhook.

**Flow**:
1. Create test deal with Checkout Session
2. Simulate `checkout.session.completed` webhook
3. Verify payment status updated
4. Verify CRM stage updated
5. Verify invoice sent
6. Cleanup

**Assertions**:
- Payment status = 'paid' in database
- CRM stage updated correctly based on payment type
- Invoice sent to customer

### `testExpiredSessionHandling()`

Тест обработки истекших сессий.

**Flow**:
1. Create test deal with Checkout Session
2. Simulate session expiration
3. Verify expired session detection
4. Verify new session creation
5. Verify notification sent
6. Cleanup

**Assertions**:
- Expired session detected
- New session created with same type
- Notification sent with new link

### `testRefundProcessing()`

Тест обработки возврата платежа.

**Flow**:
1. Create test deal with paid payment
2. Simulate `charge.refunded` webhook
3. Verify refund logged
4. Verify CRM stage recalculated
5. Cleanup

**Assertions**:
- Refund logged in `stripe_payment_deletions`
- CRM stage recalculated correctly

## SendPulse Client API Extension

### `updateContactCustomField(contactId, customFields)`

Обновляет кастомные поля контакта в SendPulse.

**Parameters**:
```typescript
{
  contactId: string;            // SendPulse contact ID
  customFields: {               // Object with custom field names and values
    [fieldName: string]: any;    // e.g., { deal_id: "12345" }
  };
}
```

**Returns**:
```typescript
{
  success: boolean;
  messageId?: string;           // Optional: message ID if available
  error?: string;               // Error message if failed
  details?: any;                // Additional error details
}
```

**Usage Example**:
```javascript
const sendpulseClient = new SendPulseClient();

// After sending message, update contact with deal_id
const updateResult = await sendpulseClient.updateContactCustomField(
  sendpulseId,
  { deal_id: dealId }
);

if (updateResult.success) {
  logger.info('Contact custom field updated', { contactId: sendpulseId, dealId });
} else {
  logger.warn('Failed to update contact custom field', { 
    contactId: sendpulseId, 
    error: updateResult.error 
  });
}
```

**Implementation Notes**:
- Uses SendPulse API endpoint: `PUT /contacts/{contact_id}` or `PATCH /contacts/{contact_id}`
- Custom fields are passed in `variables` object in payload
- Field names must match custom field names created in SendPulse UI/API
- Errors are logged but don't block message sending
- Should be called after successful message sending

## Error Handling

Все методы возвращают структурированные ошибки:

```typescript
{
  code: string;                 // Error code (e.g., 'TEST_DATA_CREATION_FAILED')
  message: string;              // Human-readable message
  details?: any;               // Additional error details
  correlationId: string;        // Correlation ID for logging
}
```

## Logging

Все операции логируются через Winston с structured logging:

```typescript
{
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId: string;
  testName?: string;
  testRunId?: string;
  metadata?: any;
}
```

