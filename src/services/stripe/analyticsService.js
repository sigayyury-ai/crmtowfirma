const StripeRepository = require('./repository');
const { roundBankers, normaliseCurrency } = require('../../utils/currency');
const logger = require('../../utils/logger');

function toIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

class StripeAnalyticsService {
  constructor(options = {}) {
    this.repository = options.repository || new StripeRepository();
  }

  async listPayments(filters = {}) {
    if (!this.repository.isEnabled()) {
      return {
        items: [],
        productMap: new Map(),
        summary: this.buildSummary([])
      };
    }

    const normalizedFilters = { ...filters };
    if (filters.dateFrom) normalizedFilters.dateFrom = toIso(filters.dateFrom);
    if (filters.dateTo) normalizedFilters.dateTo = toIso(filters.dateTo);
    if (filters.limit) {
      const limit = parseInt(filters.limit, 10);
      if (Number.isFinite(limit) && limit > 0) {
        normalizedFilters.limit = Math.min(limit, 1000);
      } else {
        delete normalizedFilters.limit;
      }
    }

    let payments = [];
    try {
      payments = await this.repository.listPayments(normalizedFilters);
    } catch (error) {
      logger.error('StripeAnalytics: failed to load payments', { error: error.message });
      return {
        items: [],
        productMap: new Map(),
        summary: this.buildSummary([])
      };
    }

    // Get list of refunded payments to exclude them from reports
    let refundedPaymentIds = new Set();
    try {
      const refunds = await this.repository.listDeletions({
        dateFrom: normalizedFilters.dateFrom || null,
        dateTo: normalizedFilters.dateTo || null
      });
      refunds.forEach((refund) => {
        if (refund.payment_id) {
          refundedPaymentIds.add(String(refund.payment_id));
        }
      });
    } catch (refundError) {
      logger.warn('StripeAnalytics: failed to load refunds', {
        error: refundError.message
      });
    }

    // Filter out refunded payments
    payments = payments.filter((payment) => {
      if (payment.session_id && refundedPaymentIds.has(String(payment.session_id))) {
        return false;
      }
      return true;
    });

    const productIds = Array.from(new Set(
      payments
        .map((payment) => payment?.product_id)
        .filter((id) => id && typeof id === 'string')
    ));
    const productMap = await this.repository.listProductLinksByIds(productIds);

    const items = payments.map((payment) => this.normalizePayment(payment, productMap));
    const summary = this.buildSummary(items);

    return { items, productMap, summary };
  }

  normalizePayment(payment, productMap) {
    const currency = normaliseCurrency(payment?.currency || 'PLN');
    const productId = payment?.product_id || null;
    const productInfo = productId ? productMap.get(productId) : null;

    const amount = toNumber(payment?.original_amount || payment?.amount);
    const amountPln = toNumber(payment?.amount_pln);
    const amountTax = toNumber(payment?.amount_tax);
    const amountTaxPln = toNumber(payment?.amount_tax_pln);

    return {
      sessionId: payment?.session_id || null,
      dealId: payment?.deal_id || null,
      productId,
      productName: productInfo?.crm_product_name || null,
      crmProductId: productInfo?.crm_product_id || null,
      stripeProductId: productInfo?.stripe_product_id || null,
      campProductId: productInfo?.camp_product_id || null,
      paymentType: payment?.payment_type || null,
      currency,
      amount,
      amountPln,
      amountTax,
      amountTaxPln,
      expectedVat: Boolean(payment?.expected_vat),
      addressValidated: payment?.address_validated !== false,
      addressValidationReason: payment?.address_validation_reason || null,
      exchangeRate: payment?.exchange_rate !== undefined && payment?.exchange_rate !== null
        ? Number(payment.exchange_rate)
        : null,
      exchangeRateFetchedAt: payment?.exchange_rate_fetched_at || null,
      customerType: payment?.customer_type || 'person',
      customerName: payment?.customer_name || null,
      customerEmail: payment?.customer_email || null,
      customerCountry: payment?.customer_country || null,
      companyName: payment?.company_name || null,
      companyTaxId: payment?.company_tax_id || null,
      companyCountry: payment?.company_country || null,
      companyAddress: payment?.company_address || null,
      paymentStatus: payment?.status || payment?.payment_status || 'processed',
      paymentMode: payment?.payment_mode || null,
      createdAt: payment?.created_at || null,
      processedAt: payment?.processed_at || null,
      raw: payment
    };
  }

