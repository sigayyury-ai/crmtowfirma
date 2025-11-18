# Feature Specification: PNL Income Categories Management

**Feature Branch**: `011-pnl-report` (extension)  
**Created**: 2025-11-18  
**Status**: Draft  
**Input**: User request: "добавить категории приходов. Для этого надо создать раздел настроек где можно добавлять и удалять категории приходов. Эти категории уже есть в базе PNL incomes category & в таблице отчета я хочу также видеть эти категории с агрегацией по месяцам."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage Income Categories (Priority: P1)

As a business owner or financial manager, I want to manage income categories (add, edit, delete) through a settings section, so that I can organize revenue data by meaningful categories.

**Why this priority**: This is foundational functionality - without categories, we cannot categorize revenue data. Category management must be available before we can display categorized reports.

**Independent Test**: Navigate to PNL report settings section, add a new category "Camp Payments", verify it appears in the categories list. Edit category name to "Camp Revenue", verify changes are saved. Delete category, verify it is removed from the list.

**Acceptance Scenarios**:

1. **Given** I am in the PNL report settings section, **When** I add a new income category with name "Camp Payments", **Then** the category appears in the categories list immediately
2. **Given** I have created a category, **When** I edit its name to "Camp Revenue", **Then** the changes are saved and reflected in the list without page refresh
3. **Given** I have a category, **When** I delete it, **Then** the category is removed from the list and cannot be used for new payments
4. **Given** I try to add a category with empty name, **Then** I see a validation error "Category name is required"
5. **Given** I try to add a duplicate category name, **Then** I see an error message "Category with this name already exists"
6. **Given** I try to delete a category that has associated payments, **Then** I see an error message preventing deletion

---

### User Story 2 - View Revenue by Categories in Report (Priority: P1)

As a user, I want to see revenue aggregated by income categories in the PNL report table with monthly breakdown, so that I can analyze revenue by different sources/types.

**Why this priority**: This is the core value - displaying categorized revenue data is the main purpose of adding categories.

**Independent Test**: Navigate to PNL report for 2025, verify that revenue is displayed grouped by categories. Each category shows monthly totals (12 months). Payments without category appear under "Uncategorized".

**Acceptance Scenarios**:

1. **Given** I am viewing the PNL report for 2025, **When** payments are assigned to categories, **Then** I see revenue grouped by categories with monthly totals for each category
2. **Given** I am viewing categorized revenue, **When** a month has no payments for a category, **Then** that category shows zero or "—" for that month
3. **Given** I am viewing the report, **When** payments have no category assigned, **Then** they appear under "Uncategorized" category
4. **Given** I am viewing categorized data, **When** I switch years, **Then** categories are displayed for the selected year with correct monthly totals
5. **Given** I am viewing the report, **When** I see category totals, **Then** the sum of all categories equals the total revenue for the year

---

## Functional Requirements

### FR-001: Income Categories Management UI

- **FR-001.1**: System must provide a settings section accessible from PNL report page
- **FR-001.2**: Settings section must display list of all income categories
- **FR-001.3**: System must provide "Add Category" button/form
- **FR-001.4**: System must provide "Edit" action for each category
- **FR-001.5**: System must provide "Delete" action for each category
- **FR-001.6**: Category list must show: name, description (if any), creation date
- **FR-001.7**: System must provide "Move Up" and "Move Down" buttons for each category to change display order
- **FR-001.8**: Category order must be persisted and reflected in both settings list and report display

### FR-002: Category Validation & Business Rules

- **FR-002.1**: Category name must be required (non-empty)
- **FR-002.2**: Category name must be unique across all categories
- **FR-002.3**: Category name must have reasonable length limit (e.g., 255 characters)
- **FR-002.4**: Category description is optional (can be empty)
- **FR-002.5**: System must prevent deletion of categories that have associated payments
- **FR-002.6**: System must validate category name before saving

### FR-003: Category Assignment to Payments

