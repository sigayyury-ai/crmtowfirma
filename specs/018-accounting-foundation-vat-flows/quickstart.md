# Quickstart: Accounting Foundation and Two VAT Flows

**Feature**: 018-accounting-foundation-vat-flows  
**Date**: 2026-02-06

## Goal

Verify that (1) expenses are classified into two VAT flows (margin_scheme / general), (2) reports show a split by VAT flow, and (3) the product margin report still includes only margin-scheme expenses per product.

## Prerequisites

- Backend and frontend running (see project README).
- At least one expense category; several payments with `direction = 'out'` (some with product link, some without).
- Migration applied: `vat_flow` on `pnl_expense_categories`, optional `vat_flow_override` on `payments`.

## Verification Steps

### 1. Category VAT flow

- Open Settings → Категории расходов (or equivalent).
- For one category (e.g. "Офис"), set VAT flow to **general**; for another (if used for product-linked expenses), set to **margin_scheme** or leave as general and rely on product link.
- Save. Reload: confirm the saved value is shown.

### 2. Effective VAT flow on a payment

- Open Платежи (VAT margin / Payments) → исходящие (outgoing).
- Open one expense payment that is **linked to a product** (see payment detail or product report). Confirm it is shown as **margin_scheme** (or "VAT margin / Art. 119").
- Open one expense payment that is **not** linked to a product and has category "Офис". Confirm it is shown as **general** (or "Ordinary VAT").
- If override is implemented: set a payment’s VAT flow override to the other value; confirm reports use the override.

### 3. Report split by VAT flow

- Open the report that shows expenses by VAT flow (e.g. PNL with VAT-flow breakdown or dedicated "Expenses by VAT flow" view).
- Select a period (e.g. current year).
- Confirm two totals or two sections: **margin_scheme** (Art. 119) and **general** (ordinary VAT).
- Confirm that the sum of the two (or sum per category within each) is consistent with the total expenses for the period (no double-count, no missing).

### 4. Product margin report unchanged

- Open VAT margin → Products → choose a product that has linked expenses.
- Confirm "Расходы" (expenses) for that product include only expenses linked to that product (margin-scheme). Do **not** include general-only expenses.
- Compare with previous behavior (if possible): product margin and VAT-marża amount should be unchanged for the same data.

### 5. General-expenses view or export

- Open the view or export for "general (ordinary VAT)" expenses only.
- Select period. Confirm only expenses with effective VAT flow = **general** are listed.
- Spot-check: no payment that is product-linked (and has no override to general) should appear in this list.

## Troubleshooting

- **All expenses show as "general"**: Check migration: categories have `vat_flow`; product-linked payments are detected (payment_product_links). Check rule order: override → product link → category → default.
- **Product margin includes office expenses**: Product report must filter expenses by product link only; it must not use category. Ensure product report does not pull in payments that are not in `payment_product_links` (or product-scoped cash/Facebook Ads) for that product.
- **Override not applied**: Ensure API and UI persist `vat_flow_override` and that report service reads it first when computing effective VAT flow.

## References

- [spec.md](./spec.md) — requirements and user stories
- [plan.md](./plan.md) — implementation phases
- [data-model.md](./data-model.md) — effective VAT flow rule
- [research.md](./research.md) — existing tables and services
