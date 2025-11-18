# Feature Specification: PNL Report Service

**Feature Branch**: `011-pnl-report`  
**Created**: 2025-11-18  
**Status**: Draft  
**Input**: User description: "давай в рамках  это софта сделаем еще один сервис PNL. так как Часть данныз у нас уже есть. Мы можем начать с приходов клиентов по месяца. так как мы обрабатываем оплаты с кемпов. ТО сможем сформировать такой отчет за 2025 год и потом перейдем на 2026 год. Сделай отдельную страницу для такого отчета и пока выведи по месячно приходы от клиентов. в приходах не должно быть возвратов."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Monthly Revenue Report (Priority: P1)

As a business owner or financial manager, I want to view monthly customer revenue (income) for a selected year, so that I can track financial performance over time and make informed business decisions.

**Why this priority**: This is the core functionality - displaying monthly revenue data is the primary purpose of the PNL report service. Without this, the feature has no value.

**Independent Test**: Can be fully tested by navigating to the PNL report page, selecting a year (2025 or 2026), and verifying that monthly revenue totals are displayed correctly, excluding refunds.

**Acceptance Scenarios**:

1. **Given** I am on the PNL report page, **When** I select year 2025, **Then** I see monthly revenue totals for each month of 2025 displayed in a clear table or chart format
2. **Given** I am viewing the 2025 report, **When** I review the data, **Then** all refunded payments are excluded from the revenue totals
3. **Given** I am viewing monthly revenue, **When** payments were made in different currencies, **Then** all amounts are converted to PLN and displayed consistently
4. **Given** I am viewing the report, **When** a month has no payments, **Then** that month shows zero or "—" instead of being hidden
5. **Given** I am on the PNL report page, **When** I select year 2026, **Then** I see monthly revenue totals for 2026, and can switch back to 2025

---

### User Story 2 - Filter and Navigate Between Years (Priority: P2)

As a user, I want to easily switch between viewing reports for different years (2025 and 2026), so that I can compare performance across years and access historical data.

**Why this priority**: Year selection is essential for accessing different time periods. While less critical than displaying data, it's needed for practical use of the feature.

**Independent Test**: Can be tested independently by verifying that year selector works correctly, data loads for selected year, and switching between years updates the display appropriately.

**Acceptance Scenarios**:

1. **Given** I am viewing the 2025 report, **When** I select 2026 from the year selector, **Then** the report updates to show 2026 monthly revenue data
2. **Given** I have selected a year, **When** the report loads, **Then** the selected year is clearly indicated in the UI
3. **Given** I am viewing a report, **When** I switch years, **Then** the data updates without requiring a page refresh

---

### Edge Cases

- What happens when a selected year has no payment data at all?
- How does the system handle months where all payments were refunded (should show zero, not negative)?
- What happens if payment data spans multiple currencies - are they all converted to PLN correctly?
- How are partial refunds handled - is the net amount (original minus refund) shown, or are refunded payments completely excluded?
- What happens if a payment date is missing or invalid - which month should it be assigned to?
- How are payments processed on the last day of a month vs first day of next month handled for monthly grouping?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated page/route for PNL (Profit and Loss) reports accessible from the main navigation
- **FR-002**: System MUST display monthly customer revenue totals for a selected year (starting with 2025 and 2026)
- **FR-003**: System MUST exclude all refunded payments from revenue calculations
- **FR-004**: System MUST convert all revenue amounts to PLN for consistent display, regardless of original payment currency
- **FR-005**: System MUST display revenue data organized by month (January through December) for the selected year
- **FR-006**: System MUST provide a year selector allowing users to choose between available years (2025, 2026)
- **FR-007**: System MUST show zero or "—" for months with no revenue (no payments or all payments refunded)
- **FR-008**: System MUST load payment data from existing payment processing system (ProForm and Stripe payments)
- **FR-009**: System MUST identify and exclude refunds using existing refund tracking mechanisms (deleted proformas, Stripe refunds, etc.)
- **FR-010**: System MUST display monthly totals in a clear, readable format (table, chart, or both)
- **FR-011**: System MUST utilize existing `pnl_data` database table structure for storing and retrieving revenue data
- **FR-012**: System MUST populate `pnl_data` table with monthly revenue entries aggregated from payment data (ProForm and Stripe)
- **FR-013**: System MUST store revenue amounts in PLN in the `amount` field of `pnl_data` table
- **FR-014**: System MUST store month number (1-12) in the `month` field of `pnl_data` table for proper monthly grouping

