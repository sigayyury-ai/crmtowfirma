#!/usr/bin/env node

require('dotenv').config();
const supabase = require('../src/services/supabaseClient');

async function deleteReceipt(receiptId) {
  const { error } = await supabase
    .from('receipt_uploads')
    .delete()
    .eq('id', receiptId);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log(`Receipt ${receiptId} deleted`);
  }
}

const receiptId = process.argv[2];
if (!receiptId) {
  console.log('Usage: node scripts/deleteReceipt.js <receipt-id>');
  process.exit(1);
}

deleteReceipt(receiptId);





