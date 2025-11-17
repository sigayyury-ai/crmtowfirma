const { getStripeClient } = require('./client');
const {
  fromMinorUnit,
  roundBankers,
  normaliseCurrency,
  convertCurrency
} = require('../../utils/currency');
const { logStripeError } = require('../../utils/logging/stripe');
const StripeRepository = require('./repository');
const logger = require('../../utils/logger');

const MAX_ITERATIONS = 20;
const DEFAULT_SUMMARY_LIMIT = 20;

function parseDateToUnix(value) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.floor(timestamp / 1000);
}

function extractEventKey(lineItem) {
  const description = lineItem?.description;
  if (!description || typeof description !== 'string') return null;
  const trimmed = description.trim();
  return trimmed.length ? trimmed : null;
}

function identifyParticipant(session) {
  const customer = session?.customer_details || {};
  const email = customer.email ? customer.email.toLowerCase() : null;
  const name = customer.name || (email ? email.split('@')[0] : 'Неизвестный участник');
  const id = email || `${name}-${session.id}`;
  return {
    id,
    displayName: name,
    email
  };
}

function sanitizeCurrency(currency) {
  return normaliseCurrency(currency || 'PLN');
}

function toIsoTime(seconds) {
  return seconds ? new Date(seconds * 1000).toISOString() : null;
}

function buildCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

class StripeEventReportService {
  constructor() {
    // Use separate API key for events if provided, otherwise use default Stripe client
    const eventsApiKey = process.env.STRIPE_EVENTS_API_KEY;
    if (eventsApiKey && eventsApiKey.trim()) {
      // Validate that it's a secret key (starts with sk_)
      if (!eventsApiKey.startsWith('sk_')) {
        logger.warn('STRIPE_EVENTS_API_KEY should be a secret key (sk_...), not a publishable key (pk_...)');
      }
      // Create separate Stripe client for events with different API key
      const Stripe = require('stripe');
      this.stripe = new Stripe(eventsApiKey.trim(), {
        apiVersion: process.env.STRIPE_API_VERSION || '2024-04-10',
        timeout: parseInt(process.env.STRIPE_TIMEOUT_MS || '12000', 10),
        maxNetworkRetries: parseInt(process.env.STRIPE_MAX_NETWORK_RETRIES || '1', 10),
        appInfo: {
          name: 'pipedrive-wfirma-integration-events',
          version: require('../../../package.json').version || '0.0.0'
        }
      });
      logger.info('Stripe Events client initialized with separate API key', {
        keyPrefix: eventsApiKey.substring(0, 7) + '...'
      });
    } else {
      // Use default Stripe client
      this.stripe = getStripeClient();
      logger.info('Stripe Events client using default Stripe API key');
    }
    this.repository = new StripeRepository();
    this.summaryCache = new Map();
    this.summaryCacheTtlMs = parseInt(process.env.STRIPE_EVENTS_CACHE_TTL_MS || '600000', 10);
  }

  async convertAmountToPln(amount, currency) {
    if (!Number.isFinite(amount)) return 0;
    const source = normaliseCurrency(currency);
    if (source === 'PLN') return roundBankers(amount);

    const converted = await convertCurrency(amount, source, 'PLN');
    return Number.isFinite(converted) ? converted : 0;
  }

  parseFilters({ from, to }) {
    const created = {};
    const fromUnix = parseDateToUnix(from);
    const toUnix = parseDateToUnix(to);
    if (fromUnix) created.gte = fromUnix;
    if (toUnix) created.lte = toUnix;
    return Object.keys(created).length ? created : undefined;
  }

