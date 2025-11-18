# Delivery Tasks: Hourly CRM Scheduler

**Spec**: `specs/001-hourly-scheduler/spec.md`  
**Plan Reference**: `specs/001-hourly-scheduler/plan.md`  
**Last Updated**: 2025-11-18  
**Status**: ✅ Основные задачи выполнены, добавлена интеграция с Pipedrive webhooks

## Phase 0 — Research & Prep

- [ ] Confirm cron timezone behaviour between Render (UTC) and `node-cron` with `Europe/Warsaw`.
- [ ] Document retry interval choice (15 minutes) and validate with stakeholders.
- [ ] Inventory current UI/API usage of `/start` and `/stop` endpoints to avoid orphaned calls.

## Phase 1 — Backend Scheduler Updates

- [x] Refactor `src/services/scheduler.js` to a single hourly job with concurrency guard (`isRunning`, `retryScheduled`).
- [x] Implement in-memory `runHistory` ring buffer (≥48 entries) with structured logging.
- [x] Add retry-on-failure (single retry within the hour) and expose state (`retryScheduled`, `nextRetryAt`).
- [x] Update initialization in `src/index.js` to auto-start scheduler without manual controls.
- [x] **NEW**: Remove `processLostDealRefunds()` from polling - refunds now processed via Pipedrive webhooks only.
- [x] **NEW**: Stripe processing uses webhooks as primary mechanism, polling is fallback only.

## Phase 1.1 — API Adjustments

- [ ] Remove legacy endpoints `/api/invoice-processing/start` and `/stop`, including service methods they call.
- [ ] Extend `/api/invoice-processing/status` to return `lastRun`, `nextRun`, `retryScheduled`, `runHistorySize`.
- [ ] Add new endpoint `/api/invoice-processing/scheduler-history` exposing latest runs for the UI.

## Phase 2 — Frontend Dashboard Refresh

- [ ] Strip scheduler control buttons and related status blocks from `frontend/index.html`.
- [ ] Introduce history widget (table/list) fed by new API; refresh every 60 seconds in `frontend/script.js`.
- [ ] Update manual polling section copy to clarify automatic hourly schedule.
- [ ] Remove unused styles/scripts tied to deleted controls in `frontend/style.css`.

## Phase 3 — Testing

- [ ] Add Jest unit tests for scheduler: hourly trigger, skip on overlap, retry scheduling, history cap.
- [ ] Add integration tests (or smoke script) hitting `/status` and `/scheduler-history`, verifying removed endpoints.
- [ ] Perform manual QA on staging: simulate cron run (temporary 1-minute interval), verify UI updates, retry logging.

## Phase 4 — Documentation & Rollout

- [ ] Update operator README/quickstart with new monitoring instructions and removed controls.
- [ ] Announce change to support team; capture acknowledgement before release.
- [ ] Prepare deployment checklist ensuring ≥3 successful hourly runs on staging before production rollout.


