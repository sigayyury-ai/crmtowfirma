# Implementation Plan: Manual Cash Expenses for PNL Report

**Branch**: `019-manual-cash-expenses` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-manual-cash-expenses/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

This feature adds the ability to create multiple manual cash expense entries per expense category and month in the PNL report. Users can click a plus icon in each month cell to open a modal dialog, enter amount and comment, and add multiple entries that are automatically summed and included in expense totals. The implementation requires removing unique constraints from the database to allow multiple entries, updating the backend service to support listing and deleting individual entries, and enhancing the frontend with a plus icon, modal dialog, and entry list view.

## Technical Context

**Language/Version**: Node.js 18+ (JavaScript/ES6+)  
**Primary Dependencies**: Express.js, Supabase Client (@supabase/supabase-js), PostgreSQL  
**Storage**: PostgreSQL (via Supabase) - `pnl_manual_entries` table  
**Testing**: Jest (existing test infrastructure)  
**Target Platform**: Web application (backend API + frontend HTML/JS)  
**Project Type**: Web application (backend + frontend)  
**Performance Goals**: 
- Modal opens/closes within 200ms (SC-005)
- Total updates within 1 second after CRUD operations (SC-006)
- Support 100+ entries per category/month without degradation (SC-004)
- Entry deletion within 5 seconds (SC-009)
**Constraints**: 
- Must maintain backward compatibility with existing single-entry-per-month behavior for revenue categories
- Database migration must not break existing data
- Frontend must work with existing PNL report structure
**Scale/Scope**: 
- Multiple expense entries per category/month (currently limited to 1)
- Frontend modal and list view components
- Backend API endpoints for CRUD operations on individual entries
- Database schema change (remove unique constraint)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Invoice Data Fidelity
✅ **PASS** - This feature does not modify invoice or proforma data. It only adds manual expense tracking.

### Reliable Automation Flow
✅ **PASS** - No changes to scheduler or automation flows. Manual entries are user-initiated only.

### Transparent Observability
⚠️ **REVIEW NEEDED** - Need to ensure logging is added for:
- Entry creation/deletion operations
- Modal interactions (for debugging)
- Error cases (validation failures, database errors)

**Action**: Add structured logging to new API endpoints and frontend error handlers.

### Secure Credential Stewardship
✅ **PASS** - No new credentials or API keys required. Uses existing Supabase connection.

### Spec-Driven Delivery Discipline
✅ **PASS** - Following `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement` workflow.

## Project Structure

### Documentation (this feature)

```text
specs/019-manual-cash-expenses/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── manual-expense-entries-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── services/
│   └── pnl/
│       ├── manualEntryService.js      # Extend with methods for multiple entries
│       └── pnlReportService.js         # Update aggregation logic
├── routes/
│   └── api.js                          # Add new endpoints for entry management
└── utils/
    └── logger.js                       # Ensure logging coverage

frontend/
├── pnl-report.html                    # Add modal HTML structure
├── pnl-report-script.js               # Add plus icon, modal, list view logic
└── style.css                          # Add modal and list view styles

scripts/
└── migrations/
    └── 019_allow_multiple_expense_entries.sql  # Remove unique constraint
```

**Structure Decision**: Web application structure with backend services and frontend HTML/JS. The feature extends existing PNL infrastructure without creating new modules. Backend changes are in `src/services/pnl/` and `src/routes/api.js`. Frontend changes are in `frontend/pnl-report-*` files.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations requiring justification.
