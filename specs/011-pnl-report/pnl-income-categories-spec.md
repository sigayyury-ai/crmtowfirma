# PNL Income Categories Management

**Feature**: Income Categories Management for PNL Report  
**Parent Feature**: 011-pnl-report  
**Date**: 2025-11-18  
**Status**: Draft

## Overview

Добавить функциональность управления категориями приходов (income categories) для PNL отчета. Пользователи должны иметь возможность добавлять, редактировать и удалять категории приходов через раздел настроек. В таблице PNL отчета должна отображаться агрегация по категориям с разбивкой по месяцам.

## User Stories

### User Story 1 - Manage Income Categories (Priority: P1)

As a business owner or financial manager, I want to manage income categories (add, edit, delete) through a settings section, so that I can organize revenue data by meaningful categories.

**Why this priority**: This is foundational functionality - without categories, we cannot categorize revenue data.

**Independent Test**: Navigate to settings section, add a new category, verify it appears in the list. Edit category name, verify changes are saved. Delete category, verify it is removed.

**Acceptance Scenarios**:

1. **Given** I am in the PNL report settings section, **When** I add a new income category with name "Camp Payments", **Then** the category appears in the categories list
2. **Given** I have created a category, **When** I edit its name to "Camp Revenue", **Then** the changes are saved and reflected in the list
3. **Given** I have a category, **When** I delete it, **Then** the category is removed from the list and cannot be used for new payments
4. **Given** I try to add a category with empty name, **Then** I see a validation error
5. **Given** I try to add a duplicate category name, **Then** I see an error message

---

### User Story 2 - View Revenue by Categories in Report (Priority: P1)

As a user, I want to see revenue aggregated by income categories in the PNL report table, so that I can analyze revenue by different sources/types.

**Why this priority**: This is the core value - displaying categorized revenue data.

**Independent Test**: Navigate to PNL report, verify that revenue is displayed grouped by categories with monthly breakdown. Each category shows monthly totals.

**Acceptance Scenarios**:

1. **Given** I am viewing the PNL report for 2025, **When** payments are assigned to categories, **Then** I see revenue grouped by categories with monthly totals
2. **Given** I am viewing categorized revenue, **When** a month has no payments for a category, **Then** that category shows zero or "—" for that month
3. **Given** I am viewing the report, **When** payments have no category assigned, **Then** they appear under "Uncategorized" or similar default category
4. **Given** I am viewing categorized data, **When** I switch years, **Then** categories are displayed for the selected year

---

## Functional Requirements

### FR-001: Income Categories Management

- **FR-001.1**: System must provide UI for managing income categories (add, edit, delete)
- **FR-001.2**: Category name must be required and unique
- **FR-001.3**: Category description is optional
- **FR-001.4**: System must prevent deletion of categories that are in use (have associated payments)
- **FR-001.5**: System must validate category names (non-empty, reasonable length)

### FR-002: Category Assignment

- **FR-002.1**: Payments must be assignable to income categories
- **FR-002.2**: System must support "Uncategorized" as default for payments without category
- **FR-002.3**: Category assignment should be stored in database (link payment to category)

### FR-003: Categorized Revenue Display

- **FR-003.1**: PNL report must display revenue grouped by income categories
- **FR-003.2**: Each category must show monthly totals (12 months)
- **FR-003.3**: Report must show total revenue per category for the selected year
- **FR-003.4**: Report must show grand total across all categories

## Success Criteria

- **SC-001**: User can add, edit, and delete income categories through settings UI
- **SC-002**: PNL report displays revenue aggregated by categories with monthly breakdown
- **SC-003**: Category changes are persisted in database
- **SC-004**: Report loads within 3 seconds with categorized data
- **SC-005**: System prevents deletion of categories with associated payments

## Edge Cases

- What happens when all categories are deleted?
- How are payments handled when their category is deleted?
- What if a category name conflicts with an existing one?
- How to handle payments without category assignment?
- What happens if database connection fails during category operations?

## Assumptions

- Income categories table exists in database (similar structure to `pnl_expense_categories`)
- Payments can be linked to categories via foreign key or category_id field
- Category management is admin-only functionality (or accessible to authorized users)
- Categories are shared across all years (not year-specific)

## Dependencies

- Existing PNL report infrastructure
- Database access to income categories table
- Frontend settings page infrastructure

## Out of Scope

- Automatic category assignment based on payment patterns
- Category hierarchies or subcategories
- Category templates or presets
- Bulk category assignment to existing payments
- Category-based filtering in other reports (future enhancement)

## Database Schema

**Assumed structure** (to be verified):
```sql
CREATE TABLE pnl_revenue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Link payments to categories (if not exists)
ALTER TABLE payments ADD COLUMN income_category_id INTEGER REFERENCES pnl_revenue_categories(id);
-- OR
ALTER TABLE stripe_payments ADD COLUMN income_category_id INTEGER REFERENCES pnl_revenue_categories(id);
```

## Technical Notes

- Settings page should be accessible from PNL report page
- Category management API endpoints needed: GET, POST, PUT, DELETE
- Report aggregation logic needs to group by category
- Frontend table needs to support category grouping display