  buildSummary(items = []) {
    const totalsByCurrency = {};
    const taxByCurrency = {};
    let totalAmountPln = 0;
    let totalTaxPln = 0;
    let expectedVat = 0;
    let missingVat = 0;
    let invalidAddress = 0;
    let b2bCount = 0;
    let b2cCount = 0;

    items.forEach((item) => {
      const currency = item.currency || 'PLN';
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + item.amount;
      taxByCurrency[currency] = (taxByCurrency[currency] || 0) + item.amountTax;
      totalAmountPln += item.amountPln;
      totalTaxPln += item.amountTaxPln;

      if (item.expectedVat) {
        expectedVat += 1;
        if (!Number.isFinite(item.amountTax) || item.amountTax <= 0) {
          missingVat += 1;
        }
        if (item.addressValidated === false) {
          invalidAddress += 1;
        }
      }

      if (item.customerType === 'organization') {
        b2bCount += 1;
      } else {
        b2cCount += 1;
      }
    });

    const roundMap = (input) => Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, roundBankers(value)])
    );

    return {
      totalPayments: items.length,
      totalsByCurrency: roundMap(totalsByCurrency),
      totalsTaxByCurrency: roundMap(taxByCurrency),
      totalAmountPln: roundBankers(totalAmountPln),
      totalTaxPln: roundBankers(totalTaxPln),
      expectedVat,
      missingVat,
      invalidAddress,
      b2bCount,
      b2cCount
    };
  }

  buildGroupsByProduct(items = []) {
    const groups = new Map();

    items.forEach((item) => {
      const key = item.productId || 'unassigned';
      const entry = groups.get(key) || {
        productId: item.productId || null,
        productName: item.productName || 'Без продукта',
        crmProductId: item.crmProductId || null,
        stripeProductId: item.stripeProductId || null,
        campProductId: item.campProductId || null,
        totalsByCurrency: {},
        currencies: new Set(),
        grossRevenue: 0,
        grossRevenuePln: 0,
        grossTax: 0,
        grossTaxPln: 0,
        paymentsCount: 0,
        expectedVatCount: 0,
        missingVatCount: 0,
        invalidAddressCount: 0,
        b2bCount: 0,
        b2cCount: 0,
        firstPaymentAt: null,
        lastPaymentAt: null
      };

      entry.productName = entry.productName || item.productName || 'Без продукта';
      entry.totalsByCurrency[item.currency] = (entry.totalsByCurrency[item.currency] || 0) + item.amount;
      entry.currencies.add(item.currency || 'PLN');
      entry.grossRevenue += item.amount;
      entry.grossRevenuePln += item.amountPln;
      entry.grossTax += item.amountTax;
      entry.grossTaxPln += item.amountTaxPln;
      entry.paymentsCount += 1;

      if (item.expectedVat) {
        entry.expectedVatCount += 1;
        if (!Number.isFinite(item.amountTax) || item.amountTax <= 0) {
          entry.missingVatCount += 1;
        }
        if (item.addressValidated === false) {
          entry.invalidAddressCount += 1;
        }
      }

      if (item.customerType === 'organization') {
        entry.b2bCount += 1;
      } else {
        entry.b2cCount += 1;
      }

      const createdAt = item.createdAt ? new Date(item.createdAt) : null;
      if (createdAt && !Number.isNaN(createdAt.getTime())) {
        const iso = createdAt.toISOString();
        if (!entry.firstPaymentAt || iso < entry.firstPaymentAt) {
          entry.firstPaymentAt = iso;
        }
        if (!entry.lastPaymentAt || iso > entry.lastPaymentAt) {
          entry.lastPaymentAt = iso;
        }
      }

      groups.set(key, entry);
    });

    return Array.from(groups.values()).map((entry) => ({
      productId: entry.productId,
      productName: entry.productName,
      crmProductId: entry.crmProductId,
      stripeProductId: entry.stripeProductId,
      campProductId: entry.campProductId,
      currency: entry.currencies.size === 1 ? Array.from(entry.currencies)[0] : 'MULTI',
      currencies: Array.from(entry.currencies),
      totalsByCurrency: Object.fromEntries(
        Object.entries(entry.totalsByCurrency).map(([key, value]) => [key, roundBankers(value)])
      ),
      grossRevenue: roundBankers(entry.grossRevenue),
      grossRevenuePln: roundBankers(entry.grossRevenuePln),
      grossTax: roundBankers(entry.grossTax),
      grossTaxPln: roundBankers(entry.grossTaxPln),
      paymentsCount: entry.paymentsCount,
      expectedVatCount: entry.expectedVatCount,
      missingVatCount: entry.missingVatCount,
      invalidAddressCount: entry.invalidAddressCount,
      b2bCount: entry.b2bCount,
      b2cCount: entry.b2cCount,
      firstPaymentAt: entry.firstPaymentAt,
      lastPaymentAt: entry.lastPaymentAt
    })).sort((a, b) => b.grossRevenuePln - a.grossRevenuePln);
  }

  async getMonthlyStripeSummary({ dateFrom, dateTo } = {}) {
    const { items, summary } = await this.listPayments({ dateFrom, dateTo });
    const grouped = this.buildGroupsByProduct(items);
    return {
      items: grouped,
      summary,
      payments: items
    };
  }
}

module.exports = new StripeAnalyticsService();

