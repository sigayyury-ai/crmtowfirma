# Implementation Plan: Marketing Analytics – Monthly MQL Dashboard

**Branch**: `001-mql-analytics-report` | **Date**: 2025-12-03 | **Spec**: `specs/001-mql-analytics-report/spec.md`
**Input**: Feature specification from `/specs/001-mql-analytics-report/spec.md`

## Summary

Deliver a PNL-style marketing analytics view that aggregates MQL-tagged leads from Pipedrive and Sendpulse, deduplicates contacts, aligns monthly marketing expenses, and surfaces conversion plus cost-per-lead metrics per full calendar year; snapshots must attribute each lead to the first month its MQL tag appears so historical totals never backfill. Pipedrive contributions are further segmented by the CRM’s `Source/UTM` field into standardized marketing channels (Organic search, Paid search, Organic social, Paid social, Direct, Referral, Partners, None) so acquisition mix is immediately visible. Users select a year (e.g., 2025, 2024) and always see all twelve months rendered in a PNL-style grid. **Before defining tasks or updating any persistent documentation, we will first re-establish authenticated connections to both channels, capture sample payloads, and build a lightweight prototype (Postman collection + throwaway script/UI) to validate observed fields, tag-date behavior, channel mapping, and dedup logic.** Only after this discovery and prototype step confirms real data structures will we finalize implementation tasks, schemas, and runbooks. The production solution will then extend the existing Node.js integration services with scheduled sync jobs, persist normalized snapshots, and expose a REST endpoint + dashboard-friendly CSV export so stakeholders can consume the data via the established Express backend and static frontend.

## Technical Context

**Language/Version**: Node.js ≥18 (Express backend) with vanilla JS frontend pages  
**Primary Dependencies**: Express, Axios (Pipedrive + Sendpulse APIs), Supabase/PostgreSQL client (`@supabase/supabase-js`), Winston logging, node-cron, Papaparse for CSV output  
**Storage**: Supabase/PostgreSQL for monthly snapshots + deduplicated lead cache; existing logs via Winston files  
**Testing**: Node-based integration tests using Jest + supertest (to be added under `tests/` for the new route) plus script-driven reconciliation harness  
**Target Platform**: Render-hosted Node server (Linux) plus static frontend served from `/frontend`  
**Project Type**: Web application (Express API + vanilla frontend)  
**Performance Goals**: Dashboard API must return 24 months of data within 2 seconds (server-side) and keep manual refresh/export under 30 seconds end-to-end  
**Constraints**: Respect constitution guardrails (logging, credential storage, spec-first). API p95 latency < 750 ms for cached data; memory footprint < 200 MB for aggregation job; sync freshness < 48 h  
**Scale/Scope**: ~5–10k MQL records yearly, <1k won deals/month, 3 upstream integrations (Pipedrive, Sendpulse, PNL source)

## Constitution Check

*GATE (pre-Phase 0)*:  
- **Invoice Data Fidelity**: Reporting layer must not mutate invoice data; plan confines work to read-only analytics tables and separate storage. ✅  
- **Reliable Automation Flow**: New schedulers must reuse existing `node-cron` patterns with idempotency + logging; plan will specify retry + dedup steps before implementation. ✅  
- **Transparent Observability**: All sync + export jobs will emit structured logs (source, timeframe, counts) using Winston, matching constitution requirements. ✅  
- **Secure Credential Stewardship**: No secrets committed; integrations reuse existing env vars (`PIPEDRIVE_API_TOKEN`, `SENDPULSE_CLIENT_ID/SECRET`, etc.). Credentials referenced only via config. ✅  
- **Spec-Driven Delivery Discipline**: Spec approved; plan references `/speckit` workflow and will generate tasks later. ✅  

Gate status: **PASS** — proceed to Phase 0 research.

## Project Structure

### Documentation (this feature)

```text
specs/001-mql-analytics-report/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
└── tasks.md        # created by /speckit.tasks later
```

### Source Code (repository root)

```text
backend (Express API + workers)
├── src/
│   ├── index.js              # server entrypoint
│   ├── routes/
│   │   ├── analytics.js      # NEW: MQL reporting endpoints
│   │   └── ...               # existing routes
│   ├── services/
│   │   ├── analytics/
│   │   │   ├── mqlSyncService.js
│   │   │   └── mqlReportService.js
│   │   └── ...
│   ├── utils/
│   └── config/
├── scripts/
│   └── cron/
│       └── refreshMqlAnalytics.js

frontend (static dashboards)
├── frontend/
│   ├── pnl-report.html
│   ├── pnl-report-script.js
│   ├── analytics/
│   │   ├── mql-report.html   # NEW grid mirroring PNL
│   │   └── mql-report.js
│   └── ...

tests/
├── integration/
│   └── analytics.mql-report.test.js
└── unit/
    └── services/
        └── analytics/
            └── mqlReportService.test.js
```

**Structure Decision**: Extend existing Express backend + static frontend. No new deploy units; analytics services live under `src/services/analytics`, routes under `src/routes/analytics.js`, and the PNL-style UI sits in `frontend/analytics/`. Tests mirror existing `tests/unit` + `tests/integration`.

## Complexity Tracking

No constitution violations identified; table not required.
