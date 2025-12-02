const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const { getStripeClient } = require('./client');
const {
  fromMinorUnit,
  normaliseCurrency,
  convertCurrency
} = require('../../utils/currency');

function buildEventLabel(lineItem) {
  if (lineItem?.description && lineItem.description.trim().length) {
    return lineItem.description.trim();
  }
  const productName = lineItem?.price?.product?.name;
  if (productName && productName.trim().length) {
    return productName.trim();
  }
  return 'Без названия';
}

async function toPln(amount, currency) {
  const normalised = normaliseCurrency(currency || 'PLN');
  if (normalised === 'PLN') {
    return amount;
  }
  try {
    const converted = await convertCurrency(amount, normalised, 'PLN');
    if (Number.isFinite(converted)) {
      return converted;
    }
  } catch (error) {
    logger.warn('StripeEventStorageService: currency conversion failed', {
      amount,
      currency: normalised,
      error: error.message
    });
  }
  return 0;
}

class StripeEventStorageService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
    this.stripe = options.stripe || getStripeClient();
  }

  async ensureStripePaymentRecord(session) {
    if (!this.supabase || !session?.id) {
      return;
    }

    try {
      const { data, error } = await this.supabase
        .from('stripe_payments')
        .select('id')
        .eq('session_id', session.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        this.logger.warn('StripeEventStorageService: unable to check stripe_payments', {
          sessionId: session.id,
          error: error.message
        });
        return;
      }

      if (data) {
        return;
      }

      const metadata = session.metadata || {};
      const customerDetails = session.customer_details || {};
      const currency = normaliseCurrency(session.currency || 'PLN');
      const amountMinor = session.amount_total ?? session.amount_subtotal ?? 0;
      const amount = fromMinorUnit(amountMinor, currency);
      const amountPln = await toPln(amount, currency);
    const nowIso = new Date().toISOString();
    const createdAt =
      session.created && Number.isFinite(session.created)
        ? new Date(session.created * 1000).toISOString()
        : nowIso;
    const statusTransitions = session.status_transitions || {};
    const paidTimestamp =
      (Number.isFinite(statusTransitions.paid_at) && statusTransitions.paid_at)
      || (Number.isFinite(statusTransitions.completed_at) && statusTransitions.completed_at)
      || (session.payment_intent && typeof session.payment_intent === 'object' && Number.isFinite(session.payment_intent.created)
        ? session.payment_intent.created
        : null)
      || session.created
      || Math.floor(Date.now() / 1000);
    const paidAtIso = new Date(paidTimestamp * 1000).toISOString();

      const payload = {
        session_id: session.id,
        deal_id: metadata.deal_id || null,
        product_id: metadata.product_link_id || null,
        payment_type: metadata.payment_type || null,
        currency,
        original_amount: amount,
        amount_pln: amountPln,
        amount_tax: 0,
        amount_tax_pln: 0,
        tax_behavior: null,
        tax_rate_id: null,
        status: 'event_placeholder',
        customer_email: customerDetails.email || session.customer_email || null,
        customer_name: customerDetails.name || null,
        customer_type: customerDetails.tax_exempt === 'none' ? 'person' : 'business',
        customer_country: customerDetails.address?.country || null,
        company_name: null,
        company_tax_id: null,
        company_address: null,
        company_country: null,
        address_validated: Boolean(customerDetails.address),
        address_validation_reason: customerDetails.address ? null : 'missing_address',
        expected_vat: metadata.vat_applicable === 'true',
        exchange_rate: currency === 'PLN' ? 1 : null,
        exchange_rate_fetched_at: currency === 'PLN' ? nowIso : null,
        payment_status: 'event_placeholder',
        payment_mode: session.mode || 'payment',
        created_at: createdAt,
        processed_at: paidAtIso,
        raw_payload: session,
        updated_at: nowIso,
        payment_schedule: metadata.payment_schedule || null
      };

      const { error: upsertError } = await this.supabase
        .from('stripe_payments')
        .upsert(payload, { onConflict: 'session_id' });

      if (upsertError) {
        this.logger.warn('StripeEventStorageService: failed to upsert placeholder stripe_payment', {
          sessionId: session.id,
          error: upsertError.message
        });
      }
    } catch (error) {
      this.logger.warn('StripeEventStorageService: ensureStripePaymentRecord failed', {
        sessionId: session.id,
        error: error.message
      });
    }
  }

  async ensureSession(sessionOrId) {
    if (sessionOrId && typeof sessionOrId === 'object' && sessionOrId.id) {
      return sessionOrId;
    }
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : null;
    if (!sessionId) {
      throw new Error('StripeEventStorageService: sessionId is required');
    }
    return this.stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price.product', 'line_items.data.price']
    });
  }

  async ensureLineItems(session) {
    if (session?.line_items?.data?.length) {
      return session.line_items.data;
    }
    const refreshed = await this.stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items.data.price.product', 'line_items.data.price']
    });
    return refreshed?.line_items?.data || [];
  }

  async upsertEventItem(payload) {
    const { error } = await this.supabase.from('stripe_event_items').upsert(payload, {
      onConflict: 'line_item_id'
    });
    if (error) {
      throw new Error(
        `Failed to upsert stripe_event_item ${payload.line_item_id}: ${error.message}`
      );
    }
  }

  async syncSession(sessionOrId, { dryRun = false } = {}) {
    if (!this.supabase) {
      throw new Error('StripeEventStorageService: Supabase client is not configured');
    }

    const session = await this.ensureSession(sessionOrId);
    if (!session?.id) {
      throw new Error('StripeEventStorageService: session is missing id');
    }
    if (session.payment_status !== 'paid') {
      return { sessionId: session.id, inserted: 0, skipped: true };
    }

    await this.ensureStripePaymentRecord(session);

    const lineItems = await this.ensureLineItems(session);
    if (!lineItems.length) {
      return { sessionId: session.id, inserted: 0, skipped: true };
    }

    const customer = session?.customer_details || {};
    let inserted = 0;

    for (const lineItem of lineItems) {
      const eventLabel = buildEventLabel(lineItem);
      const eventKey = eventLabel;
      if (!eventKey) {
        this.logger.warn('StripeEventStorageService: skipping line item without event key', {
          sessionId: session.id,
          lineItemId: lineItem?.id
        });
        continue;
      }

      const currency = normaliseCurrency(lineItem?.currency || session?.currency || 'PLN');
      const amount = fromMinorUnit(
        lineItem?.amount_total ??
          lineItem?.amount_subtotal ??
          session?.amount_total ??
          0,
        currency
      );
      const amountPln = await toPln(amount, currency);

      const payload = {
        line_item_id: lineItem?.id || `${session.id}_${eventKey}_${inserted}`,
        session_id: session.id,
        event_key: eventKey,
        event_label: eventLabel,
        currency,
        amount,
        amount_pln: amountPln,
        payment_status: session.payment_status || 'paid',
        refund_status: null,
        customer_id: customer?.id || null,
        customer_email: customer?.email || null,
        customer_name: customer?.name || null,
        created_at: new Date((session?.created || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        updated_at: new Date().toISOString()
      };

      if (dryRun) {
        this.logger.info('StripeEventStorageService DRY-RUN: would insert event item', payload);
      } else {
        await this.upsertEventItem(payload);
      }
      inserted += 1;
    }

    return {
      sessionId: session.id,
      inserted,
      skipped: false
    };
  }
}

module.exports = StripeEventStorageService;

