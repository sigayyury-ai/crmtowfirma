const logger = require('../../utils/logger');
const { getStripeClient } = require('./client');

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

async function listCheckoutSessions({ limit = 5 } = {}) {
  const stripe = getStripeClient();
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 100);
  const response = await stripe.checkout.sessions.list({
    limit: parsedLimit
  });

  return response.data.map((session) => ({
    id: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total,
    currency: session.currency,
    customerEmail: session.customer_details?.email || null,
    created: session.created,
    mode: session.mode
  }));
}

async function getCheckoutSession(sessionId) {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['line_items', 'customer']
  });
  return session;
}

module.exports = {
  checkHealth,
  listCheckoutSessions,
  getCheckoutSession
};

