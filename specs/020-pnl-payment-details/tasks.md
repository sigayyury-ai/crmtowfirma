# Tasks: PNL Payment Details View

**Input**: Design documents from `/specs/020-pnl-payment-details/`
**Prerequisites**: spec.md (required for user stories)

**Tests**: Tests are OPTIONAL - not explicitly requested in the feature specification, so test tasks are not included.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Path Conventions

- **Backend**: `src/services/pnl/`, `src/routes/api.js`
- **Frontend**: `frontend/pnl-report-script.js`, `frontend/pnl-report.html`
- **Database**: Supabase PostgreSQL (payments, stripe_payments tables)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [X] T001 Review existing PNL report structure and payment data models
- [X] T002 [P] Review existing revenue category click handlers in frontend/pnl-report-script.js
- [X] T003 [P] Review existing API route structure in src/routes/api.js

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Verify database schema supports payment queries by income_category_id and date filtering
- [X] T005 Verify management_type field exists in pnl_revenue_categories table
- [X] T006 [P] Review existing payment service patterns in src/services/payments/paymentService.js
- [X] T007 [P] Review existing modal patterns in frontend/pnl-report-script.js (showRevenueListModal, showExpenseListModal)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View Payments for Category and Month (Priority: P1) 🎯 MVP

**Goal**: Display a list of all payments assigned to a specific revenue category for a specific month when clicking on the month cell for auto-managed categories.

**Independent Test**: Navigate to the PNL report, click on a month cell for any auto-managed revenue category, verify that a modal displays all payments assigned to that category for that month with payment details (amount, date, payer, source).

### Implementation for User Story 1

- [X] T008 [US1] Create paymentDetailsService.js in src/services/pnl/paymentDetailsService.js with method to fetch payments by category and month
- [X] T009 [US1] Implement getPaymentsByCategoryAndMonth method in src/services/pnl/paymentDetailsService.js that queries both payments and stripe_payments tables filtered by income_category_id and payment date month/year
- [X] T010 [US1] Add GET /api/pnl/payments endpoint in src/routes/api.js that accepts categoryId, year, and month query parameters
- [X] T011 [US1] Implement endpoint handler in src/routes/api.js that calls paymentDetailsService.getPaymentsByCategoryAndMonth and returns unified payment list
- [X] T012 [US1] Modify attachRevenueCellClickHandlers function in frontend/pnl-report-script.js to check category management_type before showing modal
- [X] T013 [US1] Add checkCategoryManagementType helper function in frontend/pnl-report-script.js to determine if category is auto or manual
- [X] T014 [US1] Create showPaymentListModal function in frontend/pnl-report-script.js to display payment list for auto-managed categories
- [X] T015 [US1] Create renderPaymentList function in frontend/pnl-report-script.js to render payment items with details (amount, date, payer, source)
- [X] T016 [US1] Add payment list modal HTML structure in frontend/pnl-report.html (or create dynamically in script)
- [X] T017 [US1] Update attachRevenueCellClickHandlers in frontend/pnl-report-script.js to call showPaymentListModal for auto categories instead of showRevenueListModal
- [X] T018 [US1] Ensure manual categories continue to use existing showRevenueListModal/showAddRevenueModal flow (no regression)
- [X] T019 [US1] Add error handling in showPaymentListModal for cases when payment list cannot be loaded
- [X] T020 [US1] Sort payments by date (most recent first) in renderPaymentList function
- [X] T021 [US1] Handle empty payment list case - display "Нет платежей" message when no payments found
- [X] T022 [US1] Add logging in paymentDetailsService.js for payment list queries
- [X] T023 [US1] Add logging in API endpoint handler for payment list requests

**Checkpoint**: At this point, User Story 1 should be fully functional - clicking month cells for auto categories shows payment list, manual categories continue to work as before

---

## Phase 4: User Story 2 - Unlink Payment from Category (Priority: P2)

**Goal**: Allow users to unlink a payment from a category if it was accidentally assigned, moving it back to "Uncategorized" (NULL income_category_id).

**Independent Test**: View payment details for a category and month, click unlink action for a specific payment, confirm the action, verify that payment's income_category_id is set to NULL and payment disappears from current category's list, then verify payment appears in "Uncategorized" category in PNL report.

### Implementation for User Story 2

