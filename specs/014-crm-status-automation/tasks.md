# Development Tasks: CRM Status Automation

**Feature**: `014-crm-status-automation` | **Date**: 2025-11-27
**Priority Order**: P1 (Core automation) → P2 (Error handling) → P3 (Monitoring)

---

## Phase 1: Core Automation Logic

### Task 1.1: Payment Accumulation Calculator
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: None

**Description**: Create service to calculate accumulated payment amounts per proforma and determine status thresholds.

**Requirements**:
- `paymentAccumulationService.js` with method `calculateAccumulatedAmount(proformaId)`
- Calculate total linked payments vs proforma total
- Determine threshold percentages (≥50%, ≥100%)
- Return accumulation status and target CRM status

**Acceptance Criteria**:
- Correctly calculates accumulated amounts
- Properly determines threshold crossings
- Handles multiple currencies and partial payments

---

### Task 1.2: CRM Status Mapping Service
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 1.1

**Description**: Create service to determine target CRM status based on accumulation thresholds.

**Requirements**:
- `crmStatusService.js` with method `getTargetStatus(accumulationPercent, paymentSchedule)`
- Logic: ≥50% + 2 payments → "Second Payment" (32)
- Logic: ≥100% → "Camp Waiter" (27)
- Handle edge cases and invalid inputs

**Acceptance Criteria**:
- All status transition combinations covered
- Correct stage_id mappings (18, 32, 27)
- Handles partial payment scenarios

---

### Task 1.3: Pipedrive API Integration
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 1.2

**Description**: Create service for updating deal status in Pipedrive CRM.

**Requirements**:
- `pipedriveStatusService.js` with method `updateDealStatus(dealId, targetStatusId)`
- Use existing Pipedrive API client
- Handle authentication and error responses
- Return success/failure with detailed error info

**Acceptance Criteria**:
- Successfully updates deal status via Pipedrive API
- Proper error handling for API failures
- Maintains existing API usage patterns

---

### Task 1.4: Payment Linking Hook Integration
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 1.3

**Description**: Integrate CRM status automation into existing payment linking workflow.

**Requirements**:
- Extend `paymentLinkingService.linkPaymentToProforma()` method
- Add accumulation calculation after successful linking
- Trigger CRM status update when thresholds reached
- Ensure automation doesn't block payment linking

**Acceptance Criteria**:
- CRM status updates automatically on payment accumulation
- Payment linking succeeds even if CRM update fails
- Proper threshold detection for status changes

---

## Phase 2: Advanced Logic & Edge Cases

### Task 2.1: Status Override Logic
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 1.4

**Description**: Implement logic to allow overriding manually changed statuses when payment logic requires it.

**Requirements**:
- Check if current CRM status conflicts with payment accumulation
- Allow system to override manual changes when appropriate
- Log all overrides for audit purposes
- Prioritize payment business logic over manual changes

**Acceptance Criteria**:
- System can override conflicting manual status changes
- All overrides are logged with justification
- Payment logic takes precedence when needed

---

### Task 2.2: Payment Unlinking Handling
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 1.4

**Description**: Handle status recalculation when payments are unlinked from proformas.

**Requirements**:
- Recalculate accumulation after payment unlinking
- Potentially revert status changes if thresholds no longer met
- Handle partial unlinking scenarios
- Maintain data consistency

**Acceptance Criteria**:
- Status correctly reverts when payments are unlinked
- Accumulation recalculated accurately
- No orphaned status changes

---

### Task 2.3: Concurrent Payment Processing
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 1.4

**Description**: Handle multiple payments being linked simultaneously to the same proforma.

**Requirements**:
- Prevent race conditions in accumulation calculations
- Ensure atomic status updates
- Handle concurrent API calls to CRM
- Maintain data consistency across multiple operations

**Acceptance Criteria**:
- No data corruption from concurrent operations
- Consistent accumulation calculations
- Proper status updates under load

---

