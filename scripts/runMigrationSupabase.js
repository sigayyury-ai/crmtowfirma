#!/usr/bin/env node

/**
 * Script to run a SQL migration file via Supabase
 * 
 * NOTE: Supabase REST API doesn't support arbitrary SQL execution.
 * This script will output the SQL that needs to be run manually in Supabase SQL Editor.
 * 
 * Alternatively, if you have MCP Supabase configured, you can use it to execute the SQL.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node scripts/runMigrationSupabase.js <migration-file.sql>');
  process.exit(1);
}

const migrationPath = path.resolve(__dirname, 'migrations', migrationFile);

if (!fs.existsSync(migrationPath)) {
  console.error(`Migration file not found: ${migrationPath}`);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, 'utf8');

console.log('='.repeat(70));
console.log('⚠️  Supabase REST API does not support arbitrary SQL execution');
console.log('='.repeat(70));
console.log('\n📋 Migration SQL to execute:\n');
console.log(sql);
console.log('\n' + '='.repeat(70));
console.log('📝 Instructions:');
console.log('='.repeat(70));
console.log('1. Open Supabase Dashboard → SQL Editor');
console.log('2. Copy and paste the SQL above');
console.log('3. Click "Run" to execute the migration');
console.log('\nOr use MCP Supabase if configured:');
console.log('The migration file is ready at:', migrationPath);
console.log('='.repeat(70));
