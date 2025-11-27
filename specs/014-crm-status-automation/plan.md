# Implementation Plan: CRM Status Automation

**Branch**: `014-crm-status-automation` | **Date**: 2025-11-27 | **Spec**: [spec.md](../spec.md)
**Input**: Feature specification from `/specs/014-crm-status-automation/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

**Primary Requirement**: Automatically update CRM deal statuses when payment accumulation reaches threshold percentages, eliminating duplicate manual work in both VAT Margin Tracker and CRM systems.

**Technical Approach**: Extend existing payment linking logic to calculate accumulated payment amounts per proforma and trigger Pipedrive API calls for status updates when thresholds are met (≥50% for first payment, ≥100% for completion).

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Node.js (backend), JavaScript (integration)
**Primary Dependencies**: Existing payment linking service, Pipedrive API client
**Storage**: Existing PostgreSQL database (payment linking tables)
**Testing**: Jest for backend, integration tests for Pipedrive API
**Target Platform**: Web application backend (existing payment processing)
**Project Type**: Backend service extension with CRM integration
**Performance Goals**: CRM status updates complete within 5 seconds of payment linking
**Constraints**: Must not block payment processing, handle Pipedrive API failures gracefully
**Scale/Scope**: Support existing payment processing volume (100s of payments daily)

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
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── services/
│   │   ├── crmStatusAutomationService.js (new)
│   │   └── paymentLinkingService.js (extend existing)
│   └── routes/
│       └── payment-linking.js (extend existing)
└── tests/
    └── crm-status-automation.test.js

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
