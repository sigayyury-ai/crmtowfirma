#!/usr/bin/env node

/**
 * Script to create receipts bucket in Supabase Storage
 * Usage: node scripts/createReceiptsBucket.js
 */

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function createReceiptsBucket() {
  try {
    console.log('🔍 Checking for receipts bucket...');

    // Try to list buckets
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();

    if (listError) {
      console.error('❌ Error listing buckets:', listError.message);
      console.log('\n💡 Note: You may need to create the bucket manually in Supabase Dashboard:');
      console.log('   1. Go to Supabase Dashboard → Storage');
      console.log('   2. Click "Create bucket"');
      console.log('   3. Name: "receipts"');
      console.log('   4. Make it private (not public)');
      process.exit(1);
    }

    const receiptsBucket = buckets?.find(b => b.name === 'receipts');

    if (receiptsBucket) {
      console.log('✅ Bucket "receipts" already exists!');
      console.log(`   ID: ${receiptsBucket.id}`);
      console.log(`   Public: ${receiptsBucket.public}`);
      return;
    }

    console.log('📦 Creating receipts bucket...');

    // Try to create bucket
    // Note: Supabase JS client may not support bucket creation directly
    // This might need to be done via REST API or manually
    const { data, error } = await supabase.storage.createBucket('receipts', {
      public: false,
      fileSizeLimit: 10485760, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/heic', 'image/heif', 'application/pdf']
    });

    if (error) {
      if (error.message?.includes('already exists') || error.message?.includes('duplicate')) {
        console.log('✅ Bucket "receipts" already exists!');
        return;
      }

      console.error('❌ Error creating bucket:', error.message);
      console.log('\n💡 Bucket creation via API may not be supported.');
      console.log('   Please create it manually in Supabase Dashboard:');
      console.log('   1. Go to Supabase Dashboard → Storage');
      console.log('   2. Click "Create bucket"');
      console.log('   3. Name: "receipts"');
      console.log('   4. Make it private (not public)');
      console.log('   5. Optional: Set file size limit to 10MB');
      process.exit(1);
    }

    console.log('✅ Bucket "receipts" created successfully!');
    console.log(`   ID: ${data?.id || 'N/A'}`);

  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    console.log('\n💡 Please create the bucket manually in Supabase Dashboard:');
    console.log('   1. Go to Supabase Dashboard → Storage');
    console.log('   2. Click "Create bucket"');
    console.log('   3. Name: "receipts"');
    console.log('   4. Make it private (not public)');
    process.exit(1);
  }
}

createReceiptsBucket();





