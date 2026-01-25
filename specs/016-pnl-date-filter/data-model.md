# Data Model: PNL Yearly Report with Analytics

**Feature**: 016-pnl-date-filter  
**Date**: 2025-01-27

## Entities

### 1. Yearly PNL Insights Summary

**Purpose**: Represents aggregated analytical insights for a specific year, displayed in the "Выводы" tab.

**Fields**:
- `year` (number, required): Calendar year being reported (2020-2030)
- `asOfDate` (date, optional): Historical date for viewing data as of that point in time (ISO 8601 format)
- `revenueMetrics` (object, required): Key revenue metrics
  - `totalAnnual` (number): Total annual revenue in PLN
  - `averageMonthly` (number): Average monthly revenue in PLN
  - `bestMonth` (object): Best performing month
    - `month` (number): Month number (1-12)
    - `monthName` (string): Month name in Russian
    - `amount` (number): Revenue amount in PLN
  - `worstMonth` (object): Worst performing month
    - `month` (number): Month number (1-12)
    - `monthName` (string): Month name in Russian
    - `amount` (number): Revenue amount in PLN
  - `totalPayments` (number): Total number of payments for the year
- `expensesStatistics` (object, required): Expenses statistics
  - `totalAnnual` (number): Total annual expenses in PLN
  - `averageMonthly` (number): Average monthly expenses in PLN
  - `topCategories` (array, optional): Top expense categories
    - `categoryId` (number): Category ID
    - `categoryName` (string): Category name
    - `amount` (number): Total amount in PLN
    - `percentage` (number): Percentage of total expenses
  - `expensesToRevenueRatio` (number): Expenses / Revenue * 100%
- `breakEvenAnalysis` (object, required): Break-even analysis
  - `monthlyBreakEven` (number): Required monthly revenue to cover average monthly expenses
  - `annualBreakEven` (number): Required annual revenue to cover total annual expenses
  - `monthsToBreakEven` (number|null): Number of months needed to cover expenses (null if unprofitable)
  - `profitLoss` (number): Total revenue minus total expenses (can be negative)
  - `profitMargin` (number): Profit/loss divided by revenue * 100% (can be negative)
- `yearOverYear` (object, optional): Year-over-year comparison (if previous year data available)
  - `revenueGrowthRate` (number): ((current - previous) / previous) * 100%
  - `expensesGrowthRate` (number): ((current - previous) / previous) * 100%
  - `profitChange` (number): Current profit - previous profit
  - `profitChangePercent` (number): ((current - previous) / |previous|) * 100%
  - `bestMonthComparison` (object): Comparison of best months
  - `worstMonthComparison` (object): Comparison of worst months
- `profitabilityMetrics` (object, required): Profitability ratios
  - `operatingMargin` (number): (profit/loss / revenue) * 100%
  - `netProfitMargin` (number): Same as operating margin for this context
  - `returnOnRevenue` (number): (profit/loss / revenue) * 100%
- `quarterlyAnalysis` (object, required): Quarterly breakdown
  - `q1` (object): Q1 (Jan-Mar) data
    - `revenue` (number): Total revenue in PLN
    - `profitLoss` (number): Profit/loss in PLN
  - `q2` (object): Q2 (Apr-Jun) data
  - `q3` (object): Q3 (Jul-Sep) data
  - `q4` (object): Q4 (Oct-Dec) data
  - `bestQuarter` (number): Quarter number (1-4) with highest revenue
  - `worstQuarter` (number): Quarter number (1-4) with lowest revenue
  - `quarterlyTrends` (array): Growth trends between quarters
    - `from` (number): From quarter (1-3)
    - `to` (number): To quarter (2-4)
    - `growthRate` (number): Percentage change
- `operationalEfficiency` (object, required): Operational efficiency metrics
  - `averageTransactionValue` (number): Total revenue / total payment count
  - `revenuePerMonth` (number): Average monthly revenue
  - `expensesPerMonth` (number): Average monthly expenses
  - `efficiencyRatio` (number): Expenses / Revenue (lower is better)
- `stabilityVolatility` (object, required): Stability/volatility analysis
  - `coefficientOfVariation` (number): (standard deviation / mean) * 100%
  - `stabilityScore` (string): "very_stable" | "stable" | "moderate" | "high_volatility"
  - `outlierMonths` (array): Months with significant deviations
    - `month` (number): Month number
    - `deviation` (number): Deviation from mean in standard deviations
  - `consistencyIndicator` (number): Percentage of months within 1 standard deviation
