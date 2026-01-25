# Implementation Tasks: PNL Yearly Report with Analytics

**Feature**: 016-pnl-date-filter  
**Branch**: `016-pnl-date-filter`  
**Date**: 2025-01-27  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Overview

This document contains the implementation tasks for the PNL Yearly Report with Analytics feature, organized by implementation phases. Tasks follow an incremental approach, adding one metric at a time for easier testing and validation. Each phase delivers independently testable functionality.

**MVP Scope**: Phase 1-2 (Setup + Foundational) + Phase 3 (US3 Foundation) + Phase 4 (US3 Phase 1: Key Revenue Metrics) + Phase 5 (US3 Phase 2: Expenses Statistics) + Phase 6 (US3 Phase 3: Break-Even Analysis)  
**Full Feature**: All phases

## Dependencies & Story Completion Order

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
Phase 3 [US3-Foundation] → Can be tested independently
    ↓
Phase 4 [US3-Phase1] → Revenue Metrics (depends on Phase 3)
    ↓
Phase 5 [US3-Phase2] → Expenses Statistics (depends on Phase 4)
    ↓
Phase 6 [US3-Phase3] → Break-Even Analysis (depends on Phase 5)
    ↓
Phase 7-19 [US3-Phase4-14] → Additional metrics (one at a time)
    ↓
Phase 20 [US3-Phase15] → Strategic Insights Rule-Based
    ↓
Phase 21 [US3-Phase16] → Strategic Insights AI-Powered
    ↓
Phase 22 [US2] → Historical Date Filtering (can be added anytime after Phase 3)
    ↓
Phase 23 (Polish)
```

**Independent Test Criteria**:
- **US3-Foundation**: Navigate to `/pnl-report.html`, click "Выводы" tab, verify tab appears and loads
- **US3-Phase1**: Open "Выводы" tab, verify revenue metrics table displays with correct values
- **US3-Phase2**: Verify expenses statistics table displays correctly
- **US3-Phase3**: Verify break-even analysis table displays correctly
- **US2**: Select historical date, verify insights reflect data as of that date

## Implementation Strategy

**MVP First Approach**:
- Phase 1-2 implement foundation
- Phase 3 adds "Выводы" tab and basic API
- Phase 4-6 add core metrics (Revenue, Expenses, Break-Even) - MVP complete
- Remaining phases add additional metrics incrementally

**Incremental Delivery**:
- Each phase delivers independently testable functionality
- One metric added per phase for easy validation
- Manual verification after each phase before moving forward

---

## Phase 1: Setup

**Goal**: Initialize project structure and verify prerequisites.

### Tasks

- [ ] T001 Verify existing PNL report service (`src/services/pnl/pnlReportService.js`) is functional
- [ ] T002 Verify existing OpenAI service (`src/services/ai/openAIService.js`) is configured and working
- [ ] T003 Verify Supabase client configuration and database access
- [ ] T004 Review existing PNL report frontend (`frontend/pnl-report.html` and `frontend/pnl-report-script.js`)

---

## Phase 2: Foundational

**Goal**: Create core service infrastructure for insights calculations.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Tasks

- [ ] T005 Create `src/services/pnl/pnlInsightsService.js` with class structure and constructor
- [ ] T006 Add dependencies injection in `pnlInsightsService.js`: PnlReportService, ManualEntryService, ExpenseCategoryService
- [ ] T007 Implement helper methods in `pnlInsightsService.js`:
  - `calculateTotal()` - sum array of numbers
  - `calculateAverage()` - calculate average from array
  - `findMax()` - find maximum value in array with index
  - `findMin()` - find minimum value in array with index
  - `calculateStandardDeviation()` - calculate standard deviation
  - `calculateCoefficientOfVariation()` - calculate CV percentage
- [ ] T008 Extend `src/services/pnl/pnlRepository.js` to support historical date filtering:
  - Add optional `asOfDate` parameter to payment query methods
  - Add filter: `created_at <= asOfDate AND updated_at <= asOfDate` when `asOfDate` provided
- [ ] T009 Extend `src/services/pnl/manualEntryService.js` to support historical date filtering:
  - Add optional `asOfDate` parameter to expense query methods
  - Add filter: `created_at <= asOfDate AND updated_at <= asOfDate` when `asOfDate` provided

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: [US3-Foundation] Tab Structure and Basic API

**Goal**: Create "Выводы" tab and basic API endpoint for insights data.

**Independent Test**: Navigate to `/pnl-report.html`, click "Выводы" tab, verify tab appears and loads (even if empty initially).

### Backend Tasks

- [ ] T010 [US3] Add GET `/api/pnl/insights` endpoint in `src/routes/api.js`:
  - Accept `year` parameter (required, 2020-2030)
  - Accept `asOfDate` parameter (optional, ISO 8601 date)
  - Accept `regenerateAI` parameter (optional, boolean)
  - Call `pnlInsightsService.getInsights(year, asOfDate, regenerateAI)`
  - Return JSON response with `success` and `data` fields
  - Add error handling for invalid parameters
- [ ] T011 [US3] Implement basic `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Accept year, asOfDate (optional), regenerateAI (optional) parameters
  - Return basic structure: `{ year, asOfDate, revenueMetrics: {}, expensesStatistics: {}, ... }`
  - Initialize all metric sections as empty objects (will be populated in later phases)

