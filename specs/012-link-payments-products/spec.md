# Feature Specification: Linking Payments to Products

**Feature Branch**: `012-link-payments-products`
**Created**: 2025-11-27
**Status**: Draft
**Input**: User description: "хочу привязывать платежи к конкретному продукты, чтобы готовать отчеты ват маржа. Во входящих и исходящих платежах. Должна быть возможностьлинковать их с продуктами. В ручном режиме. У нас есть отчет по продуктам, вот к продуктам в нем и должны линковаться такие траты и приходы. Выводить нужно только продукты с активным статусом - В процессе. Остальные выводить не надо. Наверно линковака будет при поощи отельного выпадающего списка. При обработке платежей. Добавить еще одно поле. Нужно иметь возможность добавлять линковку но и также ее удалять если будет совершено ошибочное добавление. Зная расходы по продукту. их можно вывести в сводку. Одной цифрой а также . Вывести список всех прилинкованных платажей ниже списка с проформами и страйп платежами."

**Integration Note**: Payment-to-product linking functionality must be integrated into existing payment processing interfaces (VAT Margin Tracker for incoming payments and Expenses for outgoing payments), without creating separate pages or UI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Link Payments to Products for VAT Margin Reports (Priority: P1)

As a financial analyst, I want to manually link incoming and outgoing payments to specific products directly in existing payment processing interfaces (VAT Margin Tracker for incoming payments and Expenses for expenses), to prepare accurate VAT margin reports showing expenses and income per product.

**Why this priority**: This is the core functionality needed to generate proper VAT margin reports by product, which is critical for financial reporting and compliance.

**Independent Test**: Can be fully tested by linking payments to products and verifying they appear in the product report summary.

**Acceptance Scenarios**:

1. **Given** that I'm processing incoming payments in VAT Margin Tracker, **When** I select a product from the dropdown for a specific payment, **Then** the payment gets linked to that product
2. **Given** that I'm processing expenses in the Expenses interface, **When** I select a product from the dropdown for a specific expense, **Then** the payment gets linked to that product
3. **Given** that a payment is already linked to a product, **When** I unlink it in the existing payment processing interface, **Then** the payment no longer appears in that product's summary

---

### User Story 2 - View Linked Payments and Profitability in Product Report (Priority: P2)

As a financial analyst, I want to see all linked payments below the proforma and Stripe payment lists in the product report, as well as the product profitability (income minus expenses), to have a complete view of each product's financial performance.

**Why this priority**: Provides comprehensive visibility into all payments and financial performance associated with each product for better financial analysis and decision making.

**Independent Test**: Can be fully tested by viewing the product report and confirming that linked payments and profitability calculation are displayed correctly.

**Acceptance Scenarios**:

1. **Given** that payments are linked to products, **When** I view a product report, **Then** linked payments appear below the proforma and Stripe payment lists
2. **Given** that a product has income and expenses, **When** I view the product report, **Then** profitability is displayed as (income - expenses) with amount and percentage shown
3. **Given** that a product has multiple linked payments, **When** I view the product report, **Then** all linked payments are shown with their amounts and details

---

### User Story 3 - Filter Active Products Only (Priority: P3)

As a financial analyst, I want to see only products with "In Progress" status in the payment linking dropdown, so I don't accidentally link payments to completed or cancelled products.

**Why this priority**: Prevents errors and maintains data integrity by ensuring payments are only linked to relevant active products.

**Independent Test**: Can be fully tested by checking that the product dropdown only shows products with "In Progress" status.

**Acceptance Scenarios**:

1. **Given** that products exist with different statuses, **When** I open the product linking dropdown, **Then** only products with "In Progress" status are available for selection

---

### Edge Cases

- What happens when a product status changes from "In Progress" to completed after payments are linked?
- How does the system handle payments linked to products that get deleted?
- What happens if the same payment gets accidentally linked to multiple products?
- How are currency conversions handled for payments linked to products in different currencies?
- How to synchronize payment links between VAT Margin Tracker and Expenses interfaces?
- What happens if a payment is linked to a product in one interface and then processed in another?

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001**: System MUST allow manual linking of incoming and outgoing payments to specific products
- **FR-002**: System MUST provide a dropdown list showing only products with "In Progress" status for payment linking
- **FR-003**: System MUST allow unlinking payments from products if incorrect links are made
- **FR-004**: System MUST display linked payments in the product report below proforma and Stripe payment lists
- **FR-005**: System MUST show payment expenses per product as a single summary figure in the product report
- **FR-006**: System MUST include both income and expense payments in the product linking functionality
- **FR-007**: System MUST maintain data integrity when product statuses change or products are deleted
- **FR-008**: System MUST NOT require mandatory linking of payments to products - payments without links are considered general expenses and require no additional processing
- **FR-009**: System MUST calculate and display product profitability as (income - expenses) with absolute amount and percentage shown
- **FR-010**: System MUST integrate payment-to-product linking functionality into existing interfaces: product dropdown in VAT Margin Tracker for incoming payments and in Expenses for outgoing payments

### Key Entities *(include if feature involves data)*

- **Payment**: Represents incoming or outgoing financial transactions that can be linked to products
- **Product**: Represents business products that have associated financial transactions
- **Payment-Product Link**: Represents the relationship between a payment and a product for reporting purposes

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001**: Financial analysts can link payments to products in under 30 seconds per payment
- **SC-002**: 100% of payments linked to products appear correctly in VAT margin reports
- **SC-003**: Product reports show accurate expense summaries within 5 seconds of loading
- **SC-004**: Zero incorrect payment links remain in the system after manual review
- **SC-005**: 95% of financial analysts successfully complete payment linking tasks on first attempt
