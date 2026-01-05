# Feature Specification: Автотесты Stripe платежей

**Feature Branch**: `015-stripe-payment-autotests`  
**Created**: 2025-01-27  
**Status**: ✅ Ready for Planning  
**Input**: User description: "а также добавь сразу авто тесты API и. не только и повесь их на крон раз в сутки. с выводом в логи. Важно стабилизировать этот функционал . Автотесты от вебхука до отправки уведомления ."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - End-to-end тест создания первого платежа (deposit) (Priority: P1)

Система автоматически проверяет полный флоу создания первого платежа для графика 50/50: от получения webhook от Pipedrive до отправки уведомления клиенту через SendPulse.

**Why this priority**: Первый платеж - критический путь, который должен работать стабильно. Автотесты помогут выявить проблемы до того, как они повлияют на реальных клиентов.

**Independent Test**: Система создает тестовую сделку в Pipedrive, устанавливает invoice_type = 75, получает webhook, проверяет создание Checkout Session, сохранение в БД и отправку уведомления. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** тестовая сделка с графиком 50/50 (expected_close_date >= 30 дней), **When** система получает webhook с invoice_type = 75, **Then** создается Checkout Session типа deposit на 50% суммы, платеж сохраняется в БД со статусом 'unpaid', и отправляется уведомление через SendPulse
2. **Given** тестовая сделка с графиком 50/50, **When** создан deposit платеж, **Then** в БД есть запись с payment_type = 'deposit', payment_schedule = '50/50', payment_status = 'unpaid'
3. **Given** создан deposit платеж, **When** система проверяет уведомление, **Then** SendPulse получил сообщение с ссылкой на оплату и информацией о графике 50/50

---

### User Story 2 - End-to-end тест создания второго платежа (rest) (Priority: P1)

Система автоматически проверяет полный флоу создания второго платежа для графика 50/50: от оплаты первого платежа до создания и отправки уведомления о втором платеже.

**Why this priority**: Второй платеж критичен для завершения сделки. Автотесты гарантируют, что система правильно обрабатывает переход от первого ко второму платежу.

**Independent Test**: Система создает тестовую сделку, оплачивает первый платеж через Stripe webhook, проверяет создание второго платежа через cron, и отправку уведомления. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** тестовая сделка с оплаченным deposit платежом и графиком 50/50, **When** наступает дата второго платежа (expected_close_date - 1 месяц), **Then** cron создает Checkout Session типа rest на 50% суммы и отправляет уведомление
2. **Given** оплачен deposit платеж, **When** система обрабатывает webhook checkout.session.completed, **Then** стадия сделки обновляется на "Second Payment" (ID: 32)
3. **Given** создан rest платеж, **When** система проверяет уведомление, **Then** SendPulse получил сообщение с ссылкой на второй платеж

---

### User Story 3 - End-to-end тест единого платежа (single, 100%) (Priority: P1)

Система автоматически проверяет полный флоу создания единого платежа для графика 100%: от webhook до отправки уведомления.

**Why this priority**: Единый платеж - альтернативный сценарий, который должен работать так же стабильно, как и график 50/50.

**Independent Test**: Система создает тестовую сделку с графиком 100% (expected_close_date < 30 дней), получает webhook, проверяет создание Checkout Session на полную сумму, сохранение в БД и отправку уведомления. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** тестовая сделка с графиком 100% (expected_close_date < 30 дней), **When** система получает webhook с invoice_type = 75, **Then** создается Checkout Session типа single на 100% суммы, платеж сохраняется в БД, и отправляется уведомление
2. **Given** создан single платеж, **When** система проверяет данные в БД, **Then** запись имеет payment_type = 'single', payment_schedule = '100%', payment_status = 'unpaid'
3. **Given** создан single платеж, **When** система проверяет уведомление, **Then** SendPulse получил сообщение с информацией о графике 100%

---

### User Story 4 - Тест обработки оплаты через Stripe webhook (Priority: P1)

Система автоматически проверяет обработку успешной оплаты: от получения webhook от Stripe до обновления статусов в CRM и отправки инвойса.