### Frontend Tasks

- [ ] T012 [US3] Add "Выводы" tab button in `frontend/pnl-report.html`:
  - Add tab button in tab-header section alongside "Отчет" and "Настройки"
  - Set `data-tab="insights"` attribute
- [ ] T013 [US3] Add "Выводы" tab content section in `frontend/pnl-report.html`:
  - Create `<div class="tab-content" id="tab-insights">` section
  - Add placeholder content: "Загрузка аналитических данных..."
  - Add loading indicator element
  - Add error message element
- [ ] T014 [US3] Implement tab switching logic in `frontend/pnl-report-script.js`:
  - Add event listener for "Выводы" tab button
  - Show/hide tab content when tab is clicked
  - Add active class to selected tab button
  - Call `loadInsights()` when "Выводы" tab is activated
- [ ] T015 [US3] Implement `loadInsights()` function in `frontend/pnl-report-script.js`:
  - Get selected year from year selector
  - Build API URL: `/api/pnl/insights?year=${year}`
  - Make fetch request to API endpoint
  - Handle loading state (show loading indicator)
  - Handle error state (show error message)
  - Store response data for rendering (will be used in later phases)

**Checkpoint**: At this point, "Выводы" tab should appear and load without errors (may be empty)

---

## Phase 4: [US3-Phase1] Key Revenue Metrics

**Goal**: Display basic revenue statistics in table format.

**Independent Test**: Open "Выводы" tab, verify revenue metrics table displays with correct values. Manually verify total annual revenue matches sum of monthly revenue from main report.

### Backend Tasks

- [ ] T016 [US3] Implement `calculateRevenueMetrics()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `pnlReportService.getMonthlyRevenue(year, false, asOfDate)` to get monthly data
  - Calculate total annual revenue: sum of all monthly `amountPln` values
  - Calculate average monthly revenue: total annual / number of months with data
  - Find best performing month: month with highest `amountPln`
  - Find worst performing month: month with lowest `amountPln` (excluding zero months if all are zero)
  - Calculate total payment count: sum of all monthly `paymentCount` values
  - Return object with: `totalAnnual`, `averageMonthly`, `bestMonth`, `worstMonth`, `totalPayments`
- [ ] T017 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateRevenueMetrics()` and populate `revenueMetrics` field in response

### Frontend Tasks

- [ ] T018 [US3] Create revenue metrics table section in `frontend/pnl-report.html`:
  - Add section with id `revenue-metrics-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Общая годовая выручка", "Средняя месячная выручка", "Лучший месяц", "Худший месяц", "Всего платежей"
- [ ] T019 [US3] Implement `renderRevenueMetrics()` function in `frontend/pnl-report-script.js`:
  - Extract `revenueMetrics` from insights data
  - Populate table cells with values
  - Format amounts as currency (PLN)
  - Format month names in Russian
  - Display in `revenue-metrics-section`

**Checkpoint**: Revenue metrics table should display correctly with accurate values

---

## Phase 5: [US3-Phase2] Expenses Statistics

**Goal**: Display expenses data in table format.

**Independent Test**: Verify expenses statistics table displays. Manually verify total annual expenses matches sum of expense entries. Verify expenses-to-revenue ratio calculation.

### Backend Tasks

- [ ] T020 [US3] Implement `calculateExpensesStatistics()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `manualEntryService.getExpenses(year, asOfDate)` to get expense data
  - Calculate total annual expenses: sum of all expense entries `amount_pln`
  - Calculate average monthly expenses: total annual / number of months with expense data
  - Get top expense categories: group by `expense_category_id`, sum amounts, sort descending, take top 5
  - Calculate expenses-to-revenue ratio: (total expenses / total revenue) * 100%
  - Return object with: `totalAnnual`, `averageMonthly`, `topCategories`, `expensesToRevenueRatio`
- [ ] T021 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateExpensesStatistics()` and populate `expensesStatistics` field in response

### Frontend Tasks

- [ ] T022 [US3] Create expenses statistics table section in `frontend/pnl-report.html`:
  - Add section with id `expenses-statistics-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Общие годовые расходы", "Средние месячные расходы", "Соотношение расходов к доходам"
  - Add subsection for top expense categories (if available)
- [ ] T023 [US3] Implement `renderExpensesStatistics()` function in `frontend/pnl-report-script.js`:
  - Extract `expensesStatistics` from insights data
  - Populate table cells with values
  - Format amounts as currency (PLN)
  - Display top categories if available
  - Display expenses-to-revenue ratio as percentage

**Checkpoint**: Expenses statistics table should display correctly with accurate values

---