  async listEvents({ limit, startingAfter, from, to } = {}) {
    const summaryLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_SUMMARY_LIMIT, 1), 100);
    const eventMap = new Map();
    let cursor = startingAfter || undefined;
    let hasMore = true;
    let iterations = 0;
    let lastSessionId = null;

    const cacheKey = JSON.stringify({
      limit: summaryLimit,
      startingAfter: cursor || null,
      from: from || null,
      to: to || null
    });

    const cached = this.summaryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.payload;
    }

    try {
      // Load events directly from Stripe API
      // Event report groups payments by line_item.description (eventKey), not by deal_id or CRM products
      while (hasMore && iterations < MAX_ITERATIONS && eventMap.size < summaryLimit) {
        const params = {
          limit: 100,
          expand: ['data.line_items']
        };
        const created = this.parseFilters({ from, to });
        if (created) params.created = created;
        if (cursor) params.starting_after = cursor;

        // eslint-disable-next-line no-await-in-loop
        const response = await this.stripe.checkout.sessions.list(params);

        // eslint-disable-next-line no-loop-func
        for (const session of response.data) {
          if (session.payment_status !== 'paid' || session.status !== 'complete') {
            continue;
          }
          const lineItems = session?.line_items?.data || [];
          for (const lineItem of lineItems) {
            const eventKey = extractEventKey(lineItem);
            if (!eventKey) continue;

            const currency = sanitizeCurrency(lineItem.currency || session.currency);
            const amount = fromMinorUnit(lineItem.amount_total ?? session.amount_total ?? 0, currency);
            // eslint-disable-next-line no-await-in-loop
            const amountPln = await this.convertAmountToPln(amount, currency);

            let event = eventMap.get(eventKey);
            if (!event) {
              event = {
                eventKey,
                eventLabel: eventKey,
                currency,
                grossRevenue: 0,
                grossRevenuePln: 0,
                participants: new Set(),
                paymentsCount: 0,
                lastPaymentAt: 0,
                currencies: new Set([currency]),
                warnings: new Set()
              };
              eventMap.set(eventKey, event);
            }

            const participant = identifyParticipant(session);
            event.participants.add(participant.id);
            event.paymentsCount += 1;
            event.currencies.add(currency);
            event.grossRevenue += amount;
            if (Number.isFinite(amountPln) && amountPln > 0) {
              event.grossRevenuePln += amountPln;
            }
            event.lastPaymentAt = Math.max(event.lastPaymentAt, session.created || 0);
            if (event.currencies.size > 1) {
              event.warnings.add('Обнаружены платежи в нескольких валютах, проверьте отчёт вручную.');
            }
            if (!event.currency) {
              [event.currency] = event.currencies;
            }
          }
        }

        hasMore = response.has_more;
        if (response.data.length > 0) {
          lastSessionId = response.data[response.data.length - 1].id;
          cursor = lastSessionId;
        } else {
          hasMore = false;
        }
        iterations += 1;
      }
    } catch (error) {
      logStripeError(error, { scope: 'listEvents' });
      throw error;
    }

    const items = Array.from(eventMap.values())
      .sort((a, b) => (b.lastPaymentAt || 0) - (a.lastPaymentAt || 0))
      .slice(0, summaryLimit)
      .map((event) => ({
        eventKey: event.eventKey,
        eventLabel: event.eventLabel,
        currency: event.currency,
        grossRevenue: roundBankers(event.grossRevenue),
        grossRevenuePln: event.currency === 'PLN'
          ? roundBankers(event.grossRevenue)
          : roundBankers(event.grossRevenuePln || 0),
        participantsCount: event.participants.size,
        paymentsCount: event.paymentsCount,
        lastPaymentAt: event.lastPaymentAt ? toIsoTime(event.lastPaymentAt) : null,
        warnings: Array.from(event.warnings)
      }));

    const result = {
      items,
      pageInfo: {
        limit: summaryLimit,
        hasMore: hasMore || eventMap.size > summaryLimit,
        nextCursor: hasMore ? lastSessionId : null
      }
    };

    this.summaryCache.set(cacheKey, {
      payload: result,
      expiresAt: Date.now() + this.summaryCacheTtlMs
    });

    return result;
  }

  async getEventReport(eventKey, { from, to } = {}) {
    const sessionsSet = new Set();
    const participantsMap = new Map();
    const warnings = new Set();
    let totalsCurrency = null;
    let totalGross = 0;
    let totalGrossPln = 0;
    let totalLineItems = 0;
    let lastPaymentAt = 0;

    let cursor;
    let hasMore = true;
    let iterations = 0;

    try {
      while (hasMore && iterations < MAX_ITERATIONS) {
        const params = {
          limit: 100,
          expand: ['data.line_items']
        };
        const created = this.parseFilters({ from, to });
        if (created) params.created = created;
        if (cursor) params.starting_after = cursor;

        // eslint-disable-next-line no-await-in-loop
        const response = await this.stripe.checkout.sessions.list(params);

        for (const session of response.data) {
          if (session.payment_status !== 'paid' || session.status !== 'complete') {
            continue;
          }
          const lineItems = session?.line_items?.data || [];
          const matchingItems = lineItems.filter((item) => extractEventKey(item) === eventKey);
          if (!matchingItems.length) continue;

          sessionsSet.add(session.id);
          lastPaymentAt = Math.max(lastPaymentAt, session.created || 0);

          for (const lineItem of matchingItems) {
            totalLineItems += 1;
            const currency = sanitizeCurrency(lineItem.currency || session.currency);
            const amount = fromMinorUnit(lineItem.amount_total ?? session.amount_total ?? 0, currency);
            // eslint-disable-next-line no-await-in-loop
            const amountPln = await this.convertAmountToPln(amount, currency);

            if (!totalsCurrency) totalsCurrency = currency;
            if (totalsCurrency !== currency) {
              warnings.add('Отчёт содержит платежи в разных валютах. Проверьте агрегированные значения вручную.');
            }

            totalGross += amount;
            if (Number.isFinite(amountPln) && amountPln > 0) {
              totalGrossPln += amountPln;
            }

            const participantInfo = identifyParticipant(session);
            let participant = participantsMap.get(participantInfo.id);
            if (!participant) {
              participant = {
                participantId: participantInfo.id,
                displayName: participantInfo.displayName,
                email: participantInfo.email,
                currency,
                totalAmount: 0,
                totalAmountPln: 0,
                paymentsCount: 0
              };
              participantsMap.set(participantInfo.id, participant);
            }

            participant.currency = currency;
            participant.totalAmount += amount;
            if (Number.isFinite(amountPln) && amountPln > 0) {
              participant.totalAmountPln += amountPln;
            }
            participant.paymentsCount += 1;
          }
        }

        hasMore = response.has_more;
        if (response.data.length > 0) {
          cursor = response.data[response.data.length - 1].id;
        } else {
          hasMore = false;
        }
        iterations += 1;
      }
    } catch (error) {
      logStripeError(error, { scope: 'getEventReport', eventKey });
      throw error;
    }

    const participantsArray = Array.from(participantsMap.values()).map((participant) => ({
      ...participant,
      totalAmount: roundBankers(participant.totalAmount),
      totalAmountPln: roundBankers(participant.totalAmountPln)
    }));

    const response = {
      eventKey,
      eventLabel: eventKey,
      currency: totalsCurrency || 'PLN',
      totalSessions: sessionsSet.size,
      totalLineItems,
      warnings: Array.from(warnings),
      participants: participantsArray,
      totals: {
        grossRevenue: roundBankers(totalGross),
        grossRevenuePln: roundBankers(totalGrossPln),
        participantsCount: participantsArray.length,
        sessionsCount: sessionsSet.size
      },
      generatedAt: new Date().toISOString()
    };

    return response;
  }

  async generateExportCsv(eventKey, options = {}) {
    const report = await this.getEventReport(eventKey, options);
    const header = [
      'Name',
      'Total Amount (PLN)',
      `Total Amount (${report.currency})`,
      'Payments Count'
    ];

    const rows = report.participants.map((participant) => [
      participant.displayName || '',
      roundBankers(participant.totalAmountPln),
      roundBankers(participant.totalAmount),
      participant.paymentsCount || 0
    ]);

    const totalsRow = [
      'Итого',
      roundBankers(report.totals.grossRevenuePln),
      roundBankers(report.totals.grossRevenue),
      report.totals.sessionsCount || 0
    ];

    const csvLines = [
      header.map(buildCsvValue).join(','),
      ...rows.map((row) => row.map(buildCsvValue).join(',')),
      totalsRow.map(buildCsvValue).join(',')
    ];

    return csvLines.join('\n');
  }
}

module.exports = new StripeEventReportService();

