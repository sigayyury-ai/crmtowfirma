# Feature Specification: Accounting Foundation and Two VAT Flows

**Feature Branch**: `018-accounting-foundation-vat-flows`  
**Created**: 2026-02-06  
**Status**: Draft  
**Input**: User description: "Создай спецификацию для реализации недостающих моментов. И отдельного раздела бухгалтерия с приоритизацией по важности сначала фундамент и данные а потом все остальное. Нам надо разделять два потока."

## Контекст (из ресерча)

Система уже хранит движения денег (банк, Stripe, наличные), категории доходов/расходов, привязку к проформам и продуктам. Для турфирмы критично разделять два потока НДС:

1. **VAT-marża (art. 119)** — туризм: НДС считается с маржи по продукту; в расчёт маржи входят только расходы, привязанные к продукту/кемпу. Реализовано в отчёте по продуктам.
2. **Обычный VAT** — общие расходы (офис, бухгалтерия, IT, маркетинг и т.д.): входной НДС может быть принят к вычету; данные есть (категории, direction), но в системе нет явного разделения потоков и отчёта по вычитаемому НДС.

Приоритет: сначала **фундамент и данные** (разделение потоков, классификация), затем отчёты и сверки.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Classify Expenses by VAT Flow (Priority: P1)

As a finance user, I want every expense (bank, manual, or other) to be clearly classified as either "margin-scheme" (reduces tourism margin, Art. 119) or "general" (ordinary VAT, deductible), so that the system can consistently use this split in reports and future accounting logic.

**Why this priority**: Without a clear classification in data, the two VAT flows cannot be separated in reports or used for reconciliations and postings.

**Independent Test**: Can be tested by assigning a VAT-flow type to expense categories or to individual payments, then verifying that the classification is stored and can be filtered/exported.

**Acceptance Scenarios**:

1. **Given** an expense category (e.g. "Офис", "Маркетинг"), **When** I set its VAT flow to "general", **Then** all expenses in that category are treated as ordinary-VAT (deductible) and do not reduce product margin.
2. **Given** an expense linked to a product (e.g. via payment_product_links), **When** the expense is used in the product margin report, **Then** it is treated as margin-scheme (Art. 119) and excluded from general deductible-VAT reporting.
3. **Given** a new or existing expense payment, **When** I view or edit it, **Then** I can see (and where applicable set) which VAT flow it belongs to.
4. **Given** expenses already in the system without a VAT-flow flag, **When** the feature is first deployed, **Then** there is a defined rule (e.g. "product-linked = margin-scheme, else from category" or default) so that existing data is consistently classified.

---

### User Story 2 - View Reports Split by Two VAT Flows (Priority: P2)

As a finance user, I want reports (e.g. P&L, expense summary) to distinguish between margin-scheme expenses (Art. 119) and general expenses (ordinary VAT), so that I can prepare VAT returns and reconcile with wFirma without mixing the two flows.

**Why this priority**: Once data is classified, the next step is to expose this in reports; this delivers immediate value for VAT and management reporting.

**Independent Test**: Can be tested by opening the relevant report, selecting a period, and verifying that totals or breakdowns are shown separately for "VAT margin (tourism)" and "General expenses (ordinary VAT)" (or equivalent labels).

**Acceptance Scenarios**:

1. **Given** I am on the P&L or expense report, **When** I choose a date range, **Then** I see totals (or breakdown) for margin-scheme expenses and for general expenses.
2. **Given** I am viewing the product margin report (VAT-marża), **When** I look at expenses per product, **Then** only margin-scheme expenses for that product are included; general expenses are not.
3. **Given** I need a summary of general expenses for deductible VAT, **When** I open the dedicated view or export, **Then** I see only expenses classified as "general" (ordinary VAT), with amounts and categories suitable for reconciliation with wFirma or tax reporting.

---

### User Story 3 - Use Classified Data for Reconciliations and Future Postings (Priority: P3)

