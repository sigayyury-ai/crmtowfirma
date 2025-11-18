# Quick Start: PNL Report Service

**Feature**: 011-pnl-report  
**Date**: 2025-11-18

## Overview

The PNL Report Service provides monthly revenue (income) reports for selected years, aggregating payment data from ProForm and Stripe sources while excluding refunds. All amounts are converted to PLN for consistent display.

## Prerequisites

- Node.js 18+ installed
- Supabase database configured with:
  - `payments` table (bank statement payments)
  - `stripe_payments` table (Stripe payment records)
  - `stripe_payment_deletions` table (Stripe refunds)
  - `deleted_proformas` table (deleted/refunded proformas)
  - `pnl_data` table (exists but empty for MVP)
- Environment variables configured (see `.env.example`)

## Setup Steps

### 1. Backend Service Implementation

Create the PNL report service:

```bash
# Create service directory
mkdir -p src/services/pnl

# Create service files
touch src/services/pnl/pnlReportService.js
touch src/services/pnl/pnlRepository.js
```

### 2. API Endpoint Registration

Add route to `src/routes/api.js`:

```javascript
const PnlReportService = require('../services/pnl/pnlReportService');
const pnlReportService = new PnlReportService();

// Add route
router.get('/pnl/report', async (req, res) => {
  // Implementation
});
```

### 3. Frontend Page Creation

Create frontend files:

```bash
# Create frontend page
touch frontend/pnl-report.html
touch frontend/pnl-report-script.js
```

### 4. Navigation Update

Add link to main navigation in `frontend/index.html`:

```html
<nav class="main-nav">
  <a href="/vat-margin.html" class="nav-link">Отчеты</a>
  <a href="/pnl-report.html" class="nav-link">PNL Отчет</a>
  <a href="/" class="nav-link active">Автоматизация</a>
</nav>
```

## Testing the Feature

### Phase 1: MVP Testing

### 1. Start the Server

```bash
npm run dev
```

Server should start on `http://localhost:3000`

### 2. Access the Report Page

Navigate to: `http://localhost:3000/pnl-report.html`

### 3. Test API Endpoint Directly (MVP)

```bash
# Test current year report (year parameter optional in MVP)
curl "http://localhost:3000/api/pnl/report"

# Or explicitly specify year
curl "http://localhost:3000/api/pnl/report?year=2025"
```

**Expected MVP Behavior**:
- Returns monthly revenue for current year (or most recent year with data)
- Only includes processed payments (approved or matched)
- Excludes refunded payments
- All amounts in PLN

### Phase 2: Full Functionality Testing

```bash
# Test 2025 report
curl "http://localhost:3000/api/pnl/report?year=2025"

# Test 2026 report
curl "http://localhost:3000/api/pnl/report?year=2026"

# Test with currency breakdown
curl "http://localhost:3000/api/pnl/report?year=2025&includeBreakdown=true"
```

### 4. Verify Refund Exclusion

1. Identify a payment that was refunded
2. Check that it does not appear in the revenue totals
3. Verify refund exclusion logic works for both Stripe and ProForm payments

### 5. Verify Currency Conversion

1. Check payments in different currencies (EUR, USD, PLN)
2. Verify all amounts displayed in PLN
3. Verify conversion accuracy (within 0.01 PLN tolerance)

## Expected Behavior

### Phase 1: MVP Behavior

**Successful Report Load**:
- Page loads within 3 seconds
- Simple table displayed with monthly revenue
- Default year is current year (2025) or most recent year with processed payments
- All 12 months displayed (even if amount is 0)
- Monthly amounts shown in PLN
- Only processed payments included (approved or matched)

**No Year Selector**: Year selector will be added in Phase 2

### Phase 2: Full Functionality Behavior

**Successful Report Load**:
- Page loads within 3 seconds
- Year selector shows 2025 and 2026 options
- Default year is current year or most recent available
- All 12 months displayed (even if amount is 0)
- Monthly amounts shown in PLN
- Total for the year displayed
- Currency breakdown available (if requested)

### Refund Exclusion

- Payments linked to refunds in `stripe_payment_deletions` are excluded
- Payments linked to proformas in `deleted_proformas` are excluded
- Stripe payments with `stripe_payment_status = 'refunded'` are excluded
- Net revenue shown (original payment minus refund, not negative)

### Currency Handling

- All amounts converted to PLN
- Conversion uses stored exchange rates from payment records
- Amounts rounded to 2 decimal places
- Currency breakdown available if requested

## Troubleshooting

### No Data Showing

- Check that payment data exists in `payments` and `stripe_payments` tables
- Verify payment dates fall within selected year
- Check browser console for API errors

### Incorrect Amounts

- Verify currency conversion logic
- Check exchange rates in payment records
- Verify refund exclusion is working correctly

### Performance Issues

- Check database query performance
- Verify indexes on date fields
- Consider adding caching for frequently accessed years

## Next Steps

After MVP is working:

1. Add pre-aggregation to `pnl_data` table for better performance
2. Add `year` column to `pnl_data` table
3. Implement revenue category classification
4. Add expense tracking and profit calculations
5. Add export functionality (CSV, PDF)

