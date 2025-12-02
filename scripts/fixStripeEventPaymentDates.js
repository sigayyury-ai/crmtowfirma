#!/usr/bin/env node

/**
 * Fix processed_at timestamps for Stripe event placeholder payments so that
 * monthly reports use the actual payment date instead of the import date.
 *
 * Usage:
 *   node scripts/fixStripeEventPaymentDates.js [--limit=200]
 */

const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

if (!supabase) {
  logger.error('Supabase client is not configured. Check environment variables.');
  process.exit(1);
}

const argv = process.argv.slice(2);

function getOption(name, defaultValue) {
  const match = argv.find((arg) => arg.startsWith(`${name}=`));
  if (match) {
    return match.split('=').slice(1).join('=');
  }
  return defaultValue;
}

const BATCH_LIMIT = parseInt(getOption('--limit', '500'), 10);
if (Number.isNaN(BATCH_LIMIT) || BATCH_LIMIT <= 0) {
  logger.error('--limit must be a positive number');
  process.exit(1);
}

function toIso(secondsOrIso) {
  if (!secondsOrIso && secondsOrIso !== 0) return null;
  if (typeof secondsOrIso === 'string') {
    const parsed = new Date(secondsOrIso);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof secondsOrIso === 'number' && Number.isFinite(secondsOrIso)) {
    return new Date(secondsOrIso * 1000).toISOString();
  }
  return null;
}

function extractPaidTimestamp(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }
  const transitions = rawPayload.status_transitions || {};
  if (Number.isFinite(transitions.paid_at)) {
    return transitions.paid_at;
  }
  if (Number.isFinite(transitions.completed_at)) {
    return transitions.completed_at;
  }
  if (Number.isFinite(rawPayload.created)) {
    return rawPayload.created;
  }
  if (
    rawPayload.payment_intent
    && typeof rawPayload.payment_intent === 'object'
    && Number.isFinite(rawPayload.payment_intent.created)
  ) {
    return rawPayload.payment_intent.created;
  }
  return null;
}

async function fetchBatch(rangeStart, rangeEnd) {
  const { data, error } = await supabase
    .from('stripe_payments')
    .select('id, session_id, raw_payload, processed_at, created_at, status')
    .eq('status', 'event_placeholder')
    .order('created_at', { ascending: true })
    .range(rangeStart, rangeEnd);

  if (error) {
    throw new Error(`Failed to load stripe_payments batch: ${error.message}`);
  }

  return data || [];
}

async function applyUpdates(updates) {
  if (!updates.length) {
    return;
  }

  const chunks = [];
  for (let i = 0; i < updates.length; i += 100) {
    chunks.push(updates.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    const { error } = await supabase.from('stripe_payments').upsert(chunk);
    if (error) {
      throw new Error(`Failed to update stripe_payments: ${error.message}`);
    }
  }
}

async function main() {
  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const batch = await fetchBatch(offset, offset + BATCH_LIMIT - 1);
    if (!batch.length) {
      break;
    }

    const updates = [];
    for (const payment of batch) {
      totalProcessed += 1;

      let rawPayload = payment.raw_payload;
      if (typeof rawPayload === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload);
        } catch (parseError) {
          logger.warn('Failed to parse raw_payload JSON', {
            id: payment.id,
            session_id: payment.session_id
          });
          rawPayload = null;
        }
      }

      const paidTimestamp = extractPaidTimestamp(rawPayload);
      if (!paidTimestamp) {
        continue;
      }

      const processedAt = toIso(paidTimestamp);
      const createdAt = rawPayload?.created ? toIso(rawPayload.created) : payment.created_at;

      if (!processedAt) {
        continue;
      }

      if (processedAt !== payment.processed_at || createdAt !== payment.created_at) {
        updates.push({
          id: payment.id,
          session_id: payment.session_id,
          processed_at: processedAt,
          created_at: createdAt || payment.created_at
        });
      }
    }

    if (updates.length) {
      await applyUpdates(updates);
      totalUpdated += updates.length;
      logger.info('Updated stripe payment timestamps', {
        updated: updates.length,
        processed: totalProcessed
      });
    }

    if (batch.length < BATCH_LIMIT) {
      break;
    }
    offset += BATCH_LIMIT;
  }

  logger.info('Stripe event payment date fix completed', {
    totalProcessed,
    totalUpdated
  });
}

main().catch((error) => {
  logger.error('Stripe event payment date fix failed', { error: error.message });
  process.exit(1);
});


