-- Migration: Add display_order to Income Categories
-- Date: 2025-11-18
-- Description: Adds display_order field to pnl_revenue_categories table for custom ordering

-- Step 1: Add display_order column
ALTER TABLE pnl_revenue_categories 
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 0;

-- Step 2: Set initial display_order based on creation order (oldest first)
UPDATE pnl_revenue_categories 
SET display_order = subquery.row_number - 1
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC) as row_number
  FROM pnl_revenue_categories
) AS subquery
WHERE pnl_revenue_categories.id = subquery.id;

-- Step 3: Create index for performance
CREATE INDEX IF NOT EXISTS idx_pnl_revenue_categories_display_order ON pnl_revenue_categories(display_order);