## Phase 6: [US3-Phase3] Break-Even Analysis

**Goal**: Calculate and display break-even metrics.

**Independent Test**: Verify break-even table displays. Manually verify: monthly break-even = average monthly expenses, annual break-even = total annual expenses, profit/loss = revenue - expenses, profit margin = (profit/loss / revenue) * 100%.

### Backend Tasks

- [ ] T024 [US3] Implement `calculateBreakEvenAnalysis()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get revenue metrics (from Phase 4)
  - Get expenses statistics (from Phase 5)
  - Calculate monthly break-even: `averageMonthlyExpenses`
  - Calculate annual break-even: `totalAnnualExpenses`
  - Calculate months to break-even: `totalAnnualExpenses / averageMonthlyRevenue` (if averageMonthlyRevenue > 0, else null)
  - Calculate profit/loss: `totalAnnualRevenue - totalAnnualExpenses`
  - Calculate profit margin: `(profitLoss / totalAnnualRevenue) * 100%` (if revenue > 0, else null)
  - Return object with all break-even metrics
- [ ] T025 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateBreakEvenAnalysis()` and populate `breakEvenAnalysis` field in response

### Frontend Tasks

- [ ] T026 [US3] Create break-even analysis table section in `frontend/pnl-report.html`:
  - Add section with id `break-even-analysis-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Месячная точка безубыточности", "Годовая точка безубыточности", "Месяцев до безубыточности", "Прибыль/Убыток", "Маржа прибыли"
- [ ] T027 [US3] Implement `renderBreakEvenAnalysis()` function in `frontend/pnl-report-script.js`:
  - Extract `breakEvenAnalysis` from insights data
  - Populate table cells with values
  - Format amounts as currency (PLN)
  - Format percentages
  - Display "N/A" for null values (months to break-even if unprofitable)

**Checkpoint**: Break-even analysis table should display correctly with accurate calculations

---

## Phase 7: [US3-Phase4] Year-over-Year Comparison

**Goal**: Compare current year with previous year.

**Independent Test**: Select year 2025, verify YoY comparison shows comparison with 2024. Manually verify growth rate calculations: ((current - previous) / previous * 100%).

### Backend Tasks

- [ ] T028 [US3] Implement `calculateYearOverYear()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get current year insights (revenue metrics, expenses statistics, break-even analysis)
  - Get previous year insights by calling `getInsights(previousYear, asOfDate)`
  - Calculate revenue growth rate: `((currentRevenue - previousRevenue) / previousRevenue) * 100%`
  - Calculate expenses growth rate: `((currentExpenses - previousExpenses) / previousExpenses) * 100%`
  - Calculate profit change: `currentProfit - previousProfit`
  - Calculate profit change percent: `((currentProfit - previousProfit) / |previousProfit|) * 100%` (if previousProfit != 0)
  - Compare best/worst months between years
  - Return object with YoY metrics (null if previous year data unavailable)
- [ ] T029 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateYearOverYear()` and populate `yearOverYear` field in response

### Frontend Tasks

- [ ] T030 [US3] Create YoY comparison table section in `frontend/pnl-report.html`:
  - Add section with id `yoy-comparison-section`
  - Add table structure showing current vs previous year comparison
  - Add rows for: "Рост выручки", "Рост расходов", "Изменение прибыли"
- [ ] T031 [US3] Implement `renderYearOverYear()` function in `frontend/pnl-report-script.js`:
  - Extract `yearOverYear` from insights data
  - Display comparison if previous year data available
  - Display "N/A" if previous year data unavailable
  - Format growth rates as percentages with +/- indicators

**Checkpoint**: YoY comparison table should display correctly (or show N/A if previous year unavailable)

---

## Phase 8: [US3-Phase5] Profitability Metrics

**Goal**: Display profitability ratios.

**Independent Test**: Verify profitability metrics table displays. Manually verify: operating margin = (profit/loss / revenue) * 100%.

### Backend Tasks

- [ ] T032 [US3] Implement `calculateProfitabilityMetrics()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get break-even analysis (profit/loss, revenue)
  - Calculate operating margin: `(profitLoss / revenue) * 100%` (if revenue > 0)
  - Calculate net profit margin: same as operating margin for this context
  - Calculate return on revenue: `(profitLoss / revenue) * 100%` (if revenue > 0)
  - Return object with profitability metrics
- [ ] T033 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateProfitabilityMetrics()` and populate `profitabilityMetrics` field in response

### Frontend Tasks

- [ ] T034 [US3] Create profitability metrics table section in `frontend/pnl-report.html`:
  - Add section with id `profitability-metrics-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Операционная маржа", "Чистая маржа", "Рентабельность выручки"
- [ ] T035 [US3] Implement `renderProfitabilityMetrics()` function in `frontend/pnl-report-script.js`:
  - Extract `profitabilityMetrics` from insights data
  - Populate table cells with values
  - Format as percentages (can be negative)

**Checkpoint**: Profitability metrics table should display correctly

