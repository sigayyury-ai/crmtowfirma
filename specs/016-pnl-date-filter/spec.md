# Feature Specification: PNL Yearly Report with Analytics

**Feature Branch**: `016-pnl-date-filter`  
**Created**: 2025-01-27  
**Status**: Draft  
**MVP Scope**: Tables and numerical data only, no charts or complex graphics  
**Input**: User description: "добавить в pnl фильтр выборка по датам что был возможность в отчете выборки фильтры по выборке в самом отчете для синхронизации данных и возможности выбрать дату что было раньше"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Yearly PNL Report Summary (Priority: P1)

As a business owner or financial manager, I want to view a comprehensive yearly PNL report with summary statistics and key metrics for a selected year, so that I can quickly understand overall financial performance and make informed business decisions.

**Why this priority**: This is the core functionality - providing a yearly summary view with aggregated data and key insights is essential for understanding annual performance at a glance.

**Independent Test**: Can be fully tested by navigating to the PNL report page, selecting a year (e.g., 2025), and verifying that the yearly report displays summary statistics, total revenue, monthly breakdown, and key metrics for that year.

**Acceptance Scenarios**:

1. **Given** I am on the PNL report page, **When** I select a year (e.g., 2025), **Then** I see a yearly summary report showing total annual revenue, monthly breakdown, and key financial metrics
2. **Given** I am viewing the yearly report, **When** I review the summary section, **Then** I see total revenue for the year, average monthly revenue, best and worst performing months
3. **Given** I am viewing the yearly report, **When** I examine the monthly breakdown, **Then** I see all 12 months with their respective revenue amounts and payment counts
4. **Given** I am viewing the yearly report, **When** I check the analytics section, **Then** I see calculated insights such as growth trends, seasonal patterns, and year-over-year comparisons (if data available)
5. **Given** I am on the PNL report page, **When** I select a different year (e.g., 2026), **Then** the yearly report updates to show data for the newly selected year

---

### User Story 2 - View Historical Data State with Date Selection (Priority: P2)

As a user, I want to select a specific historical date (as-of date) to view the yearly report as it would have appeared at that point in time, so that I can analyze historical performance and reconcile data changes that occurred after that date.

**Why this priority**: This enables historical analysis and reconciliation by allowing users to see what the yearly report looked like at a specific point in time, which is valuable for auditing, understanding data evolution, and comparing historical states.

**Independent Test**: Can be tested independently by selecting a historical date (e.g., 3 months ago), verifying that the yearly report shows data as it existed on that date, excluding any payments or changes made after the selected date.

**Acceptance Scenarios**:

1. **Given** I am on the PNL report page, **When** I select a historical date (as-of date), **Then** the yearly report displays data as it existed on that date, excluding any payments or changes made after that date
2. **Given** I have selected a historical date, **When** I view the report, **Then** the selected date is clearly indicated in the UI and the report reflects the data state at that point in time
3. **Given** I am viewing a report with a historical date filter, **When** I switch to a more recent date, **Then** the report updates to include additional payments and changes that occurred between the two dates
4. **Given** I select a historical date that is before the selected year, **When** the report loads, **Then** all months show zero or "—" appropriately, indicating no data existed at that time

---

### User Story 3 - View Analytical Insights and Conclusions in Dedicated Tab (Priority: P1)

As a business owner, I want to view analytical insights and conclusions in a dedicated "Выводы" (Insights) tab, so that I can quickly identify trends, patterns, and key takeaways from yearly PNL data without manually analyzing the numbers.

**Why this priority**: This is a core feature - providing a dedicated tab for insights makes analytical conclusions easily accessible and clearly separated from raw data, enabling quick decision-making.

**Independent Test**: Can be tested independently by navigating to the "Выводы" tab in the PNL report page and verifying that it displays calculated insights, key metrics, trends, and conclusions for the selected year.

**Acceptance Scenarios**:

1. **Given** I am on the PNL report page, **When** I click on the "Выводы" tab, **Then** I see a dedicated tab displaying analytical insights and conclusions for the selected year
2. **Given** I am viewing the "Выводы" tab, **When** I examine the key metrics section, **Then** I see: total annual revenue, average monthly revenue, best performing month (with amount), worst performing month (with amount), total number of payments for the year
3. **Given** I am viewing the "Выводы" tab, **When** I examine the expenses statistics section, **Then** I see: total annual expenses, average monthly expenses, breakdown by expense categories (if available), comparison of expenses to revenue
4. **Given** I am viewing the "Выводы" tab, **When** I review the break-even analysis section, **Then** I see: monthly break-even point (required monthly revenue to cover expenses), annual break-even point (required annual revenue to cover expenses), months to break-even (if calculable), profit/loss for the year (revenue minus expenses), profit margin percentage
5. **Given** I am viewing the "Выводы" tab, **When** I review the trend analysis, **Then** I see indicators showing: growth or decline patterns across months, percentage change from first half to second half of year, identification of peak and low periods
6. **Given** I am viewing the "Выводы" tab, **When** I check the conclusions section, **Then** I see key takeaways such as: overall performance summary, break-even status (whether break-even was achieved), seasonal patterns (if detected), recommendations or observations based on the data
5. **Given** I am viewing the "Выводы" tab, **When** I select a different year, **Then** the insights update to reflect data for the newly selected year
6. **Given** I am viewing the "Выводы" tab for a year with partial data, **When** I review the insights, **Then** the analytics appropriately handle incomplete data and indicate which months are included in calculations