**Why this priority**: Обработка оплаты - критический путь, который должен работать без ошибок. Автотесты гарантируют корректное обновление статусов и отправку документов.

**Independent Test**: Система создает тестовую Checkout Session, симулирует успешную оплату через Stripe webhook, проверяет обновление статуса в БД, обновление стадии в Pipedrive, и отправку инвойса клиенту. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** создан Checkout Session для тестовой сделки, **When** система получает webhook checkout.session.completed от Stripe, **Then** платеж в БД обновляется на payment_status = 'paid', стадия сделки обновляется в Pipedrive, и инвойс отправлен клиенту
2. **Given** оплачен deposit платеж (график 50/50), **When** система обрабатывает webhook, **Then** стадия сделки обновляется на "Second Payment" (ID: 32)
3. **Given** оплачен rest платеж (график 50/50), **When** система обрабатывает webhook, **Then** стадия сделки обновляется на "Camp Waiter" (ID: 27)
4. **Given** оплачен single платеж (график 100%), **When** система обрабатывает webhook, **Then** стадия сделки обновляется на "Camp Waiter" (ID: 27)

---

### User Story 5 - Тест обработки истекших сессий (Priority: P2)

Система автоматически проверяет обработку истекших Checkout Sessions: от обнаружения истекшей сессии до создания новой и отправки уведомления.

**Why this priority**: Истекшие сессии требуют восстановления для обеспечения непрерывности процесса оплаты. Автотесты гарантируют, что система правильно обрабатывает этот сценарий.

**Independent Test**: Система создает тестовую Checkout Session, симулирует истечение сессии, проверяет обнаружение истекшей сессии, создание новой сессии и отправку уведомления. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** создан Checkout Session для тестовой сделки, **When** сессия истекает (24 часа), **Then** система обнаруживает истекшую сессию, создает новую сессию того же типа, и отправляет уведомление клиенту
2. **Given** истекшая deposit сессия, **When** система восстанавливает сессию, **Then** создается новая deposit сессия с той же суммой и графиком

---

### User Story 6 - Тест обработки возврата платежа (Priority: P2)

Система автоматически проверяет обработку возврата платежа: от получения webhook charge.refunded до пересчета стадии сделки.

**Why this priority**: Возвраты требуют корректной обработки для поддержания актуальности данных в CRM. Автотесты гарантируют правильный пересчет статусов.

**Independent Test**: Система создает тестовую сделку с оплаченным платежом, симулирует возврат через Stripe webhook, проверяет логирование возврата в БД и пересчет стадии сделки. Результаты записываются в логи.

**Acceptance Scenarios**:

1. **Given** тестовая сделка с оплаченным платежом, **When** система получает webhook charge.refunded от Stripe, **Then** возврат залогирован в stripe_payment_deletions, и стадия сделки пересчитана
2. **Given** возвращен deposit платеж (график 50/50), **When** система обрабатывает возврат, **Then** стадия сделки возвращается к предыдущей стадии

---

### Edge Cases

