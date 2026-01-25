# Research: PNL Yearly Report with Analytics

**Feature**: 016-pnl-date-filter  
**Date**: 2025-01-27  
**Status**: Complete

## Research Tasks

### 1. Extending Existing PNL Report Service for Insights

**Question**: How to extend existing `pnlReportService.js` to calculate analytical insights without duplicating code?

**Research Findings**:
- Existing `PnlReportService` already aggregates monthly revenue data
- Service has methods: `getMonthlyRevenue()`, payment filtering, refund exclusion
- Service uses `PnlRepository` for database queries
- Service uses `exchangeRateService` for currency conversion

**Decision**: Create new `PnlInsightsService` that:
- Uses existing `PnlReportService.getMonthlyRevenue()` for base data
- Uses existing `PnlRepository` for expense queries
- Calculates analytical metrics from aggregated data
- Reuses existing helper functions (convertToPln, date parsing)

**Rationale**: 
- Separation of concerns: insights calculation separate from data aggregation
- Reuses proven data aggregation logic
- Easier to test insights calculations independently
- Maintains existing PNL report functionality unchanged

**Alternatives Considered**:
- Extending `PnlReportService` directly - rejected due to single responsibility principle
- Creating separate service from scratch - rejected due to code duplication

---

### 2. ChatGPT Integration for Strategic Insights

**Question**: How to integrate ChatGPT API for generating strategic insights from analytical metrics?

**Research Findings**:
- Existing `openAIService.js` already implements OpenAI API client
- Uses axios for HTTP requests
- Supports expense categorization with structured prompts
- Uses environment variables: `OPENAI_API_KEY`, `OPENAI_MODEL`
- Default model: `gpt-4o-mini` (cheaper option)

**Decision**: Extend `openAIService.js` with new method `generateStrategicInsights()`:
- Accept structured JSON payload with all analytical metrics
- Send prompt in Russian requesting comprehensive analysis
- Parse response and format for display
- Implement caching using hash of input data
- Handle errors gracefully with fallback to rule-based generation

**Rationale**:
- Reuses existing OpenAI infrastructure
- Consistent with existing AI integration patterns
- Caching reduces API costs
- Fallback ensures reliability

**Alternatives Considered**:
- Creating separate ChatGPT service - rejected due to code duplication
- Using different AI provider - rejected due to existing OpenAI setup

---

### 3. Historical Date Filtering Implementation

**Question**: How to filter payment and expense data by historical date (as-of date) for viewing data as it existed at a specific point in time?

**Research Findings**:
- Payment tables have `created_at` and `updated_at` timestamps
- `pnl_manual_entries` table has `created_at` and `updated_at` timestamps
- Existing queries filter by payment date (`operation_date`) for year selection
- Need to add additional filter: `created_at <= as_of_date` OR `updated_at <= as_of_date`

**Decision**: Extend `PnlRepository` and `ManualEntryService`:
- Add optional `asOfDate` parameter to query methods
- Filter payments: `created_at <= as_of_date` AND `updated_at <= as_of_date`
- Filter expenses: `created_at <= as_of_date` AND `updated_at <= as_of_date`
- Apply filter at repository level before aggregation
- Pass `asOfDate` through service layer to repository

**Rationale**:
- Filtering at repository level ensures consistency
- Reuses existing query patterns
- Minimal changes to existing code
- Clear separation of concerns

**Alternatives Considered**:
- Filtering after aggregation - rejected due to performance and accuracy concerns
- Storing historical snapshots - rejected due to complexity and storage overhead

---

### 4. Data Structure for ChatGPT API Payload

**Question**: What structure should be used for sending analytical metrics to ChatGPT API?

**Research Findings**:
- Existing OpenAI service uses structured prompts with JSON data
- ChatGPT Chat Completions API accepts messages array with role and content
- Content can include structured JSON data in text format
- Response is plain text that needs parsing

**Decision**: Structure payload as JSON object with sections:
```json
{
  "year": 2025,
  "revenue": { ... },
  "expenses": { ... },
  "breakEven": { ... },
  "yoy": { ... },
  "profitability": { ... },
  "quarterly": { ... },
  "efficiency": { ... },
  "trends": { ... },
  "stability": { ... },
  "cashRunway": { ... },
  "expenseEfficiency": { ... },
  "predictive": { ... },
  "benchmarks": { ... },
  "monthly": { ... }
}
```

**Rationale**:
- Clear structure for AI to parse
- All metrics available in one payload
- Easy to extend with new metrics
- Consistent with existing AI integration patterns

**Alternatives Considered**:
- Sending raw database queries - rejected due to security and complexity
- Multiple API calls for different sections - rejected due to cost and latency

---

### 5. Incremental Implementation Strategy

**Question**: How to implement 17 phases incrementally, one metric at a time?

**Research Findings**:
- Existing PNL report already has tab structure (Report, Settings)
- Each metric can be calculated independently
- Metrics depend on base data (revenue, expenses) but not on each other
- Testing can be done manually by comparing calculated values

**Decision**: Implement phases sequentially:
- Phase 0: Foundation (tab, API endpoint, basic structure)
- Phase 1-14: One metric per phase, each independently testable
- Phase 15: Rule-based insights (uses all metrics)
- Phase 16: AI-powered insights (extends Phase 15)
- Phase 17: Historical date filtering (applies to all metrics)

**Rationale**:
- Each phase delivers independently testable functionality
- Early phases provide immediate value
- Later phases build on earlier work
- Easy to validate each metric before moving forward

**Alternatives Considered**:
- Implementing all metrics at once - rejected due to complexity and testing difficulty
- Parallel implementation - rejected due to dependencies between metrics

---

### 6. Caching Strategy for ChatGPT Responses

**Question**: How to cache ChatGPT API responses to reduce costs and improve performance?

**Research Findings**:
- Existing codebase uses `node-cache` package (already in dependencies)
- Cache key should be hash of input data (year + all metrics)
- Cache TTL should be reasonable (e.g., 1 hour) since data changes infrequently
- Need to invalidate cache when data changes

**Decision**: Implement caching in `openAIService.js`:
- Use `node-cache` with TTL of 3600 seconds (1 hour)
- Cache key: `md5(JSON.stringify(payload))`
- Check cache before API call
- Store response in cache after successful API call
- Provide manual refresh option to bypass cache

**Rationale**:
- Reduces API costs significantly
- Improves response time for repeated requests
- Simple implementation using existing dependency
- Manual refresh ensures users can get fresh insights

**Alternatives Considered**:
- Database caching - rejected due to complexity and existing cache library
- No caching - rejected due to cost concerns

---

## Summary

All research questions resolved. Key decisions:
1. Create `PnlInsightsService` extending existing services
2. Extend `openAIService.js` for ChatGPT integration
3. Add historical date filtering at repository level
4. Use structured JSON payload for ChatGPT
5. Implement incrementally, one metric per phase
6. Use node-cache for ChatGPT response caching

No blocking issues identified. Ready to proceed with Phase 1 design.


