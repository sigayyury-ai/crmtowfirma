# Data Model: PNL Report Service

**Feature**: 011-pnl-report  
**Date**: 2025-11-18

## Entities

### 1. Monthly Revenue Entry (Aggregated View)

**Purpose**: Represents aggregated monthly revenue for display in the report.

**Fields**:
- `year` (number, required): Year of the revenue (2025, 2026, etc.)
- `month` (number, required): Month number (1-12)
- `amountPln` (number, required): Total revenue in PLN for the month
- `paymentCount` (number, optional): Number of payments contributing to revenue
- `currencyBreakdown` (object, optional): Original currency totals before conversion
  - Key: currency code (e.g., "EUR", "USD")
  - Value: amount in original currency

**Validation Rules**:
- `year` must be >= 2020 and <= current year + 1
- `month` must be between 1 and 12
- `amountPln` must be >= 0 (refunds excluded, so never negative)
- `amountPln` rounded to 2 decimal places

**Relationships**:
- Aggregated from multiple `Payment` entities
- Excludes payments linked to `Refund` entities

**State Transitions**: N/A (read-only aggregated view)

---

### 2. PNL Data Record (Database Entity)

**Purpose**: Stores aggregated revenue data in `pnl_data` table (for future use).

**Database Table**: `pnl_data`

**Fields**:
- `id` (integer, primary key, auto-increment): Unique identifier
- `amount` (decimal, required): Revenue amount in PLN
- `month` (integer, required): Month number (1-12)
- `created_at` (timestamp, auto): Record creation timestamp
- `updated_at` (timestamp, auto): Record last update timestamp

**Validation Rules**:
- `amount` must be >= 0
- `month` must be between 1 and 12
- `amount` stored with 2 decimal precision

**Relationships**:
- Aggregated from `payments` and `stripe_payments` tables
- May reference `pnl_expense_categories` or `pnl_revenue_categories` in future

**State Transitions**: N/A (for MVP - table not used, but structure documented for future)

**Note**: Year information not stored in table - derived from payment dates during aggregation.

---

### 3. Payment (Existing Entity - Referenced)

**Purpose**: Source data for revenue aggregation.

**Source Tables**:
- `payments` (bank statement payments)
- `stripe_payments` (Stripe payment records)

**Key Fields Used**:
- Payment date (for month/year extraction)
- Amount in PLN (`payments_total_pln` or `amount_pln`)
- Currency and exchange rate (for breakdown)
- Linked proforma/deal IDs (for refund checking)
- Processing status (`manual_status`, `match_status`)

**Filtering Rules**:

**MVP (Phase 1) - Processed Payments Only**:
- Include payments with `manual_status = 'approved'` (manually approved)
- Include payments with `match_status = 'matched'` (auto-matched and verified)
- Exclude unprocessed payments (`manual_status IS NULL` AND `match_status != 'matched'`)
- Exclude payments linked to refunds in `stripe_payment_deletions` or `deleted_proformas`
- Exclude Stripe payments with `stripe_payment_status` = 'refunded'
- Only include Stripe payments with `stripe_payment_status = 'paid'`

**Phase 2 - Full Functionality**:
- Same as MVP, plus:
- Year filtering via payment date
- Optional inclusion of pending payments (if needed)

---

### 4. Refund (Existing Entity - Referenced)

**Purpose**: Identifies payments to exclude from revenue.

**Source Tables**:
- `stripe_payment_deletions` (Stripe refunds)
- `deleted_proformas` (deleted/refunded proformas)

**Key Fields Used**:
- `deal_id`: Links refund to payments via deal
- `session_id`: Links Stripe refund to Stripe payment
- `proforma_id`: Links refund to proforma payments

**Exclusion Logic**:
- Payments with matching `deal_id` in refund tables are excluded
- Payments linked to proformas in `deleted_proformas` are excluded
- Stripe payments with refunded status are excluded

---

## Data Flow

### Revenue Aggregation Flow

**MVP (Phase 1)**:
```
1. Default to current year (or most recent year with data)
   ↓
2. Query processed payments from:
   - payments table: WHERE (manual_status = 'approved' OR match_status = 'matched')
   - stripe_payments table: WHERE stripe_payment_status = 'paid'
   Filter: payment date within current/default year
   ↓
3. Exclude refunded payments:
   - Check stripe_payment_deletions for matching deal_id
   - Check deleted_proformas for linked proformas
   - Check stripe_payment_status for 'refunded'
   ↓
4. Group by month (extract month from payment date)
   ↓
5. Aggregate amounts:
   - Sum amounts in PLN (use payments_total_pln or amount_pln)
   - Count payments per month
   ↓
6. Return Monthly Revenue Entry array (12 entries, one per month)
```

**Phase 2 (Full Functionality)**:
```
1. User selects year (2025 or 2026)
   ↓
2. Query processed payments from:
   - payments table (ProForm payments)
   - stripe_payments table (Stripe payments)
   Filter: payment date within selected year AND (manual_status = 'approved' OR match_status = 'matched')
   ↓
3. Exclude refunded payments:
   - Check stripe_payment_deletions for matching deal_id
   - Check deleted_proformas for linked proformas
   - Check stripe_payment_status for 'refunded'
   ↓
4. Group by month (extract month from payment date)
   ↓
5. Aggregate amounts:
   - Sum amounts in PLN (use payments_total_pln or amount_pln)
   - Count payments per month
   - Group by original currency for breakdown
   ↓
6. Return Monthly Revenue Entry array (12 entries, one per month)
```

### API Response Structure

```json
{
  "success": true,
  "year": 2025,
  "months": [
    {
      "month": 1,
      "monthName": "Январь",
      "amountPln": 12500.50,
      "paymentCount": 15,
      "currencyBreakdown": {
        "EUR": 2500.00,
        "PLN": 10000.50
      }
    },
    // ... 11 more months
  ],
  "total": {
    "amountPln": 150000.00,
    "paymentCount": 180
  }
}
```

---

## Validation Rules Summary

1. **Year Validation**: Must be valid year (2025, 2026, or future years as added)
2. **Month Validation**: Always return 12 months (1-12), even if amount is 0
3. **Amount Validation**: All amounts >= 0 (refunds excluded, never negative)
4. **Currency Conversion**: All amounts converted to PLN with 2 decimal precision
5. **Refund Exclusion**: 100% of refunded payments excluded (verified requirement)

---

## Future Enhancements (Out of Scope for MVP)

- Pre-aggregation into `pnl_data` table for performance
- Adding `year` column to `pnl_data` table
- Revenue category classification
- Expense tracking and profit calculations
- Multi-year comparison views

