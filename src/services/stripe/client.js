const Stripe = require('stripe');

let stripeInstance = null;

function resolveNumber(value, fallback) {
  if (!value && value !== 0) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createStripeClient() {
  const apiKey = process.env.STRIPE_API_KEY;
  if (!apiKey) {
    throw new Error('STRIPE_API_KEY is not set. Add it to .env');
  }

  return new Stripe(apiKey, {
    apiVersion: process.env.STRIPE_API_VERSION || '2024-04-10',
    timeout: resolveNumber(process.env.STRIPE_TIMEOUT_MS, 12000),
    maxNetworkRetries: resolveNumber(process.env.STRIPE_MAX_NETWORK_RETRIES, 1)
  });
}

function getStripeClient() {
  if (!stripeInstance) {
    stripeInstance = createStripeClient();
  }
  return stripeInstance;
}

module.exports = {
  getStripeClient
};

