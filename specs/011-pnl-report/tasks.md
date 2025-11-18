# Implementation Tasks: PNL Report Service

**Feature**: 011-pnl-report  
**Branch**: `011-pnl-report`  
**Date**: 2025-11-18  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Overview

This document contains the implementation tasks for the PNL Report Service, organized by implementation phases. Tasks are ordered by dependencies and grouped by user stories to enable independent implementation and testing.

**MVP Scope**: Phase 1-3 (User Story 1 - MVP version without year selector)  
**Full Feature**: All phases

## Dependencies & Story Completion Order

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
Phase 3 [US1-MVP] → Can be tested independently
    ↓
Phase 4 [US2] → Depends on US1 (uses same service, adds year selector)
    ↓
Phase 5 (Polish)
```

**Independent Test Criteria**:
- **US1-MVP**: Navigate to `/pnl-report.html`, verify monthly revenue table displays for current year with processed payments only
- **US2**: Select different year from dropdown, verify report updates to show that year's data

## Implementation Strategy

**MVP First Approach**:
- Phase 1-3 implement MVP: Simple table with monthly revenue for current year (processed payments only)
- Phase 4 adds year selector and full functionality
- Phase 5 adds polish and optimizations

**Incremental Delivery**:
- Each phase delivers independently testable functionality
- MVP can be deployed and used before Phase 2 features are complete

---

## Phase 1: Setup

**Goal**: Initialize project structure and dependencies for PNL report service.

### Tasks

- [X] T001 Create service directory structure `src/services/pnl/`
- [X] T002 Create frontend directory structure for PNL report page
- [X] T003 Verify Supabase client configuration and `pnl_data` table access
- [X] T004 Review existing payment aggregation patterns in `src/services/vatMargin/paymentRevenueReportService.js`

---

## Phase 2: Foundational

**Goal**: Create core service infrastructure for PNL report aggregation.

### Tasks

- [X] T005 Create `src/services/pnl/pnlRepository.js` with basic Supabase query methods
- [X] T006 Create `src/services/pnl/pnlReportService.js` with class structure and constructor
- [X] T007 Implement helper methods in `pnlReportService.js`:
  - `convertToPln()` - reuse from existing services
  - `extractMonthFromDate()` - extract month number (1-12) from payment date
  - `isPaymentRefunded()` - check if payment is linked to refund
- [X] T008 Implement payment filtering logic in `pnlReportService.js`:
  - Filter processed payments: `manual_status = 'approved'` OR `match_status = 'matched'`
  - Filter Stripe payments: `stripe_payment_status = 'paid'`
  - Exclude refunded payments via refund tracking

---

## Phase 3: [US1-MVP] Monthly Revenue Table (Processed Payments Only)

**Goal**: Display simple monthly revenue table for current year based on processed payments only.

**Independent Test**: Navigate to `/pnl-report.html`, verify table displays monthly revenue totals for current year (2025), showing all 12 months with amounts in PLN. Only processed payments (approved/matched) should be included, refunds excluded.

### Backend Tasks

- [X] T009 [US1-MVP] Implement `getMonthlyRevenue()` method in `pnlReportService.js`:
  - Query processed payments from `payments` table (manual_status='approved' OR match_status='matched')
  - Query Stripe payments from `stripe_payments` table (stripe_payment_status='paid')
  - Filter by current year (default to 2025 or most recent year with data)
  - Exclude refunded payments
- [X] T010 [US1-MVP] Implement refund exclusion logic in `pnlReportService.js`:
  - Check `stripe_payment_deletions` table for matching deal_id
  - Check `deleted_proformas` table for linked proformas
  - Exclude Stripe payments with `stripe_payment_status = 'refunded'`
- [X] T011 [US1-MVP] Implement monthly aggregation in `pnlReportService.js`:
  - Group payments by month (extract month from payment date)
  - Sum amounts in PLN (use `payments_total_pln` or `amount_pln`)
  - Count payments per month
  - Ensure all 12 months are included (even if amount is 0)
- [X] T012 [US1-MVP] Implement currency conversion in `pnlReportService.js`:
  - Use existing `convertToPln()` helper
  - For Stripe: use `amount_pln` field directly
  - For ProForm: use `payments_total_pln` or calculate using `currency_exchange`
  - Round to 2 decimal places
- [X] T013 [US1-MVP] Add API endpoint `GET /api/pnl/report` in `src/routes/api.js`:
  - Year parameter optional (defaults to current year)
  - Call `pnlReportService.getMonthlyRevenue(year)`
  - Return JSON response with monthly data
  - Add error handling and logging
- [X] T014 [US1-MVP] Add structured logging to `pnlReportService.js`:
  - Log aggregation operations
  - Log refund exclusion counts
  - Log currency conversion operations
  - Use existing logger utility

### Frontend Tasks

- [X] T015 [US1-MVP] Create `frontend/pnl-report.html`:
  - Basic HTML structure following existing report page pattern
  - Container for monthly revenue table
  - Link to shared stylesheet
  - Include `pnl-report-script.js`
- [X] T016 [US1-MVP] Create `frontend/pnl-report-script.js`:
  - API call function to `/api/pnl/report`
  - Function to render monthly revenue table
  - Function to format currency (PLN)
  - Function to format month names (Январь, Февраль, etc.)
  - Load data on page load
- [X] T017 [US1-MVP] Implement table rendering in `frontend/pnl-report-script.js`:
  - Display all 12 months in table format
  - Show month name and amount in PLN
  - Handle zero amounts (show 0.00 or "—")
  - Add basic styling for table
- [X] T018 [US1-MVP] Add navigation link in `frontend/index.html`:
  - Add "PNL Отчет" link to main navigation
  - Link to `/pnl-report.html`
- [X] T019 [US1-MVP] Add error handling in `frontend/pnl-report-script.js`:
  - Handle API errors gracefully
  - Display error message to user
  - Show loading state while fetching data

---

## Phase 4: [US2] Year Selector and Full Functionality

**Goal**: Add year selector and complete functionality as per specification.

**Independent Test**: Select year 2026 from dropdown, verify report updates to show 2026 monthly revenue data. Switch back to 2025, verify data updates correctly.

### Backend Tasks

- [X] T020 [US2] Update `getMonthlyRevenue()` method in `pnlReportService.js`:
  - Accept year parameter (required in Phase 2)
  - Filter payments by selected year
  - Validate year parameter (2020-2030 range)
- [X] T021 [US2] Add currency breakdown to aggregation in `pnlReportService.js`:
  - Group by original currency before conversion
  - Include currency breakdown in response
  - Add `includeBreakdown` parameter support
- [X] T022 [US2] Add payment count per month to response in `pnlReportService.js`:
  - Count payments contributing to each month's revenue
  - Include in monthly entry response
- [X] T023 [US2] Add total summary to API response in `pnlReportService.js`:
  - Calculate total revenue for entire year
  - Calculate total payment count
  - Include in response
- [X] T024 [US2] Update API endpoint in `src/routes/api.js`:
  - Make year parameter required
  - Add `includeBreakdown` query parameter support
  - Update response format with totals and breakdown

### Frontend Tasks

- [X] T025 [US2] Add year selector UI in `frontend/pnl-report.html`:
  - Dropdown/select element for year selection
  - Options: 2025, 2026 (and future years as available)
  - Default to current year
- [X] T026 [US2] Implement year selector functionality in `frontend/pnl-report-script.js`:
  - Add event listener for year change
  - Reload data when year changes
  - Update API call with selected year
  - Show selected year in UI
- [X] T027 [US2] Add currency breakdown display in `frontend/pnl-report-script.js`:
  - Display original currency amounts if available
  - Show breakdown below or next to PLN amount
  - Format currency codes properly
- [X] T028 [US2] Add payment count display in `frontend/pnl-report-script.js`:
  - Show number of payments per month
  - Display in table or as additional column
- [X] T029 [US2] Add total summary display in `frontend/pnl-report.html`:
  - Display total revenue for selected year
  - Display total payment count
  - Format totals prominently
- [X] T030 [US2] Improve UI/UX in `frontend/pnl-report.html` and `pnl-report-script.js`:
  - Add loading spinner while fetching data
  - Improve table styling
  - Add responsive design considerations
  - Improve error message display

---

## Phase 5: Polish & Cross-Cutting Concerns

**Goal**: Add polish, optimizations, and cross-cutting improvements.

### Tasks

- [X] T031 Add input validation and sanitization in `pnlReportService.js`:
  - Validate year parameter
  - Handle invalid dates gracefully
  - Validate payment data before aggregation
- [X] T032 Add performance optimizations in `pnlReportService.js`:
  - Optimize database queries (add indexes if needed)
  - Consider caching for frequently accessed years
  - Optimize refund exclusion queries
- [X] T033 Improve error messages in `frontend/pnl-report-script.js`:
  - User-friendly error messages
  - Clear indication of what went wrong
  - Suggestions for resolving issues
- [X] T034 Add accessibility improvements in `frontend/pnl-report.html`:
  - Proper ARIA labels
  - Keyboard navigation support
  - Screen reader friendly
- [X] T035 Add responsive design improvements in `frontend/style.css`:
  - Mobile-friendly table layout
  - Responsive year selector
  - Proper spacing and typography
- [X] T036 Document API endpoint in code comments:
  - Add JSDoc comments to service methods
  - Document request/response formats
  - Document error cases

---

## Parallel Execution Opportunities

### Phase 3 (US1-MVP) - Can be parallelized:

- T009, T010, T011 can be developed in parallel (different methods in same service)
- T015, T016 can be developed in parallel with backend (frontend structure independent)
- T013 (API endpoint) depends on T009-T012 completion

### Phase 4 (US2) - Can be parallelized:

- T020, T021, T022 can be developed in parallel (different enhancements)
- T025, T026 can be developed in parallel with backend enhancements
- T027, T028, T029 can be developed in parallel (different UI features)

---

## Task Summary

**Total Tasks**: 36

**By Phase**:
- Phase 1 (Setup): 4 tasks
- Phase 2 (Foundational): 4 tasks
- Phase 3 (US1-MVP): 11 tasks
- Phase 4 (US2): 11 tasks
- Phase 5 (Polish): 6 tasks

**MVP Scope** (Phases 1-3): 19 tasks  
**Full Feature Scope**: 36 tasks

**Parallel Opportunities**: 
- Phase 3: ~6 tasks can be parallelized
- Phase 4: ~7 tasks can be parallelized

**Independent Test Criteria**:
- **US1-MVP**: Table displays monthly revenue for current year with processed payments only
- **US2**: Year selector allows switching between years and updates report accordingly