---

## Phase 9: [US3-Phase6] Quarterly Analysis

**Goal**: Display quarterly breakdown and trends.

**Independent Test**: Verify quarterly analysis table displays. Manually verify Q1 total = sum of Jan-Mar revenue, Q2 = Apr-Jun, etc.

### Backend Tasks

- [ ] T036 [US3] Implement `calculateQuarterlyAnalysis()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get monthly revenue data from `pnlReportService.getMonthlyRevenue()`
  - Calculate Q1 (Jan-Mar): sum months 1-3 revenue and profit/loss
  - Calculate Q2 (Apr-Jun): sum months 4-6 revenue and profit/loss
  - Calculate Q3 (Jul-Sep): sum months 7-9 revenue and profit/loss
  - Calculate Q4 (Oct-Dec): sum months 10-12 revenue and profit/loss
  - Find best quarter: quarter with highest revenue
  - Find worst quarter: quarter with lowest revenue
  - Calculate quarterly trends: Q1→Q2, Q2→Q3, Q3→Q4 growth rates
  - Return object with quarterly data
- [ ] T037 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateQuarterlyAnalysis()` and populate `quarterlyAnalysis` field in response

### Frontend Tasks

- [ ] T038 [US3] Create quarterly analysis table section in `frontend/pnl-report.html`:
  - Add section with id `quarterly-analysis-section`
  - Add table structure with columns: "Квартал", "Выручка", "Прибыль/Убыток", "Тренд"
  - Add rows for Q1, Q2, Q3, Q4
- [ ] T039 [US3] Implement `renderQuarterlyAnalysis()` function in `frontend/pnl-report-script.js`:
  - Extract `quarterlyAnalysis` from insights data
  - Populate table with quarterly data
  - Highlight best and worst quarters
  - Display quarterly trends between quarters

**Checkpoint**: Quarterly analysis table should display correctly

---

## Phase 10: [US3-Phase7] Operational Efficiency

**Goal**: Display efficiency metrics.

**Independent Test**: Verify operational efficiency table displays. Manually verify: average transaction value = total revenue / total payment count.

### Backend Tasks

- [ ] T040 [US3] Implement `calculateOperationalEfficiency()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get revenue metrics (total revenue, total payments, average monthly revenue)
  - Get expenses statistics (average monthly expenses)
  - Calculate average transaction value: `totalRevenue / totalPayments` (if totalPayments > 0)
  - Calculate revenue per month: `averageMonthlyRevenue` (already calculated)
  - Calculate expenses per month: `averageMonthlyExpenses` (already calculated)
  - Calculate efficiency ratio: `expensesPerMonth / revenuePerMonth` (if revenuePerMonth > 0)
  - Return object with efficiency metrics
- [ ] T041 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateOperationalEfficiency()` and populate `operationalEfficiency` field in response

### Frontend Tasks

- [ ] T042 [US3] Create operational efficiency table section in `frontend/pnl-report.html`:
  - Add section with id `operational-efficiency-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Средний чек", "Выручка на месяц", "Расходы на месяц", "Коэффициент эффективности"
- [ ] T043 [US3] Implement `renderOperationalEfficiency()` function in `frontend/pnl-report-script.js`:
  - Extract `operationalEfficiency` from insights data
  - Populate table cells with values
  - Format amounts as currency
  - Format efficiency ratio as percentage

**Checkpoint**: Operational efficiency table should display correctly

---

## Phase 11: [US3-Phase8] Trend Analysis

**Goal**: Identify growth patterns and seasonality.

**Independent Test**: Verify trend analysis table displays. Manually verify first half vs second half calculation: ((second half - first half) / first half * 100%).

### Backend Tasks

- [ ] T044 [US3] Implement `calculateTrendAnalysis()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get monthly revenue data
  - Calculate first half (Jan-Jun) total revenue
  - Calculate second half (Jul-Dec) total revenue
  - Calculate first half vs second half: `((secondHalf - firstHalf) / firstHalf) * 100%`
  - Identify peak revenue period: consecutive months with highest revenue
  - Identify low revenue period: consecutive months with lowest revenue
  - Calculate month-over-month growth rates: for each month transition (1→2, 2→3, ..., 11→12)
  - Detect seasonality: check for recurring patterns (simplified: compare same months across quarters if data available)
  - Return object with trend analysis