- [X] T024 [US2] Add unlinkPaymentFromCategory method in src/services/pnl/paymentDetailsService.js that sets income_category_id to NULL
- [X] T025 [US2] Implement unlinkPaymentFromCategory to handle both payments and stripe_payments tables based on payment source
- [X] T026 [US2] Add PUT /api/pnl/payments/:id/unlink endpoint in src/routes/api.js that accepts payment ID and source type
- [X] T027 [US2] Implement endpoint handler in src/routes/api.js that calls paymentDetailsService.unlinkPaymentFromCategory
- [X] T028 [US2] Add confirmation dialog before unlinking payment in frontend/pnl-report-script.js
- [X] T029 [US2] Create unlinkPayment function in frontend/pnl-report-script.js that calls API endpoint to unlink payment
- [X] T030 [US2] Add unlink button/action to each payment item in renderPaymentList function in frontend/pnl-report-script.js
- [X] T031 [US2] Update payment list immediately after successful unlink (remove payment from list without full page refresh)
- [X] T032 [US2] Add error handling for unlink operation failures in frontend/pnl-report-script.js
- [X] T033 [US2] Refresh PNL report totals after unlinking payment by calling refreshPnlReportSilently in frontend/pnl-report-script.js
- [X] T034 [US2] Add logging in paymentDetailsService.js for unlink operations
- [X] T035 [US2] Add logging in API endpoint handler for unlink requests
- [ ] T036 [US2] Verify unlinked payment appears in "Uncategorized" category in PNL report (test manually)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently - users can view payments and unlink them from categories

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T037 [P] Add loading indicators during payment list fetch in frontend/pnl-report-script.js
- [ ] T038 [P] Add loading indicators during unlink operation in frontend/pnl-report-script.js
- [ ] T039 [P] Improve error messages for payment list loading failures
- [ ] T040 [P] Improve error messages for unlink operation failures
- [ ] T041 [P] Add payment count display in payment list modal header
- [ ] T042 [P] Format payment amounts consistently (currency formatting) in renderPaymentList
- [ ] T043 [P] Format payment dates consistently (date formatting) in renderPaymentList
- [ ] T044 [P] Add visual distinction between bank payments and Stripe payments in payment list
- [ ] T045 [P] Handle edge case: payment with missing date (filter or display appropriately)
- [ ] T046 [P] Handle edge case: payment with missing amount (display appropriately)
- [ ] T047 [P] Add pagination support if payment list exceeds 100 items (per SC-007)
- [ ] T048 [P] Code cleanup and refactoring - ensure consistent code style
- [ ] T049 [P] Verify manual categories continue to work correctly (regression test)
- [ ] T050 [P] Verify "Uncategorized" category displays correctly with unlinked payments

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed sequentially in priority order (P1 → P2)
  - US2 depends on US1 completion (unlink functionality needs payment list to exist)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Depends on User Story 1 completion - unlink functionality requires payment list UI to exist

### Within Each User Story

- Service layer before API endpoints
- API endpoints before frontend integration
- Core implementation before error handling and polish
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked [P] can run in parallel
- All Foundational tasks marked [P] can run in parallel (within Phase 2)
- Polish tasks marked [P] can run in parallel (within Phase 5)
- Service implementation and API endpoint implementation can be done in parallel within a story (different files)

---

## Parallel Example: User Story 1

```bash
# Service and API endpoint can be developed in parallel:
Task: "Create paymentDetailsService.js in src/services/pnl/paymentDetailsService.js"
Task: "Add GET /api/pnl/payments endpoint in src/routes/api.js"

# Frontend modal and rendering can be done after API is ready:
Task: "Create showPaymentListModal function in frontend/pnl-report-script.js"
Task: "Create renderPaymentList function in frontend/pnl-report-script.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Click month cell for auto category → see payment list
   - Click month cell for manual category → see manual entry modal (existing behavior)
   - Verify no regressions
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Each story adds value without breaking previous stories

### Sequential Strategy (Recommended)

Since US2 depends on US1:

1. Team completes Setup + Foundational together
2. Complete User Story 1 → Test → Deploy/Demo
3. Complete User Story 2 → Test → Deploy/Demo
4. Complete Polish phase → Final validation

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Manual categories must continue to work exactly as before (no regression)
- Payment list should handle both payments and stripe_payments tables
- Unlink operation must set income_category_id to NULL (not delete payment)
- After unlink, payment should appear in "Uncategorized" category automatically