As a finance user, I want the system to use the same VAT-flow classification when building reconciliation views (e.g. bank vs ledger) or when generating posting suggestions (debit/credit), so that margin-scheme and ordinary-VAT transactions are never mixed in one flow.

**Why this priority**: Reconciliations and postings build on the foundation; they depend on classification being correct and consistent.

**Independent Test**: Can be tested by running a reconciliation or a "posting preview" (if implemented) and verifying that margin-scheme and general expenses appear in the correct buckets and that no general expense is counted in product margin and vice versa.

**Acceptance Scenarios**:

1. **Given** a list of bank payments for a period, **When** I run a reconciliation view, **Then** each expense is tagged with its VAT flow so I can filter or subtotal by "margin" vs "general".
2. **Given** the system generates suggested postings (e.g. for export to wFirma or internal ledger), **When** rules are applied, **Then** margin-scheme expenses produce postings for the margin/VAT-marża flow and general expenses produce postings for the ordinary-VAT (deductible) flow, with no cross-mixing.
3. **Given** an expense that was misclassified, **When** I correct its VAT flow, **Then** all reports and reconciliation views that use this classification update accordingly for that expense.

---

### Edge Cases

- Expense has no category and is not linked to a product: system MUST apply a defined default (e.g. "general" or "unclassified" with a clear indicator) and allow user to correct.
- Expense is linked to a product but category is "office" or "marketing": business rule MUST define whether product link wins (margin-scheme) or category wins (general); rule MUST be documented and applied consistently.
- Historical data before the feature: migration or default rule MUST assign a VAT flow so that past periods can be reported without gaps; optional "unclassified" flag for manual review.
- Category is reclassified from "general" to "margin-scheme" (or vice versa): all expenses in that category MUST be treated by the new rule from a chosen cut-off date, or per-expense override MUST be supported and visible.

---

## Requirements *(mandatory)*

### Раздел: Бухгалтерия — приоритизация

Требования сгруппированы по приоритету: сначала **фундамент и данные**, затем **отчёты и использование данных**.

---

### Фундамент и данные (приоритет 1)

- **FR-001**: System MUST support a clear classification of each expense into exactly one of: "margin-scheme" (VAT-marża, Art. 119, tourism) or "general" (ordinary VAT, deductible). Classification MAY be derived from category, product link, or explicit override.
- **FR-002**: System MUST persist the effective VAT-flow type for each expense (or the inputs from which it is derived) so that reports and future features can use it without recomputing business rules each time.
- **FR-003**: System MUST define and document the rule set that determines VAT flow (e.g. "if payment linked to product → margin-scheme; else if category type = general → general; else default"). Default for unclassified MUST be defined.
- **FR-004**: Expense categories MUST support an attribute or type indicating whether the category is "margin-scheme" or "general" (ordinary VAT), so that new expenses can be auto-classified by category when not linked to a product.
- **FR-005**: Where an expense is linked to a product (e.g. via payment_product_links), the system MUST treat it as margin-scheme for product margin and VAT-marża reporting, and MUST NOT include it in "general / deductible VAT" totals.
- **FR-006**: System MUST allow correction of VAT-flow classification for individual expenses (override) when the default rule is wrong; override MUST be stored and used in all reports and reconciliations.

---

### Отчёты и использование данных (приоритет 2)

