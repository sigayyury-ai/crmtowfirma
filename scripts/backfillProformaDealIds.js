#!/usr/bin/env node

/**
 * Backfill proforma records in Supabase with pipedrive_deal_id
 * based on invoice numbers stored inside Pipedrive deals.
 *
 * Typical flow:
 *   1. Ensure invoice number field in deals is populated
 *      (see scripts/backfillInvoiceNumbers.js).
 *   2. Run this script to mirror deal IDs back into Supabase.
 *
 * Examples:
 *   node scripts/backfillProformaDealIds.js --dry-run
 *   node scripts/backfillProformaDealIds.js --limit=200 --start=0
 *   node scripts/backfillProformaDealIds.js --invoice="CO-PROF 136/2025"
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEDRIVE_API_TOKEN.
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const PipedriveClient = require('../src/services/pipedrive');
const logger = require('../src/utils/logger');

if (!supabase) {
  logger.error('Supabase client is not configured. Check environment variables.');
  process.exit(1);
}

const INVOICE_NUMBER_FIELD_KEY = '0598d1168fe79005061aa3710ec45c3e03dbe8a3';

const argv = process.argv.slice(2);

function getFlag(name) {
  return argv.includes(name);
}

function getOption(name, defaultValue = undefined) {
  const byEquals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (byEquals) {
    return byEquals.split('=').slice(1).join('=');
  }

  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1]) {
    return argv[index + 1];
  }

  return defaultValue;
}

const dryRun = getFlag('--dry-run');
const invoiceFilter = getOption('--invoice');
const startOption = parseInt(getOption('--start', '0'), 10);
const limitOption = parseInt(getOption('--limit', '500'), 10);

if (Number.isNaN(startOption) || startOption < 0) {
  logger.error('Invalid --start value. Must be a non-negative number.');
  process.exit(1);
}

if (Number.isNaN(limitOption) || limitOption <= 0 || limitOption > 500) {
  logger.error('Invalid --limit value. Must be between 1 and 500.');
  process.exit(1);
}

const client = new PipedriveClient();

async function fetchDealsBatch(start, limit) {
  const response = await client.getDeals({
    start,
    limit,
    status: 'all_not_deleted'
  });

  if (!response.success) {
    throw new Error(response.error || 'Failed to load deals from Pipedrive');
  }

  return response;
}

async function updateProformaDeal(fullnumber, dealId) {
  if (!fullnumber) {
    logger.warn('Cannot update proforma: fullnumber is empty', { dealId });
    return { updated: 0 };
  }

  const normalized = fullnumber.trim();

  if (!normalized) {
    logger.warn('Cannot update proforma: normalized fullnumber is empty', { dealId });
    return { updated: 0 };
  }

  if (dryRun) {
    logger.info('[DRY RUN] Would set pipedrive_deal_id for proforma', {
      fullnumber: normalized,
      dealId
    });
    return { updated: 0 };
  }

  const { data, error } = await supabase
    .from('proformas')
    .update({ pipedrive_deal_id: String(dealId) })
    .eq('fullnumber', normalized)
    .select('id');

  if (error) {
    logger.error('Failed to update proforma with deal id', {
      fullnumber: normalized,
      dealId,
      error: error.message
    });
    return { updated: 0, error };
  }

  const affected = data ? data.length : 0;

  if (affected === 0) {
    logger.warn('No matching proforma found for invoice number', {
      fullnumber: normalized,
      dealId
    });
  } else {
    logger.info('Linked proforma to deal', {
      fullnumber: normalized,
      dealId,
      affected
    });
  }

  return { updated: affected };
}

async function main() {
  try {
    if (invoiceFilter) {
      const response = await fetchDealsBatch(0, 500);
      const target = response.deals.find((deal) => {
        const value = typeof deal[INVOICE_NUMBER_FIELD_KEY] === 'string'
          ? deal[INVOICE_NUMBER_FIELD_KEY].trim()
          : '';
        return value === invoiceFilter.trim();
      });

      if (!target) {
        logger.warn('Deal with specified invoice number not found', {
          invoice: invoiceFilter
        });
        return;
      }

      await updateProformaDeal(invoiceFilter.trim(), target.id);
      return;
    }

    let start = startOption;
    const limit = limitOption;

    let processedDeals = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    while (true) {
      const response = await fetchDealsBatch(start, limit);
      const deals = response.deals || [];

      if (!deals.length) {
        logger.info('No more deals returned by Pipedrive', { start });
        break;
      }

      logger.info('Processing deal batch', {
        start,
        limit,
        fetched: deals.length,
        dryRun
      });

      for (const deal of deals) {
        processedDeals += 1;
        const invoiceValueRaw = deal[INVOICE_NUMBER_FIELD_KEY];
        const invoiceValue = typeof invoiceValueRaw === 'string'
          ? invoiceValueRaw.trim()
          : '';

        if (!invoiceValue) {
          skippedCount += 1;
          continue;
        }

        const result = await updateProformaDeal(invoiceValue, deal.id);
        if (result.updated > 0) {
          updatedCount += result.updated;
        } else {
          skippedCount += 1;
        }
      }

      const pagination = response.pagination;
      if (!pagination?.more_items_in_collection) {
        break;
      }

      start = pagination.next_start ?? start + limit;
    }

    logger.info('Backfill of proforma deal ids completed', {
      processedDeals,
      updatedCount,
      skippedCount,
      dryRun
    });
  } catch (error) {
    logger.error('Backfill of proforma deal ids failed', {
      error: error.message,
      stack: error.stack
    });
    process.exitCode = 1;
  }
}

main();

