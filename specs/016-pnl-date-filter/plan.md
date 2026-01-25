# Implementation Plan: PNL Yearly Report with Analytics

**Branch**: `016-pnl-date-filter` | **Date**: 2025-01-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-pnl-date-filter/spec.md`

## Summary

Add a new "Выводы" (Insights) tab to the PNL report interface that displays comprehensive analytical insights and strategic conclusions for yearly financial data. The feature includes 17 implementation phases, adding one metric at a time for easier testing and validation. MVP focuses on tables and numerical data only (no charts). Strategic insights are generated using ChatGPT/OpenAI API with fallback to rule-based templates. The feature supports historical date filtering to view data as it existed at a specific point in time.

## Technical Context

**Language/Version**: Node.js ≥18.0.0 (JavaScript/ES6+)  
**Primary Dependencies**: Express.js, Supabase client (@supabase/supabase-js), OpenAI API client (axios), Winston logger  
**Storage**: Supabase PostgreSQL (existing `payments`, `stripe_payments`, `pnl_manual_entries`, `pnl_expense_categories` tables)  
**Testing**: Manual testing via browser and API endpoints (no formal test framework currently in use)  
**Target Platform**: Web application (Node.js backend + HTML/JavaScript frontend)  
**Project Type**: Web application (backend API + frontend pages)  
**Performance Goals**: Insights tab loads within 3 seconds, ChatGPT API calls complete within 10 seconds, cached responses served instantly  
**Constraints**: Must reuse existing PNL report service and data structures, must support historical date filtering without breaking existing functionality, ChatGPT API calls must be cached to reduce costs, fallback mechanism required when AI unavailable  
**Scale/Scope**: Support years 2020-2030, handle up to 12 months of data per year, support multiple concurrent users viewing different years

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Invoice Data Fidelity
✅ **PASS**: This feature does not modify invoice creation, deal-to-invoice mapping, or payment processing. It only reads existing payment and expense data for analytical purposes. No data transformation or normalization that could affect invoice fidelity.

### Reliable Automation Flow
✅ **PASS**: This feature adds new read-only endpoints and UI components. It does not modify existing automation flows, scheduler logic, or invoice processing. ChatGPT integration includes proper error handling and fallback mechanisms.

### Transparent Observability
✅ **PASS**: All API calls (including ChatGPT) will emit structured logs via existing logger with correlation identifiers. Logs will capture request parameters, response status, and errors without leaking secrets. ChatGPT API calls will be logged with request/response metadata.

### Secure Credential Stewardship
✅ **PASS**: OpenAI API key already exists in environment variables (`OPENAI_API_KEY`). No new credentials required. ChatGPT integration will use existing OpenAI service infrastructure.

### Spec-Driven Delivery Discipline
✅ **PASS**: Feature follows Spec Kit workflow: specification complete, now proceeding with plan. All requirements are clear and testable. Implementation phases are defined with independent test criteria.

## Project Structure

### Documentation (this feature)

```text
specs/016-pnl-date-filter/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── pnl-insights-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Web application structure (existing)
src/
├── services/
│   ├── pnl/
│   │   ├── pnlReportService.js          # Existing - extend for insights
│   │   ├── pnlRepository.js             # Existing - extend for historical filtering
│   │   └── pnlInsightsService.js        # NEW - analytical calculations service
│   └── ai/
│       └── openAIService.js             # Existing - extend for insights generation
├── routes/
│   └── api.js                           # Existing - add /api/pnl/insights endpoint
└── utils/
    └── logger.js                        # Existing - used for observability

frontend/
├── pnl-report.html                      # Existing - add "Выводы" tab
└── pnl-report-script.js                 # Existing - extend for insights tab
```

**Structure Decision**: Web application structure already exists. New code extends existing PNL report service (`src/services/pnl/pnlInsightsService.js`) and adds new API endpoint (`/api/pnl/insights`). Frontend extends existing PNL report page with new tab.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | No violations | All principles respected |

---

## Phase 0: Research Complete ✅

**Status**: Complete  
**Output**: `research.md`

All research questions resolved:
- ✅ Extending existing PNL report service for insights
- ✅ ChatGPT integration for strategic insights
- ✅ Historical date filtering implementation
- ✅ Data structure for ChatGPT API payload
- ✅ Incremental implementation strategy
- ✅ Caching strategy for ChatGPT responses

**Key Decisions**:
- Create `PnlInsightsService` extending existing services
- Extend `openAIService.js` for ChatGPT integration
- Add historical date filtering at repository level
- Use structured JSON payload for ChatGPT
- Implement incrementally, one metric per phase
- Use node-cache for ChatGPT response caching

---

## Phase 1: Design & Contracts Complete ✅

**Status**: Complete  
**Outputs**: `data-model.md`, `contracts/pnl-insights-api.yaml`, `quickstart.md`

### Data Model (`data-model.md`)
- ✅ Defined `YearlyPnlInsights` entity with all metric sections
- ✅ Defined `ChatGPT Payload Structure` entity
- ✅ Defined `Historical Date Filter` entity
- ✅ Documented data flow for insights generation
- ✅ Documented historical date filtering flow
- ✅ Validation rules for all entities

### API Contract (`contracts/pnl-insights-api.yaml`)
- ✅ OpenAPI 3.0 specification for `/api/pnl/insights` endpoint
- ✅ Defined all request parameters (year, asOfDate, regenerateAI)
- ✅ Defined complete response schema with all metric sections
- ✅ Error response schemas (400, 500)

### Quickstart (`quickstart.md`)
- ✅ Setup instructions
- ✅ Testing strategy per phase
- ✅ Manual verification examples
- ✅ Common issues and solutions

**Ready for**: Phase 2 (Tasks) via `/speckit.tasks` command