- [ ] T045 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateTrendAnalysis()` and populate `trendAnalysis` field in response

### Frontend Tasks

- [ ] T046 [US3] Create trend analysis table section in `frontend/pnl-report.html`:
  - Add section with id `trend-analysis-section`
  - Add table structure showing: "Сравнение первой и второй половины года", "Пиковый период", "Низкий период", "Месячные темпы роста"
- [ ] T047 [US3] Implement `renderTrendAnalysis()` function in `frontend/pnl-report-script.js`:
  - Extract `trendAnalysis` from insights data
  - Display first half vs second half comparison
  - Display peak and low periods
  - Display month-over-month growth rates
  - Indicate if seasonality detected

**Checkpoint**: Trend analysis table should display correctly

---

## Phase 12: [US3-Phase9] Stability/Volatility Analysis

**Goal**: Measure revenue stability.

**Independent Test**: Verify stability analysis table displays. Manually verify coefficient of variation = (standard deviation / mean) * 100%.

### Backend Tasks

- [ ] T048 [US3] Implement `calculateStabilityVolatility()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get monthly revenue data (array of amounts)
  - Calculate mean: average of monthly revenues
  - Calculate standard deviation using helper method
  - Calculate coefficient of variation: `(standardDeviation / mean) * 100%`
  - Determine stability score: <15% = "very_stable", 15-30% = "stable", 30-50% = "moderate", >50% = "high_volatility"
  - Identify outlier months: months with revenue >2 standard deviations from mean
  - Calculate consistency indicator: percentage of months within 1 standard deviation
  - Return object with stability metrics
- [ ] T049 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateStabilityVolatility()` and populate `stabilityVolatility` field in response

### Frontend Tasks

- [ ] T050 [US3] Create stability/volatility table section in `frontend/pnl-report.html`:
  - Add section with id `stability-volatility-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Коэффициент вариации", "Оценка стабильности", "Месяцы-выбросы", "Индикатор предсказуемости"
- [ ] T051 [US3] Implement `renderStabilityVolatility()` function in `frontend/pnl-report-script.js`:
  - Extract `stabilityVolatility` from insights data
  - Populate table cells with values
  - Display stability score with appropriate styling (color coding)
  - List outlier months if any

**Checkpoint**: Stability/volatility table should display correctly

---

## Phase 13: [US3-Phase10] Cash Runway Analysis

**Goal**: Calculate cash sustainability metrics.

**Independent Test**: Verify cash runway table displays. Manually verify months to break-even = total annual expenses / average monthly revenue.

### Backend Tasks

- [ ] T052 [US3] Implement `calculateCashRunway()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get break-even analysis (profit/loss, months to break-even)
  - Get revenue metrics (average monthly revenue)
  - Get expenses statistics (average monthly expenses)
  - Calculate months of runway: if profit positive, `currentCashBalance / averageMonthlyProfit` (requires cash balance - set to null if unavailable)
  - Calculate months until break-even: already calculated in break-even analysis
  - Calculate required growth rate: if unprofitable, `((breakEvenRevenue - currentRevenue) / remainingMonths) / averageMonthlyRevenue * 100%`
  - Calculate burn rate: if expenses > revenue, `averageMonthlyExpenses - averageMonthlyRevenue` (negative value)
  - Return object with cash runway metrics
- [ ] T053 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateCashRunway()` and populate `cashRunway` field in response

### Frontend Tasks

- [ ] T054 [US3] Create cash runway table section in `frontend/pnl-report.html`:
  - Add section with id `cash-runway-section`
  - Add table structure with headers: "Метрика", "Значение"
  - Add rows for: "Месяцы запаса прочности", "Месяцев до безубыточности", "Необходимый темп роста", "Burn rate"
- [ ] T055 [US3] Implement `renderCashRunway()` function in `frontend/pnl-report-script.js`:
  - Extract `cashRunway` from insights data
  - Populate table cells with values
  - Display "N/A" for unavailable metrics
  - Format burn rate appropriately (negative values)

**Checkpoint**: Cash runway table should display correctly

---

## Phase 14: [US3-Phase11] Expense Efficiency Analysis

**Goal**: Analyze expense categories and optimization opportunities.

**Independent Test**: Verify expense efficiency table displays. Manually verify top categories match expense breakdown from Phase 5.

### Backend Tasks

- [ ] T056 [US3] Implement `calculateExpenseEfficiency()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get expenses statistics (top categories already calculated)
  - Get previous year expenses (if available) for YoY comparison
  - Calculate category growth rates: compare current year vs previous year per category
  - Identify optimization opportunities: categories with highest growth rates
  - Calculate ROI for expense categories: if revenue categories can be linked (future enhancement, return empty array for now)
  - Return object with expense efficiency metrics
- [ ] T057 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateExpenseEfficiency()` and populate `expenseEfficiency` field in response

### Frontend Tasks

- [ ] T058 [US3] Create expense efficiency table section in `frontend/pnl-report.html`:
  - Add section with id `expense-efficiency-section`
  - Add table structure showing: "Топ категории расходов", "Темпы роста категорий", "Возможности оптимизации"
- [ ] T059 [US3] Implement `renderExpenseEfficiency()` function in `frontend/pnl-report-script.js`:
  - Extract `expenseEfficiency` from insights data
  - Display top expense categories
  - Display category growth rates if previous year available
  - Display optimization opportunities

**Checkpoint**: Expense efficiency table should display correctly

---

## Phase 15: [US3-Phase12] Predictive Insights

**Goal**: Forecast future performance.

**Independent Test**: Verify predictive insights table displays. Manually verify projected revenue calculation based on growth rate.

