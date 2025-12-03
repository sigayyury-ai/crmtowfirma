# Marketing MQL Operations Guide

_Last updated: 2025-12-03_

## Purpose
- Centralize how the Marketing dashboard ingests, stores, and displays MQL KPIs.
- Ensure anyone can safely refresh data, adjust manual inputs, and debug failed syncs.

## Data Flow Overview
1. **Sync entry point** – `node scripts/cron/refreshMqlAnalytics.js [YEAR]`
   - Boots `MqlSyncService`.
   - Determines which years to refresh (argument or trailing `MQL_SYNC_LOOKBACK_MONTHS`, default 24).
2. **Collectors**
   - `SendpulseMqlClient` pulls Instagram bot contacts tagged `Mql` (bot `SENDPULSE_INSTAGRAM_BOT_ID`).
   - `PipedriveMqlClient` fetches deals carrying the `pipedriveLabelId` (`MQL`) and SQL labels for dedupe, resolving the first month when the label appeared via `/deals/{id}/flow`.
   - `PnlExpenseClient` aggregates marketing expenses from Supabase (`payments`, `pnl_manual_entries`) filtering by `marketingExpenseCategoryIds` + hard-coded keyword allow‑list (`FACEBK`, `Google`, `LinkedIn`) for CSV uploads.
3. **Dataset building**
   - Leads deduplicated by normalized email → username → external ID.
   - Months always cover the entire selected year; SendPulse CSV baseline is applied when API history is missing.
   - Derived metrics:
  - `combined.mql = pipedrive + sendpulse (after dedupe)`
  - `conversion = won / combined.mql`
  - `repeat_deals` — количество выигранных сделок от клиентов с label `Customer`
  - Costs computed from `marketing_expense`.
4. **Persistence**
   - Raw leads → `mql_leads`.
   - Monthly aggregates → `mql_monthly_snapshots` (see `scripts/migrations/20251204_create_mql_tables.sql`).
5. **Report delivery**
   - `GET /api/analytics/mql-summary?year=YYYY` reads snapshots via `MqlReportService`.
   - Frontend (`frontend/analytics/mql-report.js`) renders the PNL-style grid; inline subscriber edits hit `POST /api/analytics/mql-subscribers`.

## Required Environment Variables
| Key | Purpose |
| --- | --- |
| `PIPEDRIVE_API_TOKEN` | CRM access for MQL/SQL deals + `getDealFlow`. |
| `SENDPULSE_ID` / `SENDPULSE_SECRET` | OAuth client for Instagram bot API. |
| `SENDPULSE_INSTAGRAM_BOT_ID` | Defaults to `65ec7b3f08090e12cd01a7ca`. |
| `SENDPULSE_TELEGRAM_BOT_ID` | Optional second bot (`bots telegram ...`). |
| `MQL_SENDPULSE_TAG` | Defaults to `Mql`. |
| `MQL_SYNC_LOOKBACK_MONTHS` | How far back the cron refreshes (min 12). |
| `PIPEDRIVE_MQL_LABEL_ID`, `PIPEDRIVE_SQL_LABEL_IDS` | Deal labels to include. |
| `PIPEDRIVE_CONVERSATION_STAGE_IDS` | Stage IDs where MQL labels usually get applied. |
| `PIPEDRIVE_SENDPULSE_ID_FIELD_KEY` | Custom field with SendPulse contact ID for Telegram dedupe (default `ff1aa263…`). |
| `PIPEDRIVE_CUSTOMER_PERSON_LABEL` / `_ID` | Лейбл у Person, по которому считаем повторные продажи. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Snapshot persistence. |

## Manual Inputs & Utilities
- **Inline subscribers**: edit cells in the “Подписчики (Instagram)” row → sends `POST /api/analytics/mql-subscribers` and updates immediately.
- **Bulk subscriber backfill**: `node scripts/analytics/updateSubscribers.js 2025`.
- **Marketing budget recompute only**: `node scripts/analytics/updateMarketingExpenses.js 2025`.
- **SendPulse baseline**: `data/analytics/sendpulse-baseline.json` fills months where API lacks history (e.g., Jan–Aug 2025 export).

## Operating the Sync
1. `npm run dev` (or `node src/index.js`) to expose `/api/analytics/mql-summary`.
2. Run full refresh:
   ```bash
   node scripts/cron/refreshMqlAnalytics.js 2025
   ```
   - Without an argument it refreshes the rolling window controlled by `MQL_SYNC_LOOKBACK_MONTHS`.
3. Watch logs for:
   - Pipedrive API quota warnings (`pipedriveClient.fetchMqlDeals`).
   - Missing marketing expenses (logged by `PnlExpenseClient`).
4. Validate results:
   - `node -e "require('./src/services/analytics/mqlReportService').prototype.getMonthlySummary({year:2025}).then(console.log)"` (or use the dashboard UI).

## Cron / Automation Status
- As of 2025‑12‑03 **no scheduler is invoking** `refreshMqlAnalytics.js`.
  - The script exists under `scripts/cron/`, but it is not wired into `src/services/scheduler.js` and there is no Render cron/worker entry.
  - Current refreshes are manual (last stored snapshot saved via `tmp/mql-summary-*.json`).
- To automate:
  1. Add a Render Cron Job (or any scheduler) executing:
     ```
     cd /opt/render/project/src && /usr/local/bin/node scripts/cron/refreshMqlAnalytics.js
     ```
     Suggested cadence: nightly at 03:15 Europe/Warsaw to avoid SendPulse/Pipedrive peak hours.
  2. Export required ENV vars in the cron environment (`SENDPULSE_*`, `PIPEDRIVE_API_TOKEN`, `SUPABASE_*`, `MQL_*` config).
  3. Monitor quotas—first deploy should use `MQL_SYNC_LOOKBACK_MONTHS=12` to keep API usage predictable.
  4. (Optional) extend `SchedulerService` to enqueue this job internally once Pipedrive rate-limiting/backpressure is implemented.

## Troubleshooting Checklist
- **SendPulse mismatch**: confirm `SENDPULSE_INSTAGRAM_BOT_ID` and tag casing; use `scripts/prototypes/mql/fetchSendpulseMqls.js` for raw dumps.
- **Pipedrive won/closed too low**: ensure we ran after daily API reset; check `tmp/pipedrive-mql-sample.json` for `firstSeenMonth`.
- **August budget spike**: CSV keyword filter currently limited to `FACEBK`, `Google`, `LinkedIn`; update `PnlExpenseClient._appendCsvMarketing`.
- **Subscribers not persisting**: API returns 200 but UI still shows old value → ensure Supabase row for that month exists (migration applied).
- **Telegrams counted дважды**: если лид уже стал сделкой и в Pipedrive заполнен SendPulse ID, Telegram источник автоматически вычитается в том же месяце. Если счётчик не меняется — проверьте, что поле `PIPEDRIVE_SENDPULSE_ID_FIELD_KEY` содержит значение и выполнен свежий Pipedrive sync.


