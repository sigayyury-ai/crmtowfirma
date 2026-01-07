#!/usr/bin/env node

/**
 * Script to create a second payment (rest/final) for a deal that already has a first payment.
 * This is useful for testing the two-payment flow.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const yargs = require('yargs');
const { hideBin } = require('yargs/helpers');
const StripeProcessorService = require('../src/services/stripe/processor');
const PipedriveClient = require('../src/services/pipedrive');

async function main() {
  const argv = yargs(hideBin(process.argv))
    // Всегда live режим, опция mode удалена
    .option('deal', {
      type: 'string',
      required: true,
      describe: 'Deal ID to create second payment for'
    })
    .option('amount', {
      type: 'number',
      describe: 'Amount for second payment (if not specified, will use remaining amount from deal)'
    })
    .help()
    .argv;

  // Всегда live режим
  const dealId = argv.deal;

  try {
    // 1. Reset invoice_type to Stripe trigger
    const pipedriveClient = new PipedriveClient();
    const invoiceTypeFieldKey = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const stripeTriggerValue = String(process.env.PIPEDRIVE_STRIPE_INVOICE_TYPE_VALUE || '75');

    // eslint-disable-next-line no-console
    console.log(`[Reset] Setting invoice_type to "${stripeTriggerValue}" (Stripe) for deal ${dealId}...`);

    const updateResult = await pipedriveClient.updateDeal(dealId, {
      [invoiceTypeFieldKey]: stripeTriggerValue
    });

    if (updateResult.success) {
      // eslint-disable-next-line no-console
      console.log(`[Reset] ✅ Deal ${dealId} invoice_type reset to Stripe`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[Reset] ⚠️  Failed to reset invoice_type: ${updateResult.error || 'unknown error'}`);
    }

    // 2. Get deal data
    const dealResult = await pipedriveClient.getDeal(dealId);
    if (!dealResult.success || !dealResult.deal) {
      throw new Error(`Failed to fetch deal: ${dealResult.error || 'unknown'}`);
    }

    const deal = dealResult.deal;
    const dealProductsResult = await pipedriveClient.getDealProducts(dealId);
    if (!dealProductsResult.success || !dealProductsResult.products || dealProductsResult.products.length === 0) {
      throw new Error('No products found in deal');
    }

    const firstProduct = dealProductsResult.products[0];
    const quantity = parseFloat(firstProduct.quantity) || 1;
    const itemPrice = typeof firstProduct.item_price === 'number'
      ? firstProduct.item_price
      : parseFloat(firstProduct.item_price) || 0;
    const sumPrice = typeof firstProduct.sum === 'number'
      ? firstProduct.sum
      : parseFloat(firstProduct.sum) || 0;
    const totalPrice = itemPrice || sumPrice || parseFloat(deal.value) || 0;
    const currency = (deal.currency || 'PLN').toUpperCase();

    // 3. Get full deal data first (needed for processor)
    const fullDealResult = await pipedriveClient.getDealWithRelatedData(dealId);
    if (!fullDealResult.success || !fullDealResult.deal) {
      throw new Error(`Failed to fetch full deal data: ${fullDealResult.error || 'unknown'}`);
    }

    // 4. Check existing payments
    const processor = new StripeProcessorService();
    const stripeRepo = processor.repository;
    const existingPayments = await stripeRepo.listPayments({
      dealId: dealId,
      status: 'processed'
    });

    // eslint-disable-next-line no-console
    console.log(`\n[Payment Check] Found ${existingPayments.length} existing payment(s) for deal ${dealId}`);

    // Calculate remaining amount (or use provided amount)
    let secondPaymentAmount = argv.amount;
    if (!secondPaymentAmount) {
      if (existingPayments.length === 0) {
        // eslint-disable-next-line no-console
        console.warn('[Payment Check] ⚠️  No existing payments found. Will create first payment (deposit) instead of second...');
        // Use half of total price as deposit
        secondPaymentAmount = totalPrice / 2;
      } else {
        // Calculate total paid in original currency (use original_amount if available)
        const totalPaid = existingPayments.reduce((sum, p) => {
          // Use original_amount if available (before conversion), otherwise use amount_pln converted back
          if (p.original_amount !== null && p.original_amount !== undefined) {
            return sum + parseFloat(p.original_amount);
          }
          // If no original_amount, assume it was in the same currency as deal
          return sum + (parseFloat(p.amount_pln) || 0);
        }, 0);

        // eslint-disable-next-line no-console
        console.log(`[Payment Check] Total paid: ${totalPaid.toFixed(2)} ${currency}`);
        // eslint-disable-next-line no-console
        console.log(`[Payment Check] Total price: ${totalPrice.toFixed(2)} ${currency}`);
        
        secondPaymentAmount = Math.max(0, totalPrice - totalPaid);
        
        if (secondPaymentAmount <= 0) {
          // eslint-disable-next-line no-console
          console.warn('[Payment Check] ⚠️  Deal appears to be fully paid. Creating final payment anyway...');
          secondPaymentAmount = 0.01; // Minimum amount to create session
        }
      }
    }

    // eslint-disable-next-line no-console
    console.log(`\n[Second Payment] Creating second payment (rest) for deal ${dealId}...`);
    // eslint-disable-next-line no-console
    console.log(`[Second Payment] Amount: ${secondPaymentAmount.toFixed(2)} ${currency}`);

    if (secondPaymentAmount <= 0) {
      throw new Error('No remaining amount to pay. Deal is fully paid.');
    }

    // eslint-disable-next-line no-console
    console.log(`[Second Payment] Amount: ${secondPaymentAmount.toFixed(2)} ${currency}`);

    // Create checkout session with 'rest' payment_type
    const result = await processor.createCheckoutSessionForDeal(fullDealResult.deal, {
      trigger: 'cli',
      runId: `manual-second-${Date.now()}`,
      paymentType: 'rest', // Override default 'deposit'
      customAmount: secondPaymentAmount // Override total price
    });

    if (result.success) {
      // eslint-disable-next-line no-console
      console.log(`\n✅ Second payment created successfully!`);
      // eslint-disable-next-line no-console
      console.log(`   Session ID: ${result.sessionId}`);
      // eslint-disable-next-line no-console
      console.log(`   Session URL: ${result.sessionUrl}`);
      // eslint-disable-next-line no-console
      console.log(`   Amount: ${secondPaymentAmount.toFixed(2)} ${currency}`);
    } else {
      throw new Error(result.error || 'Failed to create second payment');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to create second payment:', error.message);
    process.exit(1);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Script failed:', error);
  process.exit(1);
});

