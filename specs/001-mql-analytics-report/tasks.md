# Tasks: Marketing Analytics – Monthly MQL Dashboard

**Input**: Design documents from `/specs/001-mql-analytics-report/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md (available)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Capture real payloads from both sources and lock the discovery prototype before building production code.

- [X] T001 Create discovery log with sample payloads in `docs/analytics/mql-discovery.md`
- [X] T002 Build throwaway script `scripts/prototypes/mql/fetchSendpulseMqls.js` that hits `/instagram/contacts/getByTag` and saves output to `tmp/sendpulse-mql-sample.json`
- [X] T003 Build throwaway script `scripts/prototypes/mql/fetchPipedriveMqlDeals.js` that lists MQL-labeled people/deals and persists to `tmp/pipedrive-mql-sample.json`
- [X] T004 [P] Document prototype results (field mapping, pagination, tag-date gaps) in `specs/001-mql-analytics-report/research.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared data layer, normalization, and scheduling infrastructure required by every story.

- [X] T005 Create SQL migration `scripts/migrations/20251204_create_mql_tables.sql` for `mql_leads` + `mql_monthly_snapshots` tables (lead_id, source, channel metadata, first_mql_month, won_deals, expenses, cost_per_lead)
- [X] T006 Implement repository `src/services/analytics/mqlRepository.js` handling CRUD for leads/snapshots with Supabase connection pooling
- [X] T007 [P] Add normalization utilities `src/services/analytics/mqlNormalizer.js` for email casing, tag casing, and primary key derivation
- [X] T008 [P] Extend config in `src/config/index.js` for `MQL_SENDPULSE_TAG`, `MQL_SYNC_LOOKBACK_MONTHS`, and cron cadence
- [X] T009 Wire scheduler entry in `scripts/cron/refreshMqlAnalytics.js` that invokes future `mqlSyncService`
- [ ] T010 Add observability hooks (structured logs + metrics counters) in `src/utils/logger.js` for new analytics jobs
- [ ] T010a Design SQL schema for MQL snapshots (leads & monthly aggregates) and outline cron-based ETL plan

**Checkpoint**: Data schema, config, and scheduling ready—user stories can start.

---

## Phase 3: User Story 1 – Marketing reviews consolidated MQL intake (Priority: P1) 🎯 MVP

**Goal**: Deliver deduplicated full-year MQL counts from Pipedrive + SendPulse in a PNL-style grid with CSV export.
**Independent Test**: Fetch `/analytics/mql-summary?year=2025` and confirm all twelve months display per source + combined totals matching manual exports within 1%, while the frontend mirrors the PNL layout.

### Implementation

- [X] T011 [P] [US1] Implement `src/services/analytics/sendpulseMqlClient.js` to call `/instagram/contacts/getByTag` with pagination + rate-limit handling
- [X] T012 [P] [US1] Implement `src/services/analytics/pipedriveMqlClient.js` that fetches MQL-tagged people/deals and exposes helper to map to lead records
- [X] T013 [US1] Build orchestrator `src/services/analytics/mqlSyncService.js` that deduplicates by normalized email/username, assigns first-month snapshots, and persists via repository
- [ ] T014 [US1] Implement channel classification helper `src/services/analytics/mqlChannelMapper.js` that converts Pipedrive Source/UTM into the standard categories (Organic search, Paid search, Organic social, Paid social, Direct, Referral, Partners, None) and stores the bucket on each snapshot
- [ ] T015 [US1] Implement report generator `src/services/analytics/mqlReportService.js` returning full-year per-source MQL totals, a single aggregated won-deal count, and channel buckets for Pipedrive contributions
- [ ] T016 [US1] Add Express route `src/routes/analytics.js` with `GET /analytics/mql-summary` and CSV export `GET /analytics/mql-summary.csv`, accepting `year` + `view=channel` parameters
- [ ] T017 [US1] Create frontend shell `frontend/analytics/mql-report.html` reusing PNL grid markup + CSS tokens from `frontend/style.css`
- [ ] T018 [US1] Implement view logic `frontend/analytics/mql-report.js` (year selector, per-source columns, channel toggle, year headers, manual refresh button)
- [ ] T019 [US1] Implement CSV export helper `src/services/analytics/mqlExportService.js` using Papaparse and ensure metadata rows (currency, sync timestamps, channel view flag, selected year) are included
- [ ] T020 [P] [US1] Add integration test `tests/integration/analytics.mql-report.test.js` covering dedup counts, channel buckets, zero-month rendering, and CSV output schema

**Checkpoint**: Marketing can view deduplicated counts and export CSV—MVP ready.

---

## Phase 4: User Story 2 – Finance evaluates cost per MQL (Priority: P2)

**Goal**: Attach monthly marketing expenses, compute cost per MQL, and flag missing expense data.
**Independent Test**: Seed expenses for several months, hit `/analytics/mql-summary`, and verify cost per lead + “Missing expense” badges match spreadsheet calculations within 2%.

