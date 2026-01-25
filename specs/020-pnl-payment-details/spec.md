# Feature Specification: PNL Payment Details View

**Feature Branch**: `020-pnl-payment-details`  
**Created**: 2025-01-27  
**Status**: Draft  
**Input**: User description: "хочу в pnl отчете видеть платежи привязанные к каетгории   и к месяцу  по нажатию на ячейку месяца для всех категорий за исключением мануальных так как там там по нажатию срабатывает друга логика. Задача просто увидеть список платежей. и иметь возможность отвязать его если он попал случайно в категорию , он должен будет вернутсья обратнов. категорию без категории"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Payments for Category and Month (Priority: P1)

As a financial manager, I want to see a list of all payments assigned to a specific revenue category for a specific month when I click on the month cell in the PNL report, so that I can verify which payments contribute to that category's revenue and audit the categorization.

**Why this priority**: This is the core functionality - viewing payment details is the primary purpose of this feature. Without this, users cannot verify payment assignments or identify mis-categorized payments.

**Independent Test**: Can be fully tested by navigating to the PNL report, clicking on a month cell for any auto-managed revenue category, and verifying that a modal or panel displays all payments assigned to that category for that month with payment details (amount, date, payer, etc.).

**Acceptance Scenarios**:

1. **Given** I am viewing the PNL report for a selected year, **When** I click on a month cell for an auto-managed revenue category that has payments, **Then** I see a modal or panel displaying a list of all payments assigned to that category for that month
2. **Given** I am viewing the PNL report, **When** I click on a month cell for an auto-managed revenue category that has no payments, **Then** I see an empty list or message indicating no payments are assigned
3. **Given** I am viewing the PNL report, **When** I click on a month cell for a manual-managed revenue category, **Then** the existing manual entry editing flow is triggered (no change to current behavior)
4. **Given** I am viewing payment details for a category and month, **When** the list displays, **Then** I can see payment information including payment amount, date, payer name, payment source (bank payment or Stripe), and any other relevant payment details
5. **Given** I am viewing payment details, **When** payments are from multiple sources (bank payments and Stripe payments), **Then** all payments are displayed together in a unified list sorted by date

---

### User Story 2 - Unlink Payment from Category (Priority: P2)

As a financial manager, I want to unlink a payment from a category if it was accidentally assigned to the wrong category, so that I can correct categorization errors and ensure accurate financial reporting.

**Why this priority**: This is essential for data quality - users need to correct mistakes when payments are mis-categorized. Without this, users cannot fix categorization errors.

**Independent Test**: Can be tested independently by viewing payment details for a category and month, clicking an unlink action for a specific payment, confirming the action, and verifying that the payment's category assignment is removed (set to NULL) and the payment appears in the "Uncategorized" category.

**Acceptance Scenarios**:

1. **Given** I am viewing the list of payments for a category and month, **When** I click an unlink action for a specific payment, **Then** I am prompted to confirm the action before unlinking
2. **Given** I have confirmed unlinking a payment, **When** the unlink action completes, **Then** the payment's category assignment is removed (income_category_id set to NULL) and the payment disappears from the current category's list
3. **Given** I have unlinked a payment from a category, **When** I view the PNL report again, **Then** the payment appears under the "Uncategorized" category instead of the previous category
4. **Given** I am viewing payment details, **When** I unlink a payment, **Then** the payment list updates immediately to reflect the change without requiring a full page refresh
5. **Given** I have unlinked a payment, **When** the report recalculates totals, **Then** the category's monthly total decreases by the unlinked payment's amount and the "Uncategorized" category's total increases accordingly

---

### Edge Cases

- What happens when a payment is unlinked while another user is viewing the same payment list?
- How does the system handle unlinking a payment that was just linked moments ago?
- What happens if a payment's category is deleted while viewing payment details (should payment automatically become uncategorized)?
- How are payments displayed when they have missing or invalid data (null dates, null amounts)?
- What happens when clicking on a month cell for a category that has both manual entries and linked payments (should only show payments for auto categories)?
- How does the system handle payments with the same amount and date - are they distinguishable in the list?
- What happens when a payment is unlinked but the API call fails - should the UI show an error or retry?
- How are refunded payments handled - should they appear in the payment list or be excluded?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a list of payments when a user clicks on a month cell for an auto-managed revenue category in the PNL report
- **FR-002**: System MUST distinguish between auto-managed and manual-managed categories and only show payment lists for auto-managed categories
- **FR-003**: System MUST include payments from both `payments` table and `stripe_payments` table in the payment list
- **FR-004**: System MUST filter payments by category (using `income_category_id`) and by month (based on payment date) when displaying the list
- **FR-005**: System MUST display payment details including payment amount, payment date, payer information, payment source (bank or Stripe), and payment ID
- **FR-006**: System MUST provide an unlink action for each payment in the list that allows users to remove the payment's category assignment
- **FR-007**: System MUST require user confirmation before unlinking a payment from a category
- **FR-008**: System MUST set `income_category_id` to NULL in the payment record when a payment is unlinked
- **FR-009**: System MUST update both `payments` and `stripe_payments` tables when unlinking payments (depending on payment source)
- **FR-010**: System MUST refresh the payment list immediately after unlinking a payment to reflect the change
- **FR-011**: System MUST preserve existing behavior for manual-managed categories (clicking month cells opens manual entry editing, not payment list)
- **FR-012**: System MUST handle the "Uncategorized" category (payments with NULL `income_category_id`) and allow viewing payments in this category
- **FR-013**: System MUST sort payments in the list by date (most recent first or oldest first) for easy review
- **FR-014**: System MUST display appropriate error messages if payment list cannot be loaded or if unlink operation fails
- **FR-015**: System MUST update PNL report totals after unlinking a payment to reflect the change in category assignments