- **FR-003.1**: Payments (both bank and Stripe) must be assignable to income categories
- **FR-003.2**: System must support "Uncategorized" as default category for payments without assignment
- **FR-003.3**: Category assignment must be stored in database (via foreign key)
- **FR-003.4**: Payments table must have `income_category_id` field (nullable, references `pnl_revenue_categories.id`)

### FR-004: Categorized Revenue Display

- **FR-004.1**: PNL report must display revenue grouped by income categories
- **FR-004.2**: Each category must show monthly totals (all 12 months)
- **FR-004.3**: Report must show total revenue per category for the selected year
- **FR-004.4**: Report must show grand total across all categories
- **FR-004.5**: Categories must be displayed in a clear, readable format (table or grouped sections)
- **FR-004.6**: Uncategorized payments must be grouped under "Uncategorized" category

### FR-005: API Endpoints

- **FR-005.1**: `GET /api/pnl/categories` - List all income categories (ordered by display_order)
- **FR-005.2**: `POST /api/pnl/categories` - Create new category
- **FR-005.3**: `PUT /api/pnl/categories/:id` - Update category
- **FR-005.4**: `DELETE /api/pnl/categories/:id` - Delete category (with validation)
- **FR-005.5**: `POST /api/pnl/categories/:id/reorder` - Change category order (body: { direction: 'up' | 'down' })
- **FR-005.6**: API must return appropriate error messages for validation failures

## Success Criteria

- **SC-001**: User can successfully add, edit, and delete income categories through settings UI
- **SC-002**: PNL report displays revenue aggregated by categories with accurate monthly breakdown
- **SC-003**: Category changes are persisted in database and reflected immediately
- **SC-004**: Report loads within 3 seconds with categorized data
- **SC-005**: System prevents deletion of categories with associated payments
- **SC-006**: All payments are accounted for in categorized report (including uncategorized)

## Edge Cases

- What happens when all categories are deleted? (Uncategorized should still work)
- How are payments handled when their category is deleted? (Should remain uncategorized or prevent deletion)
- What if a category name conflicts with an existing one? (Show validation error)
- How to handle payments without category assignment? (Show under "Uncategorized")
- What happens if database connection fails during category operations? (Show error message)
- What if a payment has invalid category_id (orphaned reference)? (Treat as uncategorized)
- How to handle very long category names in UI? (Truncate with ellipsis or wrap)

## Assumptions

- Income categories table exists in database (`pnl_revenue_categories` or similar)
- Table structure similar to `pnl_expense_categories`: id, name, description, created_at, updated_at
- Payments tables (`payments`, `stripe_payments`) can have `income_category_id` field added
- Category management is accessible to authorized users (same auth as PNL report)
- Categories are shared across all years (not year-specific)
- "Uncategorized" is a virtual category (not stored in database, used for null category_id)

## Dependencies

- Existing PNL report infrastructure (`pnlReportService.js`)
- Database access to income categories table
- Frontend settings page infrastructure
- Existing authentication/authorization system

## Out of Scope

- Automatic category assignment based on payment patterns or rules
- Category hierarchies or subcategories
- Category templates or presets
- Bulk category assignment to existing payments (manual assignment only)
- Category-based filtering in other reports (future enhancement)
- Category colors or visual customization
- Category archiving (soft delete)

## Database Schema

**Required structure**:
```sql
-- Income categories table (assumed to exist or needs creation)
CREATE TABLE IF NOT EXISTS pnl_revenue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add category reference to payments table
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

-- Add category reference to stripe_payments table  
ALTER TABLE stripe_payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_payments_income_category ON payments(income_category_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_income_category ON stripe_payments(income_category_id);
```

## Technical Notes

- Settings page should be accessible from PNL report page (new tab or section)
- Category management API endpoints: GET, POST, PUT, DELETE
- Report aggregation logic needs to group by `income_category_id`
- Frontend table needs to support category grouping display (nested rows or separate sections)
- "Uncategorized" category is virtual - represents payments with `income_category_id IS NULL`
- Category deletion should check for associated payments before allowing deletion