### Backend Tasks

- [ ] T060 [US3] Implement `calculatePredictiveInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get revenue metrics (total annual revenue, average monthly revenue)
  - Get trend analysis (month-over-month growth rates)
  - Get YoY comparison (revenue growth rate if available)
  - Calculate projected annual revenue: if growth rate positive and stable, `currentRevenue * (1 + averageGrowthRate)`
  - Calculate projected break-even timeline: based on current trajectory and months to break-even
  - Forecast best/worst months: based on seasonality patterns (if detected)
  - Generate risk indicators: array of warning strings based on trends (e.g., "Если текущий тренд сохранится...")
  - Return object with predictive insights
- [ ] T061 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculatePredictiveInsights()` and populate `predictiveInsights` field in response

### Frontend Tasks

- [ ] T062 [US3] Create predictive insights table section in `frontend/pnl-report.html`:
  - Add section with id `predictive-insights-section`
  - Add table structure showing: "Прогноз выручки на следующий год", "Прогноз безубыточности", "Прогноз лучшего/худшего месяца", "Индикаторы рисков"
- [ ] T063 [US3] Implement `renderPredictiveInsights()` function in `frontend/pnl-report-script.js`:
  - Extract `predictiveInsights` from insights data
  - Display projected revenue
  - Display projected break-even timeline
  - Display forecasted months
  - Display risk indicators as list

**Checkpoint**: Predictive insights table should display correctly

---

## Phase 16: [US3-Phase13] Performance Benchmarks

**Goal**: Compare performance against previous year.

**Independent Test**: Verify performance benchmarks table displays. Verify comparisons are accurate.

### Backend Tasks

- [ ] T064 [US3] Implement `calculatePerformanceBenchmarks()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get current year insights
  - Get previous year insights (if available)
  - Compare overall performance: "better" if revenue/profit increased, "worse" if decreased, "same" if similar
  - Check break-even milestone: compare when break-even was achieved (if applicable)
  - Compare growth rates: current year growth rate vs previous year growth rate
  - Calculate profitability improvement: change in profit margin compared to previous year
  - Return object with benchmarks (null if previous year unavailable)
- [ ] T065 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculatePerformanceBenchmarks()` and populate `performanceBenchmarks` field in response

### Frontend Tasks

- [ ] T066 [US3] Create performance benchmarks table section in `frontend/pnl-report.html`:
  - Add section with id `performance-benchmarks-section`
  - Add table structure showing: "Общая производительность", "Достижение безубыточности", "Сравнение темпов роста", "Улучшение прибыльности"
- [ ] T067 [US3] Implement `renderPerformanceBenchmarks()` function in `frontend/pnl-report-script.js`:
  - Extract `performanceBenchmarks` from insights data
  - Display comparisons if previous year available
  - Display "N/A" if previous year unavailable
  - Use color coding for better/worse indicators

**Checkpoint**: Performance benchmarks table should display correctly

---

## Phase 17: [US3-Phase14] Month-by-Month Insights

**Goal**: Analyze monthly patterns.

**Independent Test**: Verify month-by-month insights table displays. Manually verify counts match actual data.

### Backend Tasks

- [ ] T068 [US3] Implement `calculateMonthByMonth()` method in `src/services/pnl/pnlInsightsService.js`:
  - Get monthly revenue and expense data
  - Get break-even analysis (monthly break-even point)
  - For each month, determine if above or below break-even
  - Count months above break-even, list month numbers
  - Count months below break-even, list month numbers
  - Find longest consecutive profitable months streak
  - Find longest consecutive loss months streak
  - Identify recovery months: months that showed profit after previous losses
  - Return object with month-by-month insights
- [ ] T069 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `calculateMonthByMonth()` and populate `monthByMonth` field in response

### Frontend Tasks

- [ ] T070 [US3] Create month-by-month insights table section in `frontend/pnl-report.html`:
  - Add section with id `month-by-month-section`
  - Add table structure showing: "Месяцы выше безубыточности", "Месяцы ниже безубыточности", "Самая длинная серия прибыльных месяцев", "Самая длинная серия убыточных месяцев", "Месяцы восстановления"
- [ ] T071 [US3] Implement `renderMonthByMonth()` function in `frontend/pnl-report-script.js`:
  - Extract `monthByMonth` from insights data
  - Display counts and lists of months
  - Display streaks
  - Display recovery months

**Checkpoint**: Month-by-month insights table should display correctly

---

## Phase 18: [US3-Phase15] Strategic Insights - Rule-Based

**Goal**: Generate text-based strategic recommendations using rule-based templates.

**Independent Test**: Verify strategic insights section displays text recommendations. Verify recommendations reference actual calculated metrics.

### Backend Tasks

- [ ] T072 [US3] Create `src/services/pnl/strategicInsightsGenerator.js` service:
  - Implement rule-based template generation
  - Create templates for: overall summary, break-even status, growth trajectory, seasonal patterns, stability assessment, cash runway status, expense optimization, key observations, strategic recommendations
  - Templates should use calculated metrics from insights data
  - Generate insights in Russian language
