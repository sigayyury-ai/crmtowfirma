# Development Tasks: Linking Payments to Products

**Feature**: `012-link-payments-products` | **Date**: 2025-11-27
**Priority Order**: P1 (Core linking) → P2 (Reporting) → P3 (Polish)

---

## Phase 1: Database & Backend (Foundation)

### Task 1.1: Database Schema - Payment-Product Links
**Priority**: P1 | **Estimate**: 2 hours | **Dependencies**: None

**Description**: Create database table and migration for payment-product link relationships.

**Requirements**:
- `payment_product_links` table with columns: id, payment_id, product_id, created_at, created_by
- Foreign key constraints to payments and products tables
- Index on payment_id and product_id for performance
- Migration script in `scripts/migrations/`

**Acceptance Criteria**:
- Migration can be applied without errors
- Table exists with correct schema
- Relationships work correctly

---

### Task 1.2: Backend Service - Link Management
**Priority**: P1 | **Estimate**: 4 hours | **Dependencies**: Task 1.1

**Description**: Create service for managing payment-product links (CRUD operations).

**Requirements**:
- `paymentProductLinkService.js` with methods:
  - `linkPaymentToProduct(paymentId, productId, userId)`
  - `unlinkPaymentFromProduct(paymentId, productId)`
  - `getLinkedPaymentsForProduct(productId)`
  - `getLinkedProductsForPayment(paymentId)`
- Validation: prevent duplicate links, check product status
- Error handling for invalid operations

**Acceptance Criteria**:
- All CRUD operations work correctly
- Proper validation and error messages
- Unit tests pass

---

### Task 1.3: API Endpoints - Link Operations
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 1.2

**Description**: Create REST API endpoints for payment-product linking operations.

**Requirements**:
- `POST /api/payment-product-links` - create link
- `DELETE /api/payment-product-links/:paymentId/:productId` - remove link
- `GET /api/payment-product-links/product/:productId` - get links for product
- Input validation and authentication
- Integration with existing payment API routes

**Acceptance Criteria**:
- Endpoints respond correctly to valid requests
- Proper HTTP status codes and error responses
- API documentation updated

---

## Phase 2: Frontend Integration - VAT Margin Tracker

### Task 2.1: VAT Margin UI - Add Product Dropdown
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 1.3

**Description**: Add product selection dropdown to incoming payments table in VAT Margin Tracker.

**Requirements**:
- Modify `vat-margin.html` payments tab to include product dropdown column
- Dropdown shows only products with "In Progress" status
- AJAX calls to API for linking/unlinking payments
- Visual feedback for successful operations

**Acceptance Criteria**:
- Dropdown appears in payments table
- Only active products shown in dropdown
- Link/unlink operations work without page refresh

---

### Task 2.2: Expenses UI - Add Product Dropdown
**Priority**: P1 | **Estimate**: 3 hours | **Dependencies**: Task 1.3

**Description**: Add product selection dropdown to expenses table in Expenses interface.

**Requirements**:
- Modify `expenses.html` to include product dropdown column
- Same functionality as VAT Margin Tracker
- Consistent UI/UX across both interfaces

**Acceptance Criteria**:
- Dropdown integrated into existing expenses table
- Link/unlink operations work correctly
- UI consistent with VAT Margin Tracker

---

## Phase 3: Reporting & Analytics

### Task 3.1: Product Report - Linked Payments Display
**Priority**: P2 | **Estimate**: 4 hours | **Dependencies**: Task 1.2

**Description**: Update product report to show linked payments below existing lists with payment count.

**Requirements**:
- Modify `vat-margin-product.html` to display linked payments section
- Show payments below proforma and Stripe payment lists
- Display payment count for understanding accumulation
- Group by payment type (income/expense)
- Include payment amounts and dates

**Acceptance Criteria**:
- Linked payments appear in correct section of product report
- Payment count is displayed for accumulation understanding
- Payments are properly categorized and formatted
- Report loads within performance requirements

---

