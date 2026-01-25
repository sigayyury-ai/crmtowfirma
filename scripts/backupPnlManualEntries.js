#!/usr/bin/env node

/**
 * Script to backup pnl_manual_entries before import
 * Creates a JSON backup file with timestamp
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../src/services/supabaseClient');

const BACKUP_DIR = path.join(__dirname, '../tmp/pnl-backups');

async function main() {
  const year = parseInt(process.argv[2]) || 2024;
  const restoreFile = process.argv[3];
  
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
  
  if (restoreFile) {
    // Restore mode
    console.log('🔄 Restoring from backup...');
    console.log(`📁 Backup file: ${restoreFile}`);
    
    if (!fs.existsSync(restoreFile)) {
      console.error(`❌ Backup file not found: ${restoreFile}`);
      process.exit(1);
    }
    
    const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf8'));
    console.log(`📊 Backup contains ${backup.entries.length} entries`);
    console.log(`📅 Year: ${backup.year}`);
    console.log(`⏰ Created: ${backup.createdAt}`);
    console.log('');
    
    // Ask for confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('⚠️  This will DELETE all current entries for year 2024 and restore from backup. Continue? (yes/no): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Restore cancelled');
      process.exit(0);
    }
    
    // Delete existing entries for the year
    console.log('\n🗑️  Deleting existing entries...');
    const { error: deleteError } = await supabase
      .from('pnl_manual_entries')
      .delete()
      .eq('year', backup.year)
      .eq('entry_type', 'expense');
    
    if (deleteError) {
      console.error(`❌ Error deleting entries: ${deleteError.message}`);
      process.exit(1);
    }
    
    // Restore entries
    console.log('💾 Restoring entries...');
    let restored = 0;
    let errors = 0;
    
    for (const entry of backup.entries) {
      try {
        const { error } = await supabase
          .from('pnl_manual_entries')
          .insert({
            expense_category_id: entry.expense_category_id,
            entry_type: 'expense',
            year: entry.year,
            month: entry.month,
            amount_pln: entry.amount_pln,
            currency_breakdown: entry.currency_breakdown,
            notes: entry.notes
          });
        
        if (error) {
          console.error(`❌ Error restoring entry ${entry.year}-${entry.month}: ${error.message}`);
          errors++;
        } else {
          restored++;
        }
      } catch (error) {
        console.error(`❌ Error restoring entry ${entry.year}-${entry.month}: ${error.message}`);
        errors++;
      }
    }
    
    console.log('\n📊 Restore Results:');
    console.log(`  ✅ Restored: ${restored}`);
    console.log(`  ❌ Errors: ${errors}`);
    
    if (errors === 0) {
      console.log('\n✅ Restore completed successfully!');
    } else {
      console.log('\n⚠️  Restore completed with errors');
    }
    
    return;
  }
  
  // Backup mode
  console.log(`💾 Creating backup of pnl_manual_entries for year ${year}...`);
  console.log('');
  
  // Fetch all entries for the year
  const { data: entries, error } = await supabase
    .from('pnl_manual_entries')
    .select('*')
    .eq('year', year)
    .eq('entry_type', 'expense')
    .order('expense_category_id', { ascending: true })
    .order('month', { ascending: true });
  
  if (error) {
    console.error(`❌ Error fetching entries: ${error.message}`);
    process.exit(1);
  }
  
  const backup = {
    year: year,
    createdAt: new Date().toISOString(),
    entryCount: entries.length,
    entries: entries || []
  };
  
  // Create backup filename with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                    new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('.')[0];
  const backupFile = path.join(BACKUP_DIR, `pnl_manual_entries_${year}_${timestamp}.json`);
  
  // Write backup file
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  
  console.log('✅ Backup created successfully!');
  console.log(`📁 File: ${backupFile}`);
  console.log(`📊 Entries: ${entries.length}`);
  console.log(`📅 Year: ${year}`);
  console.log('');
  console.log('💡 To restore from this backup:');
  console.log(`   node scripts/backupPnlManualEntries.js ${year} ${backupFile}`);
}

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});


