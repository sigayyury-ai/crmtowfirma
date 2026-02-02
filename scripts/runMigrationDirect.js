#!/usr/bin/env node

/**
 * Script to run a SQL migration file directly via PostgreSQL connection
 * Uses DATABASE_URL from environment variables
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('Usage: node scripts/runMigrationDirect.js <migration-file.sql>');
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
  
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL or SUPABASE_DB_URL environment variable is not set');
    console.error('Please set DATABASE_URL to your PostgreSQL connection string');
    process.exit(1);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');
    
    // Execute the entire SQL file
    console.log('Executing migration...');
    await client.query(sql);
    
    console.log('✅ Migration completed successfully!');
    
    // Verify table was created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'validation_errors'
    `);
    
    if (result.rows.length > 0) {
      console.log('✅ Table validation_errors exists');
      
      // Check columns
      const columns = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'validation_errors'
        ORDER BY ordinal_position
      `);
      
      console.log(`✅ Table has ${columns.rows.length} columns`);
    } else {
      console.warn('⚠️  Table validation_errors was not found after migration');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