- [X] T021 [P] [US2] Implement `src/services/analytics/pnlExpenseClient.js` to ingest monthly marketing spend from existing PNL source (file or API)
- [ ] T022 [US2] Extend repository (`mqlRepository.js`) to upsert `marketing_expense` and `cost_per_lead` fields for each snapshot
- [ ] T023 [US2] Update `mqlReportService.js` to merge expense data, compute cost per MQL, and mark months lacking expenses
- [ ] T024 [US2] Enhance frontend grid (`frontend/analytics/mql-report.js`) with expense rows, cost-per-lead cells, and warning badges for missing data
- [ ] T025 [US2] Extend CSV export (`mqlExportService.js`) to include expense + cost columns and missing-data flags
- [ ] T026 [P] [US2] Add unit test coverage in `tests/unit/services/analytics/mqlReportService.test.js` for cost calculation rounding and missing-expense logic

**Checkpoint**: Finance view delivers spend + CPL metrics independently.

---

## Phase 5: User Story 3 – Sales operations tracks MQL-to-win conversion (Priority: P3)

**Goal**: Show how many MQLs convert to won deals per month and enable source filters (SendPulse vs CRM vs combined).
**Independent Test**: Populate sample won deals linked to MQLs, request filtered report (`source=sendpulse`), and confirm conversion percentage within 2 pts of CRM pipeline numbers.

- [ ] T027 [P] [US3] Implement `src/services/analytics/mqlDealsService.js` that maps leads to Pipedrive deals, tracks won status, and records win timestamps
- [ ] T028 [US3] Extend repository schema/methods to persist `won_count`, `conversion_rate`, and sync freshness timestamps per source
- [ ] T029 [US3] Update `mqlReportService.js` + route handler to support `source` filter and include won/conversion metrics in API + CSV
- [ ] T030 [US3] Enhance frontend (`frontend/analytics/mql-report.js`) with filter controls, won-deal rows, and conversion percentage visualization (e.g., badges)
- [ ] T031 [US3] Add integration regression `tests/integration/analytics.mql-report.test.js` to cover source filters and conversion math

**Checkpoint**: Sales ops can independently assess conversion performance and filter by channel.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T032 [P] Update `specs/001-mql-analytics-report/quickstart.md` with setup + testing instructions for the new dashboard
- [ ] T033 Document operational playbook in `docs/analytics/mql-operations.md` (sync cadence, rebuilding history, data freshness alarms)
- [ ] T034 Add monitoring hooks (Winston + alerting) for sync lag >48h in `src/services/analytics/mqlSyncService.js`
- [ ] T035 [P] Run end-to-end validation script `scripts/prototypes/mql/fetchSendpulseMqls.js` against staging to confirm data parity before release
- [ ] T036 Refresh README analytics section (`README.md`) with link to the new dashboard and usage notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 → Phase 2**: Prototype outputs must exist before locking schema/logic.
- **Phase 2 → Phases 3–5**: Schema/config/logging required for any user story work.
- **Phases 3–5**: User stories can execute in priority order; US2 & US3 may start once their upstream data requirements (expenses, won deals) are available.
- **Phase 6**: Runs after targeted user stories complete.

### User Story Dependencies

- **US1**: Depends only on foundational work; serves as MVP.
- **US2**: Depends on US1 data structures to extend snapshots with expenses.
- **US3**: Depends on US1 data structures; independent of US2 except shared repository updates.

### Parallel Opportunities

- Tasks marked **[P]** can run concurrently (e.g., SendPulse vs Pipedrive clients, repository helpers, expense client vs UI work).
- Different user stories (US2 vs US3) can progress in parallel once foundational tasks complete.
- Frontend (`frontend/analytics/*`) and backend (`src/services/analytics/*`) tasks for the same story can run concurrently if interfaces are stubbed.

---

## Implementation Strategy

### MVP First
1. Finish Phase 1–2 to secure prototypes and shared infrastructure.
2. Deliver User Story 1 (Phase 3) end-to-end; run integration test + manual CSV verification.
3. Demo MVP to stakeholders before layering finance/sales metrics.

### Incremental Enhancements
- After MVP approval, implement US2 (finance view) then US3 (conversion view), validating each independently.
- Keep snapshots immutable per month; any rebuilds should be explicit (documented in ops guide).

### Testing & Validation
- Use `tests/integration/analytics.mql-report.test.js` for end-to-end API regressions.
- Run `tests/unit/services/analytics/mqlReportService.test.js` to cover calculations (cost, conversion, dedup).
- Re-run prototype scripts against production data before release to ensure connectors still emit the expected schema.

---

**Total Tasks**: 36  
**Task Breakdown**: Setup 4, Foundational 6, US1 10, US2 6, US3 5, Polish 5  
**Parallel Opportunities**: Marked with [P] (9 tasks)  
**Independent Test Criteria**: Listed per user story above  
**Suggested MVP Scope**: Complete through Phase 3 (User Story 1) before expanding to US2/US3.  
**Format Validation**: All tasks follow `- [ ] T### [P?] [Story?] Description` with explicit file paths.