- **FR-007**: System MUST provide at least one report or view that shows expense totals (or breakdown) split by VAT flow: "margin-scheme (Art. 119)" and "general (ordinary VAT)" for a selected period. Разделы и подписи отчётов по налогам — по базе знаний wFirma: см. `docs/wfirma-knowledge-base-vat-and-taxes.md`, раздел «Разделы отчётов по налогам» (Wydatki — VAT marża / Wydatki ogólne / Podział wydatków).
- **FR-008**: The existing product margin report (VAT-marża) MUST continue to include only margin-scheme expenses per product; it MUST NOT include general expenses. В UI использовать название, согласованное с wFirma (np. Marża / VAT marża (produkt)), см. базу знаний.
- **FR-009**: System MUST provide a view or export of "general" (ordinary VAT) expenses suitable for reconciliation with wFirma or tax reporting (amounts, categories, dates). Поля экспорта: data (operation_date), kwota (amount_pln), kontrahent (payer_name), kategoria, źródło (bank/Stripe/cash/ręczny) — для сверки z WYDATKI i JPK V7 / deklaracją VAT; детали в `docs/wfirma-knowledge-base-vat-and-taxes.md`, раздел «Разделы отчётов по налогам».

---

### Сверки и проводки (приоритет 3)

- **FR-010**: When reconciliation views or payment lists are shown, system MUST expose the VAT-flow classification for each expense so that users can filter or subtotal by flow.
- **FR-011**: If the system generates or suggests postings (debit/credit), it MUST use the same VAT-flow classification so that margin-scheme and general expenses are never mixed in one accounting flow; margin-scheme expenses MUST map to margin/VAT-marża logic, general expenses to ordinary deductible-VAT logic.

---

### Key Entities

- **Expense (payment or manual entry)**: Represents an outflow; must have an effective VAT-flow type: "margin-scheme" or "general". May be determined by product link, category type, or explicit override.
- **Expense category**: Has a type or attribute indicating VAT flow ("margin-scheme" or "general") for default classification when expense is not product-linked.
- **Product-linked expense**: Expense associated with a product (e.g. via payment_product_links or product_id); always treated as margin-scheme for product margin and VAT-marża; never in general deductible-VAT totals.
- **VAT-flow classification rule**: The documented set of rules (product link, category, default) that assigns each expense to one of the two flows; must be consistent across reports and future postings.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every expense in the system can be unambiguously classified as margin-scheme or general; classification is stored and can be filtered/exported (verifiable by running a filter and checking counts).
- **SC-002**: Finance user can open a report for a selected period and see separate totals (or clear breakdown) for margin-scheme expenses and general expenses within one minute.
- **SC-003**: Product margin (VAT-marża) report shows no change in logic for product-linked expenses; general expenses do not appear in product margin totals (verifiable by comparing before/after for a sample product).
- **SC-004**: A dedicated view or export for "general (ordinary VAT)" expenses exists and includes only expenses classified as general, with amounts and categories usable for reconciliation or tax preparation.
- **SC-005**: When reconciliation or posting logic is implemented, margin-scheme and general expenses are never mixed in the same flow; correctness is verifiable by spot-checking sample expenses in both flows.

---

## Assumptions

- The existing product margin report and VAT-marża logic remain the single source of truth for "margin-scheme" expenses per product; this feature adds explicit classification and separates "general" expenses rather than changing margin math.
- wFirma remains the system of record for official VAT and accounting; this feature supports correct split of data and reports for reconciliation and internal management.
- Expense categories already exist (pnl_expense_categories); the feature extends them with a VAT-flow type or equivalent; existing expenses receive classification via migration or default rule.
- "General" expenses include (but are not limited to) office, accounting, IT, marketing; the exact list is defined by category configuration, not hardcoded.

---

## Dependencies

- Existing tables: payments, stripe_payments, cash_payments, pnl_manual_entries, pnl_expense_categories, payment_product_links, product_links.
- Existing reports: PNL report, VAT margin product report, expense category lists and mappings.
- Optional: future reconciliation and posting features will consume the same VAT-flow classification.

---

## Out of Scope (for this spec)

- Full double-entry bookkeeping, chart of accounts, or balance sheet in this system.
- Automatic calculation of deductible input VAT amount from invoice data (only classification of expenses into the "general" flow; VAT amount can be added later).
- Changes to wFirma API or integration beyond what is needed to export or reconcile using the new classification.
