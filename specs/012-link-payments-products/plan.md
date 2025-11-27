# Implementation Plan: Linking Payments to Products

**Branch**: `012-link-payments-products` | **Date**: 2025-11-27 | **Spec**: [spec.md](../spec.md)
**Input**: Feature specification from `/specs/012-link-payments-products/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

**Primary Requirement**: Integrate payment-to-product linking functionality into existing VAT Margin Tracker (for incoming payments) and Expenses (for outgoing payments) interfaces, allowing manual linking of payments to "In Progress" products for accurate VAT margin reporting.

**Technical Approach**: Add product dropdown to existing payment processing tables, create database relationships for payment-product links, update product reports to show linked payments and calculate profitability metrics.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Node.js (backend), JavaScript/HTML/CSS (frontend)
**Primary Dependencies**: Express.js, PostgreSQL, existing frontend framework
**Storage**: PostgreSQL database (existing Supabase instance)
**Testing**: Jest for backend, manual testing for frontend
**Target Platform**: Web application (existing VAT Margin Tracker and Expenses interfaces)
**Project Type**: Web application with backend API
**Performance Goals**: Product reports load within 5 seconds, payment linking operations complete in under 2 seconds
**Constraints**: Must integrate into existing interfaces without breaking current functionality, maintain data consistency
**Scale/Scope**: Support for existing payment volumes (thousands of payments), 10-20 active products

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
backend/
├── src/
│   ├── models/
│   │   └── paymentProductLink.js
│   ├── services/
│   │   └── paymentProductLinkService.js
│   └── routes/
│       └── paymentProductLink.js
└── tests/
    └── paymentProductLink.test.js

frontend/
├── vat-margin.html (existing - add product dropdown)
├── vat-margin-script.js (existing - add linking logic)
├── expenses.html (existing - add product dropdown)
├── expenses-script.js (existing - add linking logic)
└── vat-margin-product.html (existing - update to show linked payments and profitability)
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