---

### Edge Cases

- What happens when the selected year has no payment data at all?
- How does the system handle years with only partial data (e.g., only 6 months of data)?
- What happens when a user selects a historical date that is in the future?
- How are payments handled when the payment date falls exactly on the selected as-of date?
- What happens if the user selects a historical date that is before any payment data exists for the selected year?
- How does the system handle timezone differences when filtering by historical date?
- What happens when calculating insights for years with zero revenue in some months?
- How are analytical insights calculated when data spans multiple years (for year-over-year comparisons)?

## Implementation Phases *(incremental development - one metric at a time)*

**Strategy**: Add metrics one at a time to simplify testing and validation. Each phase delivers independently testable functionality.

### Phase 0: Foundation
**Goal**: Create basic tab structure and data loading infrastructure.

**Deliverables**:
- New "Выводы" tab added to PNL report interface
- Basic API endpoint for insights data
- Tab switching functionality
- Year selector integration

**Independent Test**: Navigate to PNL report, click "Выводы" tab, verify tab appears and loads (even if empty).

---

### Phase 1: Key Revenue Metrics (FR-002)
**Goal**: Display basic revenue statistics in table format.

**Deliverables**:
- Total annual revenue (PLN)
- Average monthly revenue (PLN)
- Best performing month (month name and amount)
- Worst performing month (month name and amount)
- Total number of payments for the year

**Independent Test**: Open "Выводы" tab, verify revenue metrics table displays with correct values. Manually verify total annual revenue matches sum of monthly revenue from main report.

**Dependencies**: Phase 0

---

### Phase 2: Expenses Statistics (FR-003)
**Goal**: Display expenses data in table format.

**Deliverables**:
- Total annual expenses (PLN)
- Average monthly expenses (PLN)
- Expenses breakdown by categories (if available)
- Expenses-to-revenue ratio (percentage)

**Independent Test**: Verify expenses statistics table displays. Manually verify total annual expenses matches sum of expense entries. Verify expenses-to-revenue ratio calculation.

**Dependencies**: Phase 1

---

### Phase 3: Break-Even Analysis (FR-004)
**Goal**: Calculate and display break-even metrics.

**Deliverables**:
- Monthly break-even point
- Annual break-even point
- Months to break-even
- Profit/loss for the year
- Profit margin percentage

**Independent Test**: Verify break-even table displays. Manually verify: monthly break-even = average monthly expenses, annual break-even = total annual expenses, profit/loss = revenue - expenses, profit margin = (profit/loss / revenue) * 100%.

**Dependencies**: Phase 2

---

### Phase 4: Year-over-Year Comparison (FR-005)
**Goal**: Compare current year with previous year.

**Deliverables**:
- Revenue growth rate (YoY %)
- Expenses growth rate (YoY %)
- Profit/loss change (YoY %)
- Comparison of key metrics (best month, worst month, average monthly revenue)

**Independent Test**: Select year 2025, verify YoY comparison shows comparison with 2024. Manually verify growth rate calculations: ((current - previous) / previous * 100%).

**Dependencies**: Phase 1 (requires previous year data)

---

### Phase 5: Profitability Metrics (FR-006)
**Goal**: Display profitability ratios.

**Deliverables**:
- Operating margin
- Net profit margin
- Return on revenue

**Independent Test**: Verify profitability metrics table displays. Manually verify: operating margin = (profit/loss / revenue) * 100%.

**Dependencies**: Phase 3

---

### Phase 6: Quarterly Analysis (FR-007)
**Goal**: Display quarterly breakdown and trends.

**Deliverables**:
- Q1, Q2, Q3, Q4 revenue totals
- Quarterly profit/loss
- Best performing quarter
- Worst performing quarter
- Quarterly growth trends (Q1→Q2, Q2→Q3, Q3→Q4)

**Independent Test**: Verify quarterly analysis table displays. Manually verify Q1 total = sum of Jan-Mar revenue, Q2 = Apr-Jun, etc.

**Dependencies**: Phase 1

---

### Phase 7: Operational Efficiency (FR-008)
**Goal**: Display efficiency metrics.

**Deliverables**:
- Average transaction value
- Revenue per month
- Expenses per month
- Efficiency ratio (expenses/revenue)

**Independent Test**: Verify operational efficiency table displays. Manually verify: average transaction value = total revenue / total payment count.

**Dependencies**: Phase 1, Phase 2

---

### Phase 8: Trend Analysis (FR-009)
**Goal**: Identify growth patterns and seasonality.

**Deliverables**:
- Growth/decline indicators
- Percentage change from first half to second half of year
- Peak revenue period identification
- Low revenue period identification
- Month-over-month growth rates

