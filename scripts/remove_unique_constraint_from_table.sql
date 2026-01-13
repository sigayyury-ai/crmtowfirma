-- Migration: Remove UNIQUE constraint from pnl_manual_entries table
-- Date: 2026-01-13
-- Description: Removes the UNIQUE(category_id, year, month) constraint from migration 003
--              This constraint prevents multiple entries per category/month for ALL entry types
--              We need to remove it to allow multiple expense entries

-- Step 1: Drop constraints FIRST (before indexes)
-- PostgreSQL creates constraints with names like: tablename_columnname_key or tablename_unique
-- We need to drop constraints before indexes

-- Drop constraint by common auto-generated names
ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS pnl_manual_entries_category_id_year_month_key;
ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS pnl_manual_entries_unique;

-- Step 2: Find and drop any remaining unique constraints on (category_id, year, month)
DO $$
DECLARE
    constraint_name TEXT;
    column_names TEXT[];
BEGIN
    -- Find the constraint name
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'pnl_manual_entries'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 3;
    
    -- If found, check if it's on the right columns
    IF constraint_name IS NOT NULL THEN
        SELECT array_agg(attname::TEXT ORDER BY attnum) INTO column_names
        FROM pg_attribute 
        WHERE attrelid = 'pnl_manual_entries'::regclass
          AND attnum = ANY(
              SELECT conkey FROM pg_constraint 
              WHERE conname = constraint_name
          );
        
        -- Check if columns match
        IF column_names = ARRAY['category_id', 'year', 'month']::TEXT[] THEN
            EXECUTE format('ALTER TABLE pnl_manual_entries DROP CONSTRAINT IF EXISTS %I', constraint_name);
            RAISE NOTICE 'Dropped constraint: %', constraint_name;
        ELSE
            RAISE NOTICE 'Constraint % exists but on different columns: %', constraint_name, column_names;
        END IF;
    ELSE
        RAISE NOTICE 'No matching unique constraint found';
    END IF;
END $$;

-- Step 3: Now drop any indexes that might have been created for this constraint
-- (These should be automatically dropped with the constraint, but we'll try anyway)
DROP INDEX IF EXISTS pnl_manual_entries_category_id_year_month_key;
DROP INDEX IF EXISTS pnl_manual_entries_unique;

-- Step 4: Verify the constraint is removed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'pnl_manual_entries'::regclass
          AND contype = 'u'
          AND array_length(conkey, 1) = 3
    ) THEN
        RAISE WARNING 'Unique constraint still exists - manual removal may be required';
    ELSE
        RAISE NOTICE 'Unique constraint successfully removed';
    END IF;
END $$;

