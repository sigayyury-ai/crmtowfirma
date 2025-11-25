const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const StripeRepository = require('../stripe/repository');

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
    this.stripeRepository = new StripeRepository();
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
    const ids = new Set();
    const fullnumbers = new Set();
    payments.forEach((payment) => {
      if (payment.manual_proforma_id) {
        ids.add(String(payment.manual_proforma_id));
      } else if (payment.proforma_id) {
        ids.add(String(payment.proforma_id));
      }
      // Also collect fullnumbers for Stripe payments that may not have proforma_id
      if (payment.manual_proforma_fullnumber) {
        fullnumbers.add(String(payment.manual_proforma_fullnumber).trim());
      } else if (payment.proforma_fullnumber) {
        fullnumbers.add(String(payment.proforma_fullnumber).trim());
      }
    });
    return { ids: Array.from(ids), fullnumbers: Array.from(fullnumbers) };
  }

  mapProformas(records = []) {
    const mapById = new Map();
    const mapByFullnumber = new Map();
    records.forEach((record) => {
      if (!record || !record.id) {
        return;
      }

      const id = String(record.id);
      const fullnumber = record.fullnumber ? String(record.fullnumber).trim() : null;
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

      const proformaData = {
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
      };

      mapById.set(id, proformaData);
      if (fullnumber) {
        mapByFullnumber.set(fullnumber, proformaData);
      }
    });
    return { byId: mapById, byFullnumber: mapByFullnumber };
  }

  buildPaymentEntry(payment, proforma) {
    const amount = toNumber(payment.amount) ?? 0;
    const currency = payment.currency || 'PLN';
    const proformaCurrency = proforma?.currency || null;
    const exchangeRate = proforma?.currency_exchange ?? null;

    // For Stripe payments, use pre-calculated PLN amount if available
    let amountPln = null;
    if (payment.source === 'stripe' && payment.stripe_amount_pln !== null && payment.stripe_amount_pln !== undefined) {
      amountPln = toNumber(payment.stripe_amount_pln);
    }

    // Fallback to conversion if no pre-calculated amount
    if (!Number.isFinite(amountPln)) {
      amountPln = convertToPln(amount, currency, exchangeRate);
      if (!Number.isFinite(amountPln) && proformaCurrency && proformaCurrency !== currency) {
        amountPln = convertToPln(amount, proformaCurrency, exchangeRate);
      }
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
    } else if (payment.source === 'stripe' && payment.stripe_payment_status === 'paid') {
      // Stripe payments that are paid but not linked to proforma should show as "paid"
      status = { code: 'paid', label: 'Оплачено', className: 'matched' };
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
      source: payment.source || null, // 'stripe' or 'bank'
      stripe_payment_status: payment.stripe_payment_status || null, // 'paid', 'pending', etc.
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

  aggregateProducts(payments, proformaMap, productLinksMap = new Map()) {
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
      const proformaFullnumber = payment.manual_proforma_fullnumber || payment.proforma_fullnumber || null;
      let proformaInfo = null;
      if (proformaId) {
        proformaInfo = proformaMap.byId.get(String(proformaId)) || null;
      }
      if (!proformaInfo && proformaFullnumber) {
        proformaInfo = proformaMap.byFullnumber.get(String(proformaFullnumber).trim()) || null;
      }
      const paymentEntry = this.buildPaymentEntry(payment, proformaInfo);
      if (Number.isFinite(paymentEntry.amount_pln)) {
        summary.total_pln += paymentEntry.amount_pln;
      }

      let productKey = 'unmatched';
      let productName = 'Без привязки';
      let productId = null;

      // For Stripe payments, use product_links to find product by ID (not by name!)
      // payment.stripe_product_id is actually product_link.id (UUID) from stripe_payments table
      if (payment.source === 'stripe' && payment.stripe_product_id) {
        // Try to find product_link by its ID (UUID)
        const productLink = productLinksMap.get(payment.stripe_product_id);
        if (productLink) {
          productName = productLink.crm_product_name || 'Без названия';
          
          // Priority 1: Use camp_product_id from product_links if available
          // Convert to number if it's a string (Supabase returns strings)
          productId = productLink.camp_product_id 
            ? (typeof productLink.camp_product_id === 'string' 
                ? parseInt(productLink.camp_product_id, 10) 
                : productLink.camp_product_id)
            : null;
          if (productId && !Number.isNaN(productId)) {
            productKey = `id:${productId}`;
          } else {
            // Priority 2: Find product in proformaMap by matching product ID from proformas
            // Look for proformas that have products matching this crm_product_id
            // We need to find the camp_product_id by looking at proforma products
            for (const [proformaId, proforma] of proformaMap.entries()) {
              if (proforma.product && proforma.product.id) {
                // Check if this proforma's product matches by name (temporary until camp_product_id is set)
                // But prefer to find by ID if we can match crm_product_id somehow
                const proformaProductName = normalizeProductKey(proforma.product.name);
                const linkProductName = normalizeProductKey(productName);
                if (proformaProductName === linkProductName) {
                  productId = proforma.product.id;
                  productKey = proforma.product.key;
                  break;
                }
              }
            }
            
            // Priority 3: Check if productMap already has a product with matching ID
            if (productKey === 'unmatched' && productId) {
              if (productMap.has(`id:${productId}`)) {
                productKey = `id:${productId}`;
              }
            }
            
            // Priority 4: Check if productMap has a product with matching name (fallback)
            if (productKey === 'unmatched') {
              const normalizedName = normalizeProductKey(productName);
              for (const [existingKey, existingProduct] of productMap.entries()) {
                if (normalizeProductKey(existingProduct.name) === normalizedName) {
                  productKey = existingKey;
                  productId = existingProduct.product_id;
                  break;
                }
              }
            }
            
            // Last resort: create key by normalized name (should not happen if data is correct)
            if (productKey === 'unmatched') {
              productKey = `key:${normalizeProductKey(productName)}`;
            }
          }
        }
      }

      // Fallback to proforma product if no Stripe product found
      if (productKey === 'unmatched' && proformaInfo?.product) {
        productKey = proformaInfo.product.key;
        productName = proformaInfo.product.name || 'Без названия';
        productId = proformaInfo.product.id || null;
      }

      if (productKey === 'unmatched' && paymentEntry.status.code === 'unmatched') {
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

    const bankPayments = Array.isArray(data) ? data : [];

    // Load Stripe payments
    let stripePayments = [];
    try {
      if (this.stripeRepository.isEnabled()) {
        const stripeData = await this.stripeRepository.listPayments({
          dateFrom: fromIso || null,
          dateTo: toIso || null,
          status: 'processed'
        });

        // Get list of refunded payments to exclude them from reports
        let refundedPaymentIds = new Set();
        try {
          const refunds = await this.stripeRepository.listDeletions({
            dateFrom: fromIso || null,
            dateTo: toIso || null,
            reason: 'deal_lost' // Also include 'stripe_refund' if needed
          });
          refunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });
          
          // Also get refunds with reason 'stripe_refund' (from Stripe API)
          const stripeRefunds = await this.stripeRepository.listDeletions({
            dateFrom: fromIso || null,
            dateTo: toIso || null,
            reason: 'stripe_refund'
          });
          stripeRefunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });
        } catch (refundError) {
          logger.warn('Failed to load refunds for payment report', {
            error: refundError.message
          });
        }

        // Convert Stripe payments to payment report format and filter out refunded payments
        stripePayments = (stripeData || [])
          .filter((sp) => {
            // Exclude payments that have been refunded
            if (sp.session_id && refundedPaymentIds.has(String(sp.session_id))) {
              return false;
            }
            // Exclude payments without deal_id (event payments that shouldn't be in monthly report)
            if (!sp.deal_id) {
              return false;
            }
            return true;
          })
          .map((sp) => {
            // Use processed_at as payment date, fallback to created_at
            const paymentDate = sp.processed_at || sp.created_at || null;
            
            // Use original_amount if available (before conversion), otherwise use amount_pln converted back
            const amount = sp.original_amount !== null && sp.original_amount !== undefined
              ? sp.original_amount
              : (sp.amount_pln || 0);
            
            // Determine document number: invoice_number for B2B, receipt_number for B2C
            // These fields may not exist in older database schemas, so check safely
            const documentNumber = (sp.invoice_number !== undefined && sp.invoice_number !== null) 
              ? sp.invoice_number 
              : ((sp.receipt_number !== undefined && sp.receipt_number !== null) 
                ? sp.receipt_number 
                : null);
            
            return {
              id: `stripe_${sp.session_id || sp.id}`,
              operation_date: paymentDate,
              description: `Stripe payment: ${sp.session_id || 'unknown'}`,
              amount: amount,
              currency: sp.currency || 'PLN',
              direction: 'in',
              payer_name: sp.customer_name || sp.company_name || null,
              payer_normalized_name: null,
              manual_status: 'approved',
              manual_proforma_id: null,
              manual_proforma_fullnumber: documentNumber, // Use invoice/receipt number instead of null
              proforma_id: null,
              proforma_fullnumber: documentNumber, // Use invoice/receipt number for identification
              match_status: 'matched',
              match_confidence: 1.0,
              match_reason: 'stripe',
              source: 'stripe',
              // Stripe-specific fields
              stripe_session_id: sp.session_id,
              stripe_product_id: sp.product_id, // This is product_link.id (UUID), not stripe_product_id from Stripe
              stripe_deal_id: sp.deal_id,
              stripe_amount_pln: sp.amount_pln || null,
              stripe_payment_status: sp.payment_status || null, // 'paid', 'pending', etc.
              stripe_invoice_number: sp.invoice_number || null,
              stripe_receipt_number: sp.receipt_number || null
            };
          });
      }
    } catch (error) {
      logger.warn('Failed to load Stripe payments for payment report', {
        error: error.message
      });
    }

    // Combine bank and Stripe payments
    return [...bankPayments, ...stripePayments];
  }

  async loadProformas({ ids = [], fullnumbers = [] } = {}) {
    if (!this.supabase || (ids.length === 0 && fullnumbers.length === 0)) {
      return [];
    }

    let query = this.supabase
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
      .eq('status', 'active');

    // Build OR condition for IDs and fullnumbers
    if (ids.length > 0 && fullnumbers.length > 0) {
      query = query.or(`id.in.(${ids.join(',')}),fullnumber.in.(${fullnumbers.map(fn => `"${fn}"`).join(',')})`);
    } else if (ids.length > 0) {
      query = query.in('id', ids);
    } else if (fullnumbers.length > 0) {
      query = query.in('fullnumber', fullnumbers);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Supabase error while fetching proformas for payment report:', error);
      throw new Error('Не удалось получить проформы из базы');
    }

    return Array.isArray(data) ? data : [];
  }

  async getReport(options = {}) {
    try {
      const dateRange = this.resolveDateRange(options);
      const statusScope = this.normalizeStatusScope(options.status);

      // Load payments - handle errors gracefully
      let payments = [];
      try {
        payments = await this.loadPayments({
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
          statusScope
        });
      } catch (error) {
        logger.error('Failed to load payments for report', {
          error: error.message,
          stack: error.stack
        });
        // Return empty report instead of failing
        return {
          products: [],
          summary: {
            payments_count: 0,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          },
          filters: {
            dateFrom: dateRange.dateFrom.toISOString(),
            dateTo: dateRange.dateTo.toISOString(),
            status: statusScope
          }
        };
      }

      // Ensure payments is an array
      if (!Array.isArray(payments)) {
        logger.warn('Payments is not an array', { payments: typeof payments });
        payments = [];
      }

      const { ids: proformaIds, fullnumbers: proformaFullnumbers } = this.extractProformaIds(payments);
      
      // Load proformas - handle errors gracefully
      let proformas = [];
      try {
        proformas = await this.loadProformas({ ids: proformaIds, fullnumbers: proformaFullnumbers });
      } catch (error) {
        logger.warn('Failed to load proformas for report', {
          error: error.message,
          proformaIdsCount: proformaIds.length,
          proformaFullnumbersCount: proformaFullnumbers.length
        });
        proformas = [];
      }
      
      const proformaMap = this.mapProformas(proformas);

      // Load product links for Stripe payments
      // Stripe payments have product_id which is product_link.id (UUID), not stripe_product_id
      const stripeProductLinkIds = Array.from(new Set(
        payments
          .filter((p) => p && p.source === 'stripe' && p.stripe_product_id)
          .map((p) => p.stripe_product_id)
      ));
      
      // Also get product_link IDs directly from stripe_payments.product_id
      const directProductLinkIds = Array.from(new Set(
        payments
          .filter((p) => p && p.source === 'stripe' && p.stripe_product_id && typeof p.stripe_product_id === 'string' && p.stripe_product_id.length > 30)
          .map((p) => p.stripe_product_id)
      ));
      
      const allProductLinkIds = [...stripeProductLinkIds, ...directProductLinkIds];
      let productLinksMap = new Map();
      if (allProductLinkIds.length > 0 && this.stripeRepository.isEnabled()) {
        try {
          // listProductLinksByIds returns a Map directly
          productLinksMap = await this.stripeRepository.listProductLinksByIds(allProductLinkIds);
          // Ensure it's a Map
          if (!(productLinksMap instanceof Map)) {
            logger.warn('listProductLinksByIds did not return a Map', {
              type: typeof productLinksMap
            });
            productLinksMap = new Map();
          }
        } catch (error) {
          logger.warn('Failed to load product links for Stripe payments', {
            error: error.message
          });
          productLinksMap = new Map();
        }
      }

      // Aggregate products - ensure it always returns valid structure
      let aggregation;
      try {
        aggregation = this.aggregateProducts(payments, proformaMap, productLinksMap);
      } catch (error) {
        logger.error('Failed to aggregate products for report', {
          error: error.message,
          stack: error.stack,
          paymentsCount: payments.length
        });
        // Return empty aggregation on error
        aggregation = {
          products: [],
          summary: {
            payments_count: payments.length,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          }
        };
      }

      // Ensure aggregation structure is valid
      if (!aggregation || typeof aggregation !== 'object') {
        logger.warn('Invalid aggregation result', { aggregation });
        aggregation = {
          products: [],
          summary: {
            payments_count: payments.length,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          }
        };
      }

      return {
        products: Array.isArray(aggregation.products) ? aggregation.products : [],
        summary: aggregation.summary || {
          payments_count: payments.length,
          products_count: 0,
          currency_totals: {},
          total_pln: 0,
          unmatched_count: 0
        },
        filters: {
          dateFrom: dateRange.dateFrom.toISOString(),
          dateTo: dateRange.dateTo.toISOString(),
          status: statusScope
        }
      };
    } catch (error) {
      logger.error('Error in getReport', {
        error: error.message,
        stack: error.stack,
        options
      });
      // Return empty report instead of throwing
      const dateRange = this.resolveDateRange(options);
      const statusScope = this.normalizeStatusScope(options.status);
      return {
        products: [],
        summary: {
          payments_count: 0,
          products_count: 0,
          currency_totals: {},
          total_pln: 0,
          unmatched_count: 0
        },
        filters: {
          dateFrom: dateRange.dateFrom.toISOString(),
          dateTo: dateRange.dateTo.toISOString(),
          status: statusScope
        }
      };
    }
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


