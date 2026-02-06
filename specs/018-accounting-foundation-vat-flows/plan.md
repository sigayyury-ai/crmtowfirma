# Implementation Plan: Accounting Foundation and Two VAT Flows

**Branch**: `018-accounting-foundation-vat-flows` | **Date**: 2026-02-06 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/018-accounting-foundation-vat-flows/spec.md`

## Summary

This feature adds explicit classification of expenses into two VAT flows (VAT-marża / Art. 119 vs ordinary deductible VAT), persists that classification in data, and exposes it in reports. Implementation order: (1) extend expense categories with a VAT-flow type and add optional per-payment override; (2) define and apply a rule so every expense has an effective VAT flow (product-linked → margin-scheme, else from category, else default); (3) add a report/view that splits expenses by the two flows and ensure the product margin report continues to use only margin-scheme expenses; (4) use the same classification in reconciliation views and future posting logic.

## Technical Context

**Language/Version**: Node.js 18+ (JavaScript/ES6+)  
**Primary Dependencies**: Express.js, Supabase Client (@supabase/supabase-js), PostgreSQL  
**Storage**: PostgreSQL (Supabase) — extend `pnl_expense_categories`; optionally add column(s) on `payments` for override; existing `payment_product_links` and product linkage used for “product-linked” rule  
**Testing**: Jest (existing); manual verification of reports and filters  
**Target Platform**: Web application (backend API + frontend)  
**Project Type**: Web application (backend + frontend)  
**Performance Goals**: Report with VAT-flow split loads within 3 seconds for a 12-month period; classification rule applied without noticeable delay when loading payment lists  
**Constraints**: Must not change existing product margin (VAT-marża) calculation logic; only add filtering so general expenses are never included there. Backward compatibility: existing expenses get effective VAT flow from migration/default rule.  
**Scale/Scope**: All expense payments (bank, manual entries for expenses) and expense categories; one new report/view and optional export; reconciliation/postings use same classification when those features exist.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Invoice Data Fidelity
✅ **PASS** — No change to invoice/proforma creation or content. Only expense classification and reporting.

### Reliable Automation Flow
✅ **PASS** — No change to schedulers or payment processing automation. Classification is derived from existing data and category/payment attributes.

### Transparent Observability
✅ **PASS** — Logging of classification rule application (e.g. when override is used) can be added in implementation; no new critical automation to observe.

### Secure Credential Stewardship
✅ **PASS** — No new credentials. Uses existing Supabase and auth.

### Spec-Driven Delivery Discipline
✅ **PASS** — Spec → Plan → Tasks → Implement workflow.

## Project Structure

### Documentation (this feature)

```text
specs/018-accounting-foundation-vat-flows/
├── plan.md              # This file
├── research.md          # Existing tables, product report, PNL, rules
├── data-model.md        # VAT flow on categories and payments
├── quickstart.md        # Verification steps
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── pnl/
│   │   ├── pnlReportService.js       # Use effective VAT flow in expense aggregation; optional split by flow
│   │   └── expenseCategoryService.js # Or new: vatFlowService / classification helper
│   ├── vatMargin/
│   │   └── productReportService.js   # Ensure only margin-scheme expenses per product (no change to formula)
│   └── payments/
│       └── paymentService.js         # Expose effective VAT flow; persist override if implemented
├── routes/
│   └── api.js                        # Endpoints: category vat_flow CRUD; report by VAT flow; optional payment override
frontend/
├── pnl-report.html / pnl-report-script.js  # Optional: VAT-flow filter or breakdown on PNL
├── vat-margin*.js / expenses*.js           # Show VAT flow on expense list; category settings for vat_flow
scripts/
└── migrations/
    └── 022_add_vat_flow_to_expense_categories.sql   # Add vat_flow to pnl_expense_categories; optional payment override column
```

**Structure Decision**: Feature extends existing PNL and VAT margin services and frontend. No new top-level modules; add classification helper and use it in report services and payment list APIs.

### Knowledge base (wFirma)

При реализации UI и отчётов по НДС и расходам использовать базу знаний wFirma, чтобы не выдумывать интерфейсы, а опираться на наработки wFirma с учётом наших двух потоков НДС и каналов прихода:

- **Документ**: `docs/wfirma-knowledge-base-vat-and-taxes.md`
- **Источники**: [Księgi i rejestry podatkowe](https://pomoc.wfirma.pl/ksiegowosc/ksiegi-i-rejestry-podatkowe), [Podatki i sprawozdawczość](https://pomoc.wfirma.pl/ksiegowosc/podatki-i-sprawozdawczosc)

## Phases (high level)

| Phase | Focus | Outputs |
|-------|--------|---------|
| **1 – Foundation** | Category attribute `vat_flow` (margin_scheme | general); migration; default rule documented; effective VAT flow computed for each expense | data-model.md, migration, rule in code/docs |
| **2 – Override & API** | Optional per-payment override column and API to set/clear it; effective flow = override ?? product_link ?? category ?? default | Migration (if override), API contract, payment list returns effective vat_flow |
| **3 – Reports** | PNL or dedicated report with totals/breakdown by VAT flow; product margin report unchanged (only margin-scheme by product); view/export for “general” expenses | Report UI/API, quickstart verification |
| **4 – Reconciliations** | When reconciliation view exists, tag each expense with effective VAT flow; same for posting logic when implemented | Use effective vat_flow in existing or new reconciliation/postings code |

## Complexity Tracking

No violations requiring justification.
