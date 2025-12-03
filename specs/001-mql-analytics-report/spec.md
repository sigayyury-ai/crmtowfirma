# Feature Specification: Marketing Analytics – Monthly MQL Dashboard

**Feature Branch**: `001-mql-analytics-report`  
**Created**: 2025-12-03  
**Status**: Draft  
**Input**: User description: "Хочу добавить новый функционал, маркетинговая аналитика . Хочу видеть MQL лиды по месяцам , выигранные сделки, стоимость лида - (нужно брать цифру из PNL маркетинговые расходы. )  Отчет должен выводить статистку по месяцам забирая данные из Pipedrive и Sendpulse по тегу MQL . В Pipdrive есть сделки с лейблами MQL надо считать их количество . Надо настроить обновление из CRM и из Sendpulse, еще одно требование это стараться отсекать дубли. Так как может быть пересечение. В сендупульсе мы отслеживаем чат бот - инстаграмм. Основной истоник входящих вопросов для новых лидов. Должна быть возможность отслеживать года. По структуре предлагаю делать как PNL: слева параметры, сверху месяца."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Marketing reviews consolidated MQL intake (Priority: P1)

The marketing director opens the analytics dashboard to see how many unique MQL-tagged leads entered the funnel each month, combining Pipedrive deals with the MQL label and Sendpulse contacts (primarily from the Instagram chatbot flow).

**Why this priority**: Provides the single source of truth for demand-generation volume, guiding campaign planning and spend allocation.

**Independent Test**: Select any 12-month range, export Pipedrive + Sendpulse data manually, and confirm dashboard totals match within 1% after deduplication.

**Acceptance Scenarios**:

1. **Given** the director selects a calendar year, **When** the dashboard loads, **Then** all twelve months of that year display per-source counts (CRM vs Sendpulse), a single aggregated won-deal count, marketing budget, subscriber growth, cost per subscriber, cost per MQL, and cost per won deal in a table that mirrors the PNL layout (parameters on rows, months on columns).
2. **Given** duplicate contacts exist across systems with the same normalized email, **When** the report calculates totals, **Then** the contact counts only once in the combined total while still showing its source breakdown.
3. **Given** the director switches between calendar years, **When** the range crosses into a new year, **Then** the header clearly indicates the year for each set of month columns and preserves year-to-date totals.
4. **Given** the director focuses on Pipedrive performance, **When** the “Channel” dimension is toggled, **Then** Pipedrive MQL counts are re-bucketed into predefined source categories (Organic search, Paid social, Paid search, Organic social, Direct, Referral, Partners, None) derived from the CRM’s UTM fields.

---

### User Story 2 - Finance evaluates cost per MQL (Priority: P2)

The finance analyst aligns monthly PNL marketing expenses with MQL counts to understand acquisition efficiency and flag overspending.

**Why this priority**: Connects spend to outcomes for budgeting and ROI justification.

**Independent Test**: Supply known marketing expense inputs, confirm cost per lead equals expense divided by deduplicated MQL count and that missing expenses are clearly flagged.

**Acceptance Scenarios**:

1. **Given** an expense entry exists for a month, **When** the dashboard renders metrics, **Then** it shows expense, cost per MQL (rounded to two decimals), and highlights months exceeding a configurable target cost.
2. **Given** an expense entry is missing, **When** the analyst views the report, **Then** the cost per MQL field shows "n/a" with guidance to import/update the PNL figure while other metrics remain visible.

---

### User Story 3 - Sales operations tracks MQL-to-win conversion (Priority: P3)

The sales operations manager checks how many MQL-labeled deals moved to "Won" each month to spot conversion drops and coach the team.

**Why this priority**: Ensures lead quality translates into revenue and identifies pipeline bottlenecks.

**Independent Test**: For a sample month, compare dashboard conversion rate to CRM pipeline reports; variance must stay under 2 percentage points.

**Acceptance Scenarios**:

1. **Given** deals in Pipedrive are associated with MQL-tagged leads, **When** a month is selected, **Then** the dashboard shows won-deal counts and conversion percentage for that month's MQL cohort.
2. **Given** the manager filters for Sendpulse-originated leads (Instagram chatbot), **When** metrics refresh, **Then** the dashboard shows only that source's leads and won deals, with an option to revert to all sources.

---

### Edge Cases

