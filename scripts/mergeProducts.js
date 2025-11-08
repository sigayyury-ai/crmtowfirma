#!/usr/bin/env node

/**
 * Merge two product entries in Supabase so that all proformas reference
 * the target product and the source product is removed.
 *
 * Usage:
 *   node scripts/mergeProducts.js
 *
 * Make sure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are available.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('Supabase client is not configured. Check environment variables.');
  process.exit(1);
}

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: node scripts/mergeProducts.js "Target Product" "Source Product"');
  process.exit(1);
}

const TARGET_NAME = args[0];
const SOURCE_NAME = args[1];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeProductName(name) {
  if (!name) return null;
  const trimmed = normalizeWhitespace(name);
  if (!trimmed) return null;

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchProductByName(name) {
  const normalized = normalizeProductName(name);

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .or(`name.eq.${normalizeWhitespace(name)},normalized_name.eq.${normalized}`)
    .limit(1);

  if (error) {
    throw error;
  }

  return data?.[0] || null;
}

async function updateProformaProducts(sourceId, targetId, targetName) {
  const { data, error } = await supabase
    .from('proforma_products')
    .update({
      product_id: targetId,
      name: targetName
    })
    .eq('product_id', sourceId)
    .select('proforma_id');

  if (error) {
    throw error;
  }

  return data ? data.length : 0;
}

async function deleteProduct(productId) {
  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', productId);

  if (error) {
    throw error;
  }
}

async function ensureProductName(productId, name) {
  const normalized = normalizeProductName(name);

  const { error } = await supabase
    .from('products')
    .update({
      name: normalizeWhitespace(name).slice(0, 255),
      normalized_name: normalized
    })
    .eq('id', productId);

  if (error) {
    throw error;
  }
}

async function main() {
  try {
    console.log('⏳  Fetching products from Supabase...');
    const targetProduct = await fetchProductByName(TARGET_NAME);
    const sourceProduct = await fetchProductByName(SOURCE_NAME);

    if (!targetProduct) {
      console.error(`Target product "${TARGET_NAME}" not found.`);
      process.exit(1);
    }

    if (!sourceProduct) {
      console.error(`Source product "${SOURCE_NAME}" not found.`);
      process.exit(1);
    }

    if (targetProduct.id === sourceProduct.id) {
      console.log('Products already merged – nothing to do.');
      process.exit(0);
    }

    console.log('🔄 Updating proforma products to use the target product...');
    const updatedRows = await updateProformaProducts(
      sourceProduct.id,
      targetProduct.id,
      TARGET_NAME
    );
    console.log(`✔ Updated ${updatedRows} proforma product rows.`);

    console.log('🧹 Deleting source product entry...');
    await deleteProduct(sourceProduct.id);
    console.log('✔ Source product removed.');

    console.log('🛠  Ensuring target product has canonical name and normalized name...');
    await ensureProductName(targetProduct.id, TARGET_NAME);
    console.log('✔ Target product updated.');

    console.log('\n✅ Merge completed successfully.');
  } catch (error) {
    console.error('❌ Merge failed:', error);
    process.exit(1);
  }
}

main();

