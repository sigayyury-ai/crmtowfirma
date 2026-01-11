const logger = require('../../utils/logger');
const { getStripeClient } = require('./client');
const { logStripeError } = require('../../utils/logging/stripe');

async function checkHealth() {
  const stripe = getStripeClient();
  const account = await stripe.accounts.retrieve();
  return {
    accountId: account?.id,
    businessType: account?.business_type,
    defaultCurrency: account?.default_currency,
    email: account?.email,
    livemode: account?.livemode,
    capabilities: account?.capabilities || {}
  };
}

function buildSessionFilters({ from, to, mode } = {}) {
  const created = {};
  if (from) {
    const fromDate = Date.parse(from);
    if (!Number.isNaN(fromDate)) created.gte = Math.floor(fromDate / 1000);
  }
  if (to) {
    const toDate = Date.parse(to);
    if (!Number.isNaN(toDate)) created.lte = Math.floor(toDate / 1000);
  }
  const filters = {};
  if (Object.keys(created).length > 0) filters.created = created;
  if (mode) filters.mode = mode;
  return filters;
}

async function listCheckoutSessionsPaged({ pageSize = 100, cursor, filters } = {}) {
  const stripe = getStripeClient();
  const params = {
    limit: Math.min(Math.max(parseInt(pageSize, 10) || 100, 1), 100),
    expand: ['data.line_items']
  };
  if (cursor) params.starting_after = cursor;
  
  // Filter out invalid parameters that Stripe API doesn't accept
  // payment_status is a property of the session object, not a filter parameter
  const validParams = ['limit', 'starting_after', 'ending_before', 'created', 'customer', 'customer_email', 'status', 'mode', 'expand', 'subscription'];
  if (filters) {
    Object.keys(filters).forEach(key => {
      if (validParams.includes(key)) {
        params[key] = filters[key];
      } else if (key !== 'payment_status') {
        // Log unknown parameters (except payment_status which is common mistake)
        logger.warn('Unknown filter parameter for checkout.sessions.list', { parameter: key });
      }
    });
  }
  
  const response = await stripe.checkout.sessions.list(params);
  return response;
}

async function listCheckoutSessions({ limit = 100 } = {}) {
  const stripe = getStripeClient();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 100);
  return stripe.checkout.sessions.list({
    limit: safeLimit,
    expand: ['data.line_items']
  });
}

async function getCheckoutSession(sessionId) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }
  const stripe = getStripeClient();
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items']
  });
}

async function iterateCheckoutSessions({
  onPage,
  filters,
  maxIterations = 50
} = {}) {
  let cursor = null;
  let iterations = 0;
  let hasMore = true;

  try {
    while (hasMore && iterations < maxIterations) {
      // eslint-disable-next-line no-await-in-loop
      const response = await listCheckoutSessionsPaged({
        cursor,
        filters
      });
      hasMore = response.has_more;
      const sessions = response.data || [];
      if (typeof onPage === 'function') {
        // eslint-disable-next-line no-await-in-loop
        await onPage(sessions);
      }
      cursor = sessions.length ? sessions[sessions.length - 1].id : null;
      if (!cursor) {
        hasMore = false;
      }
      iterations += 1;
    }
  } catch (error) {
    logStripeError(error, { scope: 'iterateCheckoutSessions' });
    throw error;
  }
}

async function iterateRefunds({
  onPage,
  filters,
  maxIterations = 50
} = {}) {
  const stripe = getStripeClient();
  let cursor = null;
  let iterations = 0;
  let hasMore = true;

  try {
    while (hasMore && iterations < maxIterations) {
      // eslint-disable-next-line no-await-in-loop
      const response = await stripe.refunds.list({
        limit: 100,
        starting_after: cursor || undefined,
        ...filters
      });

      const refunds = response.data || [];
      if (typeof onPage === 'function' && refunds.length) {
        // eslint-disable-next-line no-await-in-loop
        await onPage(refunds);
      }

      hasMore = response.has_more;
      cursor = refunds.length ? refunds[refunds.length - 1].id : null;
      if (!cursor) {
        hasMore = false;
      }
      iterations += 1;
    }
  } catch (error) {
    logStripeError(error, { scope: 'iterateRefunds' });
    throw error;
  }
}

module.exports = {
  checkHealth,
  listCheckoutSessions,
  getCheckoutSession,
  iterateCheckoutSessions,
  buildSessionFilters,
  iterateRefunds
};

