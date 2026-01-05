# Tasks: Автотесты Stripe платежей

**Input**: Design documents from `/specs/015-stripe-payment-autotests/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Tests are included as this is a testing feature - test infrastructure and test cases are core deliverables.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and test infrastructure structure

- [ ] T001 Create test directory structure: `tests/integration/` and `tests/scripts/` directories
- [ ] T002 [P] Add environment variables documentation for test configuration in `env.example` (STRIPE_MODE=test, test Pipedrive credentials, test SendPulse credentials)
- [ ] T003 [P] Verify existing dependencies in `package.json` (no new packages needed per plan.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core test infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 Create `StripePaymentTestRunner` service class structure in `src/services/stripe/testRunner.js` with constructor and basic methods
- [ ] T005 [P] Implement `createTestDeal()` method in `src/services/stripe/testRunner.js` for creating test deals in Pipedrive with `[TEST]` prefix and `stripe_autotest` tag
- [ ] T006 [P] Implement `deleteTestDeal()` method in `src/services/stripe/testRunner.js` for cleaning up test deals from Pipedrive
- [ ] T007 [P] Implement `createTestSession()` helper method in `src/services/stripe/testRunner.js` for creating Stripe test mode sessions
- [ ] T008 [P] Implement `cleanupTestData()` method in `src/services/stripe/testRunner.js` for cleaning up all test data (deals, sessions, payments)
- [ ] T009 Implement `runTestSuite()` method in `src/services/stripe/testRunner.js` with test execution orchestration and result collection
- [ ] T010 Implement `runTest()` method in `src/services/stripe/testRunner.js` for executing individual test cases
- [ ] T011 [P] Implement test result logging structure in `src/services/stripe/testRunner.js` using Winston logger with correlation IDs
- [ ] T012 Create CLI script `tests/scripts/runStripePaymentTests.js` for manual test execution with command-line options
- [ ] T013 Add cron job registration in `src/services/scheduler.js` for daily test execution at 3:00 AM (Europe/Warsaw timezone)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - End-to-end тест создания первого платежа (deposit) (Priority: P1) 🎯 MVP

**Goal**: Система автоматически проверяет полный флоу создания первого платежа для графика 50/50: от получения webhook от Pipedrive до отправки уведомления клиенту через SendPulse.

**Independent Test**: Система создает тестовую сделку в Pipedrive, устанавливает invoice_type = 75, получает webhook, проверяет создание Checkout Session, сохранение в БД и отправку уведомления. Результаты записываются в логи.

### Implementation for User Story 1

- [ ] T014 [US1] Implement `testDepositPaymentCreation()` method in `src/services/stripe/testRunner.js` with test flow: create test deal → set invoice_type → simulate webhook → verify session → verify DB → verify notification
- [ ] T015 [US1] Add assertion logic in `testDepositPaymentCreation()` to verify Checkout Session created with payment_type='deposit' and payment_schedule='50/50' in `src/services/stripe/testRunner.js`
- [ ] T016 [US1] Add assertion logic in `testDepositPaymentCreation()` to verify payment saved to database with correct fields (session_id, deal_id, payment_type='deposit', payment_status='unpaid') in `src/services/stripe/testRunner.js`
- [ ] T017 [US1] Add assertion logic in `testDepositPaymentCreation()` to verify SendPulse notification sent with payment link and 50/50 schedule info in `src/services/stripe/testRunner.js`
- [ ] T018 [US1] Add assertion logic in `testDepositPaymentCreation()` to verify invoice_type field reset to null after session creation in `src/services/stripe/testRunner.js`
- [ ] T019 [US1] Add cleanup logic in `testDepositPaymentCreation()` finally block to delete test deal, session, and payment records in `src/services/stripe/testRunner.js`
- [ ] T020 [US1] Add error handling and logging for `testDepositPaymentCreation()` with correlation ID in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - End-to-end тест создания второго платежа (rest) (Priority: P1)

**Goal**: Система автоматически проверяет полный флоу создания второго платежа для графика 50/50: от оплаты первого платежа до создания и отправки уведомления о втором платеже.

**Independent Test**: Система создает тестовую сделку, оплачивает первый платеж через Stripe webhook, проверяет создание второго платежа через cron, и отправку уведомления. Результаты записываются в логи.

### Implementation for User Story 2

- [ ] T021 [US2] Implement `testRestPaymentCreation()` method in `src/services/stripe/testRunner.js` with test flow: create deal → pay deposit → trigger cron → verify rest session → verify notification
- [ ] T022 [US2] Add logic in `testRestPaymentCreation()` to simulate deposit payment via Stripe webhook (checkout.session.completed) in `src/services/stripe/testRunner.js`
- [ ] T023 [US2] Add logic in `testRestPaymentCreation()` to simulate cron trigger for second payment creation in `src/services/stripe/testRunner.js`
- [ ] T024 [US2] Add assertion logic in `testRestPaymentCreation()` to verify Checkout Session created with payment_type='rest' and payment_schedule='50/50' in `src/services/stripe/testRunner.js`
- [ ] T025 [US2] Add assertion logic in `testRestPaymentCreation()` to verify CRM stage updated to "Second Payment" (ID: 32) after deposit payment in `src/services/stripe/testRunner.js`
- [ ] T026 [US2] Add assertion logic in `testRestPaymentCreation()` to verify SendPulse notification sent with second payment link in `src/services/stripe/testRunner.js`
- [ ] T027 [US2] Add cleanup logic in `testRestPaymentCreation()` finally block to delete all test data in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - End-to-end тест единого платежа (single, 100%) (Priority: P1)

**Goal**: Система автоматически проверяет полный флоу создания единого платежа для графика 100%: от webhook до отправки уведомления.

**Independent Test**: Система создает тестовую сделку с графиком 100% (expected_close_date < 30 дней), получает webhook, проверяет создание Checkout Session на полную сумму, сохранение в БД и отправку уведомления. Результаты записываются в логи.

### Implementation for User Story 3

- [ ] T028 [US3] Implement `testSinglePaymentCreation()` method in `src/services/stripe/testRunner.js` with test flow: create deal with 100% schedule → set invoice_type → simulate webhook → verify session → verify DB → verify notification
- [ ] T029 [US3] Add logic in `testSinglePaymentCreation()` to create test deal with expected_close_date < 30 days to trigger 100% schedule in `src/services/stripe/testRunner.js`
- [ ] T030 [US3] Add assertion logic in `testSinglePaymentCreation()` to verify Checkout Session created with payment_type='single' and payment_schedule='100%' in `src/services/stripe/testRunner.js`
- [ ] T031 [US3] Add assertion logic in `testSinglePaymentCreation()` to verify payment saved to database with payment_type='single', payment_schedule='100%', payment_status='unpaid' in `src/services/stripe/testRunner.js`
- [ ] T032 [US3] Add assertion logic in `testSinglePaymentCreation()` to verify SendPulse notification sent with 100% schedule info in `src/services/stripe/testRunner.js`
- [ ] T033 [US3] Add cleanup logic in `testSinglePaymentCreation()` finally block to delete all test data in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Stories 1, 2, AND 3 should all work independently

---

## Phase 6: User Story 4 - Тест обработки оплаты через Stripe webhook (Priority: P1)

**Goal**: Система автоматически проверяет обработку успешной оплаты: от получения webhook от Stripe до обновления статусов в CRM и отправки инвойса.

**Independent Test**: Система создает тестовую Checkout Session, симулирует успешную оплату через Stripe webhook, проверяет обновление статуса в БД, обновление стадии в Pipedrive, и отправку инвойса клиенту. Результаты записываются в логи.

### Implementation for User Story 4

- [ ] T034 [US4] Implement `testPaymentProcessing()` method in `src/services/stripe/testRunner.js` with test flow: create session → simulate checkout.session.completed webhook → verify status updates → verify CRM stage → verify invoice
- [ ] T035 [US4] Add logic in `testPaymentProcessing()` to simulate Stripe webhook `checkout.session.completed` event in `src/services/stripe/testRunner.js`
- [ ] T036 [US4] Add assertion logic in `testPaymentProcessing()` to verify payment status updated to 'paid' in database in `src/services/stripe/testRunner.js`
- [ ] T037 [US4] Add assertion logic in `testPaymentProcessing()` to verify CRM stage updated correctly based on payment type (deposit → Second Payment ID:32, rest/single → Camp Waiter ID:27) in `src/services/stripe/testRunner.js`
- [ ] T038 [US4] Add assertion logic in `testPaymentProcessing()` to verify invoice sent to customer via Stripe in `src/services/stripe/testRunner.js`
- [ ] T039 [US4] Add cleanup logic in `testPaymentProcessing()` finally block to delete all test data in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Stories 1-4 should all work independently

---

## Phase 7: User Story 5 - Тест обработки истекших сессий (Priority: P2)

**Goal**: Система автоматически проверяет обработку истекших Checkout Sessions: от обнаружения истекшей сессии до создания новой и отправки уведомления.

**Independent Test**: Система создает тестовую Checkout Session, симулирует истечение сессии, проверяет обнаружение истекшей сессии, создание новой сессии и отправку уведомления. Результаты записываются в логи.

### Implementation for User Story 5

- [ ] T040 [US5] Implement `testExpiredSessionHandling()` method in `src/services/stripe/testRunner.js` with test flow: create session → simulate expiration → verify detection → verify recreation → verify notification
- [ ] T041 [US5] Add logic in `testExpiredSessionHandling()` to simulate session expiration (24 hours) in `src/services/stripe/testRunner.js`
- [ ] T042 [US5] Add assertion logic in `testExpiredSessionHandling()` to verify expired session detected in `src/services/stripe/testRunner.js`
- [ ] T043 [US5] Add assertion logic in `testExpiredSessionHandling()` to verify new session created with same payment_type and payment_schedule in `src/services/stripe/testRunner.js`
- [ ] T044 [US5] Add assertion logic in `testExpiredSessionHandling()` to verify SendPulse notification sent with new payment link in `src/services/stripe/testRunner.js`
- [ ] T045 [US5] Add cleanup logic in `testExpiredSessionHandling()` finally block to delete all test data in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Stories 1-5 should all work independently

---

## Phase 8: User Story 6 - Тест обработки возврата платежа (Priority: P2)

**Goal**: Система автоматически проверяет обработку возврата платежа: от получения webhook charge.refunded до пересчета стадии сделки.

**Independent Test**: Система создает тестовую сделку с оплаченным платежом, симулирует возврат через Stripe webhook, проверяет логирование возврата в БД и пересчет стадии сделки. Результаты записываются в логи.

### Implementation for User Story 6

- [ ] T046 [US6] Implement `testRefundProcessing()` method in `src/services/stripe/testRunner.js` with test flow: create deal → pay payment → simulate charge.refunded webhook → verify refund logged → verify stage recalculated
- [ ] T047 [US6] Add logic in `testRefundProcessing()` to simulate Stripe webhook `charge.refunded` event in `src/services/stripe/testRunner.js`
- [ ] T048 [US6] Add assertion logic in `testRefundProcessing()` to verify refund logged in `stripe_payment_deletions` table in `src/services/stripe/testRunner.js`
- [ ] T049 [US6] Add assertion logic in `testRefundProcessing()` to verify CRM stage recalculated correctly (deposit refund → previous stage) in `src/services/stripe/testRunner.js`
- [ ] T050 [US6] Add cleanup logic in `testRefundProcessing()` finally block to delete all test data in `src/services/stripe/testRunner.js`

**Checkpoint**: At this point, User Stories 1-6 should all work independently

---

## Phase 9: Additional Feature - SendPulse Contact Deal ID Sync

**Goal**: При отправке сообщения в SendPulse обновлять кастомное поле контакта с deal_id из CRM для связи SendPulse контакта с CRM сделкой.

**Independent Test**: После успешной отправки сообщения через SendPulse, кастомное поле контакта обновляется с deal_id. Ошибки обновления не блокируют отправку сообщения.

### Implementation for SendPulse Contact Deal ID Sync

- [ ] T051 [P] Add `updateContactCustomField()` method in `src/services/sendpulse.js` for updating contact custom fields via SendPulse API (PUT /contacts/{contact_id})
- [ ] T052 Update `sendPaymentNotificationForDeal()` method in `src/services/stripe/processor.js` to call `updateContactCustomField()` after successful message sending
- [ ] T053 Update SendPulse notification calls in `src/routes/pipedriveWebhook.js` to update deal_id field after successful message sending
- [ ] T054 Update SendPulse notification calls in `scripts/create-session-for-deal.js` to update deal_id field after successful message sending
- [ ] T055 Update SendPulse notification calls in `scripts/recreate-expired-sessions.js` to update deal_id field after successful message sending
- [ ] T056 Add environment variable `SENDPULSE_DEAL_ID_FIELD_NAME` configuration with default value 'deal_id' in `env.example`
- [ ] T057 Add error handling in `updateContactCustomField()` to log errors but not block message sending in `src/services/sendpulse.js`

**Checkpoint**: SendPulse contact sync feature complete and integrated

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories and final integration

- [ ] T058 [P] Add test summary logging with total tests, passed, failed, skipped, and execution duration in `src/services/stripe/testRunner.js`
- [ ] T059 [P] Add timeout handling for test execution (10 minutes max per test suite) in `src/services/stripe/testRunner.js`
- [ ] T060 [P] Implement scheduled cleanup cron job in `src/services/scheduler.js` for orphaned test data (daily at 4:00 AM)
- [ ] T061 [P] Add retry logic for external API calls (Pipedrive, Stripe, SendPulse) with exponential backoff in `src/services/stripe/testRunner.js`
- [ ] T062 [P] Add graceful error handling for test failures without affecting production functionality in `src/services/stripe/testRunner.js`
- [ ] T063 [P] Update documentation in `specs/015-stripe-payment-autotests/quickstart.md` with actual implementation details
- [ ] T064 [P] Add validation for test data isolation (verify STRIPE_MODE=test, test markers, etc.) in `src/services/stripe/testRunner.js`
- [ ] T065 [P] Add correlation ID tracking throughout test execution for better log analysis in `src/services/stripe/testRunner.js`
- [ ] T066 Run quickstart.md validation to ensure all examples work correctly

---

## Phase 11: Code Cleanup & Legacy Removal

**Purpose**: Ensure codebase cleanliness - no unused code, no legacy files, maintain order

**⚠️ CRITICAL**: This phase ensures code quality and maintainability. All unused code must be removed.

### Code Analysis & Cleanup

- [ ] T067 [P] Scan `src/services/stripe/` directory for unused exports and remove them (check all require() statements)
- [ ] T068 [P] Scan `src/services/` directory for unused service methods and remove them (check all method calls)
- [ ] T069 [P] Scan `src/routes/` directory for unused route handlers and remove them (check all route registrations)
- [ ] T070 [P] Check all modified files (`processor.js`, `sendpulse.js`, `pipedriveWebhook.js`) for unused imports and remove them
- [ ] T071 [P] Verify all new code in `testRunner.js` doesn't duplicate existing functionality from other services
- [ ] T072 [P] Check for dead code paths in modified files (unreachable code, commented-out blocks)
- [ ] T073 [P] Remove any TODO/FIXME comments that are no longer relevant after implementation

### Legacy File Detection

- [ ] T074 [P] Scan `scripts/` directory for deprecated or unused scripts and mark for removal (check for "deprecated", "legacy", "unused" comments)
- [ ] T075 [P] Verify all scripts in `scripts/` are referenced in documentation or actively used
- [ ] T076 [P] Check for duplicate functionality between scripts and consolidate if needed
- [ ] T077 [P] Remove or archive deprecated scripts (e.g., `reapprove-dec-payments.js` if marked as deprecated)

### Import & Dependency Cleanup

- [ ] T078 [P] Run dependency analysis to find unused npm packages in `package.json` (use tools like `depcheck` or manual review)
- [ ] T079 [P] Remove unused imports from all modified files (`processor.js`, `sendpulse.js`, `pipedriveWebhook.js`, `scheduler.js`)
- [ ] T080 [P] Verify all new imports in `testRunner.js` are actually used

### File Structure Validation

- [ ] T081 [P] Verify no orphaned files were created (files not imported anywhere)
- [ ] T082 [P] Check that all new files (`testRunner.js`, test files) are properly exported/imported
- [ ] T083 [P] Ensure no temporary or backup files remain in the codebase (check for `.bak`, `.tmp`, `.old` files)

### Documentation Cleanup

- [ ] T084 [P] Update `README.md` if new scripts or services were added
- [ ] T085 [P] Remove outdated documentation references to removed code
- [ ] T086 [P] Verify all code examples in documentation are still valid after changes

### Final Validation

- [ ] T087 Run full codebase search for "deprecated", "legacy", "unused", "remove", "delete" comments and verify all are addressed
- [ ] T088 [P] Run linter/static analysis to catch unused variables, functions, imports
- [ ] T089 [P] Verify no console.log or debug statements remain in production code (use logger instead)
- [ ] T090 Final code review: ensure all code follows project conventions and no legacy patterns remain

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2)
- **SendPulse Sync (Phase 9)**: Can be done in parallel with user stories (different files)
- **Polish (Phase 10)**: Depends on all desired user stories being complete
- **Code Cleanup (Phase 11)**: Depends on all implementation phases being complete - must run before final deployment

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - Uses similar patterns to US1 but independently testable
- **User Story 3 (P1)**: Can start after Foundational (Phase 2) - Uses similar patterns to US1 but independently testable
- **User Story 4 (P1)**: Can start after Foundational (Phase 2) - Uses similar patterns to US1 but independently testable
- **User Story 5 (P2)**: Can start after Foundational (Phase 2) - Uses similar patterns to US1 but independently testable
- **User Story 6 (P2)**: Can start after Foundational (Phase 2) - Uses similar patterns to US1 but independently testable

### Within Each User Story

- Test data creation before test execution
- Test execution before assertions
- Assertions before cleanup
- Cleanup in finally block (guaranteed execution)
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- SendPulse sync tasks (Phase 9) can run in parallel with user stories
- All Polish tasks marked [P] can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch foundational tasks in parallel:
Task: "Implement createTestDeal() method in src/services/stripe/testRunner.js"
Task: "Implement deleteTestDeal() method in src/services/stripe/testRunner.js"
Task: "Implement createTestSession() helper method in src/services/stripe/testRunner.js"
Task: "Implement cleanupTestData() method in src/services/stripe/testRunner.js"
Task: "Implement test result logging structure in src/services/stripe/testRunner.js"

# Once foundational is done, User Story 1 can proceed:
Task: "Implement testDepositPaymentCreation() method in src/services/stripe/testRunner.js"
# Then add assertions sequentially as they depend on test execution
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1 (Deposit Payment Creation)
4. **STOP and VALIDATE**: Test User Story 1 independently via CLI script
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Add User Story 4 → Test independently → Deploy/Demo
6. Add User Stories 5-6 (P2) → Test independently → Deploy/Demo
7. Add SendPulse sync → Test independently → Deploy/Demo
8. Add Polish improvements → Test → **Code Cleanup (Phase 11)** → Final validation → Deploy

**⚠️ IMPORTANT**: Phase 11 (Code Cleanup) is mandatory before final deployment to ensure codebase cleanliness.

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Deposit)
   - Developer B: User Story 2 (Rest)
   - Developer C: User Story 3 (Single)
   - Developer D: User Story 4 (Payment Processing)
3. Then:
   - Developer A: User Story 5 (Expired Sessions)
   - Developer B: User Story 6 (Refunds)
   - Developer C: SendPulse Sync
   - Developer D: Polish tasks
4. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- All tests use test mode (STRIPE_MODE=test) to avoid production impact
- Test data is marked with `[TEST]` prefix and `stripe_autotest` tag
- Cleanup is critical - all test data must be removed after execution
- Correlation IDs are used throughout for log tracking
- Errors in test execution should not affect production functionality
- **Code Quality**: Phase 11 (Code Cleanup) is mandatory - no unused code or legacy files allowed
- **File Strategy**: New files for test infrastructure, minimal modifications to existing files
- **Legacy Prevention**: All new code must be actively used, no dead code paths
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence, unused code, legacy patterns

---

## Task Summary

- **Total Tasks**: 90
- **Phase 1 (Setup)**: 3 tasks
- **Phase 2 (Foundational)**: 10 tasks
- **Phase 3 (US1 - Deposit)**: 7 tasks
- **Phase 4 (US2 - Rest)**: 7 tasks
- **Phase 5 (US3 - Single)**: 6 tasks
- **Phase 6 (US4 - Payment Processing)**: 6 tasks
- **Phase 7 (US5 - Expired Sessions)**: 6 tasks
- **Phase 8 (US6 - Refunds)**: 5 tasks
- **Phase 9 (SendPulse Sync)**: 7 tasks
- **Phase 10 (Polish)**: 9 tasks
- **Phase 11 (Code Cleanup & Legacy Removal)**: 24 tasks ⚠️ **CRITICAL for code quality**

**MVP Scope**: Phases 1-3 (Setup + Foundational + User Story 1) = 20 tasks

**Code Quality Requirement**: Phase 11 must be completed before final deployment to ensure no legacy code remains.

