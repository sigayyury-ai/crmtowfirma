const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

const CRM_DEAL_BASE_URL = 'https://comoon.pipedrive.com/deal/';
const DEFAULT_STATUS_SCOPE = 'approved';
const AMOUNT_TOLERANCE = 5; // PLN tolerance for determining payment status

function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeProductKey(name) {
  if (!name) return 'без названия';
  return normalizeWhitespace(String(name))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || 'без названия';
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function getMonthRange(month, year) {
  const now = new Date();
  const targetYear = Number.isFinite(year) ? year : now.getUTCFullYear();
  const targetMonth = Number.isFinite(month) ? month - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(targetYear, targetMonth, 1));
  const end = endOfMonth(start);
  return { dateFrom: start, dateTo: end };
}

function toIsoDate(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function convertToPln(amount, currency, exchangeRate) {
  const numericAmount = toNumber(amount) ?? 0;
  const normalizedCurrency = (currency || 'PLN').toUpperCase();
  const numericRate = toNumber(exchangeRate);

  if (normalizedCurrency === 'PLN') {
    return numericAmount;
  }

  if (numericRate && numericRate > 0) {
    return numericAmount * numericRate;
  }

  return null;
}

function determinePaymentStatus(totalPln, paidPln) {
  const total = toNumber(totalPln) ?? 0;
  const paid = toNumber(paidPln) ?? 0;

  if (!total || total <= 0) {
    return { code: 'unknown', label: 'Статус неизвестен', className: 'auto' };
  }

  if (paid >= total + AMOUNT_TOLERANCE) {
    return { code: 'overpaid', label: 'Переплата', className: 'needs_review' };
  }

  if (paid >= total - AMOUNT_TOLERANCE) {
    return { code: 'paid', label: 'Оплачено', className: 'matched' };
  }

  if (paid > 0) {
    return { code: 'partial', label: 'Частично оплачено', className: 'needs_review' };
  }

  return { code: 'unpaid', label: 'Ожидает оплаты', className: 'unmatched' };
}

function buildDealUrl(dealId) {
  if (!dealId) return null;
  const trimmed = String(dealId).trim();
  if (!trimmed) return null;
  return `${CRM_DEAL_BASE_URL}${encodeURIComponent(trimmed)}`;
}

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value).replace(/\r?\n/g, ' ');
  if (/[",]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

class PaymentRevenueReportService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. Payment revenue report will be unavailable.');
    }
    this.supabase = supabase;
  }

  resolveDateRange({ dateFrom, dateTo, month, year } = {}) {
    const parsedFrom = parseDate(dateFrom);
    const parsedTo = parseDate(dateTo);

    if (parsedFrom && parsedTo) {
      return { dateFrom: parsedFrom, dateTo: parsedTo };
    }

    if (typeof month !== 'undefined' || typeof year !== 'undefined') {
      const numericMonth = toNumber(month);
      const numericYear = toNumber(year);
      return getMonthRange(
        Number.isFinite(numericMonth) ? numericMonth : undefined,
        Number.isFinite(numericYear) ? numericYear : undefined
      );
    }

    const now = new Date();
    return {
      dateFrom: startOfMonth(now),
      dateTo: endOfMonth(now)
    };
  }

  normalizeStatusScope(raw) {
    if (!raw || typeof raw !== 'string') {
      return DEFAULT_STATUS_SCOPE;
    }
    const normalized = raw.trim().toLowerCase();
    if (['approved', 'all'].includes(normalized)) {
      return normalized;
    }
    return DEFAULT_STATUS_SCOPE;
  }

  extractProformaIds(payments) {
    const set = new Set();
    payments.forEach((payment) => {
      if (payment.manual_proforma_id) {
        set.add(String(payment.manual_proforma_id));
      } else if (payment.proforma_id) {
        set.add(String(payment.proforma_id));
      }
    });
    return Array.from(set);
  }

  mapProformas(records = []) {
    const map = new Map();
    records.forEach((record) => {
      if (!record || !record.id) {
        return;
      }

      const id = String(record.id);
      const currency = record.currency || 'PLN';
      const currencyExchange = toNumber(record.currency_exchange);
      const total = toNumber(record.total) ?? 0;
      const totalPln = currency === 'PLN'
        ? total
        : (currencyExchange && currencyExchange > 0 ? total * currencyExchange : null);
      const paymentsTotal = toNumber(record.payments_total) ?? 0;
      const paymentsTotalPln = toNumber(record.payments_total_pln)
        ?? (currency === 'PLN'
          ? paymentsTotal
          : (toNumber(record.payments_currency_exchange) ?? currencyExchange ?? 0) * paymentsTotal);

      const products = Array.isArray(record.proforma_products) ? record.proforma_products : [];
      let primaryProduct = null;

      if (products.length > 0) {
        const [firstProduct] = products;
        const productId = firstProduct.product_id || firstProduct.products?.id || null;
        const productName = firstProduct.products?.name || firstProduct.name || 'Без названия';
        const productKey = productId ? `id:${productId}` : `key:${normalizeProductKey(productName)}`;
        primaryProduct = {
          id: productId,
          key: productKey,
          name: productName
        };
      } else {
        primaryProduct = {
          id: null,
          key: `proforma:${id}`,
          name: 'Без названия'
        };
      }

      map.set(id, {
        id,
        fullnumber: record.fullnumber || null,
        issued_at: record.issued_at || null,
        currency,
        currency_exchange: currencyExchange,
        total,
        total_pln: totalPln,
        payments_total: paymentsTotal,
        payments_total_pln: paymentsTotalPln,
        buyer: {
          name: record.buyer_name || record.buyer_alt_name || null,
          alt_name: record.buyer_alt_name || null,
          email: record.buyer_email || null,
          phone: record.buyer_phone || null,
          street: record.buyer_street || null,
          zip: record.buyer_zip || null,
          city: record.buyer_city || null,
          country: record.buyer_country || null
        },
        pipedrive_deal_id: record.pipedrive_deal_id || null,
        pipedrive_deal_url: buildDealUrl(record.pipedrive_deal_id),
        product: primaryProduct
      });
    });
    return map;
  }

  buildPaymentEntry(payment, proforma) {
    const amount = toNumber(payment.amount) ?? 0;
    const currency = payment.currency || 'PLN';
    const proformaCurrency = proforma?.currency || null;
    const exchangeRate = proforma?.currency_exchange ?? null;

    let amountPln = convertToPln(amount, currency, exchangeRate);
    if (!Number.isFinite(amountPln) && proformaCurrency && proformaCurrency !== currency) {
      amountPln = convertToPln(amount, proformaCurrency, exchangeRate);
    }

    const paymentSummary = proforma
      ? {
          total: proforma.total,
          total_pln: proforma.total_pln,
          paid: proforma.payments_total,
          paid_pln: proforma.payments_total_pln,
          remaining_pln: Number.isFinite(proforma.total_pln) && Number.isFinite(proforma.payments_total_pln)
            ? Math.max(proforma.total_pln - proforma.payments_total_pln, 0)
            : null
        }
      : null;

    let status = { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
    if (proforma) {
      status = determinePaymentStatus(paymentSummary.total_pln, paymentSummary.paid_pln);
    } else if (payment.manual_status === 'rejected') {
      status = { code: 'rejected', label: 'Отклонено', className: 'unmatched manual' };
    }

    return {
      id: payment.id,
      date: payment.operation_date || null,
      description: payment.description || null,
      amount,
      currency,
      amount_pln: Number.isFinite(amountPln) ? amountPln : null,
      payer_name: payment.payer_name || null,
      payer_normalized_name: payment.payer_normalized_name || null,
      manual_status: payment.manual_status || null,
      match_status: payment.match_status || null,
      status,
      proforma: proforma
        ? {
            id: proforma.id,
            fullnumber: proforma.fullnumber,
            issued_at: proforma.issued_at,
            currency: proforma.currency,
            currency_exchange: proforma.currency_exchange,
            total: proforma.total,
            total_pln: proforma.total_pln,
            payments_total: proforma.payments_total,
            payments_total_pln: proforma.payments_total_pln,
            buyer: proforma.buyer,
            pipedrive_deal_id: proforma.pipedrive_deal_id,
            pipedrive_deal_url: proforma.pipedrive_deal_url,
            product: proforma.product,
            payment_summary: paymentSummary
          }
        : null
    };
  }

  aggregateProducts(payments, proformaMap) {
    const productMap = new Map();
    const summary = {
      payments_count: 0,
      products_count: 0,
      currency_totals: {},
      total_pln: 0,
      unmatched_count: 0
    };

    payments.forEach((payment) => {
      summary.payments_count += 1;
      const amount = toNumber(payment.amount) ?? 0;
      if (payment.currency) {
        summary.currency_totals[payment.currency] = (summary.currency_totals[payment.currency] || 0) + amount;
      }

      const proformaId = payment.manual_proforma_id || payment.proforma_id || null;
      const proformaInfo = proformaId ? proformaMap.get(String(proformaId)) || null : null;
      const paymentEntry = this.buildPaymentEntry(payment, proformaInfo);
      if (Number.isFinite(paymentEntry.amount_pln)) {
        summary.total_pln += paymentEntry.amount_pln;
      }

      let productKey = 'unmatched';
      let productName = 'Без привязки';
      let productId = null;

      if (proformaInfo?.product) {
        productKey = proformaInfo.product.key;
        productName = proformaInfo.product.name || 'Без названия';
        productId = proformaInfo.product.id || null;
      } else if (paymentEntry.status.code === 'unmatched') {
        summary.unmatched_count += 1;
      }

      if (!productMap.has(productKey)) {
        productMap.set(productKey, {
          key: productKey,
          name: productName,
          product_id: productId,
          totals: {
            payments_count: 0,
            currency_totals: {},
            pln_total: 0,
            proforma_ids: new Set()
          },
          aggregates: new Map()
        });
      }

      const group = productMap.get(productKey);
      group.totals.payments_count += 1;
      if (Number.isFinite(paymentEntry.amount_pln)) {
        group.totals.pln_total += paymentEntry.amount_pln;
      }
      if (paymentEntry.currency) {
        group.totals.currency_totals[paymentEntry.currency] =
          (group.totals.currency_totals[paymentEntry.currency] || 0) + (toNumber(paymentEntry.amount) ?? 0);
      }
      if (proformaInfo?.id) {
        group.totals.proforma_ids.add(proformaInfo.id);
      }

      const aggregateKey = proformaInfo?.id ? `proforma:${proformaInfo.id}` : `payment:${payment.id}`;
      if (!group.aggregates.has(aggregateKey)) {
        group.aggregates.set(aggregateKey, {
          key: aggregateKey,
          proforma: proformaInfo,
          totals: {
            payment_count: 0,
            currency_totals: {},
            pln_total: 0
          },
          payments: [],
          payer_names: new Set(),
          first_payment_date: null,
          last_payment_date: null
        });
      }

      const aggregate = group.aggregates.get(aggregateKey);
      aggregate.payments.push(paymentEntry);
      aggregate.totals.payment_count += 1;
      if (paymentEntry.currency) {
        aggregate.totals.currency_totals[paymentEntry.currency] =
          (aggregate.totals.currency_totals[paymentEntry.currency] || 0) + (toNumber(paymentEntry.amount) ?? 0);
      }
      if (Number.isFinite(paymentEntry.amount_pln)) {
        aggregate.totals.pln_total += paymentEntry.amount_pln;
      }

      if (paymentEntry.payer_name) {
        aggregate.payer_names.add(paymentEntry.payer_name);
      }

      const paymentDate = paymentEntry.date ? new Date(paymentEntry.date) : null;
      if (paymentDate) {
        if (!aggregate.first_payment_date || paymentDate < aggregate.first_payment_date) {
          aggregate.first_payment_date = paymentDate;
        }
        if (!aggregate.last_payment_date || paymentDate > aggregate.last_payment_date) {
          aggregate.last_payment_date = paymentDate;
        }
      }
    });

    const products = Array.from(productMap.values()).map((group) => {
      const entries = Array.from(group.aggregates.values()).map((entry) => {
        entry.totals.currency_totals = Object.fromEntries(
          Object.entries(entry.totals.currency_totals).map(([cur, value]) => [cur, Number(value.toFixed(2))])
        );
        entry.totals.pln_total = Number(entry.totals.pln_total.toFixed(2));
        entry.payer_names = Array.from(entry.payer_names.values());
        entry.first_payment_date = entry.first_payment_date ? entry.first_payment_date.toISOString() : null;
        entry.last_payment_date = entry.last_payment_date ? entry.last_payment_date.toISOString() : null;

        if (entry.proforma) {
          const targetTotalPln = Number.isFinite(entry.proforma.total_pln)
            ? entry.proforma.total_pln
            : convertToPln(entry.proforma.total, entry.proforma.currency, entry.proforma.currency_exchange);
          entry.status = determinePaymentStatus(targetTotalPln, entry.totals.pln_total);
        } else {
          const firstStatus = entry.payments.find((item) => item.status)?.status
            || { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
          entry.status = firstStatus;
        }

        return entry;
      });

      return {
        key: group.key,
        name: group.name,
        product_id: group.product_id,
        totals: {
          payments_count: group.totals.payments_count,
          proforma_count: Array.from(group.totals.proforma_ids).length,
          currency_totals: Object.fromEntries(
            Object.entries(group.totals.currency_totals).map(([cur, value]) => [cur, Number(value.toFixed(2))])
          ),
          pln_total: Number(group.totals.pln_total.toFixed(2))
        },
        entries
      };
    });

    summary.products_count = products.length;
    summary.total_pln = Number(summary.total_pln.toFixed(2));
    summary.currency_totals = Object.fromEntries(
      Object.entries(summary.currency_totals).map(([cur, value]) => [cur, Number(value.toFixed(2))])
    );

    return { products, summary };
  }

  async loadPayments({ dateFrom, dateTo, statusScope }) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const fromIso = toIsoDate(dateFrom);
    const toIso = toIsoDate(dateTo);
    const query = this.supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        direction,
        payer_name,
        payer_normalized_name,
        manual_status,
        manual_proforma_id,
        manual_proforma_fullnumber,
        proforma_id,
        proforma_fullnumber,
        match_status,
        match_confidence,
        match_reason,
        source
      `)
      .eq('direction', 'in')
      .order('operation_date', { ascending: false });

    if (fromIso) {
      query.gte('operation_date', fromIso);
    }
    if (toIso) {
      query.lte('operation_date', toIso);
    }

    if (statusScope !== 'all') {
      query.eq('manual_status', 'approved');
    }

    const { data, error } = await query.limit(5000);

    if (error) {
      logger.error('Supabase error while fetching payments for report:', error);
      throw new Error('Не удалось получить платежи из базы');
    }

    return Array.isArray(data) ? data : [];
  }

  async loadProformas(ids = []) {
    if (!this.supabase || ids.length === 0) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('proformas')
      .select(`
        id,
        fullnumber,
        issued_at,
        currency,
        total,
        currency_exchange,
        payments_total,
        payments_total_pln,
        payments_currency_exchange,
        buyer_name,
        buyer_alt_name,
        buyer_email,
        buyer_phone,
        buyer_street,
        buyer_zip,
        buyer_city,
        buyer_country,
        pipedrive_deal_id,
        proforma_products (
          product_id,
          quantity,
          unit_price,
          line_total,
          name,
          products (
            id,
            name,
            normalized_name
          )
        )
      `)
      .in('id', ids)
      .eq('status', 'active');

    if (error) {
      logger.error('Supabase error while fetching proformas for payment report:', error);
      throw new Error('Не удалось получить проформы из базы');
    }

    return Array.isArray(data) ? data : [];
  }

  async getReport(options = {}) {
    const dateRange = this.resolveDateRange(options);
    const statusScope = this.normalizeStatusScope(options.status);

    const payments = await this.loadPayments({
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      statusScope
    });

    const proformaIds = this.extractProformaIds(payments);
    const proformas = await this.loadProformas(proformaIds);
    const proformaMap = this.mapProformas(proformas);

    const aggregation = this.aggregateProducts(payments, proformaMap);

    return {
      products: aggregation.products,
      summary: aggregation.summary,
      filters: {
        dateFrom: dateRange.dateFrom.toISOString(),
        dateTo: dateRange.dateTo.toISOString(),
        status: statusScope
      }
    };
  }

  async exportCsv(options = {}) {
    const report = await this.getReport(options);
    const rows = [];

    (report.products || []).forEach((group) => {
      (group.entries || []).forEach((entry) => {
        const proforma = entry.proforma || null;
        const buyer = proforma?.buyer?.name || proforma?.buyer?.alt_name || '';
        const amountPln = toNumber(entry.totals?.pln_total);
        const totalPln = toNumber(proforma?.payment_summary?.total_pln ?? proforma?.total_pln);
        const defaultCurrency = proforma?.currency || Object.keys(entry.totals?.currency_totals || {})[0] || 'PLN';
        const amountInDefaultCurrency = toNumber(entry.totals?.currency_totals?.[defaultCurrency]);
        const row = [
          escapeCsv(group.key || ''),
          escapeCsv(group.name || ''),
          escapeCsv(entry.proforma ? entry.proforma.id || '' : ''),
          escapeCsv(entry.first_payment_date || ''),
          escapeCsv(entry.payer_names && entry.payer_names.length ? entry.payer_names.join(', ') : ''),
          escapeCsv(buyer),
          escapeCsv(Number.isFinite(amountInDefaultCurrency) ? amountInDefaultCurrency.toFixed(2) : ''),
          escapeCsv(defaultCurrency),
          escapeCsv(Number.isFinite(amountPln) ? amountPln.toFixed(2) : ''),
          escapeCsv(entry.status?.label || ''),
          escapeCsv(proforma?.fullnumber || ''),
          escapeCsv(proforma?.issued_at || ''),
          escapeCsv(Number.isFinite(totalPln)
            ? totalPln.toFixed(2)
            : ''),
          escapeCsv(proforma?.pipedrive_deal_id || ''),
          escapeCsv(proforma?.pipedrive_deal_url || '')
        ];
        rows.push(row.join(','));

      });
    });

    const header = [
      'product_key',
      'product_name',
      'proforma_id',
      'first_payment_date',
      'payer',
      'buyer',
      'amount',
      'currency',
      'amount_pln',
      'payment_status',
      'proforma_fullnumber',
      'proforma_issue_date',
      'proforma_total_pln',
      'deal_id',
      'deal_url'
    ].join(',');

    return `${header}\n${rows.join('\n')}`;
  }
}

module.exports = PaymentRevenueReportService;


