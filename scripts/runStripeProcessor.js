#!/usr/bin/env node

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');

async function main() {
  const argv = yargs(hideBin(process.argv))
    .option('mode', {
      type: 'string',
      default: process.env.STRIPE_MODE || 'test',
      describe: 'Stripe mode (test/live)'
    })
    .option('from', {
      type: 'string',
      describe: 'ISO date-time filter (created >= from)'
    })
    .option('to', {
      type: 'string',
      describe: 'ISO date-time filter (created <= to)'
    })
    .option('deal', {
      type: 'string',
      describe: 'Filter by deal ID (metadata.deal_id)'
    })
    .help()
    .argv;

  process.env.STRIPE_MODE = argv.mode;
  
  // Reset invoice_type field from "done" (73) to "Stripe" (75) for testing
  if (argv.deal) {
    try {
      const pipedriveClient = new PipedriveClient();
      const invoiceTypeFieldKey = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
      const stripeTriggerValue = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');
      
      // eslint-disable-next-line no-console
      console.log(`[Reset] Setting invoice_type to "${stripeTriggerValue}" (Stripe) for deal ${argv.deal}...`);
      
      const updateResult = await pipedriveClient.updateDeal(argv.deal, {
        [invoiceTypeFieldKey]: stripeTriggerValue
      });
      
      if (updateResult.success) {
        // eslint-disable-next-line no-console
        console.log(`[Reset] ✅ Deal ${argv.deal} invoice_type reset to Stripe`);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[Reset] ⚠️  Failed to reset invoice_type: ${updateResult.error || 'unknown error'}`);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[Reset] ⚠️  Error resetting invoice_type: ${error.message}`);
    }
  }
  
  const processor = new StripeProcessorService();
  const result = await processor.processPendingPayments({
    trigger: 'cli',
    runId: `manual-${Date.now()}`,
    from: argv.from,
    to: argv.to,
    dealId: argv.deal
  });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Stripe processor CLI failed:', error); // eslint-disable-line no-console
  process.exit(1);
});