**Independent Test**: Verify trend analysis table displays. Manually verify first half vs second half calculation: ((second half - first half) / first half * 100%).

**Dependencies**: Phase 1

---

### Phase 9: Stability/Volatility Analysis (FR-023)
**Goal**: Measure revenue stability.

**Deliverables**:
- Coefficient of variation for monthly revenue
- Revenue stability score
- Identification of outlier months
- Consistency indicator

**Independent Test**: Verify stability analysis table displays. Manually verify coefficient of variation = (standard deviation / mean) * 100%.

**Dependencies**: Phase 1

---

### Phase 10: Cash Runway Analysis (FR-024)
**Goal**: Calculate cash sustainability metrics.

**Deliverables**:
- Months of runway
- Months until break-even
- Required monthly revenue growth rate
- Burn rate analysis

**Independent Test**: Verify cash runway table displays. Manually verify months to break-even = total annual expenses / average monthly revenue.

**Dependencies**: Phase 3

---

### Phase 11: Expense Efficiency Analysis (FR-025)
**Goal**: Analyze expense categories and optimization opportunities.

**Deliverables**:
- Top expense categories by amount
- Expense category growth rates (YoY)
- Expense optimization opportunities
- ROI analysis for expense categories (if applicable)

**Independent Test**: Verify expense efficiency table displays. Manually verify top categories match expense breakdown from Phase 2.

**Dependencies**: Phase 2, Phase 4

---

### Phase 12: Predictive Insights (FR-026)
**Goal**: Forecast future performance.

**Deliverables**:
- Projected annual revenue for next year
- Projected break-even timeline
- Forecasted best/worst months for next year
- Risk indicators

**Independent Test**: Verify predictive insights table displays. Manually verify projected revenue calculation based on growth rate.

**Dependencies**: Phase 1, Phase 4, Phase 8

---

### Phase 13: Performance Benchmarks (FR-027)
**Goal**: Compare performance against previous year.

**Deliverables**:
- Comparison of current year to previous year (better/worse/same)
- Break-even milestone achievement
- Growth rate comparison
- Profitability improvement

**Independent Test**: Verify performance benchmarks table displays. Verify comparisons are accurate.

**Dependencies**: Phase 4, Phase 5

---

### Phase 14: Month-by-Month Insights (FR-029)
**Goal**: Analyze monthly patterns.

**Deliverables**:
- Months above break-even (count and list)
- Months below break-even (count and list)
- Consecutive profitable months streak
- Consecutive loss months streak
- Recovery months

**Independent Test**: Verify month-by-month insights table displays. Manually verify counts match actual data.

**Dependencies**: Phase 3

---

### Phase 15: Strategic Insights - Rule-Based (FR-010, FR-034)
**Goal**: Generate text-based strategic recommendations using rule-based templates.

**Deliverables**:
- Overall performance summary
- Break-even status assessment
- Growth trajectory assessment
- Seasonal patterns identification
- Key observations
- Actionable strategic recommendations

**Independent Test**: Verify strategic insights section displays text recommendations. Verify recommendations reference actual calculated metrics.

**Dependencies**: All previous phases (needs all metrics to generate comprehensive insights)

---

### Phase 16: Strategic Insights - AI-Powered (FR-030-FR-035)
**Goal**: Integrate ChatGPT for AI-generated strategic insights.

**Deliverables**:
- ChatGPT API integration
- Structured data payload preparation
- AI response parsing and formatting
- Caching mechanism
- Fallback to rule-based generation
- "Обновить выводы" button

**Independent Test**: Verify AI insights generate when ChatGPT API is available. Verify fallback works when API is unavailable. Verify caching reduces API calls.

**Dependencies**: Phase 15 (rule-based fallback must work first)

---

### Phase 17: Historical Date Filtering (FR-011-FR-018)
**Goal**: Support viewing insights as of a specific historical date.

**Deliverables**:
- Historical date selector UI
- Date filtering logic for revenue and expenses
- Display of selected date in tab header
- Clear date filter functionality

**Independent Test**: Select historical date, verify insights reflect data as of that date. Verify payments/expenses after selected date are excluded.

