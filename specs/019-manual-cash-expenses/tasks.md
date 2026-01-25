# Tasks: Manual Cash Expenses for PNL Report

**Input**: Design documents from `/specs/019-manual-cash-expenses/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Tests are OPTIONAL per spec - not included unless explicitly requested.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Web app**: Backend in `src/`, Frontend in `frontend/`
- Paths follow existing project structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

- [x] T001 Verify existing project structure matches plan.md requirements
- [x] T002 Verify Supabase connection and database access in `src/services/supabaseClient.js`
- [x] T003 [P] Verify Express.js routing structure in `src/routes/api.js`
- [x] T004 [P] Verify frontend PNL report page exists at `frontend/pnl-report.html`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Create database migration script `scripts/migrations/019_allow_multiple_expense_entries.sql` to drop unique constraint for expense entries
- [x] T006 Add non-unique performance indexes in migration script `scripts/migrations/019_allow_multiple_expense_entries.sql` for expense entry queries
- [x] T007 Execute migration script against database and verify constraint removal
- [x] T008 Verify existing revenue entries still work (unique constraint preserved for revenue)

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Add Manual Cash Expense Entry (Priority: P1) 🎯 MVP

**Goal**: Users can add manual cash expenses by clicking a plus icon, opening a modal, entering amount and comment, and saving. Multiple entries per category/month are allowed.

**Independent Test**: Navigate to PNL report, find expense category with manual management type, click plus icon in month cell, enter amount and comment in modal, verify expense is saved and total displayed in cell.

### Implementation for User Story 1

- [x] T009 [US1] Add `createEntry()` method to `src/services/pnl/manualEntryService.js` that always inserts new entry (no upsert for expenses)
- [x] T010 [US1] Add validation in `createEntry()` method to check category exists and has `management_type = 'manual'`
- [x] T011 [US1] Add `getEntriesByCategoryMonth()` method to `src/services/pnl/manualEntryService.js` to return all entries for category/month
- [ ] T012 [US1] Add `POST /api/pnl/manual-entries` endpoint in `src/routes/api.js` that calls `createEntry()` for expense entries
- [ ] T013 [US1] Add request validation in POST endpoint for expenseCategoryId, year, month, amountPln (must be > 0)
- [ ] T014 [US1] Add error handling and logging in POST endpoint in `src/routes/api.js`
- [x] T015 [US1] Add plus icon (+) button to expense category month cells in `frontend/pnl-report-script.js` renderReport() function (only for manual categories)
- [x] T016 [US1] Add CSS styling for plus icon button in `frontend/style.css` or `frontend/pnl-report.html`
- [x] T017 [US1] Add modal HTML structure for adding expense entry in `frontend/pnl-report.html` with amount and comment fields
- [x] T018 [US1] Add `showAddExpenseModal()` function in `frontend/pnl-report-script.js` to open modal with category/year/month context
- [x] T019 [US1] Add `closeAddExpenseModal()` function in `frontend/pnl-report-script.js` to close modal and reset form
- [x] T020 [US1] Add `saveExpenseEntry()` function in `frontend/pnl-report-script.js` to validate inputs and call POST API endpoint
- [x] T021 [US1] Add event listener for plus icon clicks in `frontend/pnl-report-script.js` to trigger modal opening
- [x] T022 [US1] Add success handling in `saveExpenseEntry()` to close modal and refresh PNL report to show updated total
- [x] T023 [US1] Add error handling and user feedback in `saveExpenseEntry()` for API errors

**Checkpoint**: At this point, User Story 1 should be fully functional - users can add expense entries via plus icon and modal, entries are saved, and totals update.

---

## Phase 4: User Story 3 - Expense Totals Participate in PNL Calculations (Priority: P1)

**Goal**: Manual cash expenses are included in category totals, expense section totals, and profit/loss calculations.

**Independent Test**: Add manual cash expenses, verify they appear in category row totals, "Расходы" header row totals, and affect profit/loss calculations correctly.

**Dependencies**: Requires User Story 1 (entries must exist to aggregate)

### Implementation for User Story 3

- [x] T024 [US3] Update `getExpenseCategories()` method in `src/services/pnl/pnlReportService.js` to query all manual expense entries (not just one) using `getEntriesByCategoryMonth()`
- [x] T025 [US3] Update aggregation logic in `pnlReportService.js` to sum all entries for each category/month combination
- [x] T026 [US3] Update category total calculation in `pnlReportService.js` to include sum of all manual entries across all months
- [x] T027 [US3] Verify expense section totals ("Расходы" header row) include manual expense entries in `pnlReportService.js`
- [x] T028 [US3] Verify profit/loss calculations subtract manual expenses from revenue in `pnlReportService.js`
- [x] T029 [US3] Test aggregation with multiple entries per category/month to ensure correct summation

**Checkpoint**: At this point, User Stories 1 AND 3 should work together - entries are added and correctly aggregated in all totals.

---

## Phase 5: User Story 2 - View and Manage Multiple Expense Entries (Priority: P2)

**Goal**: Users can view all individual expense entries for a category/month, edit entries, and delete entries with confirmation.

**Independent Test**: Add multiple expense entries, click month cell, verify list shows all entries with amounts and comments, edit an entry, delete an entry with confirmation, verify totals update.

**Dependencies**: Requires User Story 1 (entries must exist to view/manage)

### Implementation for User Story 2

- [x] T030 [US2] Add `getEntryById()` method to `src/services/pnl/manualEntryService.js` to retrieve single entry by ID
- [x] T031 [US2] Add `updateEntryById()` method to `src/services/pnl/manualEntryService.js` to update entry amount and notes
- [x] T032 [US2] Add `deleteEntryById()` method to `src/services/pnl/manualEntryService.js` to delete entry by ID
- [x] T033 [US2] Add `GET /api/pnl/manual-entries/:id` endpoint in `src/routes/api.js` to get single entry by ID
- [x] T034 [US2] Add `PUT /api/pnl/manual-entries/:id` endpoint in `src/routes/api.js` to update entry by ID
- [x] T035 [US2] Add `DELETE /api/pnl/manual-entries/:id` endpoint in `src/routes/api.js` to delete entry by ID
- [x] T036 [US2] Add request validation in PUT endpoint for amountPln (must be > 0) and notes
- [x] T037 [US2] Add error handling and logging in GET/PUT/DELETE endpoints in `src/routes/api.js`
- [x] T038 [US2] Add modal HTML structure for expense list view in `frontend/pnl-report.html` showing all entries
- [x] T039 [US2] Add `showExpenseListModal()` function in `frontend/pnl-report-script.js` to fetch and display all entries for category/month
- [x] T040 [US2] Add `renderExpenseList()` function in `frontend/pnl-report-script.js` to render entry list with amounts, comments, and dates
- [x] T041 [US2] Add edit button and `editExpenseEntry()` function in `frontend/pnl-report-script.js` to open edit modal with pre-filled values
- [x] T042 [US2] Add delete button and `deleteExpenseEntry()` function in `frontend/pnl-report-script.js` with confirmation dialog
- [x] T043 [US2] Add edit modal HTML structure in `frontend/pnl-report.html` with pre-filled amount and comment fields
- [x] T044 [US2] Add `saveEditedExpenseEntry()` function in `frontend/pnl-report-script.js` to call PUT API endpoint
- [x] T045 [US2] Update cell click handler in `frontend/pnl-report-script.js` to show list modal (not inline edit) for expense categories
- [x] T046 [US2] Add CSS styling for expense list modal and entry items in `frontend/style.css` or `frontend/pnl-report.html`
- [x] T047 [US2] Add refresh logic after edit/delete operations to update list and cell totals
- [x] T048 [US2] Add "Add New" button in list modal to open add expense modal

**Checkpoint**: At this point, all user stories should work together - users can add, view, edit, and delete expense entries, and totals are correctly aggregated.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T049 [P] Add structured logging for entry creation operations in `src/routes/api.js` POST endpoint
- [ ] T050 [P] Add structured logging for entry update operations in `src/routes/api.js` PUT endpoint
- [ ] T051 [P] Add structured logging for entry deletion operations in `src/routes/api.js` DELETE endpoint
- [ ] T052 [P] Add error logging in frontend error handlers in `frontend/pnl-report-script.js`
- [ ] T053 Add loading indicators for async operations (modal save, list load) in `frontend/pnl-report-script.js`
- [ ] T054 Add user-friendly error messages for validation failures in frontend and backend
- [ ] T055 Add keyboard shortcuts (Enter to save, Escape to close) in modal handlers in `frontend/pnl-report-script.js`
- [ ] T056 Verify performance with 100+ entries per category/month (per SC-004)
- [ ] T057 Test edge cases: negative amounts, zero amounts, very large amounts, concurrent additions
- [ ] T058 Test empty state: category/month with no entries shows zero or "—"
- [ ] T059 Test year switching: entries persist correctly when switching between years
- [ ] T060 Run quickstart.md validation checklist
- [ ] T061 Code cleanup and refactoring of duplicate code
- [ ] T062 Update documentation if needed

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - **BLOCKS all user stories**
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User Story 1 (Phase 3): Can start immediately after Foundational
  - User Story 3 (Phase 4): Depends on User Story 1 (needs entries to aggregate)
  - User Story 2 (Phase 5): Depends on User Story 1 (needs entries to view/manage)
- **Polish (Phase 6)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P1)**: Can start after User Story 1 - Needs entries to exist for aggregation
- **User Story 2 (P2)**: Can start after User Story 1 - Needs entries to exist for viewing/managing

### Within Each User Story

- Backend service methods before API endpoints
- API endpoints before frontend integration
- Modal HTML before JavaScript handlers
- Core implementation before error handling and polish
- Story complete before moving to next priority

### Parallel Opportunities

- **Phase 1**: All setup tasks marked [P] can run in parallel
- **Phase 2**: Migration script creation and execution must be sequential
- **Phase 3 (US1)**: 
  - Backend service methods (T009-T011) can be done in parallel
  - Frontend modal HTML (T017) and JavaScript functions (T018-T023) can be done in parallel with backend
- **Phase 4 (US3)**: All aggregation tasks (T024-T029) can be done in parallel after US1 backend is complete
- **Phase 5 (US2)**: 
  - Backend service methods (T030-T032) can be done in parallel
  - API endpoints (T033-T037) can be done in parallel
  - Frontend list modal (T038-T048) can be done in parallel with backend
- **Phase 6**: All polish tasks marked [P] can run in parallel

---

## Parallel Example: User Story 1

```bash
# Backend service methods can be implemented in parallel:
Task: "Add createEntry() method to src/services/pnl/manualEntryService.js"
Task: "Add getEntriesByCategoryMonth() method to src/services/pnl/manualEntryService.js"

# Frontend modal and handlers can be implemented in parallel with backend:
Task: "Add modal HTML structure for adding expense entry in frontend/pnl-report.html"
Task: "Add showAddExpenseModal() function in frontend/pnl-report-script.js"
Task: "Add saveExpenseEntry() function in frontend/pnl-report-script.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup ✅
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories) ✅
3. Complete Phase 3: User Story 1 ✅
4. **STOP and VALIDATE**: Test User Story 1 independently
   - Add expense entry via plus icon
   - Verify entry saved in database
   - Verify total displayed in cell
   - Verify multiple entries can be added
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 3 → Test independently → Deploy/Demo (Full P1 functionality)
4. Add User Story 2 → Test independently → Deploy/Demo (Complete feature)
5. Add Polish → Final validation → Deploy

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (Backend + Frontend)
   - Developer B: Can start User Story 3 backend (aggregation) after US1 backend complete
   - Developer C: Can start User Story 2 after US1 complete
3. Stories complete and integrate independently

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Database migration (Phase 2) is CRITICAL and blocks all user story work
- User Story 3 can start backend work once US1 backend is complete (entries exist)
- User Story 2 requires US1 to be complete (entries must exist to view/manage)

