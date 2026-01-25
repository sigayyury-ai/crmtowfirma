# Quickstart: PNL Yearly Report with Analytics

**Feature**: 016-pnl-date-filter  
**Date**: 2025-01-27

## Overview

This feature adds a new "Выводы" (Insights) tab to the PNL report interface, displaying comprehensive analytical insights and strategic conclusions for yearly financial data. Implementation follows an incremental approach with 17 phases, adding one metric at a time for easier testing.

## Prerequisites

- Node.js ≥18.0.0
- Existing PNL report service (`011-pnl-report`) must be functional
- Supabase database with payment and expense data
- OpenAI API key (optional, for AI-generated insights)

## Quick Setup

### 1. Environment Variables

Ensure these environment variables are set (already configured for existing features):

```bash
# Supabase (required)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# OpenAI (optional, for AI insights)
OPENAI_API_KEY=sk-your_openai_api_key
OPENAI_MODEL=gpt-4o-mini  # or gpt-4o for better quality
```

### 2. Verify Existing PNL Report Works

```bash
# Test existing PNL report endpoint
curl "http://localhost:3000/api/pnl/report?year=2025"
```

Should return monthly revenue data for 2025.

### 3. Test New Insights Endpoint (After Phase 0 Implementation)

```bash
# Get insights for 2025
curl "http://localhost:3000/api/pnl/insights?year=2025"

# Get insights with historical date filter
curl "http://localhost:3000/api/pnl/insights?year=2025&asOfDate=2025-06-15"

# Force regenerate AI insights (bypass cache)
curl "http://localhost:3000/api/pnl/insights?year=2025&regenerateAI=true"
```

## Implementation Phases

### Phase 0: Foundation (MVP Start)

**Goal**: Create basic tab structure and API endpoint.

**Test**: Navigate to `/pnl-report.html`, click "Выводы" tab, verify tab appears.

**Expected Behavior**:
- New "Выводы" tab appears alongside "Отчет" and "Настройки"
- Tab loads without errors (may be empty initially)
- API endpoint `/api/pnl/insights` exists and returns basic structure

---

### Phase 1: Key Revenue Metrics

**Goal**: Display basic revenue statistics.

**Test**: Open "Выводы" tab, verify revenue metrics table displays:
- Total annual revenue
- Average monthly revenue
- Best performing month
- Worst performing month
- Total payment count

**Manual Verification**:
```bash
# Get insights
curl "http://localhost:3000/api/pnl/insights?year=2025" | jq '.data.revenueMetrics'

# Verify total annual revenue matches sum from main report
curl "http://localhost:3000/api/pnl/report?year=2025" | jq '.data.total.amountPln'
```

---

### Phase 2: Expenses Statistics

**Goal**: Display expenses data.

**Test**: Verify expenses statistics table displays:
- Total annual expenses
- Average monthly expenses
- Top expense categories
- Expenses-to-revenue ratio

**Manual Verification**:
```bash
# Check expenses total
curl "http://localhost:3000/api/pnl/insights?year=2025" | jq '.data.expensesStatistics.totalAnnual'

# Verify ratio calculation: expenses / revenue * 100
```

---

### Phase 3: Break-Even Analysis

**Goal**: Calculate break-even metrics.

**Test**: Verify break-even table displays:
- Monthly break-even point
- Annual break-even point
- Months to break-even
- Profit/loss
- Profit margin

**Manual Verification**:
- Monthly break-even = average monthly expenses
- Annual break-even = total annual expenses
- Profit/loss = revenue - expenses
- Profit margin = (profit/loss / revenue) * 100%

---

### Phase 4-14: Additional Metrics

Each phase adds one metric section. Test each independently:
- Phase 4: Year-over-Year Comparison
- Phase 5: Profitability Metrics
- Phase 6: Quarterly Analysis
- Phase 7: Operational Efficiency
- Phase 8: Trend Analysis
- Phase 9: Stability/Volatility
- Phase 10: Cash Runway
- Phase 11: Expense Efficiency
- Phase 12: Predictive Insights
- Phase 13: Performance Benchmarks
- Phase 14: Month-by-Month Insights

---

### Phase 15: Strategic Insights - Rule-Based

**Goal**: Generate text insights using templates.

**Test**: Verify strategic insights section displays:
- Overall performance summary
- Break-even status
- Growth trajectory
- Key observations
- Strategic recommendations

**Manual Verification**: Check that recommendations reference actual calculated metrics.

---

### Phase 16: Strategic Insights - AI-Powered

