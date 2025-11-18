# Implementation Plan: PNL Income Categories Management

**Branch**: `011-pnl-report` | **Date**: 2025-11-18 | **Spec**: [income-categories-spec.md](./income-categories-spec.md)
**Input**: Feature specification from `/specs/011-pnl-report/income-categories-spec.md`

## Summary

Add income categories management functionality to the PNL report service. Users can add, edit, and delete income categories through a settings section. The PNL report table displays revenue aggregated by categories with monthly breakdown.

**Implementation Phases**:
- **Phase 1 (MVP)**: Category management UI and API, basic category assignment
- **Phase 2**: Categorized revenue display in PNL report

## Technical Context

**Language/Version**: Node.js 18+ (JavaScript/ES6+)  
**Primary Dependencies**: Express.js, Supabase client (@supabase/supabase-js), existing PNL report service  
**Storage**: Supabase PostgreSQL (`pnl_revenue_categories` table, `income_category_id` fields in `payments` and `stripe_payments`)  
**Testing**: Manual testing via browser and API endpoints (no formal test framework currently in use)  
**Target Platform**: Web application (Node.js backend + HTML/JavaScript frontend)  
**Project Type**: Web application (backend API + frontend pages)  
**Performance Goals**: Settings page loads within 2 seconds, category operations complete within 1 second, categorized report loads within 3 seconds  
**Constraints**: Must prevent deletion of categories with associated payments, category names must be unique  
**Scale/Scope**: Manage up to 50 categories, support thousands of payments per category

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Invoice Data Fidelity
✅ **PASS**: This feature does not modify invoice creation or deal-to-invoice mapping. It only adds categorization metadata to existing payments.

### Reliable Automation Flow
✅ **PASS**: This feature adds new endpoints and UI for category management. It does not modify existing automation flows or scheduler logic. Category assignment is manual (out of scope for MVP).

### Transparent Observability
⚠️ **REQUIRES ATTENTION**: Must add structured logging for:
- Category CRUD operations
- Category validation failures
- Payment-to-category assignment operations
- Categorized report aggregation operations

### Secure Credential Stewardship
✅ **PASS**: No new API keys or secrets required. Uses existing Supabase configuration and authentication system.

### Spec-Driven Delivery Discipline
✅ **PASS**: Following spec → plan → tasks → implement workflow as required.

**Gate Status**: ✅ **PASS** (with logging requirements noted for Phase 1)

## Project Structure

### Documentation (this feature)

```text
specs/011-pnl-report/
├── income-categories-spec.md    # Feature specification
├── income-categories-plan.md    # This file (/speckit.plan command output)
├── income-categories-research.md # Phase 0 output (if needed)
├── income-categories-data-model.md # Phase 1 output
├── income-categories-contracts/  # Phase 1 output (API contracts)
└── income-categories-quickstart.md # Phase 1 output
```

### Source Code (repository root)

```text
src/
├── services/
│   └── pnl/
│       ├── pnlReportService.js          # Extend with category aggregation
│       └── incomeCategoryService.js      # New service for category management
├── routes/
│   └── api.js                            # Add category endpoints
└── index.js                              # Register new routes

frontend/
├── pnl-report.html                       # Extend with settings tab
├── pnl-report-script.js                  # Extend with category display logic
├── pnl-settings.html                     # New settings page (or tab)
├── pnl-settings-script.js                # Settings page JavaScript
└── style.css                             # Shared styles (may need additions)
```

**Structure Decision**: Extend existing PNL report infrastructure. Add settings as a new tab/section in the PNL report page or separate page accessible from navigation.

## Phase 0: Research & Design

**Status**: ✅ Complete

**Research Findings**: See [income-categories-research.md](./income-categories-research.md)

**Key Decisions**:
- Use `pnl_revenue_categories` table structure similar to `pnl_expense_categories`
- Add `income_category_id` columns to `payments` and `stripe_payments` with ON DELETE SET NULL
- Settings UI as tab in PNL report page (consistent with existing patterns)
- Virtual "Uncategorized" category for NULL values
- Database-level grouping for report aggregation

**Data Model**: See [income-categories-data-model.md](./income-categories-data-model.md)

**API Contracts**: See [income-categories-contracts/pnl-categories-api.yaml](./income-categories-contracts/pnl-categories-api.yaml)

**Quickstart Guide**: See [income-categories-quickstart.md](./income-categories-quickstart.md)

## Implementation Phases

### Phase 1: Category Management (MVP)

**Goal**: Enable users to manage income categories through settings UI.

**Scope**:
- Create/verify `pnl_revenue_categories` table in database
- Add `income_category_id` columns to `payments` and `stripe_payments` tables
- Implement category management API endpoints (CRUD)
- Create settings UI for category management (as tab in PNL report page)
- Add validation and error handling
- Add structured logging

**Deliverables**:
- Backend service: `src/services/pnl/incomeCategoryService.js`
- API endpoints: `GET/POST/PUT/DELETE /api/pnl/categories`
- Frontend settings tab: Add to `frontend/pnl-report.html`
- Frontend script: Extend `frontend/pnl-report-script.js` or create `pnl-settings-script.js`
- Database migrations: Add columns and indexes

**Success Criteria**:
- Users can add, edit, delete categories through UI
- Category names are validated (unique, non-empty, max 255 chars)
- Deletion is prevented for categories with associated payments
- All operations are logged with structured logging
- Settings tab accessible from PNL report page

### Phase 2: Categorized Revenue Display

**Goal**: Display revenue grouped by categories in PNL report.

**Scope**:
- Extend `pnlReportService.getMonthlyRevenue()` to support category grouping
- Update report aggregation logic to group by `income_category_id`
- Update frontend to display categorized data (grouped by category)
- Handle "Uncategorized" payments (NULL category_id)
- Update API endpoint to return categorized structure

**Deliverables**:
- Enhanced backend service with category aggregation
- Updated API endpoint `/api/pnl/report` with category grouping
- Enhanced frontend with category display (grouped sections or nested rows)
- Support for "Uncategorized" virtual category

**Success Criteria**:
- Report displays revenue grouped by categories
- Each category shows monthly totals (12 months)
- Uncategorized payments are grouped correctly
- Report loads within 3 seconds
- Sum of all categories equals total revenue

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

