# Research: PNL Income Categories Management

**Feature**: Income Categories Management  
**Date**: 2025-11-18  
**Phase**: 0 - Research

## Research Findings

### Database Structure

**Decision**: Use `pnl_revenue_categories` table with structure similar to `pnl_expense_categories`

**Rationale**: 
- Consistency with existing expense categories structure
- User mentioned categories already exist in database ("PNL incomes category")
- Standard structure: id, name, description, timestamps

**Alternatives Considered**:
- Reuse `pnl_expense_categories` table with type field - Rejected: Separate concerns, different business logic
- Create separate tables per year - Rejected: Categories are shared across years

**Database Schema**:
```sql
CREATE TABLE pnl_revenue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Payment-Category Linking

**Decision**: Add `income_category_id` column to both `payments` and `stripe_payments` tables with foreign key constraint and ON DELETE SET NULL

**Rationale**:
- Allows payments to be linked to categories
- ON DELETE SET NULL prevents orphaned references if category is deleted
- Nullable field allows payments without category assignment
- Indexes needed for performance on aggregation queries

**Alternatives Considered**:
- Junction table (many-to-many) - Rejected: One payment belongs to one category
- Store category name directly - Rejected: Normalization, consistency issues

**Implementation**:
```sql
ALTER TABLE payments 
  ADD COLUMN income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

ALTER TABLE stripe_payments 
  ADD COLUMN income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_payments_income_category ON payments(income_category_id);
CREATE INDEX idx_stripe_payments_income_category ON stripe_payments(income_category_id);
```

### Settings UI Approach

**Decision**: Add settings as a new tab in PNL report page (similar to VAT margin tracker tabs)

**Rationale**:
- Consistent with existing UI patterns (vat-margin.html uses tabs)
- Keeps related functionality together
- Easy navigation between report and settings
- No need for separate page/routing

**Alternatives Considered**:
- Separate settings page - Rejected: Extra navigation, less integrated
- Modal dialog - Rejected: Limited space, harder to manage list

**UI Structure**:
- Add "Настройки" tab to pnl-report.html
- Settings tab contains category management UI
- List of categories with add/edit/delete actions

### Category Deletion Protection

**Decision**: Check for associated payments before allowing deletion, show error if category is in use

**Rationale**:
- Prevents data inconsistency
- User-friendly error messages
- Maintains referential integrity

**Implementation**:
- Query `payments` and `stripe_payments` tables for category_id
- If any payments found, return error with count
- Allow deletion only if no payments associated

### Uncategorized Payments Handling

**Decision**: Use virtual "Uncategorized" category for payments with `income_category_id IS NULL`

**Rationale**:
- No need to create actual database record
- Simplifies logic (null check)
- Clear user understanding

**Alternatives Considered**:
- Create default "Uncategorized" category in DB - Rejected: Unnecessary, harder to manage

### Report Aggregation Strategy

**Decision**: Group payments by `income_category_id` in aggregation query, handle NULL as "Uncategorized"

**Rationale**:
- Efficient database-level grouping
- Single query for all categories
- Handles uncategorized naturally

**Implementation**:
- Modify `getMonthlyRevenue()` to group by `income_category_id`
- Use COALESCE or CASE to map NULL to "Uncategorized"
- Return structure: `{ categories: [{ id, name, monthly: [...] }] }`

### API Design

**Decision**: RESTful endpoints following existing API patterns

**Rationale**:
- Consistency with existing `/api/pnl/report` endpoint
- Standard CRUD operations
- Easy to understand and maintain

**Endpoints**:
- `GET /api/pnl/categories` - List all categories
- `POST /api/pnl/categories` - Create category
- `PUT /api/pnl/categories/:id` - Update category
- `DELETE /api/pnl/categories/:id` - Delete category (with validation)

### Validation Rules

**Decision**: 
- Category name: required, non-empty, max 255 chars, unique
- Description: optional, max 5000 chars

**Rationale**:
- Standard validation patterns
- Database constraints enforce uniqueness
- Reasonable limits prevent abuse

## Open Questions Resolved

1. **Q**: Should categories be year-specific?
   **A**: No, categories are shared across all years (simpler, more flexible)

2. **Q**: How to handle payments when category is deleted?
   **A**: ON DELETE SET NULL - payments become uncategorized automatically

3. **Q**: Should we support category archiving?
   **A**: No, out of scope for MVP (hard delete only)

4. **Q**: How to display categories in report?
   **A**: Grouped sections or nested table rows, one section per category

## Technical Decisions Summary

- Database: `pnl_revenue_categories` table with foreign keys
- UI: Tab-based settings in PNL report page
- API: RESTful CRUD endpoints
- Validation: Name uniqueness, non-empty, length limits
- Deletion: Protected if category has payments
- Uncategorized: Virtual category for NULL values
- Aggregation: Database-level grouping by category_id



