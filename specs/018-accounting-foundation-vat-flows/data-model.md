# Data Model: Accounting Foundation and Two VAT Flows

**Feature**: 018-accounting-foundation-vat-flows  
**Date**: 2026-02-06

## Overview

This document describes the data changes needed to support two VAT flows: **margin_scheme** (VAT-marża, Art. 119) and **general** (ordinary VAT, deductible). The model adds a VAT-flow attribute to expense categories and an optional override on payments; the **effective** VAT flow for each expense is derived by a fixed rule.

## Entities and Attributes

### 1. Expense category (extended)

**Table**: `pnl_expense_categories` (existing)

**New attribute**:

| Attribute   | Type    | Constraints                    | Description |
|------------|---------|--------------------------------|-------------|
| `vat_flow` | VARCHAR | 'margin_scheme' \| 'general'   | Default VAT flow for expenses in this category when they are not product-linked. Default for existing rows: **general**. |

- **Default**: New categories get `vat_flow = 'general'` unless set otherwise. Existing categories: set to `'general'` by migration.
- **Usage**: When computing effective VAT flow for a payment, if the payment is not product-linked and has `expense_category_id`, use `pnl_expense_categories.vat_flow`; if category has no `vat_flow` (legacy), treat as `'general'`.

### 2. Payment (optional override)

**Table**: `payments` (existing)

**New attribute (optional)**:

| Attribute           | Type    | Constraints                  | Description |
|--------------------|---------|------------------------------|-------------|
| `vat_flow_override`| VARCHAR | NULL \| 'margin_scheme' \| 'general' | If set, overrides derived VAT flow for this payment. NULL = use rule. |

- **Nullable**: Yes. NULL means “use rule” (product link → category → default).
- **Usage**: Only meaningful for `direction = 'out'`. When present, effective VAT flow = `vat_flow_override`; when NULL, effective VAT flow = derived (see below).

### 3. Manual expense entry

**Table**: `pnl_manual_entries` (existing), `entry_type = 'expense'`

- No new column. Manual entries have only `expense_category_id`. **Effective VAT flow** = category’s `vat_flow` or **general** if category has no `vat_flow`.

### 4. Effective VAT flow (derived)

**Not a table.** Computed per expense (payment or manual entry) by the following rule:

1. **Override**: If payment has `vat_flow_override` NOT NULL → use it.
2. **Product-linked**: If payment is `direction = 'out'` and has at least one row in `payment_product_links` → **margin_scheme**.
3. **Category**: If expense has `expense_category_id` and category has `vat_flow` → use category’s `vat_flow`.
4. **Default**: → **general**.

For **manual entries**: effective VAT flow = category’s `vat_flow` or **general**.

## State Transitions

- **Category**: `vat_flow` can be changed at any time. Existing expenses are not backfilled; their effective flow is recomputed when read (override ?? product link ?? category ?? default). So changing a category’s `vat_flow` immediately affects all expenses in that category that have no override and are not product-linked.
- **Payment override**: User sets or clears `vat_flow_override`; effective flow for that payment updates immediately in all reports.

## Indexes / Queries

- **Reports by VAT flow**: Filter expenses where effective vat_flow = 'margin_scheme' or 'general'. Implementation: either compute in application (join category, left join payment_product_links, coalesce override) or add a stored/computed column `effective_vat_flow` on `payments` and index it (optional performance optimization).
- **Category list**: Include `vat_flow` in category API responses so UI can show and edit it.

## Migration Notes

- Add `vat_flow` to `pnl_expense_categories`: default `'general'`, NOT NULL after backfill.
- Optionally add `vat_flow_override` to `payments`: nullable.
- Optional: backfill `effective_vat_flow` on `payments` (if stored) using the same rule; otherwise compute on read.

## Key Entities Summary

| Entity              | Identifies VAT flow by |
|---------------------|-------------------------|
| Expense category    | `vat_flow` (margin_scheme \| general) |
| Payment (expense)   | `vat_flow_override` (optional) + product link + category |
| Manual entry        | Category’s `vat_flow` only |
| Effective flow      | Override ?? product_link ?? category ?? default |