### Task 3.2: Profitability Calculation
**Priority**: P2 | **Estimate**: 3 hours | **Dependencies**: Task 3.1

**Description**: Implement profitability calculation and display in product reports.

**Requirements**:
- Calculate: (income - expenses) = profitability
- Display absolute amount and percentage
- Handle currency conversions if needed
- Update summary section of product reports

**Acceptance Criteria**:
- Profitability calculated correctly for all products
- Both amount and percentage displayed
- Calculations update when payments are linked/unlinked

---

### Task 3.3: Expense Summary Aggregation
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 3.1

**Description**: Show single expense summary figure in product reports.

**Requirements**:
- Aggregate all linked expenses for each product
- Display as single summary figure
- Update when links change

**Acceptance Criteria**:
- Expense summary shows correct total
- Updates dynamically with link changes
- Consistent with existing report formatting

---

## Phase 4: Data Integrity & Edge Cases

### Task 4.1: Status Change Handling
**Priority**: P2 | **Estimate**: 2 hours | **Dependencies**: Task 1.2

**Description**: Handle product status changes and maintain data integrity.

**Requirements**:
- When product status changes from "In Progress" to completed:
  - Remove from dropdown lists
  - Keep existing links for reporting
- Handle product deletion gracefully
- Update UI to reflect status changes

**Acceptance Criteria**:
- No orphaned links after status changes
- UI updates correctly when products change status
- Historical reporting still works

---

### Task 4.2: Cross-Interface Synchronization
**Priority**: P3 | **Estimate**: 3 hours | **Dependencies**: Task 2.1, Task 2.2

**Description**: Ensure payment links are synchronized between VAT Margin Tracker and Expenses interfaces.

**Requirements**:
- Links created in one interface visible in others
- Real-time updates across interfaces
- Handle conflicts if same payment linked in multiple places

**Acceptance Criteria**:
- Links consistent across all interfaces
- No duplicate or conflicting links
- Changes propagate correctly

---

### Task 4.3: Validation & Error Handling
**Priority**: P3 | **Estimate**: 2 hours | **Dependencies**: All previous

**Description**: Add comprehensive validation and error handling.

**Requirements**:
- Prevent linking to inactive products
- Handle API errors gracefully
- Validate payment and product existence
- User-friendly error messages

**Acceptance Criteria**:
- All invalid operations prevented
- Clear error messages for users
- System remains stable under error conditions

---

## Phase 5: Testing & Documentation

### Task 5.1: Unit Tests
**Priority**: P3 | **Estimate**: 4 hours | **Dependencies**: All backend tasks

**Description**: Create comprehensive unit tests for backend services.

**Requirements**:
- Test all service methods
- Test validation logic
- Test error conditions
- Mock database operations

**Acceptance Criteria**:
- 90%+ code coverage
- All critical paths tested
- Tests pass consistently

---

### Task 5.2: Integration Tests
**Priority**: P3 | **Estimate**: 3 hours | **Dependencies**: Task 5.1

**Description**: Test end-to-end functionality across frontend and backend.

**Requirements**:
- Test complete link/unlink workflows
- Test reporting with linked payments
- Test cross-interface synchronization

**Acceptance Criteria**:
- Full workflows tested
- Integration issues identified and fixed
- Performance meets requirements

---

### Task 5.3: User Acceptance Testing
**Priority**: P3 | **Estimate**: 2 hours | **Dependencies**: All tasks

**Description**: Manual testing against acceptance criteria from spec.

**Requirements**:
- Test all user stories
- Verify performance requirements
- Test edge cases

**Acceptance Criteria**:
- All acceptance criteria from spec met
- Feature ready for production use
- Documentation updated

---

## Risk Mitigation

**High Risk Items**:
- Database migration compatibility with existing data
- UI integration without breaking existing functionality
- Performance impact on existing reports

**Mitigation Strategies**:
- Test migrations on staging environment first
- Incremental UI changes with feature flags
- Performance monitoring and optimization

## Success Metrics

- All acceptance criteria from spec met
- No regression in existing functionality
- Performance requirements satisfied
- User testing successful