**Dependencies**: All metric phases (needs all metrics to filter)

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST add a new "Выводы" (Insights) tab to the PNL report interface, alongside existing "Отчет" and "Настройки" tabs
- **FR-002**: System MUST display key revenue metrics in the "Выводы" tab including: total annual revenue (PLN), average monthly revenue (PLN), best performing month (month name and amount), worst performing month (month name and amount), total number of payments for the year
- **FR-003**: System MUST display expenses statistics in the "Выводы" tab including: total annual expenses (PLN), average monthly expenses (PLN), expenses breakdown by categories (if available), expenses-to-revenue ratio (percentage)
- **FR-004**: System MUST calculate and display break-even analysis in the "Выводы" tab showing: monthly break-even point (required monthly revenue to cover average monthly expenses), annual break-even point (required annual revenue to cover total annual expenses), months to break-even (number of months needed to cover expenses based on average monthly revenue, if calculable), profit/loss for the year (total revenue minus total expenses), profit margin percentage (profit/loss divided by revenue, expressed as percentage)
- **FR-005**: System MUST calculate and display year-over-year (YoY) comparison in the "Выводы" tab showing: revenue growth rate compared to previous year (percentage change), expenses growth rate compared to previous year (percentage change), profit/loss change compared to previous year (absolute and percentage), comparison of key metrics (best month, worst month, average monthly revenue) with previous year
- **FR-006**: System MUST calculate and display profitability metrics in the "Выводы" tab including: gross profit margin (revenue minus cost of goods sold / revenue, if cost data available), operating margin (profit/loss / revenue, expressed as percentage), net profit margin (profit/loss / revenue, expressed as percentage), return on revenue (profit/loss / revenue * 100%)
- **FR-007**: System MUST calculate and display quarterly analysis in the "Выводы" tab showing: Q1, Q2, Q3, Q4 revenue totals, quarterly profit/loss, best performing quarter, worst performing quarter, quarterly growth trends (Q1→Q2, Q2→Q3, Q3→Q4), quarterly comparison with previous year (if data available)
- **FR-008**: System MUST calculate and display operational efficiency metrics in the "Выводы" tab including: average transaction value (total revenue / total payment count), revenue per month (average monthly revenue), expenses per month (average monthly expenses), efficiency ratio (expenses / revenue, lower is better)
- **FR-009**: System MUST calculate and display trend analysis in the "Выводы" tab showing: growth/decline indicators, percentage change from first half to second half of year, identification of peak revenue period, identification of low revenue period, month-over-month growth rates, seasonality analysis (if detectable patterns)
- **FR-010**: System MUST generate and display strategic insights section in the "Выводы" tab with: overall performance summary (text description), break-even status (whether break-even was achieved, how many months above/below break-even), growth trajectory assessment (accelerating, stable, declining), seasonal patterns identification (if detectable), key observations and insights, actionable strategic recommendations for next year based on data trends
- **FR-030**: System MUST integrate with ChatGPT/OpenAI API to generate AI-powered strategic insights and conclusions based on all calculated analytical metrics
- **FR-031**: System MUST prepare structured data payload for ChatGPT API including: all key revenue metrics, expenses statistics, YoY comparisons, profitability metrics, quarterly analysis, operational efficiency metrics, break-even analysis, stability/volatility analysis, cash runway analysis, expense efficiency analysis, predictive insights, performance benchmarks, trend analysis, month-by-month insights
- **FR-032**: System MUST send analytical data to ChatGPT API with a prompt that requests: overall performance summary in Russian, break-even status assessment, growth trajectory analysis, seasonal patterns identification, stability assessment, cash runway evaluation, expense optimization recommendations, strategic recommendations for next year, risk indicators and warnings
- **FR-033**: System MUST handle ChatGPT API responses gracefully: parse AI-generated text insights, display formatted conclusions in the Strategic Insights section, handle API errors with fallback to rule-based text generation, cache AI responses for same data inputs to reduce API calls
- **FR-034**: System MUST provide fallback mechanism: if ChatGPT API is unavailable or returns error, system MUST generate insights using rule-based templates with calculated metrics, ensure insights section is always populated even without AI
- **FR-035**: System MUST allow users to regenerate AI insights: provide "Обновить выводы" button to trigger new AI analysis, show loading indicator during AI processing, display timestamp of last AI insights generation
- **FR-023**: System MUST calculate and display stability/volatility analysis in the "Выводы" tab including: coefficient of variation for monthly revenue (standard deviation / mean, expressed as percentage), revenue stability score (lower variation = more stable), identification of months with significant deviations from average (outliers), consistency indicator (how predictable revenue is month-to-month)
- **FR-024**: System MUST calculate and display cash runway analysis in the "Выводы" tab showing: months of runway based on current average monthly profit/loss (if profit positive), months until break-even based on current trajectory (if currently unprofitable), required monthly revenue growth rate to achieve break-even within target timeframe (if applicable), burn rate analysis (monthly cash consumption rate if expenses exceed revenue)
- **FR-025**: System MUST calculate and display expense efficiency analysis in the "Выводы" tab including: top expense categories by amount (showing percentage of total expenses), expense category growth rates (YoY comparison if previous year data available), expense optimization opportunities (categories with highest growth rates), ROI analysis for expense categories (if revenue categories can be linked to expense categories, e.g., marketing expenses vs marketing revenue)
- **FR-026**: System MUST calculate and display predictive insights in the "Выводы" tab showing: projected annual revenue for next year (based on current growth rate and trends, if calculable), projected break-even timeline (based on current trajectory), forecasted best/worst months for next year (based on seasonality patterns), risk indicators (e.g., "Если текущий тренд сохранится, точка безубыточности будет достигнута через [X] месяцев")
- **FR-027**: System MUST calculate and display performance benchmarks in the "Выводы" tab including: comparison of current year performance to previous year (better/worse/same), achievement of break-even milestone (yes/no, when achieved), growth rate comparison (current vs previous year growth rate), profitability improvement (if profit margin improved compared to previous year)
- **FR-028**: [OUT OF SCOPE FOR MVP] System MAY display data visualization in future versions including: revenue trend chart (line graph showing monthly revenue over the year), revenue vs expenses comparison chart (bar or line chart showing both metrics), quarterly comparison chart (bar chart showing Q1-Q4 performance), YoY comparison chart (side-by-side comparison with previous year, if available)
- **FR-029**: System MUST calculate and display month-by-month insights in the "Выводы" tab showing: months above break-even (count and list), months below break-even (count and list), consecutive profitable months streak (if applicable), consecutive loss months streak (if applicable), recovery months (months that recovered from previous losses)
- **FR-011**: System MUST support selecting a historical date (as-of date) for viewing insights as they would have appeared at that point in time
- **FR-012**: System MUST apply historical date filtering to exclude payments, expenses, and data changes made after the selected as-of date when calculating insights
- **FR-013**: System MUST display the selected year and historical date (if selected) clearly in the "Выводы" tab header
- **FR-014**: System MUST update insights in the "Выводы" tab when user changes the selected year
- **FR-015**: System MUST handle years with partial data gracefully in insights, indicating which months are included in calculations and which are excluded
- **FR-016**: System MUST preserve year and historical date selections when switching between tabs or refreshing the page (using browser storage or URL parameters)
- **FR-017**: System MUST allow users to clear historical date filter and return to viewing current data state for the selected year
- **FR-018**: System MUST pass year and historical date parameters to the API endpoint when requesting insights data for the "Выводы" tab
- **FR-019**: System MUST display insights in a clear, readable format using tables and numerical data (no charts or complex graphics for MVP) with sections for: Key Revenue Metrics, Expenses Statistics, Year-over-Year Comparison, Profitability Metrics, Quarterly Analysis, Operational Efficiency, Break-Even Analysis, Stability/Volatility Analysis, Cash Runway Analysis, Expense Efficiency Analysis, Predictive Insights, Performance Benchmarks, Trend Analysis, Month-by-Month Insights, and Strategic Insights (AI-generated or rule-based)
- **FR-020**: System MUST load insights data when user switches to the "Выводы" tab (lazy loading) or when year/historical date changes
- **FR-021**: System MUST calculate break-even point accurately: monthly break-even = average monthly expenses, annual break-even = total annual expenses, months to break-even = total annual expenses / average monthly revenue (if average monthly revenue > 0)
- **FR-022**: System MUST calculate YoY growth rates accurately: revenue YoY = ((current year revenue - previous year revenue) / previous year revenue) * 100%, expenses YoY = ((current year expenses - previous year expenses) / previous year expenses) * 100%, profit YoY = ((current year profit - previous year profit) / |previous year profit|) * 100% (if previous year profit != 0)