- [ ] T073 [US3] Implement `generateRuleBasedInsights()` method in `src/services/pnl/strategicInsightsGenerator.js`:
  - Accept insights data object
  - Generate overall summary based on revenue trends and profitability
  - Generate break-even status description
  - Assess growth trajectory (accelerating/stable/declining)
  - Detect seasonal patterns if applicable
  - Assess stability based on coefficient of variation
  - Evaluate cash runway status
  - Generate expense optimization recommendations
  - Generate key observations
  - Generate strategic recommendations for next year
  - Return formatted insights object
- [ ] T074 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Call `generateRuleBasedInsights()` and populate `strategicInsights` field in response
  - Set `generatedBy: "rule-based"` and `generatedAt: new Date().toISOString()`

### Frontend Tasks

- [ ] T075 [US3] Create strategic insights section in `frontend/pnl-report.html`:
  - Add section with id `strategic-insights-section`
  - Add subsections for: "Общее резюме", "Статус безубыточности", "Траектория роста", "Сезонные паттерны", "Оценка стабильности", "Статус запаса прочности", "Оптимизация расходов", "Ключевые наблюдения", "Стратегические рекомендации"
- [ ] T076 [US3] Implement `renderStrategicInsights()` function in `frontend/pnl-report-script.js`:
  - Extract `strategicInsights` from insights data
  - Render each subsection with formatted text
  - Display generation timestamp and method (rule-based or AI)

**Checkpoint**: Strategic insights section should display comprehensive text recommendations

---

## Phase 19: [US3-Phase16] Strategic Insights - AI-Powered

**Goal**: Integrate ChatGPT for AI-generated strategic insights.

**Independent Test**: Verify AI insights generate when ChatGPT API is available. Verify fallback works when API is unavailable. Verify caching reduces API calls.

### Backend Tasks

- [ ] T077 [US3] Extend `src/services/ai/openAIService.js` with `generateStrategicInsights()` method:
  - Accept structured insights data payload
  - Check cache using hash of payload (MD5 of JSON.stringify(payload))
  - If cached and not regenerateAI: return cached response
  - If not cached or regenerateAI: call ChatGPT API
  - Build prompt in Russian requesting comprehensive analysis
  - Parse AI response and extract sections
  - Cache response with TTL 3600 seconds (1 hour)
  - Handle API errors gracefully, return null on error
- [ ] T078 [US3] Implement caching in `src/services/ai/openAIService.js`:
  - Use `node-cache` package (already in dependencies)
  - Create cache instance with TTL 3600 seconds
  - Generate cache key: `md5(JSON.stringify(payload))`
  - Store responses in cache after successful API call
- [ ] T079 [US3] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Try to generate AI insights using `openAIService.generateStrategicInsights()`
  - If AI unavailable or returns error: fallback to rule-based generation
  - Set `generatedBy: "ai"` or `"rule-based"` accordingly
  - Set `cacheKey` if AI-generated

### Frontend Tasks

- [ ] T080 [US3] Add "Обновить выводы" button in `frontend/pnl-report.html`:
  - Add button in strategic insights section
  - Set id `regenerate-insights-btn`
- [ ] T081 [US3] Implement regenerate insights functionality in `frontend/pnl-report-script.js`:
  - Add event listener for regenerate button
  - Call API with `regenerateAI=true` parameter
  - Show loading indicator during regeneration
  - Update strategic insights section with new data
  - Display timestamp of last generation

**Checkpoint**: AI insights should generate when API available, fallback should work when unavailable

---

## Phase 20: [US2] Historical Date Filtering

**Goal**: Support viewing insights as of a specific historical date.

**Independent Test**: Select historical date, verify insights reflect data as of that date. Verify payments/expenses after selected date are excluded.

### Backend Tasks

- [ ] T082 [US2] Update `getInsights()` method in `src/services/pnl/pnlInsightsService.js`:
  - Accept `asOfDate` parameter (optional, ISO 8601 date string)
  - Validate `asOfDate` is valid date and not in future
  - Pass `asOfDate` to all calculation methods
  - Pass `asOfDate` to `pnlReportService.getMonthlyRevenue()` (extend if needed)
  - Pass `asOfDate` to `manualEntryService.getExpenses()` (extend if needed)
- [ ] T083 [US2] Update API endpoint in `src/routes/api.js`:
  - Accept `asOfDate` query parameter
  - Validate date format (ISO 8601)
  - Pass to `pnlInsightsService.getInsights()`
  - Include `asOfDate` in response if provided

### Frontend Tasks

- [ ] T084 [US2] Add historical date selector UI in `frontend/pnl-report.html`:
  - Add date input field in "Выводы" tab header
  - Set id `as-of-date-input`
  - Add label "Показать данные на дату:"
  - Add "Очистить" button to clear date filter
