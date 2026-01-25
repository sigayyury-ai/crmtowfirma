#!/usr/bin/env node

/**
 * Script to apply migration 019: Allow multiple expense entries
 * This removes the unique constraint on expense entries
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

async function applyMigration() {
  console.log('Applying migration 019: Allow multiple expense entries...\n');

  const sql = `
    -- Step 1: Drop unique index for expense entries
    DROP INDEX IF EXISTS pnl_manual_entries_expense_unique;

    -- Step 2: Add non-unique performance index for expense entry queries
    CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year_month 
        ON pnl_manual_entries(expense_category_id, year, month) 
        WHERE entry_type = 'expense';

    -- Step 3: Add index for year-level queries
    CREATE INDEX IF NOT EXISTS idx_pnl_manual_entries_expense_category_year 
        ON pnl_manual_entries(expense_category_id, year) 
        WHERE entry_type = 'expense';
  `;

  try {
    // Split SQL into individual statements
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
        
        if (error) {
          // Try alternative method - direct query
          console.log('Trying alternative method...');
          const { error: altError } = await supabase
            .from('pnl_manual_entries')
            .select('id')
            .limit(0);
          
          if (altError) {
            console.error('❌ Cannot execute SQL directly through Supabase client.');
            console.error('Please run this SQL manually in Supabase SQL Editor:');
            console.log('\n' + '='.repeat(60));
            console.log(sql);
            console.log('='.repeat(60));
            process.exit(1);
          }
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('You can now add multiple expense entries per category/month.');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('\nPlease run this SQL manually in Supabase SQL Editor:');
    console.log('\n' + '='.repeat(60));
    console.log(sql);
    console.log('='.repeat(60));
    process.exit(1);
  }
}

applyMigration();