**Goal**: Integrate ChatGPT for AI-generated insights.

**Test**: 
1. Verify AI insights generate when OpenAI API is configured
2. Verify fallback to rule-based when API unavailable
3. Verify caching works (second request uses cache)
4. Verify "Обновить выводы" button bypasses cache

**Manual Verification**:
```bash
# First request (calls ChatGPT)
curl "http://localhost:3000/api/pnl/insights?year=2025" | jq '.data.strategicInsights.generatedBy'
# Should return "ai"

# Second request (uses cache)
curl "http://localhost:3000/api/pnl/insights?year=2025" | jq '.data.strategicInsights.generatedBy'
# Should return "ai" (from cache)

# Force regenerate
curl "http://localhost:3000/api/pnl/insights?year=2025&regenerateAI=true" | jq '.data.strategicInsights.generatedBy'
# Should return "ai" (new call)
```

---

### Phase 17: Historical Date Filtering

**Goal**: Support viewing data as of a specific date.

**Test**: 
1. Select historical date (e.g., 2025-06-15)
2. Verify insights reflect data as of that date
3. Verify payments/expenses after selected date are excluded

**Manual Verification**:
```bash
# Get insights as of June 15, 2025
curl "http://localhost:3000/api/pnl/insights?year=2025&asOfDate=2025-06-15" | jq '.data.revenueMetrics.totalAnnual'

# Compare with current data
curl "http://localhost:3000/api/pnl/insights?year=2025" | jq '.data.revenueMetrics.totalAnnual'

# Historical should be <= current (if data was added after June 15)
```

## Testing Strategy

### Manual Testing Per Phase

1. **Implement phase** (e.g., Phase 1: Revenue Metrics)
2. **Test independently**: Verify metric displays correctly
3. **Manual verification**: Calculate expected values manually, compare with displayed values
4. **Move to next phase**: Only after current phase is validated

### Example Manual Verification Script

```bash
#!/bin/bash
# test-insights.sh

YEAR=2025

echo "Testing PNL Insights for year $YEAR"
echo "===================================="

# Get insights
INSIGHTS=$(curl -s "http://localhost:3000/api/pnl/insights?year=$YEAR")

# Extract values
TOTAL_REVENUE=$(echo $INSIGHTS | jq '.data.revenueMetrics.totalAnnual')
AVG_MONTHLY=$(echo $INSIGHTS | jq '.data.revenueMetrics.averageMonthly')
TOTAL_EXPENSES=$(echo $INSIGHTS | jq '.data.expensesStatistics.totalAnnual')
PROFIT_LOSS=$(echo $INSIGHTS | jq '.data.breakEvenAnalysis.profitLoss')

echo "Total Revenue: $TOTAL_REVENUE PLN"
echo "Average Monthly: $AVG_MONTHLY PLN"
echo "Total Expenses: $TOTAL_EXPENSES PLN"
echo "Profit/Loss: $PROFIT_LOSS PLN"

# Manual calculation
EXPECTED_PROFIT=$(echo "$TOTAL_REVENUE - $TOTAL_EXPENSES" | bc)
echo "Expected Profit/Loss: $EXPECTED_PROFIT PLN"

if [ "$(echo "$PROFIT_LOSS == $EXPECTED_PROFIT" | bc)" -eq 1 ]; then
  echo "✅ Profit/Loss calculation correct"
else
  echo "❌ Profit/Loss calculation incorrect"
fi
```

## Common Issues

### Issue: ChatGPT API not working

**Solution**: Check `OPENAI_API_KEY` is set. Verify API key is valid. Check logs for API errors. System will fallback to rule-based insights automatically.

### Issue: Historical date filtering not working

**Solution**: Verify `created_at` and `updated_at` timestamps exist in payment/expense tables. Check repository queries include date filters.

### Issue: Cached insights not updating

**Solution**: Use `regenerateAI=true` parameter or clear cache manually. Cache TTL is 1 hour by default.

## Next Steps

After MVP (Phase 0-3):
1. Continue with Phase 4-14 (one metric at a time)
2. Validate each metric before moving forward
3. Add Phase 15 (rule-based insights)
4. Add Phase 16 (AI-powered insights)
5. Add Phase 17 (historical date filtering)

## References

- [Specification](./spec.md)
- [Implementation Plan](./plan.md)
- [Data Model](./data-model.md)
- [API Contract](./contracts/pnl-insights-api.yaml)
- [Existing PNL Report Service](../011-pnl-report/spec.md)


