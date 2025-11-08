#!/usr/bin/env node

/**
 * Backfill buyer information for proformas stored in Supabase by fetching
 * details from wFirma. Intended for one-off migrations when historic data
 * lacks buyer fields.
 *
 * Usage:
 *   node scripts/backfillProformaBuyers.js
 *
 * Environment:
 *   Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and wFirma credentials.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const ProformaRepository = require('../src/services/proformaRepository');
const { WfirmaLookup } = require('../src/services/vatMargin/wfirmaLookup');

const BATCH_SIZE = parseInt(process.env.PROFORMA_BACKFILL_BATCH || '20', 10);
const SLEEP_MS = parseInt(process.env.PROFORMA_BACKFILL_SLEEP || '250', 10);

if (!supabase) {
  console.error('Supabase client is not configured. Check environment variables.');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\s+/g, ' ').trim();
}

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

async function fetchProformasBatch(offset) {
  const start = offset;
  const end = offset + BATCH_SIZE - 1;

  const { data, error } = await supabase
    .from('proformas')
    .select('id, fullnumber')
    .or('buyer_name.is.null,buyer_name.eq.')
    .order('id', { ascending: true })
    .range(start, end);

  if (error) {
    throw error;
  }

  return data || [];
}

async function updateProforma(proformaId, payload) {
  const { error } = await supabase
    .from('proformas')
    .update(payload)
    .eq('id', proformaId);

  if (error) {
    throw error;
  }
}

async function backfill() {
  const repository = new ProformaRepository();
  const wfirmaLookup = new WfirmaLookup();

  if (!repository.isEnabled()) {
    console.error('Supabase is not enabled in ProformaRepository. Aborting.');
    process.exit(1);
  }

  console.log('Starting proforma buyer backfill from wFirma...');
  console.log(`Batch size: ${BATCH_SIZE}, delay: ${SLEEP_MS}ms`);

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;

  while (true) {
    let batch;
    try {
      batch = await fetchProformasBatch(offset);
    } catch (error) {
      console.error('Failed to fetch proformas batch:', error);
      break;
    }

    if (!batch.length) {
      break;
    }

    console.log(`Processing batch ${offset / BATCH_SIZE + 1}, ${batch.length} records...`);

    for (const proforma of batch) {
      totalProcessed += 1;

      const proformaId = proforma.id;
      const fullnumber = proforma.fullnumber || '—';

      try {
        const invoice = await wfirmaLookup.getFullProformaById(proformaId);

        if (!invoice || !invoice.buyer) {
          console.warn(`wFirma returned no buyer data for proforma ${fullnumber} (${proformaId})`);
          continue;
        }

        const buyer = invoice.buyer;
        const buyerNameRaw = normalizeWhitespace(buyer.name || buyer.altName);
        const buyerAltNameRaw = normalizeWhitespace(buyer.altName);

        if (!buyerNameRaw && !buyerAltNameRaw) {
          console.warn(`Proforma ${fullnumber} (${proformaId}) has no buyer name even after lookup.`);
          continue;
        }

        const updatePayload = {
          buyer_name: buyerNameRaw ? repository.truncate(buyerNameRaw, 255) : null,
          buyer_alt_name: buyerAltNameRaw ? repository.truncate(buyerAltNameRaw, 255) : null,
          buyer_normalized_name: repository.normalizeContactName(buyerNameRaw || buyerAltNameRaw || null),
          buyer_email: buyer.email ? repository.truncate(buyer.email, 255) : null,
          buyer_phone: buyer.phone ? repository.truncate(buyer.phone, 64) : null,
          buyer_street: buyer.street ? repository.truncate(buyer.street, 255) : null,
          buyer_zip: buyer.zip ? repository.truncate(buyer.zip, 64) : null,
          buyer_city: buyer.city ? repository.truncate(buyer.city, 255) : null,
          buyer_country: buyer.country ? repository.truncate(buyer.country, 255) : null,
          buyer_tax_id: buyer.taxId ? repository.truncate(buyer.taxId, 64) : null
        };

        const compacted = compactRecord(updatePayload);

        if (Object.keys(compacted).length === 0) {
          console.warn(`Nothing to update for proforma ${fullnumber} (${proformaId}).`);
          continue;
        }

        await updateProforma(proformaId, compacted);
        totalUpdated += 1;
        console.log(`✔ Updated proforma ${fullnumber} (${proformaId}) with buyer data.`);
      } catch (error) {
        totalFailed += 1;
        console.error(`✖ Failed to update proforma ${fullnumber} (${proformaId}):`, error.message || error);
      }

      if (SLEEP_MS > 0) {
        await sleep(SLEEP_MS);
      }
    }

    offset += batch.length;
  }

  console.log('\nBackfill finished.');
  console.log(`Processed: ${totalProcessed}`);
  console.log(`Updated:   ${totalUpdated}`);
  console.log(`Failed:    ${totalFailed}`);
}

backfill().catch((error) => {
  console.error('Unexpected error during backfill:', error);
  process.exit(1);
});

