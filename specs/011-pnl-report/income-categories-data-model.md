# Data Model: PNL Income Categories Management

**Feature**: Income Categories Management  
**Date**: 2025-11-18

## Entities

### 1. Income Category

**Purpose**: Represents a category for classifying revenue/income payments.

**Database Table**: `pnl_revenue_categories`

**Fields**:
- `id` (integer, primary key, auto-increment): Unique identifier
- `name` (string, required, max 255 chars): Category name (must be unique)
- `description` (text, optional): Category description
- `display_order` (integer, default 0): Display order for sorting categories (lower = first)
- `created_at` (timestamp, auto): Record creation timestamp
- `updated_at` (timestamp, auto): Record last update timestamp

**Validation Rules**:
- `name` must be non-empty string
- `name` must be unique across all categories
- `name` maximum length: 255 characters
- `description` maximum length: 5000 characters (if provided)
- `name` cannot be changed to duplicate existing name

**Relationships**:
- One-to-many with `Payment` entities (via `income_category_id`)
- One-to-many with `StripePayment` entities (via `income_category_id`)

**State Transitions**:
- **Created**: New category created via API
- **Updated**: Category name or description modified
- **Deleted**: Category removed (only if no associated payments)

**Business Rules**:
- Cannot delete category if it has associated payments
- Category name must be unique (enforced by database constraint)
- Deletion sets `income_category_id` to NULL in associated payments (ON DELETE SET NULL)

---

### 2. Payment (Extended)

**Purpose**: Bank payment with optional income category assignment.

**Database Table**: `payments` (existing, extended)

**New Fields**:
- `income_category_id` (integer, nullable, foreign key): Reference to `pnl_revenue_categories.id`

**Validation Rules**:
- `income_category_id` must reference existing category or be NULL
- If category is deleted, `income_category_id` is set to NULL automatically

**Relationships**:
- Many-to-one with `IncomeCategory` (via `income_category_id`, nullable)

**Business Rules**:
- Payment can exist without category (NULL = "Uncategorized")
- Category assignment is manual (not automatic)

---

### 3. Stripe Payment (Extended)

**Purpose**: Stripe payment with optional income category assignment.

**Database Table**: `stripe_payments` (existing, extended)

**New Fields**:
- `income_category_id` (integer, nullable, foreign key): Reference to `pnl_revenue_categories.id`

**Validation Rules**:
- `income_category_id` must reference existing category or be NULL
- If category is deleted, `income_category_id` is set to NULL automatically

**Relationships**:
- Many-to-one with `IncomeCategory` (via `income_category_id`, nullable)

**Business Rules**:
- Payment can exist without category (NULL = "Uncategorized")
- Category assignment is manual (not automatic)

---

### 4. Uncategorized Category (Virtual)

**Purpose**: Represents payments without category assignment.

**Database Table**: None (virtual entity)

**Fields**:
- `id`: null (virtual identifier)
- `name`: "Uncategorized" (virtual name)
- `description`: null

**Validation Rules**:
- N/A (virtual entity)

**Relationships**:
- Contains all payments where `income_category_id IS NULL`

**Business Rules**:
- Always exists (cannot be deleted)
- Automatically includes all payments without category
- Displayed in reports alongside real categories

---

### 5. Categorized Monthly Revenue Entry

**Purpose**: Represents monthly revenue aggregated by category.

**Database Table**: None (computed view)

**Fields**:
- `category_id` (integer, nullable): Category ID (null for uncategorized)
- `category_name` (string): Category name ("Uncategorized" if null)
- `year` (number): Year of revenue
- `month` (number): Month number (1-12)
- `amountPln` (number): Total revenue in PLN for this category/month
- `paymentCount` (number): Number of payments contributing to revenue

**Validation Rules**:
- `amountPln` must be >= 0
- `month` must be between 1 and 12
- `paymentCount` must be >= 0

**Relationships**:
- Aggregated from multiple `Payment` and `StripePayment` entities
- Grouped by `IncomeCategory` (or virtual Uncategorized)

**Business Rules**:
- All payments must be accounted for (including uncategorized)
- Sum of all categories equals total revenue
- Excludes refunded payments

---

## Entity Relationships Diagram

```
IncomeCategory (1) ──< (many) Payment
                      └─ income_category_id (nullable)

IncomeCategory (1) ──< (many) StripePayment
                      └─ income_category_id (nullable)

Uncategorized (virtual) ──< (many) Payment
                              └─ income_category_id IS NULL

Uncategorized (virtual) ──< (many) StripePayment
                              └─ income_category_id IS NULL
```

## Data Flow

### Category Creation Flow

1. User submits category name (and optional description)
2. Backend validates: non-empty, unique name
3. Insert into `pnl_revenue_categories` table
4. Return created category with ID

### Category Update Flow

1. User submits updated category name/description
2. Backend validates: non-empty, unique name (if changed)
3. Update `pnl_revenue_categories` table
4. Return updated category

### Category Deletion Flow

1. User requests category deletion
2. Backend checks for associated payments:
   - Query `payments` WHERE `income_category_id = :id`
   - Query `stripe_payments` WHERE `income_category_id = :id`
3. If payments found: Return error with count
4. If no payments: Delete from `pnl_revenue_categories`
5. Foreign key constraint automatically sets `income_category_id` to NULL in any remaining payments

### Categorized Report Aggregation Flow

1. Load all payments for selected year (bank + Stripe)
2. Filter processed payments (approved/matched, paid)
3. Exclude refunded payments
4. Group by `income_category_id` (NULL = Uncategorized)
5. Aggregate by month within each category
6. Convert amounts to PLN
7. Return structure: `{ categories: [{ id, name, monthly: [...] }] }`

## Database Constraints

**Primary Keys**:
- `pnl_revenue_categories.id` (PRIMARY KEY)

**Foreign Keys**:
- `payments.income_category_id` → `pnl_revenue_categories.id` (ON DELETE SET NULL)
- `stripe_payments.income_category_id` → `pnl_revenue_categories.id` (ON DELETE SET NULL)

**Unique Constraints**:
- `pnl_revenue_categories.name` (UNIQUE)

**Indexes**:
- `idx_payments_income_category` ON `payments(income_category_id)`
- `idx_stripe_payments_income_category` ON `stripe_payments(income_category_id)`

## Validation Summary

**Category Name**:
- Required: Yes
- Type: String
- Min Length: 1 character
- Max Length: 255 characters
- Uniqueness: Yes (enforced by database)
- Pattern: Any printable characters

**Category Description**:
- Required: No
- Type: Text
- Max Length: 5000 characters

**Category ID (for updates/deletes)**:
- Required: Yes
- Type: Integer
- Must exist in database
- Cannot delete if has associated payments