### Key Entities *(include if feature involves data)*

- **Yearly PNL Summary**: Represents aggregated annual financial data for a specific year
  - Year: The calendar year being reported
  - Total Annual Revenue: Sum of all monthly revenue for the year
  - Monthly Breakdown: Array of 12 monthly entries with revenue and payment counts
  - Key Metrics: Calculated statistics (average, best month, worst month, etc.)
- **As-Of Date Filter**: Represents a specific historical date used for data synchronization, showing data as it existed at that point in time
  - Date: The historical date selected
  - Purpose: View data state at a specific point in time
  - Excludes: Any payments or changes made after this date
- **Analytical Insights**: Calculated conclusions and patterns derived from yearly PNL data, displayed in the "Выводы" tab
  - Key Revenue Metrics: Total annual revenue, average monthly revenue, best/worst months, total payment count
  - Expenses Statistics: Total annual expenses, average monthly expenses, expenses breakdown by categories, expenses-to-revenue ratio
  - Year-over-Year Comparison: Revenue growth rate (YoY %), expenses growth rate (YoY %), profit/loss change (YoY %), comparison of key metrics with previous year
  - Profitability Metrics: Gross profit margin (if cost data available), operating margin, net profit margin, return on revenue
  - Quarterly Analysis: Q1-Q4 revenue totals, quarterly profit/loss, best/worst quarters, quarterly growth trends, quarterly YoY comparison
  - Operational Efficiency: Average transaction value, revenue per month, expenses per month, efficiency ratio (expenses/revenue)
  - Break-Even Analysis: Monthly break-even point, annual break-even point, months to break-even, profit/loss for the year, profit margin percentage
  - Stability/Volatility Analysis: Coefficient of variation for monthly revenue, revenue stability score, identification of outlier months, consistency indicator
  - Cash Runway Analysis: Months of runway based on current profit/loss, months until break-even, required growth rate to achieve break-even, burn rate analysis
  - Expense Efficiency Analysis: Top expense categories by amount, expense category growth rates, expense optimization opportunities, ROI analysis for expense categories
  - Predictive Insights: Projected annual revenue for next year, projected break-even timeline, forecasted best/worst months, risk indicators
  - Performance Benchmarks: Comparison to previous year, break-even milestone achievement, growth rate comparison, profitability improvement
  - Trend Analysis: Growth/decline indicators, first half vs second half comparison, peak and low period identification, month-over-month growth rates, seasonality analysis
  - Month-by-Month Insights: Months above/below break-even, consecutive profitable/loss months streaks, recovery months identification
  - Data Display: Tables and numerical data only (no charts or complex graphics for MVP)
  - Strategic Insights: Overall performance summary, break-even status, growth trajectory assessment, seasonal patterns (if detected), key observations, actionable strategic recommendations for next year
    - AI Generation: Generated using ChatGPT/OpenAI API based on all analytical metrics
    - Fallback: Rule-based template generation if AI unavailable
  - Display Location: Dedicated "Выводы" tab in the PNL report interface
