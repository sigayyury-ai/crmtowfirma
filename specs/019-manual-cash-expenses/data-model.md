# Data Model: Manual Cash Expenses for PNL Report

**Feature**: 019-manual-cash-expenses  
**Date**: 2025-01-27

## Overview

This feature extends the existing `pnl_manual_entries` table to support multiple expense entries per category/month combination. The data model builds on the existing manual entry infrastructure while removing uniqueness constraints for expense entries.

## Entities

### Manual Cash Expense Entry

**Table**: `pnl_manual_entries` (existing table, schema modification required)

**Purpose**: Stores individual manual cash expense entries that users add through the UI.

**Fields**:

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | SERIAL PRIMARY KEY | NOT NULL, AUTO_INCREMENT | Unique identifier for the entry |
| `expense_category_id` | INTEGER | NOT NULL (for expenses), REFERENCES `pnl_expense_categories(id)` ON DELETE CASCADE | Links to expense category |
| `category_id` | INTEGER | NULL (for expenses), REFERENCES `pnl_revenue_categories(id)` ON DELETE CASCADE | NULL for expense entries |
| `entry_type` | VARCHAR(10) | NOT NULL, CHECK (`entry_type IN ('revenue', 'expense')`) | Type of entry: 'expense' for this feature |
| `year` | INTEGER | NOT NULL, CHECK (`year >= 2020 AND year <= 2030`) | Year of the expense (2020-2030) |
| `month` | INTEGER | NOT NULL, CHECK (`month >= 1 AND month <= 12`) | Month of the expense (1-12) |
| `amount_pln` | NUMERIC(15, 2) | NOT NULL, CHECK (`amount_pln > 0`) | Amount in PLN (must be positive) |
| `notes` | TEXT | NULL | Optional comment/description for the expense |
| `currency_breakdown` | JSONB | NULL | Optional currency breakdown (not used for cash expenses, but kept for consistency) |
| `created_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT NOW() | Timestamp when entry was created |
| `updated_at` | TIMESTAMP WITH TIME ZONE | NOT NULL, DEFAULT NOW() | Timestamp when entry was last updated |

**Indexes**:

- **Primary Key**: `id` (unique)
- **Performance Index**: `idx_pnl_manual_entries_expense_category_year_month` on `(expense_category_id, year, month)` WHERE `entry_type = 'expense'` (non-unique)
- **Query Index**: `idx_pnl_manual_entries_category_year` on `(expense_category_id, year)` WHERE `entry_type = 'expense'`

**Unique Constraints**:

- **Removed**: `pnl_manual_entries_expense_unique` index (allows multiple entries per category/month)
- **Kept**: `pnl_manual_entries_revenue_unique` index (preserves existing revenue entry behavior)

**Relationships**:

- **Many-to-One**: Multiple expense entries → One expense category (`expense_category_id`)
- **Cascade Delete**: When expense category is deleted, all related entries are deleted

**Validation Rules**:

1. `entry_type = 'expense'` → `expense_category_id IS NOT NULL` AND `category_id IS NULL`
2. `amount_pln > 0` (positive numbers only)
3. `year` between 2020 and 2030
4. `month` between 1 and 12
5. Expense category must exist and have `management_type = 'manual'`

**State Transitions**:

- **Created**: New entry inserted into database
- **Updated**: Entry amount or notes modified
- **Deleted**: Entry permanently removed from database (no soft delete)

### Expense Category (Existing Entity)

**Table**: `pnl_expense_categories` (existing table, no changes)

**Purpose**: Defines expense categories that can have manual entries.

**Relevant Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Category identifier |
| `name` | VARCHAR(255) | Category name (e.g., "Наличные расходы") |
| `management_type` | VARCHAR(10) | Must be 'manual' for this feature |
| `description` | TEXT | Optional category description |

**Relationship**: One expense category → Many manual expense entries

## Data Flow

### Creating an Entry

1. User clicks plus icon in month cell
2. Modal opens with amount and comment fields
3. User enters amount (required) and comment (optional)
4. Frontend validates: amount > 0
5. Frontend sends `POST /api/pnl/manual-entries` with:
   ```json
   {
     "expenseCategoryId": 5,
     "entryType": "expense",
     "year": 2025,
     "month": 1,
     "amountPln": 1000.50,
     "notes": "Обед для команды"
   }
   ```
6. Backend validates: category exists, is manual type, amount > 0
7. Backend inserts new row into `pnl_manual_entries`
8. Backend returns created entry with `id`
9. Frontend closes modal, refreshes cell total

### Listing Entries

1. User clicks month cell (not plus icon)
2. Frontend sends `GET /api/pnl/manual-entries?expenseCategoryId=5&year=2025&month=1&entryType=expense`
3. Backend queries all entries matching criteria
4. Backend returns array of entries:
   ```json
   [
     {
       "id": 101,
       "expense_category_id": 5,
       "entry_type": "expense",
       "year": 2025,
       "month": 1,
       "amount_pln": 1000.50,
       "notes": "Обед для команды",
       "created_at": "2025-01-27T10:30:00Z",
       "updated_at": "2025-01-27T10:30:00Z"
     },
     {
       "id": 102,
       "expense_category_id": 5,
       "entry_type": "expense",
       "year": 2025,
       "month": 1,
       "amount_pln": 500.00,
       "notes": "Такси",
       "created_at": "2025-01-27T14:15:00Z",
       "updated_at": "2025-01-27T14:15:00Z"
     }
   ]
   ```
5. Frontend displays list in modal

### Updating an Entry

1. User clicks "Edit" on entry in list
2. Modal opens with pre-filled amount and comment
3. User modifies values
4. Frontend sends `PUT /api/pnl/manual-entries/101` with updated data
5. Backend validates and updates row
6. Frontend refreshes list

### Deleting an Entry

1. User clicks "Delete" on entry in list
2. Confirmation dialog appears
3. User confirms deletion
4. Frontend sends `DELETE /api/pnl/manual-entries/101`
5. Backend deletes row from database
6. Frontend refreshes list and cell total

### Aggregating Totals

1. PNL report loads for selected year
2. `pnlReportService` queries all expense entries for each category/month:
   ```sql
   SELECT expense_category_id, month, SUM(amount_pln) as total
   FROM pnl_manual_entries
   WHERE entry_type = 'expense'
     AND year = 2025
     AND expense_category_id IN (5, 6, 7, ...)
   GROUP BY expense_category_id, month
   ```
3. Results aggregated by category and month
4. Totals displayed in report cells

## Data Integrity

### Constraints

1. **Referential Integrity**: `expense_category_id` must reference existing category
2. **Cascade Delete**: Deleting category deletes all related entries
3. **Type Consistency**: `entry_type = 'expense'` requires `expense_category_id IS NOT NULL` and `category_id IS NULL`
4. **Amount Validation**: `amount_pln > 0` (positive numbers only)
5. **Date Validation**: `year` and `month` within valid ranges

### Business Rules

1. Only categories with `management_type = 'manual'` can have manual entries
2. Multiple entries per category/month are allowed (for expenses)
3. Entries are permanently deleted (no soft delete or archive)
4. Totals are calculated by summing all entries for category/month

## Migration Impact

### Schema Changes

1. **Drop Unique Index**: Remove `pnl_manual_entries_expense_unique` index
2. **Add Performance Index**: Create non-unique index on `(expense_category_id, year, month)` WHERE `entry_type = 'expense'`

### Data Impact

- **No data loss**: Only constraint removal, no data migration needed
- **Backward compatibility**: Existing revenue entries unaffected
- **Existing expense entries**: If any exist, they remain valid (no uniqueness violation)

### Application Impact

- **Backend**: Service methods need to support multiple entries
- **Frontend**: UI needs plus icon, modal, list view
- **API**: New endpoints for individual entry operations

## Performance Considerations

### Query Optimization

- Index on `(expense_category_id, year, month)` for fast lookups
- Index on `(expense_category_id, year)` for year-level queries
- Limit query results when listing entries (pagination if needed)

### Aggregation Performance

- Use SQL `SUM()` for efficient aggregation
- Cache aggregated totals when possible
- Lazy load entry lists (only when user clicks cell)

### Scale

- Designed to handle 100+ entries per category/month (per SC-004)
- Indexes support efficient queries even with many entries
- No performance degradation expected for typical usage (< 50 entries/month)


