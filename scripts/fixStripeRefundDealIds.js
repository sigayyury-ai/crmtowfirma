#!/usr/bin/env node

/**
 * Utility script to inspect Stripe refunds that are missing deal_id metadata
 * and optionally set a specific deal_id for all of them.
 *
 * Usage examples:
 *   # Dry-run: list up to 25 refunds without deal_id
 *   node scripts/fixStripeRefundDealIds.js --limit 25
 *
 *   # Assign deal 1596 to all missing refunds created since 2024-01-01
 *   node scripts/fixStripeRefundDealIds.js --deal 1596 --since 2024-01-01 --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const { getStripeClient } = require('../src/services/stripe/client');

const argv = yargs(hideBin(process.argv))
  .option('deal', {
    type: 'string',
    describe: 'Pipedrive deal ID to set in refund metadata (deal_id)',
  })
  .option('limit', {
    type: 'number',
    default: 50,
    describe: 'Maximum number of refunds without deal_id to process',
  })
  .option('since', {
    type: 'string',
    describe: 'Filter refunds created at or after this ISO date (YYYY-MM-DD)',
  })
  .option('until', {
    type: 'string',
    describe: 'Filter refunds created before or on this ISO date (YYYY-MM-DD)',
  })
  .option('apply', {
    type: 'boolean',
    default: false,
    describe: 'Actually update Stripe metadata (otherwise dry-run)',
  })
  .help()
  .alias('help', 'h')
  .argv;

function parseDateToTimestamp(value) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid date "${value}". Use YYYY-MM-DD format.`);
  }
  return Math.floor(timestamp / 1000);
}

function hasDealMetadata(refund) {
  const metadata = refund?.metadata || {};
  return Boolean(metadata.deal_id || metadata.dealId);
}

async function main() {
  if (argv.apply && !argv.deal) {
    throw new Error('Please provide --deal when running with --apply');
  }

  const stripe = getStripeClient();
  const params = {
    limit: 100,
  };

  const createdFilter = {};
  const sinceTs = parseDateToTimestamp(argv.since);
  const untilTs = parseDateToTimestamp(argv.until);
  if (sinceTs) createdFilter.gte = sinceTs;
  if (untilTs) createdFilter.lte = untilTs;
  if (Object.keys(createdFilter).length > 0) {
    params.created = createdFilter;
  }

  let scanned = 0;
  let fixed = 0;
  const missingRefunds = [];

  const list = stripe.refunds.list(params);
  for await (const refund of list) {
    scanned += 1;
    if (!hasDealMetadata(refund)) {
      missingRefunds.push(refund);
      console.log(
        `[${refund.id}] ${refund.amount / 100} ${refund.currency.toUpperCase()} | created ${new Date(
          refund.created * 1000,
        ).toISOString()}`,
      );
      if (argv.apply) {
        const newMetadata = {
          ...(refund.metadata || {}),
          deal_id: argv.deal,
        };
        await stripe.refunds.update(refund.id, { metadata: newMetadata });
        fixed += 1;
        console.log(`   ↳ deal_id set to ${argv.deal}`);
      }
      if (missingRefunds.length >= argv.limit) {
        break;
      }
    }
  }

  console.log(`Scanned refunds: ${scanned}`);
  console.log(`Refunds without deal_id found: ${missingRefunds.length}`);
  if (argv.apply) {
    console.log(`Updated refunds: ${fixed}`);
  } else if (missingRefunds.length && !argv.deal) {
    console.log('Tip: re-run with --deal <id> --apply to update metadata');
  }
}

main().catch((error) => {
  console.error('Failed to fix Stripe refund metadata:', error.message);
  process.exit(1);
});