- Months with marketing expenses but zero MQL leads (must avoid division-by-zero by showing "n/a" cost per MQL).
- Months with leads but missing PNL expenses (display counts yet flag incomplete financial data).
- Contacts entering via multiple channels (e.g., Instagram chatbot plus web form) leading to duplicates; deduplication should rely on normalized primary email and fallback identifiers.
- Tag casing or spelling inconsistencies (`MQL`, `mql`, `Mql`) across systems (normalize before aggregation).
- Stale syncs or failed imports from either source (show freshness timestamp and warnings when older than 48 hours).
- Deals that lose or gain the MQL label retroactively (define whether historical months update or stay frozen; assume metrics snapshot at month close unless a manual rebuild is triggered).
- Switching across multiple years when some years lack full 12 months of data (ensure partial-year columns are visibly flagged and totals recalculate accurately).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dashboard MUST default to the current calendar year and allow users to switch between full-year views (e.g., 2025, 2024, 2023). Each selection MUST render all twelve months of that year without partial ranges, while still allowing access to at least the prior 24 months of history.
- **FR-002**: The system MUST pull MQL-tagged records from Pipedrive (deals/people with the MQL label) and Sendpulse (contacts tagged MQL, including Instagram chatbot flows) via automated syncs at least every 6 hours, plus offer a manual "refresh now" control.
- **FR-003**: Incoming records MUST be normalized (e.g., lowercased email) and deduplicated across systems so the combined total counts each person once while retaining per-source visibility.
- **FR-004**: For every month shown, the dashboard MUST display: unique MQL count per source and merged total, a single aggregated count of MQL-derived won deals (not split by source), marketing budget from PNL expenses, subscriber count pulled from Instagram (SendPulse) with month-over-month delta, cost per subscriber (marketing budget ÷ new subscribers vs previous month), cost per MQL (marketing budget ÷ MQL total), and cost per won deal (marketing budget ÷ won deals).
- **FR-005**: When PNL expense data is missing for a month, the UI MUST show a "Missing expense" badge, set cost per MQL to "n/a", and record the gap for follow-up without hiding other metrics.
- **FR-006**: Users MUST be able to filter metrics by source (CRM only, Sendpulse only, combined) and by lead funnel stage (all MQLs vs only those tied to won deals), with immediate recalculation.
- **FR-007**: The dashboard MUST display last-sync timestamps per source; if any source is older than 48 hours, a warning banner should prompt action and provide retry instructions.
- **FR-008**: Users MUST be able to export the currently viewed table (respecting filters) to CSV, including metadata rows for currency, data range, deduplication rules, and sync timestamps.
- **FR-009**: Historical monthly snapshots MUST be immutable after month close unless a user with proper permission triggers a "rebuild history" job acknowledging potential metric changes.
- **FR-010**: The system MUST log synchronization errors or dedup conflicts and surface a summary so ops teams can investigate data quality issues.
- **FR-011**: Users MUST be able to jump between calendar years (e.g., 2024, 2025) while preserving the PNL-style matrix, including year-level subtotals beneath each block of month columns.
- **FR-012**: The table layout MUST mimic PNL reporting with metric parameters listed vertically on the left and months (grouped by year) across the top, ensuring responsiveness for up to 24 consecutive months without horizontal scroll on standard desktop resolutions.
- **FR-013**: The storage layer MUST attribute MQL leads to the first month in which the `MQL` tag is observed, prevent the same lead from being re-counted in later months unless a newer tag-date exists, and persist month-over-month totals so historical months remain unchanged when tags evolve.
- **FR-014**: The frontend MUST reuse the same visual styles, typography, and spacing tokens as the existing PNL dashboard (`frontend/pnl-report.html` + `frontend/style.css`) so users keep a familiar interface without custom theming.
- **FR-015**: Pipedrive-sourced MQLs MUST be further segmented by marketing channel categories resolved from the “Source/UTM” CRM field (Organic search, Paid search, Organic social, Paid social, Direct, Referral, Partners, None), and the dashboard MUST allow switching between per-source totals and channel buckets without reloading the page.

### Key Entities *(include if feature involves data)*

- **LeadSourceRecord**: Represents an individual MQL-tagged person from Pipedrive or Sendpulse, storing source system, identifiers, normalized email, acquisition timestamp, associated deal IDs, and channel (e.g., Instagram chatbot).
- **MonthlyMarketingSnapshot**: Aggregated metrics per calendar month containing per-source lead counts, deduplicated totals, won deals, marketing expense, cost per MQL, conversion rate, sync freshness, and data completeness flags.
- **MarketingExpenseEntry**: Monthly marketing spend imported from the PNL with month, amount, currency, source document reference, and approval status.

## Assumptions & Dependencies

- PNL marketing expenses are available per calendar month in the same currency as revenue reporting and can be imported/approved before analytics runs.
- Every MQL record includes an email (or another unique contact key) allowing reliable deduplication; fallback identifiers (phone, Sendpulse contact ID) can supplement when email is missing.
- Instagram chatbot traffic is managed inside Sendpulse and already tagged as MQL once qualified; this feature consumes the tag but does not alter chatbot logic.
- Pipedrive deals maintain a “Source/UTM” field whose categorical values (Organic search, Paid search, Organic social, Paid social, Direct, Referral, Partners, None) can be mapped deterministically from UTM inputs without additional user input.
- Existing authenticated integrations with Pipedrive, Sendpulse, and the PNL data source are in place; no new connector build is required.
- Authorized users have permission to view marketing expenses and CRM performance data within the same dashboard.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Marketing leaders can generate the consolidated MQL dashboard for any 12-month range in under 30 seconds without exporting raw data.
- **SC-002**: Deduplicated monthly MQL totals match combined CRM + Sendpulse exports (after manual dedup) within 1% variance during user acceptance testing.
- **SC-003**: Finance can view cost per MQL for 100% of months with expense data, with calculated values matching manual spreadsheets within 2% variance.
- **SC-004**: Sales operations observes that MQL-to-won conversion percentages differ by no more than 2 percentage points from CRM reports across all months in scope.
- **SC-005**: Sync freshness warnings keep data latency under 48 hours for at least 95% of business days, ensuring decisions rely on near-real-time information.
