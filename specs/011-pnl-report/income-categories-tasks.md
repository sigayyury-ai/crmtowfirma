# Implementation Tasks: PNL Income Categories Management

**Feature**: Income Categories Management (extension of 011-pnl-report)  
**Branch**: `011-pnl-report`  
**Date**: 2025-11-18  
**Spec**: [income-categories-spec.md](./income-categories-spec.md) | **Plan**: [income-categories-plan.md](./income-categories-plan.md)

## Overview

This document contains the implementation tasks for the PNL Income Categories Management feature, organized by implementation phases. Tasks are ordered by dependencies and grouped by user stories to enable independent implementation and testing.

**MVP Scope**: Phase 1-3 (User Story 1 - Category Management)  
**Full Feature**: All phases

## Dependencies & Story Completion Order

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
Phase 3 [US1] → Can be tested independently
    ↓
Phase 4 [US2] → Depends on US1 (uses categories from US1)
    ↓
Phase 5 (Polish)
```

**Independent Test Criteria**:
- **US1**: Navigate to PNL report settings tab, add category "Camp Payments", verify it appears in list. Edit name to "Camp Revenue", verify changes saved. Delete category, verify removed.
- **US2**: Navigate to PNL report, select year 2025, verify revenue displayed grouped by categories with monthly totals. Payments without category appear under "Uncategorized".

## Implementation Strategy

**MVP First Approach**:
- Phase 1-3 implement MVP: Category management UI and API
- Phase 4 adds categorized revenue display in report
- Phase 5 adds polish and optimizations

**Incremental Delivery**:
- Each phase delivers independently testable functionality
- MVP can be deployed and used before Phase 2 features are complete

---

## Phase 1: Setup

**Goal**: Initialize database structure and verify prerequisites for income categories.

### Tasks

- [ ] T001 Verify or create `pnl_revenue_categories` table in Supabase database
- [ ] T002 Add `income_category_id` column to `payments` table with foreign key constraint
- [ ] T003 Add `income_category_id` column to `stripe_payments` table with foreign key constraint
- [ ] T004 Create indexes on `income_category_id` columns for performance (`idx_payments_income_category`, `idx_stripe_payments_income_category`)
- [ ] T005 Verify database constraints (UNIQUE on category name, ON DELETE SET NULL on foreign keys)

---

## Phase 2: Foundational

**Goal**: Create core service infrastructure for category management.

### Tasks

- [ ] T006 Create `src/services/pnl/incomeCategoryService.js` with class structure and constructor
- [ ] T007 Implement `listCategories()` method in `incomeCategoryService.js`:
  - Query all categories from `pnl_revenue_categories` table
  - Order by name or created_at
  - Return array of category objects
- [ ] T008 Implement `getCategoryById(id)` method in `incomeCategoryService.js`:
  - Query single category by ID
  - Return category object or null if not found
- [ ] T009 Implement `createCategory(name, description)` method in `incomeCategoryService.js`:
  - Validate name (non-empty, max 255 chars)
  - Check uniqueness of name
  - Insert into `pnl_revenue_categories` table
  - Return created category
- [ ] T010 Implement `updateCategory(id, name, description)` method in `incomeCategoryService.js`:
  - Validate name (non-empty, max 255 chars)
  - Check uniqueness of name (excluding current category)
  - Update `pnl_revenue_categories` table
  - Return updated category
- [ ] T011 Implement `deleteCategory(id)` method in `incomeCategoryService.js`:
  - Check for associated payments in `payments` table
  - Check for associated payments in `stripe_payments` table
  - If payments found, throw error with count
  - If no payments, delete from `pnl_revenue_categories` table
- [ ] T012 Add structured logging to `incomeCategoryService.js`:
  - Log all CRUD operations
  - Log validation failures
  - Log deletion attempts with payment counts
  - Use existing logger utility

---

## Phase 3: [US1] Category Management UI and API

**Goal**: Enable users to manage income categories through settings UI.

**Independent Test**: Navigate to PNL report settings tab, add category "Camp Payments", verify it appears in list. Edit name to "Camp Revenue", verify changes saved. Delete category, verify removed. Try to delete category with payments, verify error message.

### Backend Tasks

- [ ] T013 [US1] Add API endpoint `GET /api/pnl/categories` in `src/routes/api.js`:
  - Call `incomeCategoryService.listCategories()`
  - Return JSON response with categories array
  - Add error handling and logging
- [ ] T014 [US1] Add API endpoint `POST /api/pnl/categories` in `src/routes/api.js`:
  - Validate request body (name required, description optional)
  - Call `incomeCategoryService.createCategory(name, description)`
  - Return JSON response with created category
  - Handle validation errors (duplicate name, empty name)
  - Add error handling and logging
- [ ] T015 [US1] Add API endpoint `GET /api/pnl/categories/:id` in `src/routes/api.js`:
  - Parse category ID from URL parameter
  - Call `incomeCategoryService.getCategoryById(id)`
  - Return JSON response with category or 404 if not found
  - Add error handling and logging
- [ ] T016 [US1] Add API endpoint `PUT /api/pnl/categories/:id` in `src/routes/api.js`:
  - Parse category ID from URL parameter
  - Validate request body (name required, description optional)
  - Call `incomeCategoryService.updateCategory(id, name, description)`
  - Return JSON response with updated category
  - Handle validation errors (duplicate name, empty name, not found)
  - Add error handling and logging
- [ ] T017 [US1] Add API endpoint `DELETE /api/pnl/categories/:id` in `src/routes/api.js`:
  - Parse category ID from URL parameter
  - Call `incomeCategoryService.deleteCategory(id)`
  - Return success response or error if category has payments
  - Handle error: "Cannot delete category with associated payments"
  - Add error handling and logging

### Frontend Tasks

- [ ] T018 [US1] Add "Настройки" tab to `frontend/pnl-report.html`:
  - Add tab button in tab header (similar to existing tabs)
  - Create tab content section with category management UI
  - Include category list container
  - Include add/edit category form
- [ ] T019 [US1] Implement category list display in `frontend/pnl-report-script.js`:
  - Function to fetch categories from `/api/pnl/categories`
  - Function to render category list table
  - Display: name, description, created date, actions (edit/delete)
  - Load categories on settings tab activation
- [ ] T020 [US1] Implement add category form in `frontend/pnl-report-script.js`:
  - Form with name input (required) and description textarea (optional)
  - Submit handler to call `POST /api/pnl/categories`
  - Success: refresh category list, clear form
  - Error: display validation error message
- [ ] T021 [US1] Implement edit category functionality in `frontend/pnl-report-script.js`:
  - Edit button opens form with pre-filled category data
  - Submit handler to call `PUT /api/pnl/categories/:id`
  - Success: refresh category list, close form
  - Error: display validation error message
- [ ] T022 [US1] Implement delete category functionality in `frontend/pnl-report-script.js`:
  - Delete button with confirmation dialog
  - Submit handler to call `DELETE /api/pnl/categories/:id`
  - Success: refresh category list
  - Error: display error message (especially if category has payments)
- [ ] T023 [US1] Add validation and error handling in `frontend/pnl-report-script.js`:
  - Client-side validation for empty category name
  - Display user-friendly error messages
  - Handle API errors gracefully
  - Show loading states during operations

---

## Phase 4: [US2] Categorized Revenue Display

**Goal**: Display revenue grouped by categories in PNL report with monthly breakdown.

**Independent Test**: Navigate to PNL report, select year 2025, verify revenue displayed grouped by categories. Each category shows monthly totals (12 months). Payments without category appear under "Uncategorized". Sum of all categories equals total revenue.

### Backend Tasks

- [ ] T024 [US2] Extend `getMonthlyRevenue()` method in `src/services/pnl/pnlReportService.js`:
  - Add optional `groupByCategory` parameter (default: false)
  - When enabled, group payments by `income_category_id` before monthly aggregation
  - Handle NULL `income_category_id` as "Uncategorized" category
- [ ] T025 [US2] Implement category aggregation logic in `pnlReportService.js`:
  - Load all categories from `pnl_revenue_categories` table
  - Group payments by category_id (including NULL)
  - Aggregate monthly totals per category
  - Create virtual "Uncategorized" entry for NULL category_id
- [ ] T026 [US2] Update response structure in `pnlReportService.js`:
  - Return structure: `{ categories: [{ id, name, monthly: [...] }], total: {...} }`
  - Each category includes monthly array (12 months)
  - Include "Uncategorized" category in response
  - Calculate totals per category and grand total
- [ ] T027 [US2] Update API endpoint `GET /api/pnl/report` in `src/routes/api.js`:
  - Add optional `groupByCategory` query parameter
  - Pass parameter to `pnlReportService.getMonthlyRevenue()`
  - Return categorized structure when enabled
  - Maintain backward compatibility (default: false)

### Frontend Tasks

- [ ] T028 [US2] Update `loadPnlReport()` function in `frontend/pnl-report-script.js`:
  - Add `groupByCategory=true` parameter to API call
  - Handle new response structure with categories array
- [ ] T029 [US2] Implement categorized report rendering in `frontend/pnl-report-script.js`:
  - Function to render report grouped by categories
  - Display each category as separate section or nested rows
  - Each category shows monthly totals (12 months)
  - Display "Uncategorized" category if present
- [ ] T030 [US2] Update report table structure in `frontend/pnl-report-script.js`:
  - Render category headers/grouping
  - Display monthly data per category
  - Show category totals
  - Show grand total across all categories
- [ ] T031 [US2] Add category display styling in `frontend/style.css`:
  - Styles for category grouping/sections
  - Styles for category headers
  - Nested table rows or separate sections
  - Visual distinction between categories

---

## Phase 5: Polish & Cross-Cutting Concerns

**Goal**: Add polish, optimizations, and cross-cutting improvements.

### Tasks

- [ ] T032 Add input sanitization in `incomeCategoryService.js`:
  - Sanitize category names (trim whitespace)
  - Sanitize descriptions
  - Validate name length (max 255 chars)
  - Validate description length (max 5000 chars)
- [ ] T033 Improve error messages in `frontend/pnl-report-script.js`:
  - User-friendly error messages for validation failures
  - Clear indication when category has payments (cannot delete)
  - Suggestions for resolving issues
- [ ] T034 Add loading states in `frontend/pnl-report-script.js`:
  - Show loading indicator while fetching categories
  - Show loading indicator during category operations (create/update/delete)
  - Disable form during submission
- [ ] T035 Add accessibility improvements in `frontend/pnl-report.html`:
  - Proper ARIA labels for category form inputs
  - ARIA labels for edit/delete buttons
  - Keyboard navigation support
  - Screen reader friendly
- [ ] T036 Add responsive design improvements in `frontend/style.css`:
  - Mobile-friendly category list layout
  - Responsive category form
  - Proper spacing and typography for category display
- [ ] T037 Document API endpoints in code comments:
  - Add JSDoc comments to service methods
  - Document request/response formats
  - Document error cases and validation rules

---

## Parallel Execution Opportunities

### Phase 3 (US1) - Can be parallelized:

- T013, T014, T015, T016, T017 can be developed in parallel (different endpoints)
- T019, T020, T021, T022 can be developed in parallel (different UI features)
- Backend endpoints (T013-T017) can be developed in parallel with frontend structure (T018)

### Phase 4 (US2) - Can be parallelized:

- T024, T025 can be developed in parallel (different aggregation methods)
- T028, T029 can be developed in parallel with backend (frontend structure independent)
- T030, T031 can be developed in parallel (different UI aspects)

---

## Task Summary

**Total Tasks**: 37

**By Phase**:
- Phase 1 (Setup): 5 tasks
- Phase 2 (Foundational): 7 tasks
- Phase 3 (US1): 11 tasks
- Phase 4 (US2): 8 tasks
- Phase 5 (Polish): 6 tasks

**MVP Scope** (Phases 1-3): 23 tasks  
**Full Feature Scope**: 37 tasks

**Parallel Opportunities**: 
- Phase 3: ~8 tasks can be parallelized
- Phase 4: ~5 tasks can be parallelized

**Independent Test Criteria**:
- **US1**: Settings tab allows adding, editing, deleting categories with proper validation
- **US2**: Report displays revenue grouped by categories with monthly breakdown, including "Uncategorized"