### Task 2.4: CRM API Error Recovery
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 1.3

**Description**: Implement robust error handling and recovery for Pipedrive API failures.

**Requirements**:
- Retry failed CRM API calls (exponential backoff)
- Queue failed updates for later retry
- Alert monitoring system on persistent failures
- Never block payment processing due to CRM issues

**Acceptance Criteria**:
- Failed CRM updates don't break payment processing
- Automatic retry for transient failures
- Proper monitoring and alerting for issues

---

## Phase 3: Monitoring & Observability

### Task 3.1: Status Update Audit Logging
**Priority**: P3 | **Estimate**: 2 hours | **Dependencies**: All previous

**Description**: Implement comprehensive audit logging for status automation operations.

**Requirements**:
- Log all status update attempts (success/failure)
- Include deal ID, accumulation %, old/new status, trigger info
- Store logs in existing logging system
- Make logs searchable for troubleshooting

**Acceptance Criteria**:
- All automation operations are logged
- Logs include sufficient context for debugging
- Logs are accessible for audit purposes

---

### Task 3.2: Metrics and Monitoring
**Priority**: P3 | **Estimate**: 3 hours | **Dependencies**: Task 3.1

**Description**: Add monitoring metrics for automation performance and reliability.

**Requirements**:
- Track automation success/failure rates
- Monitor average update times
- Alert on high error rates or failed updates
- Dashboard integration for operations team

**Acceptance Criteria**:
- Key metrics are collected and exposed
- Monitoring alerts configured appropriately
- Performance metrics track efficiency improvements

---

### Task 3.3: Feature Toggle & Rollback
**Priority**: P3 | **Estimate**: 2 hours | **Dependencies**: All previous

**Description**: Implement feature toggle for safe deployment and easy rollback.

**Requirements**:
- Environment variable to enable/disable automation
- Gradual rollout capability (percentage of deals)
- Easy rollback if issues discovered
- Clear documentation for operations

**Acceptance Criteria**:
- Feature can be safely enabled/disabled
- Gradual rollout possible
- Clear rollback procedures documented

---

## Phase 4: Testing & Validation

### Task 4.1: Unit Tests
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: All backend tasks

**Description**: Create comprehensive unit tests for all automation services.

**Requirements**:
- Test accumulation calculations for all scenarios
- Test status mapping logic with various thresholds
- Test CRM API integration with mocks
- Test error handling and edge cases
- 90%+ code coverage

**Acceptance Criteria**:
- All business logic tested
- Error scenarios covered
- Tests pass consistently

---

### Task 4.2: Integration Tests
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 4.1

**Description**: Test end-to-end automation workflow with real services.

**Requirements**:
- Test complete payment linking → accumulation → CRM update flow
- Test with real Pipedrive API (staging environment)
- Test partial payment scenarios and thresholds
- Validate status changes in CRM

**Acceptance Criteria**:
- Full workflow tested in staging
- All threshold scenarios validated
- CRM status changes verified

---

### Task 4.3: Manual Testing Scenarios
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 4.2

**Description**: Create comprehensive manual testing checklist for QA team.

**Requirements**:
- Test cases for all accumulation scenarios
- Edge cases: partial payments, unlinking, concurrent operations
- Status override scenarios
- Performance validation under load

**Acceptance Criteria**:
- Complete testing checklist created
- All spec scenarios covered
- Clear pass/fail criteria defined

---

## Risk Mitigation

**High Risk Items**:
- CRM API failures causing payment processing disruption
- Incorrect status calculations leading to business process issues
- Race conditions in accumulation calculations

**Mitigation Strategies**:
- Comprehensive error isolation and retry logic
- Extensive testing of accumulation logic
- Proper locking mechanisms for concurrent operations
- Gradual rollout with monitoring

## Success Metrics

- 100% of payment accumulations trigger appropriate CRM status updates
- Zero payment processing failures due to CRM integration
- 95% reduction in manual status update operations
- All status mappings validated through comprehensive testing