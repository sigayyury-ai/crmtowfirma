#!/usr/bin/env node

/**
 * Update product_links.camp_product_id references after merging duplicate products.
 *
 * Usage:
 *   node scripts/updateProductLinkCampIds.js
 */

require('dotenv').config();

const supabase = require('../src/services/supabaseClient');

if (!supabase) {
  console.error('Supabase client is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const mappings = [
  { from: 9, to: 1, label: 'Coliving Portugal' },
  { from: 18, to: 23, label: 'Single Lankowa' },
  { from: 4, to: 21, label: 'Ski France' },
  { from: 5, to: 20, label: 'Ski Poland 01' }
];

async function updateCampProductId({ from, to, label }) {
  const oldValue = String(from);
  const newValue = String(to);

  const { data: rows, error } = await supabase
    .from('product_links')
    .select('id,camp_product_id,crm_product_id,crm_product_name')
    .eq('camp_product_id', oldValue);

  if (error) {
    console.error(`❌ Failed to query product_links for ${label}:`, error);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log(`ℹ️  No product_links entries referencing camp_product_id=${oldValue} (${label})`);
    return;
  }

  console.log(`🔄 Updating ${rows.length} product_links row(s) for ${label}:`, rows.map((row) => ({
    id: row.id,
    camp_product_id: row.camp_product_id,
    crm_product_name: row.crm_product_name || null,
    crm_product_id: row.crm_product_id || null
  })));

  const { error: updateError } = await supabase
    .from('product_links')
    .update({
      camp_product_id: newValue,
      updated_at: new Date().toISOString()
    })
    .eq('camp_product_id', oldValue);

  if (updateError) {
    console.error(`❌ Failed to update camp_product_id for ${label}:`, updateError);
    return;
  }

  const { data: updatedRows, error: verifyError } = await supabase
    .from('product_links')
    .select('id,camp_product_id,crm_product_id,crm_product_name')
    .eq('camp_product_id', newValue)
    .in('id', rows.map((row) => row.id));

  if (verifyError) {
    console.error(`⚠️  Updated rows but failed to verify for ${label}:`, verifyError);
    return;
  }

  console.log(`✅ Updated ${label}:`, updatedRows.map((row) => ({
    id: row.id,
    camp_product_id: row.camp_product_id,
    crm_product_name: row.crm_product_name || null,
    crm_product_id: row.crm_product_id || null
  })));
}

async function main() {
  for (const mapping of mappings) {
    await updateCampProductId(mapping);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error while updating product link mappings:', error);
  process.exit(1);
});


