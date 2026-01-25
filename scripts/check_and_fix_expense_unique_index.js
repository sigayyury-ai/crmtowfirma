#!/usr/bin/env node

/**
 * Script to check and remove unique constraint on expense entries
 * This verifies if the index exists and removes it if needed
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAndFix() {
  console.log('Checking for unique constraint on expense entries...\n');

  try {
    // Check if the unique index exists by querying pg_indexes
    const { data: indexes, error: indexError } = await supabase
      .rpc('exec_sql', {
        sql_query: `
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = 'pnl_manual_entries' 
          AND indexname = 'pnl_manual_entries_expense_unique';
        `
      });

    if (indexError) {
      console.log('⚠️  Cannot check indexes directly. Attempting to drop index anyway...\n');
    } else {
      if (indexes && indexes.length > 0) {
        console.log('❌ Found unique index: pnl_manual_entries_expense_unique');
        console.log('This index prevents multiple expense entries per category/month.\n');
      } else {
        console.log('✅ Unique index not found (or already removed).\n');
      }
    }

    // Try to drop the index using ALTER TABLE
    console.log('Attempting to remove unique constraint...');
    
    // Since we can't execute DROP INDEX directly, we'll provide instructions
    console.log('\n' + '='.repeat(70));
    console.log('⚠️  IMPORTANT: Please run this SQL in Supabase SQL Editor:');
    console.log('='.repeat(70));
    console.log(`
-- Remove unique constraint for expense entries
DROP INDEX IF EXISTS pnl_manual_entries_expense_unique;

-- Add non-unique performance indexes
CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year_month 
    ON pnl_manual_entries(expense_category_id, year, month) 
    WHERE entry_type = 'expense';

CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year 
    ON pnl_manual_entries(expense_category_id, year) 
    WHERE entry_type = 'expense';
    `);
    console.log('='.repeat(70));
    console.log('\nAfter running this SQL, try adding the expense again.\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.log('\nPlease run the SQL manually in Supabase SQL Editor.');
  }
}

checkAndFix();