- Что происходит, когда webhook приходит дважды (дубликат)?
- Как система обрабатывает webhook, когда сделка уже удалена?
- Что происходит, когда SendPulse недоступен при отправке уведомления?
- Как система обрабатывает webhook, когда email клиента отсутствует?
- Что происходит, когда expected_close_date изменяется после создания первого платежа?
- Как система обрабатывает изменение графика с 50/50 на 100% после создания deposit?
- Что происходит, когда Stripe API недоступен при проверке статуса сессии?
- Как система обрабатывает race condition при параллельном создании сессий?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically run end-to-end tests for Stripe payment flow once per day via cron schedule
- **FR-002**: System MUST test complete flow from Pipedrive webhook receipt to SendPulse notification delivery
- **FR-003**: System MUST test creation of deposit payment (50/50 schedule) including Checkout Session creation, database persistence, and notification sending
- **FR-004**: System MUST test creation of rest payment (50/50 schedule) including cron-triggered creation and notification sending
- **FR-005**: System MUST test creation of single payment (100% schedule) including Checkout Session creation and notification sending
- **FR-006**: System MUST test payment processing via Stripe webhook including status updates in database and CRM stage changes
- **FR-007**: System MUST test expired session handling including detection, recreation, and notification sending
- **FR-008**: System MUST test refund processing including logging and CRM stage recalculation
- **FR-009**: System MUST log all test results including test name, execution time, success/failure status, and detailed error messages if any
- **FR-010**: System MUST use test data that does not interfere with production data (test deals, test Stripe sessions, test notifications)
- **FR-011**: System MUST clean up test data after test execution (test deals, test Stripe sessions, test database records)
- **FR-012**: System MUST verify that Checkout Sessions are created with correct metadata (deal_id, payment_type, payment_schedule)
- **FR-013**: System MUST verify that payments are saved to database with correct fields (session_id, deal_id, payment_type, payment_status, amount)
- **FR-014**: System MUST verify that CRM stages are updated correctly based on payment type and schedule
- **FR-015**: System MUST verify that notifications are sent via SendPulse with correct content (payment amount, schedule, payment link)
- **FR-016**: System MUST verify that invoice_type field is reset to null after successful session creation
- **FR-017**: System MUST handle test failures gracefully without affecting production functionality
- **FR-018**: System MUST provide test summary in logs including total tests run, passed, failed, and execution duration

### Key Entities *(include if feature involves data)*

- **TestRun**: Represents a single execution of the test suite with timestamp, duration, results summary, and individual test outcomes
- **TestResult**: Represents outcome of a single test case including test name, status (passed/failed), execution time, error details if failed, and verified assertions
- **TestDeal**: Temporary test deal created in Pipedrive for testing purposes, marked with special identifier to distinguish from production deals
- **TestSession**: Temporary Stripe Checkout Session created for testing, using test mode Stripe keys
- **TestNotification**: Test notification sent via SendPulse to test recipient, marked to avoid confusion with production notifications

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Test suite executes successfully once per day via cron schedule with 100% reliability (no missed executions)
- **SC-002**: All critical path tests (deposit, rest, single payment creation) pass with 95% success rate over 30 days
- **SC-003**: Test execution completes within 10 minutes for full test suite
- **SC-004**: Test logs provide sufficient detail to diagnose failures within 5 minutes of review
- **SC-005**: Test data cleanup is 100% effective (no test deals, sessions, or database records remain after test execution)
- **SC-006**: System detects and reports test failures immediately in logs with actionable error messages
- **SC-007**: Test coverage includes all critical payment flows (webhook → session creation → payment processing → notification) with 100% coverage of primary scenarios
- **SC-008**: Test execution does not impact production functionality (0 production deals affected, 0 production notifications sent to real customers)

## Assumptions

- Test environment has access to test Pipedrive account or test deals can be created in production account with special marking
- Test environment has access to Stripe test mode keys (STRIPE_MODE=test)
- Test environment has access to SendPulse test account or test notifications can be sent to test recipient
- Cron scheduler supports daily execution at specified time (recommended: early morning to minimize impact)
- Test data can be safely created and deleted without affecting production operations
- System has sufficient logging infrastructure to store and retrieve test execution logs
- Test execution time is acceptable even if it takes up to 10 minutes
- Test failures do not block production functionality (tests run in isolated mode)

## Dependencies

- Existing Stripe payment processing functionality (createCheckoutSessionForDeal, persistSession)
- Existing Pipedrive webhook handler (pipedriveWebhook.js)
- Existing Stripe webhook handler (stripeWebhook.js)
- Existing SendPulse notification service
- Existing cron scheduler infrastructure
- Existing logging infrastructure
- Test Pipedrive account or ability to create test deals
- Stripe test mode API keys
- SendPulse test account or test recipient

## Out of Scope

- Performance/load testing (only functional end-to-end tests)
- Security testing (authentication, authorization)
- UI testing (only backend API and webhook flows)
- Integration with external payment gateways other than Stripe
- Testing of wFirma proforma creation (only Stripe payment flow)
- Testing of cash payment functionality (only Stripe payment flow)
- Manual test execution (only automated cron-based execution)