- **ChatGPT Integration**: AI service for generating strategic insights
  - API Endpoint: OpenAI Chat Completions API
  - Model: Configurable (default: gpt-4o-mini or gpt-4o)
  - Input: Structured JSON with all analytical metrics
  - Output: Formatted text insights in Russian
  - Caching: Cache responses for same data inputs to reduce API costs
  - Error Handling: Fallback to rule-based generation on API errors
- **Expenses Data**: Aggregated from `pnl_manual_entries` table with `entry_type = 'expense'` and expense categories from `pnl_expense_categories` table
  - Monthly expenses: Sum of all expense entries for each month
  - Annual expenses: Sum of all monthly expenses for the year
  - Average monthly expenses: Total annual expenses divided by number of months with expense data
- **Monthly Revenue Entry**: Existing entity representing revenue for a specific month, aggregated into yearly summary
- **Payment Date**: Existing field in payment records used for filtering and historical date synchronization

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can navigate to the "Выводы" tab and see analytical insights for any selected year within 3 seconds of tab activation
- **SC-002**: Key revenue metrics displayed in "Выводы" tab accurately match underlying data: total annual revenue matches sum of monthly entries, average monthly revenue is calculated correctly, best/worst months are correctly identified (verified by manual calculation)
- **SC-003**: Expenses statistics displayed in "Выводы" tab accurately match underlying data: total annual expenses matches sum of expense entries, average monthly expenses is calculated correctly, expenses breakdown by categories is accurate (verified by manual calculation)
- **SC-004**: Year-over-year comparison calculations are accurate: revenue YoY growth rate matches manual calculation ((current - previous) / previous * 100%), expenses YoY growth rate is calculated correctly, profit YoY change is accurate (verified by manual calculation)
- **SC-005**: Profitability metrics are calculated correctly: operating margin equals (profit/loss / revenue * 100%), net profit margin matches manual calculation, return on revenue is accurate (verified by manual calculation)
- **SC-006**: Quarterly analysis accurately aggregates data: Q1-Q4 totals match sum of respective months, quarterly profit/loss equals revenue minus expenses for each quarter, best/worst quarters are correctly identified (verified by manual calculation)
- **SC-007**: Operational efficiency metrics are accurate: average transaction value equals total revenue / total payment count, efficiency ratio equals expenses / revenue (verified by manual calculation)
- **SC-008**: Break-even analysis calculations are accurate: monthly break-even equals average monthly expenses, annual break-even equals total annual expenses, months to break-even is calculated correctly (if applicable), profit/loss equals revenue minus expenses, profit margin percentage is calculated correctly (verified by manual calculation)
- **SC-009**: Historical date (as-of date) filtering correctly excludes 100% of payments, expenses, and changes made after the selected date when calculating insights (verified by manual reconciliation)
- **SC-010**: Analytical insights in "Выводы" tab are calculated correctly and provide meaningful strategic conclusions (verified by comparing calculated insights with manual analysis)
- **SC-011**: Trend analysis accurately identifies growth/decline patterns, calculates percentage changes correctly, and detects seasonality when present
- **SC-012**: "Выводы" tab clearly displays selected year and historical date (if selected) in the tab header
- **SC-013**: System handles years with partial data gracefully in insights, indicating which months are included in calculations
- **SC-014**: Strategic insights section provides actionable recommendations for next year based on data trends, growth trajectory, and break-even status
- **SC-015**: Stability/volatility analysis accurately calculates coefficient of variation and identifies outlier months (verified by manual calculation)
- **SC-016**: Cash runway analysis correctly calculates months of runway and break-even timeline based on current trajectory (verified by manual calculation)
- **SC-017**: Expense efficiency analysis accurately identifies top expense categories and calculates growth rates (verified by manual calculation)
- **SC-018**: Predictive insights provide reasonable projections based on current trends (verified by comparing projections with actual data when available)
- **SC-019**: Performance benchmarks accurately compare current year to previous year across all key metrics (verified by manual calculation)
- **SC-020**: Month-by-month insights correctly identify profitable/loss months and calculate streaks (verified by manual verification)
- **SC-021**: [OUT OF SCOPE FOR MVP] Data visualization charts accurately represent underlying data and are readable/interpretable (will be implemented after MVP when numerical data is stable)
- **SC-022**: ChatGPT integration successfully generates strategic insights when API is available and configured (verified by checking AI-generated text appears in Strategic Insights section)
- **SC-023**: Fallback mechanism works correctly: when ChatGPT API is unavailable, rule-based insights are generated and displayed (verified by disabling API and checking insights still appear)
- **SC-024**: AI-generated insights are relevant and accurate: contain references to actual calculated metrics, provide actionable recommendations, written in Russian language (verified by manual review)
- **SC-025**: ChatGPT API calls are optimized: responses are cached for same data inputs, API is called only when data changes or user requests regeneration (verified by monitoring API call frequency)

