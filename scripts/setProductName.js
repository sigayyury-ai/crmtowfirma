#!/usr/bin/env node

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('Supabase client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/setProductName.js <productId> "New Name"');
  process.exit(1);
}

const productId = Number(args[0]);
const newName = args.slice(1).join(' ');

if (!Number.isInteger(productId) || productId <= 0) {
  console.error('Invalid productId provided. Must be a positive integer.');
  process.exit(1);
}

if (!newName || !newName.trim()) {
  console.error('New name must be a non-empty string.');
  process.exit(1);
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductName(name) {
  const trimmed = normalizeWhitespace(name);
  if (!trimmed) {
    return '';
  }

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function updateProductName() {
  const normalizedName = normalizeProductName(newName);
  const formattedName = normalizeWhitespace(newName).slice(0, 255);

  const { data, error } = await supabase
    .from('products')
    .update({
      name: formattedName,
      normalized_name: normalizedName
    })
    .eq('id', productId)
    .select('id,name,normalized_name')
    .single();

  if (error) {
    console.error('Failed to update product name:', error);
    process.exit(1);
  }

  console.log('Updated product:', data);
}

updateProductName();