- [ ] T085 [US2] Implement historical date filtering in `frontend/pnl-report-script.js`:
  - Add event listener for date input change
  - Add event listener for clear button
  - Update `loadInsights()` to include `asOfDate` parameter if selected
  - Display selected date in tab header
  - Update API call to include date parameter
- [ ] T086 [US2] Update `loadInsights()` function in `frontend/pnl-report-script.js`:
  - Get selected year and asOfDate from UI
  - Build API URL with both parameters
  - Display selected date clearly in UI

**Checkpoint**: Historical date filtering should work correctly, excluding data after selected date

---

## Phase 21: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

### Tasks

- [ ] T087 [P] Add error handling improvements across all calculation methods in `src/services/pnl/pnlInsightsService.js`:
  - Handle division by zero errors
  - Handle null/undefined values gracefully
  - Return appropriate defaults for missing data
- [ ] T088 [P] Add logging for insights generation in `src/services/pnl/pnlInsightsService.js`:
  - Log when insights are requested (year, asOfDate)
  - Log calculation time for each metric section
  - Log ChatGPT API calls and cache hits
- [ ] T089 [P] Optimize API response time:
  - Review calculation performance
  - Add caching for expensive calculations if needed
  - Optimize database queries
- [ ] T090 [P] Improve frontend error handling in `frontend/pnl-report-script.js`:
  - Better error messages for users
  - Retry logic for failed API calls
  - Graceful degradation when some metrics unavailable
- [ ] T091 [P] Add loading states for each metric section:
  - Show loading indicators while calculating
  - Update sections incrementally as data loads
- [ ] T092 [P] Run quickstart.md validation:
  - Test all phases manually
  - Verify all manual verification steps pass
  - Document any discrepancies
- [ ] T093 [P] Code cleanup and refactoring:
  - Review code for consistency
  - Extract common patterns
  - Improve code documentation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **US3-Foundation (Phase 3)**: Depends on Foundational completion
- **US3-Phase1-14 (Phase 4-17)**: Each depends on previous phase (incremental metric addition)
- **US3-Phase15 (Phase 18)**: Depends on all metric phases (needs all metrics for comprehensive insights)
- **US3-Phase16 (Phase 19)**: Depends on Phase 18 (rule-based fallback must work first)
- **US2 (Phase 20)**: Can be added anytime after Phase 3 (foundation)
- **Polish (Phase 21)**: Depends on all desired phases being complete

### User Story Dependencies

- **User Story 3 (P1)**: Core feature - "Выводы" tab with analytical insights
  - Foundation (Phase 3) → Phase 1-14 (metrics) → Phase 15-16 (insights)
- **User Story 2 (P2)**: Historical date filtering - can be added independently after foundation
- **User Story 1 (P1)**: Already implemented in existing PNL report - not part of this feature

### Within Each Phase

- Backend tasks before frontend tasks (data before display)
- Calculation methods before rendering functions
- Core functionality before error handling
- Rule-based insights before AI-powered insights

### Parallel Opportunities

- Setup tasks (T001-T004) can run in parallel
- Foundational tasks marked [P] can run in parallel
- Frontend and backend tasks for same phase can run concurrently if API contract is defined
- Polish tasks marked [P] can run in parallel

---

## Parallel Example: Phase 3 (US3-Foundation)

```bash
# Backend and frontend can work in parallel:
Backend: T010 - Add API endpoint
Frontend: T012 - Add tab button, T013 - Add tab content

# Then:
Backend: T011 - Implement basic getInsights()
Frontend: T014 - Tab switching, T015 - loadInsights()
```

---

## Implementation Strategy

### MVP First (Phases 1-6)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: US3-Foundation (tab and API)
4. Complete Phase 4: US3-Phase1 (Revenue Metrics)
5. Complete Phase 5: US3-Phase2 (Expenses Statistics)
6. Complete Phase 6: US3-Phase3 (Break-Even Analysis)
7. **STOP and VALIDATE**: Test MVP independently
8. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add Foundation tab → Test independently
3. Add Revenue Metrics → Test independently → Validate calculations
4. Add Expenses Statistics → Test independently → Validate calculations
5. Add Break-Even Analysis → Test independently → Validate calculations
6. Continue with remaining metrics one at a time
7. Add Strategic Insights (rule-based) → Test independently
8. Add Strategic Insights (AI-powered) → Test independently
9. Add Historical Date Filtering → Test independently

### Testing Strategy

- After each phase: Manual verification of calculations
- Compare displayed values with manual calculations
- Test edge cases (zero revenue, partial data, etc.)
- Validate API responses match expected structure
- Test error handling and fallback mechanisms

---

## Notes

- [P] tasks = different files, no dependencies
- [US3] label maps task to User Story 3 (Analytical Insights tab)
- [US2] label maps task to User Story 2 (Historical Date Filtering)
- Each phase should be independently completable and testable
- Manual verification required after each metric phase
- Stop at any checkpoint to validate phase independently
- Avoid: vague tasks, same file conflicts, skipping validation steps