- `cashRunway` (object, required): Cash runway analysis
  - `monthsOfRunway` (number|null): Months of runway based on current profit/loss (null if loss)
  - `monthsUntilBreakEven` (number|null): Months until break-even (null if already profitable)
  - `requiredGrowthRate` (number|null): Required monthly revenue growth rate to achieve break-even
  - `burnRate` (number|null): Monthly cash consumption rate if expenses exceed revenue
- `expenseEfficiency` (object, required): Expense efficiency analysis
  - `topCategories` (array): Top expense categories by amount
  - `categoryGrowthRates` (array, optional): YoY growth rates per category (if previous year available)
  - `optimizationOpportunities` (array): Categories with highest growth rates
  - `roiAnalysis` (array, optional): ROI for expense categories (if revenue categories linked)
- `predictiveInsights` (object, required): Predictive insights
  - `projectedAnnualRevenue` (number|null): Projected revenue for next year
  - `projectedBreakEvenTimeline` (number|null): Projected months until break-even
  - `forecastedBestMonth` (number|null): Forecasted best month for next year (1-12)
  - `forecastedWorstMonth` (number|null): Forecasted worst month for next year (1-12)
  - `riskIndicators` (array): Array of risk indicator strings
- `performanceBenchmarks` (object, optional): Performance benchmarks (if previous year available)
  - `overallPerformance` (string): "better" | "worse" | "same"
  - `breakEvenMilestone` (object): Break-even milestone achievement
    - `achieved` (boolean): Whether break-even was achieved
    - `month` (number|null): Month when achieved (if applicable)
  - `growthRateComparison` (number): Current year growth rate vs previous year
  - `profitabilityImprovement` (number): Change in profit margin compared to previous year
- `trendAnalysis` (object, required): Trend analysis
  - `firstHalfVsSecondHalf` (number): Percentage change from first half to second half
  - `peakPeriod` (object): Peak revenue period
    - `startMonth` (number): Start month
    - `endMonth` (number): End month
    - `totalRevenue` (number): Total revenue for period
  - `lowPeriod` (object): Low revenue period
  - `monthOverMonthGrowthRates` (array): Growth rates for each month transition
  - `seasonalityDetected` (boolean): Whether seasonality patterns detected
- `monthByMonth` (object, required): Month-by-month insights
  - `monthsAboveBreakEven` (object): Months above break-even
    - `count` (number): Number of months
    - `months` (array): Array of month numbers (1-12)
  - `monthsBelowBreakEven` (object): Months below break-even
  - `longestProfitableStreak` (number): Longest consecutive profitable months
  - `longestLossStreak` (number): Longest consecutive loss months
  - `recoveryMonths` (array): Months that showed profit after previous losses
- `strategicInsights` (object, required): Strategic insights (AI-generated or rule-based)
  - `overallSummary` (string): Overall performance summary text
  - `breakEvenStatus` (string): Break-even status description
  - `growthTrajectory` (string): Growth trajectory assessment
  - `seasonalPatterns` (string|null): Seasonal patterns identification (if detected)
  - `stabilityAssessment` (string): Stability assessment
  - `cashRunwayStatus` (string): Cash runway status
  - `expenseOptimization` (array): Expense optimization recommendations
  - `keyObservations` (array): Key observations
  - `strategicRecommendations` (array): Actionable strategic recommendations for next year
  - `generatedAt` (string): ISO 8601 timestamp of generation
  - `generatedBy` (string): "ai" | "rule-based"
  - `cacheKey` (string, optional): Cache key if AI-generated

**Validation Rules**:
- `year` must be between 2020 and 2030
- `asOfDate` must be valid ISO 8601 date, must not be in the future
- All monetary amounts must be numbers (can be negative for losses)
- Percentages must be numbers between -100 and 1000 (allowing for high growth rates)
- Month numbers must be between 1 and 12
- Quarter numbers must be between 1 and 4

**Relationships**:
- Aggregated from `Payment` entities (via `PnlReportService`)
- Aggregated from `Expense` entities (via `ManualEntryService`)
- Uses `IncomeCategory` and `ExpenseCategory` entities for breakdowns
- Generated using `ChatGPT` API (optional) or rule-based templates

**State Transitions**: N/A (read-only aggregated view)

