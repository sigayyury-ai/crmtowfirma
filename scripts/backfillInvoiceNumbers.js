#!/usr/bin/env node

/**
 * Backfill invoice numbers in Pipedrive deals using data stored in Supabase.
 *
 * Usage examples:
 *   node scripts/backfillInvoiceNumbers.js --limit=50 --offset=0
 *   node scripts/backfillInvoiceNumbers.js --deal=1234
 *   node scripts/backfillInvoiceNumbers.js --dry-run
 *
 * Env requirements: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PIPEDRIVE_API_TOKEN.
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
    return byEquals.split('=').slice(1).join('='); // allow equals in value
  }

  const index = argv.indexOf(name);
  if (index !== -1 && argv[index + 1]) {
    return argv[index + 1];
  }

  return defaultValue;
}

const limit = parseInt(getOption('--limit', '100'), 10);
const offset = parseInt(getOption('--offset', '0'), 10);
const dryRun = getFlag('--dry-run');
const dealFilter = getOption('--deal', null);

if (Number.isNaN(limit) || limit <= 0) {
  logger.error('Invalid --limit value. Must be a positive number.');
  process.exit(1);
}

if (Number.isNaN(offset) || offset < 0) {
  logger.error('Invalid --offset value. Must be a non-negative number.');
  process.exit(1);
}

const client = new PipedriveClient();

async function fetchDealsBatch() {
  if (dealFilter) {
    const dealId = parseInt(dealFilter, 10);
    if (Number.isNaN(dealId)) {
      logger.error('Invalid --deal value. Must be numeric.');
      process.exit(1);
    }

    const { data, error } = await supabase
      .from('proformas')
      .select('id, fullnumber, pipedrive_deal_id')
      .eq('pipedrive_deal_id', dealId)
      .not('fullnumber', 'is', null)
      .limit(1);

    if (error) {
      throw error;
    }

    return data || [];
  }

  const rangeStart = offset;
  const rangeEnd = offset + limit - 1;

  const { data, error } = await supabase
    .from('proformas')
    .select('id, fullnumber, pipedrive_deal_id')
    .not('pipedrive_deal_id', 'is', null)
    .order('issued_at', { ascending: true })
    .range(rangeStart, rangeEnd);

  if (error) {
    throw error;
  }

  return data || [];
}

async function syncDealInvoiceNumber(dealId, fullnumber) {
  if (!dealId) {
    logger.warn('Skipping proforma because dealId is missing', { fullnumber });
    return { success: false, skipped: true, reason: 'missing_deal_id' };
  }

  const dealResult = await client.getDeal(dealId);
  if (!dealResult.success || !dealResult.deal) {
    logger.warn('Failed to fetch deal from Pipedrive', {
      dealId,
      fullnumber,
      error: dealResult.error
    });
    return { success: false, skipped: true, reason: 'deal_not_found' };
  }

  const currentValueRaw = dealResult.deal[INVOICE_NUMBER_FIELD_KEY];
  const currentValue = typeof currentValueRaw === 'string' ? currentValueRaw.trim() : null;
  const desiredValue = typeof fullnumber === 'string' ? fullnumber.trim() : '';

  if (!desiredValue) {
    logger.warn('Skipping proforma because fullnumber is empty', { dealId });
    return { success: false, skipped: true, reason: 'empty_fullnumber' };
  }

  if (currentValue && currentValue === desiredValue) {
    logger.info('Invoice number already up to date in Pipedrive', { dealId, fullnumber });
    return { success: true, skipped: true, reason: 'already_synced' };
  }

  if (dryRun) {
    logger.info('[DRY RUN] Would update invoice number in Pipedrive', {
      dealId,
      previousValue: currentValue || null,
      newValue: desiredValue
    });
    return { success: true, skipped: true, reason: 'dry_run' };
  }

  const updateResult = await client.updateDeal(dealId, {
    [INVOICE_NUMBER_FIELD_KEY]: desiredValue.slice(0, 255)
  });

  if (!updateResult.success) {
    logger.error('Failed to update invoice number in Pipedrive', {
      dealId,
      fullnumber,
      error: updateResult.error
    });
    return { success: false, skipped: false, reason: updateResult.error || 'update_failed' };
  }

  logger.info('Invoice number updated in Pipedrive', {
    dealId,
    fullnumber,
    previousValue: currentValue || null
  });

  return { success: true, skipped: false };
}

async function main() {
  try {
    const proformas = await fetchDealsBatch();
    if (!proformas.length) {
      logger.info('No proformas found for syncing invoice numbers.');
      return;
    }

    logger.info(`Loaded ${proformas.length} proformas for invoice number backfill.`, {
      limit,
      offset,
      dryRun,
      dealFilter
    });

    let successCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const proforma of proformas) {
      try {
        const result = await syncDealInvoiceNumber(proforma.pipedrive_deal_id, proforma.fullnumber);
        if (result.success && !result.skipped) {
          successCount += 1;
        } else if (result.success && result.skipped) {
          skippedCount += 1;
        } else {
          errorCount += 1;
        }
      } catch (error) {
        errorCount += 1;
        logger.error('Unexpected error during invoice number backfill', {
          proformaId: proforma.id,
          dealId: proforma.pipedrive_deal_id,
          error: error.message
        });
      }

      // Respect Pipedrive rate limits.
      if (!dryRun) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    logger.info('Invoice number backfill completed', {
      processed: proformas.length,
      successCount,
      skippedCount,
      errorCount,
      dryRun
    });
  } catch (error) {
    logger.error('Invoice number backfill failed', {
      error: error.message,
      stack: error.stack
    });
    process.exitCode = 1;
  }
}

main();

