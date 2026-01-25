#!/usr/bin/env node

/**
 * Test script for receipt upload
 * Usage: node scripts/testReceiptUpload.js [filepath]
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';
const FILE_PATH = process.argv[2] || path.join(__dirname, '../tmp/Общие расходы/201-00240359.pdf');

async function testReceiptUpload() {
  try {
    console.log('🧾 Testing receipt upload...');
    console.log(`📁 File: ${FILE_PATH}`);

    if (!fs.existsSync(FILE_PATH)) {
      console.error(`❌ File not found: ${FILE_PATH}`);
      process.exit(1);
    }

    const fileBuffer = fs.readFileSync(FILE_PATH);
    const fileName = path.basename(FILE_PATH);
    const mimeType = getMimeType(fileName);

    console.log(`📊 File size: ${(fileBuffer.length / 1024).toFixed(2)} KB`);
    console.log(`📄 MIME type: ${mimeType}`);

    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: fileName,
      contentType: mimeType
    });

    console.log(`\n📤 Uploading to ${API_BASE}/receipts/upload...`);

    const response = await axios.post(`${API_BASE}/receipts/upload`, formData, {
      headers: formData.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30000
    });

    if (response.status === 202 || response.status === 200) {
      const receiptId = response.data.data.receiptId;
      console.log(`✅ Receipt uploaded successfully!`);
      console.log(`📋 Receipt ID: ${receiptId}`);
      console.log(`📊 Status: ${response.data.data.status}`);

      // Poll for details
      console.log(`\n⏳ Waiting for processing...`);
      await pollReceiptDetails(receiptId);

    } else {
      console.error(`❌ Unexpected status: ${response.status}`);
      console.error(response.data);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
      console.error('Status:', error.response.status);
    }
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

async function pollReceiptDetails(receiptId, maxAttempts = 20) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

    try {
      const response = await axios.get(`${API_BASE}/receipts/${receiptId}`);
      const { receipt, extraction, candidates, link } = response.data.data;

      console.log(`\n📊 Attempt ${i + 1}/${maxAttempts}:`);
      console.log(`   Status: ${receipt.status}`);

      if (extraction) {
        console.log(`   Extraction status: ${extraction.status}`);
        if (extraction.status === 'done' && extraction.extracted_json) {
          const extracted = extraction.extracted_json;
          console.log(`   📋 Extracted data:`);
          if (extracted.vendor) console.log(`      Vendor: ${extracted.vendor}`);
          if (extracted.date) console.log(`      Date: ${extracted.date}`);
          if (extracted.amount) console.log(`      Amount: ${extracted.amount} ${extracted.currency || ''}`);
          if (extracted.confidence) console.log(`      Confidence: ${extracted.confidence}%`);
        } else if (extraction.status === 'failed') {
          console.log(`   ❌ Extraction failed: ${extraction.error}`);
        }
      }

      if (candidates && candidates.length > 0) {
        console.log(`   🎯 Found ${candidates.length} candidates:`);
        candidates.slice(0, 3).forEach((c, idx) => {
          console.log(`      ${idx + 1}. Payment #${c.payment_id}: ${c.amount} ${c.currency} (${c.score}%)`);
          console.log(`         Reasons: ${c.reasons.join(', ')}`);
        });
      }

      if (link) {
        console.log(`   ✅ Linked to payment #${link.payment_id}`);
      }

      // Stop polling if processing is complete
      if (receipt.status === 'matched' || receipt.status === 'failed') {
        console.log(`\n✅ Processing complete!`);
        return;
      }

    } catch (error) {
      console.error(`   ⚠️  Error polling: ${error.message}`);
    }
  }

  console.log(`\n⏱️  Max polling attempts reached`);
}

function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const mimeTypes = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.heic': 'image/heic',
    '.heif': 'image/heif'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

testReceiptUpload();





