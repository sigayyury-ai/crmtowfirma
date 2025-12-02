#!/usr/bin/env node

/**
 * Backfill Stripe event items (line items grouped by event_key) into Supabase.
 *
 * Usage:
 *   node scripts/backfillStripeEventItems.js --limit=50 --offset=0
 *   node scripts/backfillStripeEventItems.js --session=cs_live_xxx
 *   node scripts/backfillStripeEventItems.js --dry-run
 *   node scripts/backfillStripeEventItems.js --source=stripe_events --limit=100
 *
 * Requirements:
 *   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   - STRIPE_API_KEY (или STRIPE_MODE=test + тестовый ключ)
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');
const { getStripeClient } = require('../src/services/stripe/client');
const StripeEventStorageService = require('../src/services/stripe/eventStorageService');

if (!supabase) {
  logger.error('Supabase client is not configured. Check environment variables.');
  process.exit(1);
}

const argv = process.argv.slice(2);

function getFlag(name) {
  return argv.includes(name);
}

function getOption(name, defaultValue = undefined) {
  const byEquals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (byEquals) {
    return byEquals.split('=').slice(1).join('=');
  }
  const idx = argv.indexOf(name);
  if (idx !== -1 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return defaultValue;
}

const limit = parseInt(getOption('--limit', '50'), 10);
const offset = parseInt(getOption('--offset', '0'), 10);
const dryRun = getFlag('--dry-run');
const sessionFilter = getOption('--session', null);

if (Number.isNaN(limit) || limit <= 0) {
  logger.error('Invalid --limit value. Must be a positive number.');
  process.exit(1);
}

if (Number.isNaN(offset) || offset < 0) {
  logger.error('Invalid --offset value. Must be a non-negative number.');
  process.exit(1);
}

const source = (getOption('--source', 'stripe_payments') || '').toLowerCase();
const useEventsStripe = source === 'stripe_events' || getFlag('--events');
const stripe = getStripeClient(useEventsStripe ? { type: 'events' } : {});
const eventStorageService = new StripeEventStorageService({ stripe });
const BATCH_LIMIT = limit;

async function hasSessionInStorage(sessionId) {
  const { count, error } = await supabase
    .from('stripe_event_items')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);

  if (error) {
    logger.warn('Failed to check existing event items', {
      sessionId,
      error: error.message
    });
    return true;
  }

  return count > 0;
}

async function fetchCandidateSessionsFromStripe() {
  const filtered = [];
  let hasMore = true;
  let startingAfter = null;
  let attemptsWithoutNewSessions = 0;

  while (filtered.length < BATCH_LIMIT && hasMore) {
    const pageLimit = Math.min(100, BATCH_LIMIT - filtered.length);
    const params = {
      limit: pageLimit,
      status: 'complete'
    };
    if (startingAfter) {
      params.starting_after = startingAfter;
    }

    const response = await stripe.checkout.sessions.list(params);
    const sessions = response?.data || [];

    let newSessionsFound = false;
    for (const session of sessions) {
      if (session.payment_status !== 'paid') {
        continue;
      }
      const exists = await hasSessionInStorage(session.id);
      if (!exists) {
        filtered.push({ session_id: session.id });
        newSessionsFound = true;
      }

      if (filtered.length >= BATCH_LIMIT) {
        break;
      }
    }

    if (!newSessionsFound) {
      attemptsWithoutNewSessions += 1;
    } else {
      attemptsWithoutNewSessions = 0;
    }

    hasMore = Boolean(response?.has_more);
    if (hasMore && sessions.length) {
      startingAfter = sessions[sessions.length - 1].id;
    } else {
      hasMore = false;
    }

    if (attemptsWithoutNewSessions >= 3) {
      logger.info('No new Stripe event sessions found in several pages, stopping early');
      break;
    }
  }

  return filtered;
}

async function fetchCandidatePayments() {
  if (sessionFilter) {
    return [
      {
        session_id: sessionFilter,
        currency: null,
        payment_status: 'paid'
      }
    ];
  }

  if (useEventsStripe) {
    return fetchCandidateSessionsFromStripe();
  }

  const { data, error } = await supabase
    .from('stripe_payments')
    .select('session_id, currency, payment_status, status')
    .eq('payment_status', 'paid')
    .eq('status', 'processed')
    .order('created_at', { ascending: false })
    .range(offset, offset + BATCH_LIMIT - 1);

  if (error) {
    logger.error('Failed to load stripe payments from Supabase', { error: error.message });
    throw error;
  }

  if (!data || data.length === 0) {
    return [];
  }

  const filtered = [];
  for (const payment of data) {
    const exists = await hasSessionInStorage(payment.session_id);
    if (!exists) {
      filtered.push(payment);
    }
  }

  return filtered;
}

async function main() {
  try {
    const payments = await fetchCandidatePayments();
    if (!payments.length) {
      logger.info('No candidate Stripe payments found for backfill.');
      return;
    }

    logger.info('Processing stripe sessions for event backfill', {
      total: payments.length,
      dryRun,
      source: useEventsStripe ? 'stripe_events' : 'stripe_payments'
    });

    let totalItems = 0;
    for (const payment of payments) {
      try {
        const result = await eventStorageService.syncSession(payment.session_id, { dryRun });
        totalItems += result.inserted;
        logger.info('Processed session', result);
      } catch (error) {
        logger.error('Failed to process session', {
          sessionId: payment.session_id,
          error: error.message
        });
      }
    }

    logger.info('Backfill completed', {
      sessionsProcessed: payments.length,
      itemsInserted: totalItems,
      dryRun
    });
  } catch (error) {
    logger.error('Backfill failed', { error: error.message });
    process.exitCode = 1;
  }
}

main();

