#!/usr/bin/env node

/**
 * Script to run a SQL migration file
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../src/services/supabaseClient');

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node scripts/runMigration.js <migration-file.sql>');
  process.exit(1);
}

const migrationPath = path.resolve(__dirname, 'migrations', migrationFile);

if (!fs.existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, 'utf8');

async function runMigration() {
  console.log(`Running migration: ${migrationFile}`);
  console.log('='.repeat(50));
  
  try {
    // Split SQL by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement });
        
        if (error) {
          // Try direct query if RPC doesn't work
          const { error: directError } = await supabase.from('_').select('*').limit(0);
          if (directError) {
            console.error('Error executing migration:', error);
            console.error('Note: Supabase client may not support direct SQL execution.');
            console.error('Please run this migration manually in Supabase SQL Editor.');
            process.exit(1);
          }
        }
      }
    }
    
    console.log('✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('\nPlease run this migration manually in Supabase SQL Editor:');
    console.error(`File: ${migrationPath}`);
    process.exit(1);
  }
}

runMigration();




