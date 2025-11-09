# Feature Specification: Pipedrive to wFirma Invoice Automation

**Feature Branch**: `001-project-spec`  
**Created**: 2025-10-25  
**Status**: Draft  
**Input**: User description: "Создай спецификации о проекте исходя из того что уже делает код и ты знаешь о проекте. @business-requirements.md @architecture.md здесь последние файлы архитектуры и бизнес требований. Но нужно проверить их на логичность."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operations trigger proforma invoice (Priority: P1)

Sales operations staff wants to turn an approved Pipedrive deal into a matching proforma invoice in wFirma with one click or API call so that the finance team can bill the customer immediately without re-entering data.

**Why this priority**: This is the primary value of the integration—without accurate one-off invoice creation the rest of the workflow provides no benefit.

**Independent Test**: From a staging deal that meets prerequisites, run the manual trigger and verify that wFirma shows a new proforma carrying the correct contractor, amounts, currency, payment schedule, and tag.

**Acceptance Scenarios**:

1. **Given** an eligible Pipedrive deal with required fields and linked product, **When** an operator runs the manual trigger, **Then** a wFirma proforma is created with matching totals, VAT 0%, appropriate payment description, and linked contractor.
2. **Given** a deal for a new customer, **When** the trigger executes, **Then** the system creates the contractor in wFirma using normalized country code and associates the invoice to that contractor.

---

### User Story 2 - Scheduler syncs queued deals (Priority: P2)

The system scheduler should periodically discover deals marked for invoicing and process them automatically so that finance does not depend on manual runs.

**Why this priority**: Automation prevents backlog and reduces the risk of missing invoice deadlines.

**Independent Test**: Seed multiple eligible deals, enable the scheduler, and confirm that queued invoices are created within the configured window without manual intervention.

**Acceptance Scenarios**:

1. **Given** deals marked with the invoice flag, **When** the scheduler cycle runs, **Then** every eligible deal is processed exactly once and marked as completed or logged as failed with reason.
2. **Given** a transient API failure, **When** the scheduler retries, **Then** the system defers the deal with an error log and reattempts according to retry policy without duplicating invoices.

---

### User Story 3 - Finance review errors and audit trail (Priority: P3)

Finance and support teams need rapid insight into processing status so they can intervene, re-run, or communicate with customers without guessing.

**Why this priority**: Visibility ensures that automation issues do not silently block revenue or induce double billing.

**Independent Test**: Trigger failures (missing email, wFirma rejection) and confirm that logs capture deal identifiers, reason codes, and recommended manual fixes that can be reviewed without accessing source code.

**Acceptance Scenarios**:

1. **Given** a deal missing the customer email, **When** processing runs, **Then** the system aborts with a descriptive error and logs the exact field that must be corrected.
2. **Given** a wFirma API rejection, **When** the system logs the failure, **Then** the audit log includes the external response message and request context so finance can re-run or escalate.

---

### Edge Cases

- Deal lacks required contact email → invoice creation must halt with actionable guidance.
- Multiple products attached → choose primary product consistently (current rule: first line item) and log if others exist.
- Expected close date absent or in the past → fall back to default payment schedule and record the assumption.
- Tags exceeding 16 characters → truncate safely and surface original value for reviewer.
- Duplicate trigger within short window → detect already processed deals and avoid double invoices.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST validate Pipedrive deals for mandatory fields (title, value, currency, expected close date, invoice type, primary email, at least one product) before attempting invoice creation.
- **FR-002**: The system MUST ensure a matching contractor exists in wFirma by email, creating one with normalized country code when absent.
- **FR-003**: The system MUST produce proforma invoices that mirror deal amounts as gross values with enforced VAT 0% and include a payment description reflecting the 50/50 or 100% schedule based on expected close date.
- **FR-004**: The system MUST select the appropriate bank account per deal currency, defaulting to configured fallbacks when wFirma data is incomplete.
- **FR-005**: The system MUST generate or reuse a wFirma tag derived from product or deal name truncated to 16 characters and attach it to the invoice metadata.
- **FR-006**: The system MUST provide both manual trigger and scheduled batch processing paths that guarantee idempotency per deal.
- **FR-007**: The system MUST log each processing step with correlation identifiers, capturing success, warnings, and actionable failure messages without revealing credentials.
- **FR-008**: The system MUST expose a reviewable list (via logs or API) of deals pending processing, successfully processed, and failed with reasons.
- **FR-009**: The system MUST allow re-processing of failed deals after corrections without duplicating existing invoices.
- **FR-010**: The system MUST document any business rule overrides (e.g., missing expected close date fallback) in the audit log for finance visibility.

### Key Entities *(include if feature involves data)*

- **Pipedrive Deal**: Commercial agreement containing deal metadata, expected close date, currency, invoice-type flag, linked products, and contact references.
- **Pipedrive Product Line Item**: First associated product used to derive invoice line details (name, quantity, unit price); additional items noted for manual reconciliation.
- **Contractor**: Customer record in wFirma identified by email, enriched with normalized address and country data when created.
- **Proforma Invoice**: Billing document in wFirma generated from deal data, maintaining schedule, VAT rules, and bank account references.
- **Label/Tag**: Categorization token in wFirma ensuring documents can be grouped by product or deal name within naming limits.
- **Processing Log Entry**: Structured record capturing the outcome of each deal processing attempt for audit and support follow-up.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 95% of eligible deals produce matching proforma invoices on the first run without manual data correction.
- **SC-002**: Manual trigger completes end-to-end processing for a compliant deal within 2 minutes, including contractor creation and tagging.
- **SC-003**: Scheduler processes queued deals within 15 minutes of flagging during business hours, with zero duplicate invoices in audit logs.
- **SC-004**: 100% of processing failures include actionable error messages and required fields in the log so that finance can resolve issues without engineering support.
- **SC-005**: Finance confirms through sampling that invoice amounts, VAT treatment, and payment descriptions align with documented business rules in 100% of reviewed cases per release.

## Assumptions & Dependencies *(optional)*

- Pipedrive and wFirma APIs remain available and retain current contract fields; any vendor change triggers a new planning cycle.
- Finance provides and maintains bank account mappings for each supported currency.
- Deployment environments supply secure storage for API credentials and outbound HTTPS connectivity.
- WordPress plugin or external UI will surface manual triggers and logs but is out of scope for this specification.