### Key Entities *(include if feature involves data)*

- **Payment**: Represents a bank payment from the `payments` table with fields including `id`, `income_category_id`, `amount`, `date`, `payer_name`, and other payment details. Payments can be linked to revenue categories via `income_category_id` field (nullable).
- **Stripe Payment**: Represents a Stripe payment from the `stripe_payments` table with fields including `id`, `income_category_id`, `amount`, `date`, `payer_email`, and other payment details. Stripe payments can be linked to revenue categories via `income_category_id` field (nullable).
- **Revenue Category**: Represents a revenue category from `pnl_revenue_categories` table with fields including `id`, `name`, `management_type` ('auto' or 'manual'). Categories with `management_type = 'auto'` show payment lists when month cells are clicked, while categories with `management_type = 'manual'` use manual entry editing.
- **Uncategorized Payments**: Virtual category representing payments where `income_category_id IS NULL` in either `payments` or `stripe_payments` tables. These payments can be viewed and assigned to categories later.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view payment details for any auto-managed category and month within 2 seconds of clicking the month cell
- **SC-002**: Payment list displays all payments assigned to the selected category and month with 100% accuracy (no missing payments, no incorrect payments)
- **SC-003**: Users can successfully unlink a payment from a category within 3 seconds of confirming the action
- **SC-004**: After unlinking, payment correctly appears in "Uncategorized" category in 100% of cases (verified by checking database and report display)
- **SC-005**: PNL report totals update correctly after unlinking payments, with category totals decreasing and uncategorized totals increasing by the exact unlinked payment amounts
- **SC-006**: Manual-managed categories continue to function correctly with existing manual entry editing flow (no regression in existing functionality)
- **SC-007**: Payment list displays correctly for categories with up to 100 payments per month without performance degradation
- **SC-008**: Unlink operation succeeds in 99% of attempts (allowing for network errors or concurrent modification scenarios)

## Assumptions

- Payment dates are stored in a format that allows accurate filtering by year and month
- Both `payments` and `stripe_payments` tables have `income_category_id` fields that can be set to NULL
- Categories have `management_type` field that distinguishes between 'auto' and 'manual' categories
- Manual categories already have existing click handlers that should not be modified
- Payment list modal or panel can be implemented as an overlay or side panel
- Users understand that unlinking a payment moves it to "Uncategorized" category
- Payment amounts are stored in a consistent currency format (PLN) or can be converted for display
- Payment dates are stored in a timezone-aware format or can be normalized for month filtering
- The system can handle concurrent unlink operations without data corruption
- Payment list should show a reasonable number of payments (pagination may be needed for large lists)

## Dependencies

- Existing PNL report page and month cell rendering
- Existing revenue categories system (`pnl_revenue_categories` table)
- Existing payment tables (`payments` and `stripe_payments` with `income_category_id` fields)
- Existing category management type system (`management_type` field in categories)
- Existing manual entry editing flow for manual categories (must not be disrupted)
- API endpoints for fetching payments by category and month
- API endpoints for unlinking payments (setting `income_category_id` to NULL)

## Out of Scope

- Linking payments to categories (assigning payments to categories) - this feature only supports viewing and unlinking
- Editing payment details (amount, date, payer) - only category assignment can be changed
- Bulk unlinking operations (unlinking multiple payments at once)
- Payment search or filtering within the payment list (beyond category and month filtering)
- Payment export functionality from the payment list view
- Payment detail drill-down (viewing full payment record with all fields)
- Re-linking unlinked payments to different categories (only unlinking to uncategorized is supported)
- Automatic payment categorization or suggestions
- Payment history or audit trail for category changes
