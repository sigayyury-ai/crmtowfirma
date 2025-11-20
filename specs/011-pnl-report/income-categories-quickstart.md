# Quickstart Guide: PNL Income Categories Management

**Feature**: Income Categories Management  
**Date**: 2025-11-18

## Prerequisites

- PNL report service is running and accessible
- Database access to Supabase
- User has access to PNL report page

## Setup Steps

### 1. Database Setup

Verify or create the `pnl_revenue_categories` table:

```sql
CREATE TABLE IF NOT EXISTS pnl_revenue_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

Add category columns to payments tables:

```sql
ALTER TABLE payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

ALTER TABLE stripe_payments 
  ADD COLUMN IF NOT EXISTS income_category_id INTEGER 
  REFERENCES pnl_revenue_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payments_income_category ON payments(income_category_id);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_income_category ON stripe_payments(income_category_id);
```

### 2. Backend Setup

1. Create `src/services/pnl/incomeCategoryService.js`
2. Add category endpoints to `src/routes/api.js`
3. Restart server

### 3. Frontend Setup

1. Add settings tab to `frontend/pnl-report.html`
2. Create `frontend/pnl-settings-script.js` (or extend existing script)
3. Update navigation if needed

## Testing Scenarios

### Scenario 1: Create a Category

**Steps**:
1. Navigate to PNL report page
2. Click "Настройки" tab
3. Click "Добавить категорию"
4. Enter name: "Camp Payments"
5. Enter description: "Revenue from camp registrations" (optional)
6. Click "Сохранить"

**Expected Result**:
- Category appears in the list immediately
- Success message displayed
- Category can be used for payment assignment

### Scenario 2: Edit a Category

**Steps**:
1. Navigate to settings tab
2. Find category "Camp Payments"
3. Click "Редактировать"
4. Change name to "Camp Revenue"
5. Click "Сохранить"

**Expected Result**:
- Category name updated in list
- Changes persisted
- No page refresh needed

### Scenario 3: Delete a Category (No Payments)

**Steps**:
1. Navigate to settings tab
2. Find a category with no associated payments
3. Click "Удалить"
4. Confirm deletion

**Expected Result**:
- Category removed from list
- Success message displayed

### Scenario 4: Delete a Category (With Payments)

**Steps**:
1. Navigate to settings tab
2. Find a category that has associated payments
3. Click "Удалить"
4. Confirm deletion

**Expected Result**:
- Error message displayed: "Cannot delete category with associated payments"
- Category remains in list
- Shows count of associated payments

### Scenario 5: View Categorized Report

**Steps**:
1. Assign some payments to categories (via database or future UI)
2. Navigate to PNL report tab
3. Select year (e.g., 2025)
4. View report

**Expected Result**:
- Revenue displayed grouped by categories
- Each category shows monthly totals (12 months)
- "Uncategorized" category shows payments without category
- Total revenue equals sum of all categories

### Scenario 6: Validation - Duplicate Name

**Steps**:
1. Navigate to settings tab
2. Click "Добавить категорию"
3. Enter name that already exists
4. Click "Сохранить"

**Expected Result**:
- Validation error: "Category with this name already exists"
- Category not created

### Scenario 7: Validation - Empty Name

**Steps**:
1. Navigate to settings tab
2. Click "Добавить категорию"
3. Leave name empty
4. Click "Сохранить"

**Expected Result**:
- Validation error: "Category name is required"
- Category not created

## API Testing

### List Categories

```bash
curl http://localhost:3000/api/pnl/categories
```

Expected: List of all categories

### Create Category

```bash
curl -X POST http://localhost:3000/api/pnl/categories \
  -H "Content-Type: application/json" \
  -d '{"name": "Camp Payments", "description": "Revenue from camps"}'
```

Expected: Created category with ID

### Update Category

```bash
curl -X PUT http://localhost:3000/api/pnl/categories/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Camp Revenue", "description": "Updated description"}'
```

Expected: Updated category

### Delete Category

```bash
curl -X DELETE http://localhost:3000/api/pnl/categories/1
```

Expected: Success message or error if has payments

## Troubleshooting

### Category Not Appearing in List

- Check database: `SELECT * FROM pnl_revenue_categories;`
- Check API response: `curl http://localhost:3000/api/pnl/categories`
- Check browser console for errors

### Cannot Delete Category

- Check if category has payments:
  ```sql
  SELECT COUNT(*) FROM payments WHERE income_category_id = 1;
  SELECT COUNT(*) FROM stripe_payments WHERE income_category_id = 1;
  ```
- If count > 0, category cannot be deleted

### Report Not Showing Categories

- Verify payments have `income_category_id` set
- Check API response includes category grouping
- Verify frontend is displaying categorized data correctly

### Validation Errors

- Check category name is unique: `SELECT name FROM pnl_revenue_categories;`
- Verify name is not empty
- Check name length (max 255 characters)

## Next Steps

After MVP:
- Add UI for assigning categories to payments
- Add bulk category assignment
- Add category filtering in reports
- Add category colors/visual customization