## Assumptions

- "Выводы" tab will be added to the existing PNL report page (`frontend/pnl-report.html`), alongside "Отчет" and "Настройки" tabs
- Insights will be calculated on-the-fly from yearly PNL data, not pre-stored
- Key revenue metrics displayed in "Выводы" tab: total annual revenue (sum of all monthly revenue), average monthly revenue (total/annual months with data), best performing month (month with highest revenue), worst performing month (month with lowest revenue, excluding zero months if all are zero), total payment count (sum of payments across all months)
- Expenses statistics displayed in "Выводы" tab: total annual expenses (sum of all expense entries from `pnl_manual_entries` with `entry_type = 'expense'`), average monthly expenses (total annual expenses / number of months with expense data), expenses breakdown by categories (if available, showing top expense categories), expenses-to-revenue ratio (total expenses / total revenue * 100%)
- Break-even analysis will include: monthly break-even point (average monthly expenses - the amount of monthly revenue needed to cover expenses), annual break-even point (total annual expenses - the amount of annual revenue needed to cover expenses), months to break-even (total annual expenses / average monthly revenue, if average monthly revenue > 0, otherwise "N/A"), profit/loss for the year (total revenue minus total expenses, can be negative), profit margin percentage ((profit/loss / total revenue) * 100%, can be negative)
- Year-over-year comparison will include: revenue growth rate ((current year - previous year) / previous year * 100%), expenses growth rate, profit/loss change (absolute and percentage), comparison of best/worst months, comparison of average monthly metrics
- Profitability metrics will include: operating margin (profit/loss / revenue * 100%), net profit margin (same as operating margin for this context), return on revenue (profit/loss / revenue * 100%), gross profit margin (if cost of goods sold data becomes available)
- Quarterly analysis will include: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec) revenue totals, quarterly profit/loss, best performing quarter (highest revenue), worst performing quarter (lowest revenue), quarterly growth trends (Q1→Q2, Q2→Q3, Q3→Q4 percentage changes), quarterly YoY comparison (if previous year data available)
- Operational efficiency metrics will include: average transaction value (total revenue / total payment count), revenue per month (average monthly revenue), expenses per month (average monthly expenses), efficiency ratio (expenses / revenue, expressed as percentage - lower is better)
- Trend analysis will include: comparison of first half vs second half of year (percentage change), identification of peak revenue period (consecutive months with highest revenue), identification of low revenue period (consecutive months with lowest revenue), growth/decline indicators (comparing month-to-month changes), month-over-month growth rates (for each month transition), seasonality analysis (detecting recurring patterns across months)
- Stability/volatility analysis will include: coefficient of variation calculation (standard deviation / mean * 100%), revenue stability score (interpretation: <15% = very stable, 15-30% = stable, 30-50% = moderate volatility, >50% = high volatility), identification of outlier months (months with revenue >2 standard deviations from mean), consistency indicator (percentage of months within 1 standard deviation of mean)
- Cash runway analysis will include: months of runway = current cash balance / average monthly loss (if loss), or months of runway = current cash balance / average monthly profit (if profit, showing sustainability), months until break-even = (total annual expenses - total annual revenue) / average monthly profit (if currently unprofitable but trending toward profit), required monthly revenue growth rate = ((break-even revenue - current annual revenue) / remaining months) / average monthly revenue * 100%, burn rate = average monthly expenses - average monthly revenue (if negative, shows cash consumption rate)
- Expense efficiency analysis will include: top 5 expense categories by total amount (with percentage of total expenses), expense category YoY growth rates (if previous year data available), expense optimization opportunities (categories with highest growth rates that may need review), ROI analysis (if marketing expenses can be linked to marketing revenue categories, calculate marketing ROI = marketing revenue / marketing expenses)
- Predictive insights will include: projected annual revenue = current year revenue * (1 + average monthly growth rate) (if growth rate is positive and stable), projected break-even timeline = months until break-even based on current average monthly profit trend, forecasted best/worst months = months with historically highest/lowest revenue (based on seasonality), risk indicators (e.g., "При текущем тренде точка безубыточности будет достигнута через [X] месяцев", "Если расходы продолжат расти текущими темпами, потребуется увеличение выручки на [X]%")
- Performance benchmarks will include: overall performance rating (better/worse/same compared to previous year), break-even milestone achievement (achieved in month X vs previous year), growth rate comparison (current year growth rate vs previous year growth rate), profitability improvement (profit margin change compared to previous year)
- Month-by-month insights will include: count of months above break-even, list of months above break-even, count of months below break-even, list of months below break-even, longest consecutive profitable months streak, longest consecutive loss months streak, recovery months (months that showed profit after previous loss months)
- Data display for MVP will use: tables with numerical data, clear section headers, organized rows and columns, no charts or complex graphics (charts will be added in future versions after MVP when numerical data is stable and validated)
- Strategic insights section will be generated using ChatGPT API with the following approach:
  - Data Preparation: All calculated metrics are formatted into structured JSON payload including: revenue metrics (total, average, best/worst months), expenses (total, average, top categories), YoY comparisons (growth rates), profitability metrics (margins), quarterly analysis (Q1-Q4 totals and trends), operational efficiency (average transaction value, efficiency ratio), break-even analysis (points, months to break-even, profit/loss), stability metrics (coefficient of variation, stability score), cash runway (months of runway, burn rate), expense efficiency (top categories, growth rates), predictive insights (projected revenue, break-even timeline), performance benchmarks (comparison to previous year), trend analysis (growth patterns, seasonality), month-by-month insights (profitable/loss months, streaks)
  - ChatGPT Prompt: System sends structured prompt in Russian requesting: comprehensive performance summary, break-even status assessment, growth trajectory analysis (accelerating/stable/declining), seasonal patterns identification, stability assessment with recommendations, cash runway evaluation and warnings, expense optimization opportunities with specific categories, strategic recommendations for next year based on trends, risk indicators and early warnings, actionable next steps
  - AI Response Processing: Parse ChatGPT response, extract key sections (summary, recommendations, risks), format for display in Strategic Insights section, handle markdown formatting if present
  - Caching Strategy: Cache AI responses using hash of input data (year + all metrics), reuse cached response if data hasn't changed, allow manual refresh to regenerate insights
  - Fallback Mechanism: If ChatGPT API unavailable or returns error, use rule-based template generation: populate templates with calculated metrics, generate insights using predefined patterns, ensure all sections are filled even without AI
