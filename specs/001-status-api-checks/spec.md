# Feature Specification: System Status API Coverage

**Feature Branch**: `001-status-api-checks`  
**Created**: 2025-11-09  
**Status**: Draft  
**Input**: User description: "обновить блок статус системы добавив туда проверку других API учавствующих в этом софте"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operations monitor all integrations (Priority: P1)

Operations managers need to confirm at a glance that every external API the product depends on is available and healthy, using the system status block as their source of truth.

**Why this priority**: Loss of visibility into any API outage directly disrupts synchronization and customer workflows, so this is mission-critical for day-to-day operations.

**Independent Test**: Trigger health checks while mocking available and unavailable API responses; verify the status block reflects each API’s current state and last checked time without requiring other functionality.

**Acceptance Scenarios**:

1. **Given** an authenticated operator viewing the status page, **When** all integrated APIs return healthy responses within expected thresholds, **Then** the status block lists each API as operational with a timestamp updated within the last check cycle.
2. **Given** an integrated API returns an error or times out, **When** the next health check executes, **Then** the status block flags that API as degraded/unavailable and surfaces the most recent failure message.

---

### User Story 2 - Operators triage degraded APIs (Priority: P2)

Support specialists need to identify which integration is failing and what action to take when the status block shows a warning.

**Why this priority**: Faster triage reduces customer impact during partial outages and avoids guesswork when coordinating with external providers.

**Independent Test**: Simulate a degraded response for one API while others stay healthy; confirm the status block highlights the impacted API, displays actionable failure context, and preserves unaffected statuses.

**Acceptance Scenarios**:

1. **Given** a single API is failing authentication, **When** the operator opens the status block, **Then** the failing API row indicates the issue type (e.g., authentication) and points to the recommended escalation contact or runbook reference.

---

### User Story 3 - Operators detect stale monitoring (Priority: P3)

Operations teams must know if any API health check has not run recently so they can investigate monitoring gaps before customers are affected.

**Why this priority**: Stale checks hide silent failures; surfacing them protects service quality even when integrations appear green.

**Independent Test**: Pause the scheduler for one API check while leaving others active; verify the status block highlights the stale check and logs when the last successful run occurred.

**Acceptance Scenarios**:

1. **Given** an API health check has not completed within the defined freshness window, **When** an operator reviews the status block, **Then** the API row shows a stale status with a timestamp exceeding the freshness threshold and guidance to investigate the monitoring job.

---

### Edge Cases

- API endpoint responds with rate-limit or throttling errors during health checks.
- External API returns success but key business capability (e.g., creating an invoice) fails validation.
- Health check scheduler itself experiences downtime, delaying updates for one or more APIs.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a dedicated row in the status block for each external API dependency involved in the integration.
- **FR-002**: System MUST execute automated health checks for each listed API at the existing monitoring cadence and upon manual refresh requests from operators.
- **FR-003**: System MUST record and surface the timestamp of the most recent successful and failed health checks per API.
- **FR-004**: System MUST present human-readable failure summaries including error type and suggested next actions when an API check fails.
- **FR-005**: System MUST flag any API check as stale when no result has been recorded within the configured freshness window and notify operators within the status block.
- **FR-006**: System MUST include health checks for [NEEDS CLARIFICATION: Which additional APIs should be monitored beyond the existing ones?].

### Key Entities *(include if feature involves data)*

- **ApiEndpointStatus**: Represents the current health state of an external API, capturing name, current status (operational, degraded, down, stale), last success time, last failure time, and latest failure summary.
- **SystemStatusDashboard**: Aggregates `ApiEndpointStatus` records for presentation, including ordering, manual refresh capability, and metadata about the monitoring cadence.

## Assumptions

- Existing monitoring cadence (e.g., every 5 minutes) remains sufficient unless the clarification indicates otherwise.
- Operators already authenticate to access the system status block; no changes to access control are required.
- Each API has at least one lightweight operation or endpoint suitable for use as a health probe without incurring significant cost or rate-limit risk.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of defined external APIs appear in the status block with a status updated within the last monitoring cycle during normal operation.
- **SC-002**: Operators identify the failing API and underlying error type within 2 minutes of an outage by using the status block alone.
- **SC-003**: At least 90% of degraded API incidents logged in the next quarter are triaged without manual API probing thanks to the surfaced failure summaries.
- **SC-004**: Monitoring gaps (stale checks) are detected and addressed within one monitoring interval in 95% of occurrences, preventing undetected outages.
