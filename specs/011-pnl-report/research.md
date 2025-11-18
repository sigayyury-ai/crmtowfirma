# Research: PNL Report Service

**Feature**: 011-pnl-report  
**Date**: 2025-11-18  
**Status**: Complete

## Research Tasks

### 1. Payment Data Aggregation Strategy

**Question**: How to efficiently aggregate monthly revenue from ProForm and Stripe payments while excluding refunds?

**Research Findings**:
- Existing `PaymentRevenueReportService` already aggregates payments by month and product
- Payment data stored in `payments` table (bank statements) and `stripe_payments` table
- Refunds tracked in `stripe_payment_deletions` table and `deleted_proformas` table
- Both payment sources have `payments_total_pln` field for PLN conversion

**Decision**: Reuse existing payment aggregation logic from `PaymentRevenueReportService` but simplify to:
- Aggregate by month only (not by product)
- Filter out refunded payments using existing refund tracking
- Convert all amounts to PLN using existing exchange rate logic

**Rationale**: 
- Leverages proven aggregation patterns
- Maintains consistency with existing reports
- Reduces code duplication

**Alternatives Considered**:
- Creating new aggregation service from scratch - rejected due to code duplication
- Using raw SQL queries - rejected due to less maintainability

---

### 2. pnl_data Table Population Strategy

**Question**: Should revenue data be pre-aggregated and stored in `pnl_data` table, or calculated on-the-fly?

**Research Findings**:
- `pnl_data` table exists with structure: `id`, `amount`, `month`, `created_at`, `updated_at`
- Table currently empty (0 records)
- No `year` column exists - year must be derived from payment dates or stored separately
- Table structure suggests pre-aggregation approach

**Decision**: 
- **Phase 1 (MVP)**: Calculate revenue on-the-fly from payment tables for faster implementation
- **Future Enhancement**: Pre-aggregate and store in `pnl_data` table for better performance

**Rationale**:
- Faster initial implementation
- No need to maintain sync between payment tables and `pnl_data`
- Can add pre-aggregation later if performance becomes an issue
- Year filtering handled via payment date queries

**Alternatives Considered**:
- Pre-aggregating immediately - rejected due to added complexity and sync requirements
- Using `pnl_data` only - rejected due to need to populate from scratch

---

### 3. Year Storage in pnl_data Table

**Question**: How to handle year information given `pnl_data` table only has `month` column?

**Research Findings**:
- `pnl_data` table structure: `id`, `amount`, `month`, `created_at`, `updated_at`
- No `year` column exists
- `created_at` timestamp could be used but not reliable for year determination
- Payment tables have date fields that include year information

**Decision**: 
- For MVP: Filter payments by year range when querying payment tables directly
- For future: Add `year` column to `pnl_data` table if pre-aggregation is implemented

**Rationale**:
- Works with current table structure
- No schema changes required for MVP
- Year filtering handled at query level using payment dates

**Alternatives Considered**:
- Adding `year` column immediately - rejected as not needed for MVP
- Using `created_at` for year - rejected as unreliable

---

### 4. Refund Exclusion Logic

**Question**: How to accurately exclude refunded payments from revenue calculations?

**Research Findings**:
- Stripe refunds tracked in `stripe_payment_deletions` table with `deal_id` and `session_id`
- ProForm refunds tracked via `deleted_proformas` table
- Stripe payments have `stripe_payment_status` field
- Payment records can be linked to refunds via `deal_id` or payment IDs

**Decision**: Use existing refund tracking:
- For Stripe: Check `stripe_payment_deletions` table and exclude payments with matching `deal_id`
- For ProForm: Exclude payments linked to proformas in `deleted_proformas` table
- Also check `stripe_payment_status` for Stripe payments to exclude refunded status

**Rationale**:
- Leverages existing refund tracking infrastructure
- Consistent with other reports (payment revenue report)
- Ensures 100% refund exclusion as required

**Alternatives Considered**:
- Creating new refund tracking - rejected due to duplication
- Manual refund marking - rejected due to error-prone nature

---

### 5. Frontend Page Structure

**Question**: What frontend structure to use for the PNL report page?

**Research Findings**:
- Existing reports use pattern: `frontend/vat-margin.html` + `frontend/vat-margin-script.js`
- Navigation structure in `frontend/index.html` shows links to reports
- Shared styles in `frontend/style.css`
- API calls use `/api/vat-margin/` prefix pattern

**Decision**: Follow existing pattern:
- Create `frontend/pnl-report.html` for the page
- Create `frontend/pnl-report-script.js` for JavaScript logic
- Add navigation link in main navigation
- Use API endpoint `/api/pnl/report` following RESTful pattern

**Rationale**:
- Consistency with existing codebase
- Familiar structure for developers
- Reuses existing authentication and styling

**Alternatives Considered**:
- Single-page application framework - rejected as overkill for simple report
- Embedding in existing vat-margin page - rejected due to different purpose and scope

---

### 6. Currency Conversion Accuracy

**Question**: How to ensure currency conversion accuracy within 0.01 PLN tolerance?

**Research Findings**:
- Existing `convertToPln` function in `paymentRevenueReportService.js` handles conversion
- Exchange rates stored in payment records (`currency_exchange` field)
- Stripe payments have `amount_pln` field pre-calculated
- ProForm payments use `payments_total_pln` field

**Decision**: Use existing currency conversion logic:
- For Stripe: Use `amount_pln` field directly (already converted)
- For ProForm: Use `payments_total_pln` field or calculate using `currency_exchange`
- Round to 2 decimal places for PLN amounts

**Rationale**:
- Leverages existing proven conversion logic
- Maintains consistency across reports
- Meets accuracy requirement (0.01 PLN = 2 decimal places)

**Alternatives Considered**:
- Real-time exchange rate API - rejected due to complexity and existing stored rates
- Manual conversion - rejected due to potential errors

---

## Summary

All research questions resolved. Key decisions:
1. Reuse existing payment aggregation patterns
2. Calculate revenue on-the-fly for MVP (no pre-aggregation)
3. Filter by year using payment date queries
4. Use existing refund tracking mechanisms
5. Follow existing frontend page structure pattern
6. Use existing currency conversion logic

### MVP Simplification

**Decision**: MVP will focus on processed payments only:
- Include payments with `manual_status = 'approved'` (manually approved)
- Include payments with `match_status = 'matched'` (auto-matched)
- Exclude unprocessed/unmatched payments
- Year selector deferred to Phase 2 (default to current year in MVP)

**Rationale**: 
- Faster MVP delivery
- Focuses on verified/processed revenue data
- Reduces complexity for initial implementation
- Year selector can be added easily in Phase 2

No blocking issues identified. Ready to proceed to Phase 1 design.

