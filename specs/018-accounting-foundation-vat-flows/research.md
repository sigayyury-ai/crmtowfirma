# Research: Accounting Foundation and Two VAT Flows

**Feature**: 018-accounting-foundation-vat-flows  
**Date**: 2026-02-06

## Existing Data and Flows

### Expense storage

- **Bank expenses**: Table `payments` with `direction = 'out'`, `expense_category_id` (FK to `pnl_expense_categories`). Optional link to product via `payment_product_links` (payment_id + product_id).
- **Manual expense entries**: Table `pnl_manual_entries` with `entry_type = 'expense'`, `expense_category_id`; no product link (manual entries are category-only).
- **Stripe**: Income only in this system; no expense flow.
- **Cash**: `cash_payments` — linked to deal/proforma; can have `product_id`; used in product margin as outgoing when tied to product.
- **Facebook Ads**: `facebook_ads_expenses` — per product; used only in VAT margin product report, excluded from PNL (see specs/018-facebook-ads-expenses/pnl-exclusion.md).

### Expense categories

- **Table**: `pnl_expense_categories` — `id`, `name`, `description`, `management_type` ('auto' | 'manual'), `display_order`, timestamps. No `vat_flow` (or equivalent) today.
- **Usage**: `payments.expense_category_id`, `pnl_manual_entries.expense_category_id`; category mappings in `expense_category_mappings` for auto-categorization from CSV.

### Product-linked expenses (margin-scheme)

- **Table**: `payment_product_links` — `payment_id` (payments.id), `product_id` (product_links.id), `direction` ('in' | 'out'), `linked_by`, `linked_at`.
- **VAT margin report**: `productReportService.loadLinkedPayments(productId)` loads payments linked to that product (incoming + outgoing). Outgoing = expenses that reduce product margin (VAT-marża, Art. 119). These must be treated as **margin-scheme** only; they must never appear in “general / deductible VAT” totals.
- **Rule**: If a payment (direction = 'out') has at least one `payment_product_links` row, it is **product-linked** and must be classified as **margin-scheme** for consistency with the existing product report.

### PNL report (expenses)

- **Source**: `pnlReportService` aggregates expenses from `payments` (direction = 'out') and `pnl_manual_entries` (entry_type = 'expense'), by category and month. Today there is no split by VAT flow.
- **Exclusions**: Expenses with `source = 'facebook_ads'` are excluded from PNL (see pnl-exclusion.md). Same or similar filter will need to consider VAT flow when splitting “margin-scheme” vs “general”.

### API surface

- **Categories**: CRUD for `pnl_expense_categories`; list/filter payments by `expense_category_id` and `direction = 'out'`.
- **Payment**: `PUT /api/payments/:id/expense-category` sets `expense_category_id` for a payment (only when direction = 'out'). No current field for “vat_flow” or override.
- **Reports**: PNL report API returns monthly revenue and expenses by category; VAT margin product report returns per-product revenue and linked expenses. No endpoint yet that returns expenses split by VAT flow.

## Rule for “effective VAT flow”

Recommended order (product link wins over category):

1. **Override** (if implemented): If payment has explicit `vat_flow_override` ('margin_scheme' | 'general'), use it.
2. **Product-linked**: If payment (direction = 'out') has a row in `payment_product_links` for any product → **margin_scheme**.
3. **Category**: If `expense_category_id` is set and category has `vat_flow` → use category’s `vat_flow`.
4. **Default**: Otherwise → **general** (so that unclassified expenses are not counted in product margin and can be reviewed for deductible VAT).

Manual entries (pnl_manual_entries): have only `expense_category_id`; no product link. Effective VAT flow = category’s `vat_flow` or default **general**.

## What must not change

- **Product margin (VAT-marża) report**: Continues to include only expenses that are linked to the product (via payment_product_links or product-scoped cash/Facebook Ads). No change to the formula (margin = paid − expenses). Only ensure no “general”-only expense can leak into this report (they are not product-linked, so they already do not appear).
- **PNL expense totals**: Today one total (or by category). New behavior: same totals can be split by VAT flow for the same period; no change to how totals are computed except filtering/grouping by effective vat_flow when the “split by VAT flow” view is requested.

## Gaps to implement

| Gap | Resolution |
|-----|------------|
| Category has no VAT flow | Add `vat_flow` to `pnl_expense_categories` ('margin_scheme' \| 'general'); migration + API + UI in settings. |
| Payment has no override | Optional: add `vat_flow_override` to `payments` (nullable); API to set/clear; UI in payment detail. |
| No “effective” field on payment | Compute in service layer when returning payment list or report rows (override ?? product_link ?? category ?? default). Optionally cache in DB for performance (computed column or background job). |
| Reports don’t split by VAT flow | Add report (or PNL breakdown) that groups expenses by effective vat_flow; add view/export for “general” only. |
| Reconciliation/postings | When those features exist, they must use the same effective VAT flow (read from same helper/service). |

## База знаний wFirma (VAT и налоги)

При проектировании интерфейсов и флоу работы с НДС и расходами используем терминологию и структуру помощи wFirma, с учётом наших двух потоков НДС и каналов прихода:

- **Документ**: `docs/wfirma-knowledge-base-vat-and-taxes.md`
- **Источники**: [Księgi i rejestry podatkowe](https://pomoc.wfirma.pl/ksiegowosc/ksiegi-i-rejestry-podatkowe), [Podatki i sprawozdawczość](https://pomoc.wfirma.pl/ksiegowosc/podatki-i-sprawozdawczosc)
- Там: маппинг WYDATKI / przychody / płatności, два потока (VAT marża vs zwykły VAT), каналы (bank, Stripe, cash), правила для разработки.

## References

- `specs/011-pnl-report/data-model.md` — PNL data model
- `specs/018-facebook-ads-expenses/pnl-exclusion.md` — Facebook Ads excluded from PNL
- `specs/019-manual-cash-expenses/data-model.md` — Manual expense entries
- `src/services/vatMargin/productReportService.js` — loadLinkedPayments, expense totals per product
- `src/services/pnl/pnlReportService.js` — monthly revenue and expense aggregation
- `docs/api-reference.md` — Payments and expense categories API