### Key Entities *(include if feature involves data)*

- **PNL Data Table**: Existing database table (`pnl_data`) with structure:
  - `id`: Unique identifier
  - `amount`: Revenue/expense amount (stored in PLN)
  - `month`: Month number (1-12) for the entry
  - `created_at`: Timestamp when record was created
  - `updated_at`: Timestamp when record was last updated
  - Note: Table currently exists but is empty, will be populated with revenue data from payments
- **Expense Categories Table**: Existing table (`pnl_expense_categories`) with structure:
  - `id`: Unique identifier
  - `name`: Category name (e.g., "Marketing & Advertising", "Travel & Accommodation")
  - `description`: Optional description
  - `is_default`: Boolean flag for default categories
  - `created_at`, `updated_at`: Timestamps
- **Revenue Categories**: Category system for classifying revenue types (structure to be determined - may use similar structure to expense categories or separate table)
- **Monthly Revenue Entry**: Represents revenue for a specific month and year, containing total amount in PLN, original currency breakdowns, and payment count
- **Payment**: Existing entity representing customer payments from camps, linked to proformas or Stripe transactions
- **Refund**: Existing entity representing returned payments, used to exclude amounts from revenue calculations

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view monthly revenue report for any selected year (2025 or 2026) within 3 seconds of page load
- **SC-002**: Report accurately excludes 100% of refunded payments from revenue totals (verified by manual reconciliation)
- **SC-003**: All currency conversions to PLN are accurate within 0.01 PLN tolerance (verified against exchange rates)
- **SC-004**: Report displays all 12 months for selected year, even when some months have zero revenue
- **SC-005**: Users can switch between years without errors or data inconsistencies
- **SC-006**: Report page is accessible and functional on standard web browsers (Chrome, Firefox, Safari, Edge)

## Assumptions

- Payment data is already available in the system from existing ProForm and Stripe payment processing
- Refunds are tracked through existing mechanisms (deleted proformas table, Stripe refund records, etc.)
- Exchange rates for currency conversion are available from existing exchange rate service
- The report will start with 2025 and 2026, with potential to extend to other years in the future
- Monthly revenue is calculated based on payment date (when payment was received), not invoice date
- Partial refunds result in net revenue (original payment minus refund amount) rather than complete exclusion
- The report focuses on customer revenue (income) only, not expenses or other PNL components at this stage
- Existing `pnl_data` database table structure is available with columns: `id`, `amount`, `month`, `created_at`, `updated_at`
- Table `pnl_data` currently exists but is empty and will be populated with aggregated revenue data
- Existing `pnl_expense_categories` table structure is available for expense categorization (not used in initial revenue phase)
- Revenue category system may need to be created or determined based on existing structure
- Month field stores numeric value (1-12) representing the month of the year
- Year information may need to be derived from payment dates or stored separately if needed

## Dependencies

- Existing payment processing system (ProForm and Stripe integrations)
- Existing refund tracking system (deleted proformas, Stripe refunds)
- Existing exchange rate service for currency conversion
- Existing authentication/authorization system for page access
- Database containing payment and refund records
- Existing `pnl_data` database table with structure: `id`, `amount`, `month`, `created_at`, `updated_at`
- Existing `pnl_expense_categories` table (for future expense tracking)
- Revenue category system (structure to be determined - may reuse expense categories structure or create separate table)

## Out of Scope

- Expenses tracking and reporting
- Profit calculations (revenue minus expenses)
- Detailed breakdown by product, customer, or deal
- Export functionality (CSV, PDF) - may be added later
- Comparison between years (side-by-side view)
- Forecasting or projections
- Cash flow reporting
- Tax calculations or VAT reporting