- Strategic insights content (AI-generated or fallback) will include: overall performance summary (e.g., "Год показал стабильный рост [X]%" или "Выручка была неравномерной"), growth trajectory assessment (e.g., "Рост ускоряется", "Рост стабилен", "Рост замедляется"), break-even status (e.g., "Точка безубыточности достигнута за [X] месяцев" или "Точка безубыточности не достигнута, требуется [X] PLN дополнительной выручки"), seasonal patterns (if detectable, e.g., "Наблюдается сезонность с пиком в летние месяцы"), stability assessment (e.g., "Выручка стабильна (коэффициент вариации [X]%)" или "Выручка волатильна, требуется стабилизация"), cash runway status (e.g., "При текущих темпах денежных средств хватит на [X] месяцев" или "Требуется увеличение выручки для поддержания операций"), expense optimization recommendations (e.g., "Рекомендуется пересмотреть категорию '[категория]', которая выросла на [X]%"), key observations (e.g., "Самый успешный месяц - [месяц] с выручкой [сумма]", "Расходы составляют [X]% от выручки", "Средний чек составляет [X] PLN", "[X] месяцев были прибыльными"), actionable strategic recommendations for next year (e.g., "Рекомендуется обратить внимание на [месяц]", "Для достижения точки безубыточности необходимо увеличить выручку на [X]%", "Рекомендуется оптимизировать расходы в [квартал/месяц]", "На основе трендов ожидается рост/падение в следующем году", "Рекомендуется сосредоточиться на категориях расходов: [список]", "Прогнозируемая выручка на следующий год: [сумма] PLN при сохранении текущих трендов")
- Historical date filtering requires querying payment data with created_at or updated_at timestamps to exclude changes made after the as-of date
- Browser localStorage or URL parameters will be used to persist year and historical date selections
- Historical date filtering can be combined with year selection (shows yearly insights as of the selected historical date)
- Insights will be loaded when user switches to "Выводы" tab (lazy loading) or when year/historical date changes

## Dependencies

- Existing PNL report service (`011-pnl-report`) and API endpoint (`/api/pnl/report`)
- Existing monthly revenue data structure and aggregation logic
- Existing expenses data structure (`pnl_manual_entries` table with `entry_type = 'expense'`)
- Existing expense categories (`pnl_expense_categories` table)
- Existing frontend PNL report page (`frontend/pnl-report.html` and `frontend/pnl-report-script.js`)
- Payment data with timestamps for historical date filtering
- Expenses data with timestamps for historical date filtering
- Database queries that support filtering by year and historical date for both revenue and expenses
- Existing OpenAI API integration (`src/services/ai/openAIService.js`) for AI-powered features
- OpenAI API key configuration (`OPENAI_API_KEY` and `OPENAI_MODEL` in environment variables)
- ChatGPT/OpenAI Chat Completions API for generating strategic insights

## Out of Scope

- Data visualization (charts, graphs, animations) - will be added after MVP when numerical data is stable and validated
- Exporting yearly reports (CSV, PDF) - may be added later
- Saving custom report configurations or templates
- Advanced analytics with machine learning or predictive modeling
- Detailed drill-down into specific months or transactions from yearly view
- Custom date range reports (only full calendar year reports)
- Multiple year comparison views in a single report
- Automated report generation or scheduling
- Email delivery of yearly reports