---

### 2. ChatGPT Payload Structure

**Purpose**: Structured data payload sent to ChatGPT API for generating strategic insights.

**Fields**:
- `year` (number): Year being analyzed
- `revenue` (object): Revenue metrics
- `expenses` (object): Expenses statistics
- `breakEven` (object): Break-even analysis
- `yoy` (object, optional): Year-over-year comparison
- `profitability` (object): Profitability metrics
- `quarterly` (object): Quarterly analysis
- `efficiency` (object): Operational efficiency
- `trends` (object): Trend analysis
- `stability` (object): Stability/volatility analysis
- `cashRunway` (object): Cash runway analysis
- `expenseEfficiency` (object): Expense efficiency analysis
- `predictive` (object): Predictive insights
- `benchmarks` (object, optional): Performance benchmarks
- `monthly` (object): Month-by-month insights

**Validation Rules**:
- All fields must be present (except optional ones)
- All numeric values must be valid numbers
- Structure must match Yearly PNL Insights Summary entity

**Relationships**:
- Input to ChatGPT API
- Output from `PnlInsightsService`

---

### 3. Historical Date Filter

**Purpose**: Represents a filter for viewing data as of a specific historical date.

**Fields**:
- `asOfDate` (date, required): Historical date in ISO 8601 format
- `year` (number, required): Year being filtered
- `appliesTo` (array): What data is filtered
  - `payments` (boolean): Whether to filter payments
  - `expenses` (boolean): Whether to filter expenses

**Validation Rules**:
- `asOfDate` must be valid date
- `asOfDate` must not be in the future
- `asOfDate` must be within reasonable range (e.g., 2020-01-01 to today)

**Relationships**:
- Applied to `Payment` queries (via `PnlRepository`)
- Applied to `Expense` queries (via `ManualEntryService`)

---

## Data Flow

### Insights Generation Flow

```
1. User selects year (and optional asOfDate)
   ↓
2. Frontend calls GET /api/pnl/insights?year=2025&asOfDate=2025-06-15
   ↓
3. Backend PnlInsightsService.getInsights(year, asOfDate)
   ↓
4. Load base data:
   - PnlReportService.getMonthlyRevenue(year, asOfDate)
   - ManualEntryService.getExpenses(year, asOfDate)
   ↓
5. Calculate all metrics (Phase 1-14):
   - Revenue metrics
   - Expenses statistics
   - Break-even analysis
   - YoY comparison (if previous year available)
   - Profitability metrics
   - Quarterly analysis
   - Operational efficiency
   - Trend analysis
   - Stability/volatility
   - Cash runway
   - Expense efficiency
   - Predictive insights
   - Performance benchmarks
   - Month-by-month insights
   ↓
6. Generate strategic insights:
   - Check cache for ChatGPT response
   - If cached: return cached response
   - If not cached: call ChatGPT API with structured payload
   - Parse AI response
   - Cache response
   - Fallback to rule-based if AI unavailable
   ↓
7. Return complete insights object
   ↓
8. Frontend displays in "Выводы" tab
```

### Historical Date Filtering Flow

```
1. User selects historical date (asOfDate)
   ↓
2. Frontend includes asOfDate in API request
   ↓
3. Backend applies filter at repository level:
   - Payments: WHERE created_at <= asOfDate AND updated_at <= asOfDate
   - Expenses: WHERE created_at <= asOfDate AND updated_at <= asOfDate
   ↓
4. Aggregation uses filtered data
   ↓
5. Insights reflect data state as of selected date
```

---

## Validation Rules Summary

1. **Year Validation**: Must be valid year between 2020 and 2030
2. **Date Validation**: Historical dates must be valid ISO 8601 dates, not in future
3. **Monetary Values**: All amounts must be numbers (can be negative)
4. **Percentages**: Must be numbers, typically between -100 and 1000
5. **Month Numbers**: Must be between 1 and 12
6. **Quarter Numbers**: Must be between 1 and 4
7. **Cache Keys**: Must be valid MD5 hash strings (32 characters)

---

## Database Schema (No New Tables Required)

This feature uses existing tables:
- `payments` - for revenue data
- `stripe_payments` - for Stripe revenue data
- `pnl_manual_entries` - for expense data
- `pnl_expense_categories` - for expense categories
- `pnl_revenue_categories` - for revenue categories (if used)

No new database tables required. Feature extends existing data structures.


