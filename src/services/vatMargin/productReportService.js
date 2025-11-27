const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const StripeAnalyticsService = require('../stripe/analyticsService');

const CRM_DEAL_BASE_URL = 'https://comoon.pipedrive.com/deal/';

const STATUS_DEFAULT = 'in_progress';
const STATUS_ORDER = {
  in_progress: 0,
  calculated: 1
};

const PRODUCT_PAGE_SIZE = 1000;

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductName(name) {
  if (!name) return null;
  const trimmed = normalizeWhitespace(name);
  if (!trimmed) return null;

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function convertToPln(amount, currency, exchangeRate) {
  const numericAmount = toNumber(amount) || 0;
  const normalizedCurrency = (currency || 'PLN').toUpperCase();
  const rate = toNumber(exchangeRate);

  if (normalizedCurrency === 'PLN') {
    return numericAmount;
  }

  if (rate && rate > 0) {
    return numericAmount * rate;
  }

  return numericAmount;
}

function determinePaymentStatus(totalPln, paidPln) {
  if (!totalPln || totalPln <= 0) {
    return 'unknown';
  }

  const ratio = paidPln / totalPln;
  if (ratio >= 0.98) return 'paid';
  if (ratio > 0) return 'partial';
  return 'unpaid';
}

function roundCurrencyMap(map) {
  const result = {};
  Object.entries(map || {}).forEach(([key, value]) => {
    result[key] = Number((value || 0).toFixed(2));
  });
  return result;
}

function createEmptyEntry({ mapKey, productId, productName, productKey, slug }) {
  const resolvedProductName = productName || 'Без названия';
  const resolvedProductKey = productKey
    || normalizeProductName(resolvedProductName)
    || 'без названия';
  const resolvedSlug = slug
    || (productId ? `id-${productId}` : `slug-${resolvedProductKey}`);

  return {
    mapKey: mapKey || null,
    productId: productId || null,
    productKey: resolvedProductKey,
    slug: resolvedSlug,
    productName: resolvedProductName,
    calculationStatus: STATUS_DEFAULT,
    calculationDueMonth: null,
    proformaIds: new Set(),
    lastSaleDate: null,
    totals: {
      grossPln: 0,
      paidPln: 0,
      originalTotals: {}
    },
    proformaDetails: new Map(),
    stripeTotals: null,
    stripePayments: []
  };
}

function toFixedNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

class ProductReportService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. Product report features will be unavailable.');
    }
  }

  async getProductSummary({ includeStripeData = true } = {}) {
    const { products, totalGrossPln } = includeStripeData
      ? await this.loadAggregatedData()
      : await this.loadDatabaseOnlyData();

    const summary = Array.from(products.values())
      .map((entry) => {
        const proformaCount = entry.proformaIds.size;
        const grossPln = Number(entry.totals.grossPln.toFixed(2));
        const paidPln = Number(entry.totals.paidPln.toFixed(2));
        // Для проформ VAT = 0, поэтому net = gross
        const netPln = grossPln;
        // Margin = net - cost, но cost неизвестен, поэтому margin = net (или можно оставить 0)
        const marginPln = netPln;
        const averageDealSize = proformaCount > 0 ? Number((grossPln / proformaCount).toFixed(2)) : 0;
        const revenueShare = totalGrossPln > 0 ? Number((grossPln / totalGrossPln).toFixed(4)) : 0;
        const stripeGrossPln = entry.stripeTotals?.grossRevenuePln || 0;
        const combinedGrossPln = Number((grossPln + stripeGrossPln).toFixed(2));

        return {
          productId: entry.productId,
          productKey: entry.productKey,
          productSlug: entry.slug,
          productName: entry.productName,
          calculationStatus: entry.calculationStatus,
          calculationDueMonth: entry.calculationDueMonth,
          proformaCount,
          lastSaleDate: entry.lastSaleDate,
          totals: {
            grossPln,
            paidPln,
            netPln,
            marginPln,
            averageDealSize,
            revenueShare
          },
          stripeTotals: entry.stripeTotals
            ? {
                paymentsCount: entry.stripeTotals.paymentsCount,
                grossPln: toFixedNumber(entry.stripeTotals.grossRevenuePln),
                taxPln: toFixedNumber(entry.stripeTotals.grossTaxPln),
                expectedVatCount: entry.stripeTotals.expectedVatCount,
                missingVatCount: entry.stripeTotals.missingVatCount,
                invalidAddressCount: entry.stripeTotals.invalidAddressCount,
                b2bCount: entry.stripeTotals.b2bCount,
                b2cCount: entry.stripeTotals.b2cCount,
                lastPaymentAt: entry.stripeTotals.lastPaymentAt
              }
            : null,
          combinedTotals: {
            grossPln: combinedGrossPln
          }
        };
      })
      .sort((a, b) => {
        const statusDiff = (STATUS_ORDER[a.calculationStatus] ?? 99) - (STATUS_ORDER[b.calculationStatus] ?? 99);
        if (statusDiff !== 0) return statusDiff;
        // Сортировка по выручке в рамках каждой группы статуса
        return b.totals.grossPln - a.totals.grossPln;
      });

    return summary;
  }

  async getProductDetail(identifier) {
    const { products, totalGrossPln } = await this.loadAggregatedData();
    const entry = this.findProductEntry(products, identifier);

    if (!entry) {
      return null;
    }

    const proformas = Array.from(entry.proformaDetails.values())
      .map((detail) => {
        const status = determinePaymentStatus(detail.totalPln, detail.paidPln);
        return {
          proformaId: detail.proformaId,
          fullnumber: detail.fullnumber,
          date: detail.date,
          currencyTotals: roundCurrencyMap(detail.currencyTotals),
          totalPln: Number(detail.totalPln.toFixed(2)),
          paidPln: Number(detail.paidPln.toFixed(2)),
          netPln: Number(detail.totalPln.toFixed(2)), // net = gross для проформ без VAT
          vatPln: 0, // VAT = 0 для проформ
          paymentStatus: status,
          dealId: detail.dealId || null,
          dealUrl: detail.dealUrl || null,
          buyerName: detail.buyerName || detail.buyerAltName || null,
          buyerAltName: detail.buyerAltName || null,
          buyerEmail: detail.buyerEmail || null,
          buyerPhone: detail.buyerPhone || null,
          buyerStreet: detail.buyerStreet || null,
          buyerZip: detail.buyerZip || null,
          buyerCity: detail.buyerCity || null,
          buyerCountry: detail.buyerCountry || null
        };
      })
      .sort((a, b) => {
        if (a.date && b.date) {
          return b.date.localeCompare(a.date);
        }
        return 0;
      });

    const revenueShare = totalGrossPln > 0
      ? Number((entry.totals.grossPln / totalGrossPln).toFixed(4))
      : 0;

    const stripeTotals = entry.stripeTotals
      ? {
          paymentsCount: entry.stripeTotals.paymentsCount,
          grossPln: toFixedNumber(entry.stripeTotals.grossRevenuePln),
          grossTaxPln: toFixedNumber(entry.stripeTotals.grossTaxPln),
          originalTotals: roundCurrencyMap(entry.stripeTotals.originalTotals),
          expectedVatCount: entry.stripeTotals.expectedVatCount,
          missingVatCount: entry.stripeTotals.missingVatCount,
          invalidAddressCount: entry.stripeTotals.invalidAddressCount,
          b2bCount: entry.stripeTotals.b2bCount,
          b2cCount: entry.stripeTotals.b2cCount,
          lastPaymentAt: entry.stripeTotals.lastPaymentAt
        }
      : null;

    const stripePayments = Array.isArray(entry.stripePayments)
      ? entry.stripePayments.map((payment) => ({
        sessionId: payment.sessionId || null,
        paymentType: payment.paymentType || null,
        customerType: payment.customerType || 'person',
        customerName: payment.customerName || null,
        customerEmail: payment.customerEmail || null,
        companyName: payment.companyName || null,
        companyTaxId: payment.companyTaxId || null,
        companyCountry: payment.companyCountry || null,
        currency: payment.currency || 'PLN',
        amount: toFixedNumber(payment.amount),
        amountPln: toFixedNumber(payment.amountPln),
        taxAmount: toFixedNumber(payment.taxAmount),
        taxAmountPln: toFixedNumber(payment.taxAmountPln),
        expectedVat: Boolean(payment.expectedVat),
        addressValidated: payment.addressValidated !== false,
        paymentMode: payment.paymentMode || null,
        createdAt: payment.createdAt || null,
        processedAt: payment.processedAt || null
      }))
      : [];

    const grossPln = Number(entry.totals.grossPln.toFixed(2));
    const netPln = grossPln; // net = gross для проформ без VAT
    const marginPln = netPln; // margin = net для проформ
    const proformaCount = entry.proformaIds.size;
    const averageDealSize = proformaCount > 0 ? Number((grossPln / proformaCount).toFixed(2)) : 0;

    return {
      productId: entry.productId,
      productKey: entry.productKey,
      productSlug: entry.slug,
      productName: entry.productName,
      calculationStatus: entry.calculationStatus,
      calculationDueMonth: entry.calculationDueMonth,
      lastSaleDate: entry.lastSaleDate,
      proformaCount,
      totals: {
        grossPln,
        paidPln: Number(entry.totals.paidPln.toFixed(2)),
        netPln,
        marginPln,
        averageDealSize,
        currencyTotals: roundCurrencyMap(entry.totals.originalTotals)
      },
      revenueShare,
      proformas,
      stripeTotals,
      stripePayments
    };
  }

  async updateProductStatus(identifier, { status, dueMonth }) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { products } = await this.loadAggregatedData();
    const entry = this.findProductEntry(products, identifier);

    if (!entry || !entry.productId) {
      throw new Error('Указанный продукт не найден или не имеет идентификатора в базе');
    }

    const updates = {};

    let nextStatus = entry.calculationStatus;
    if (status !== undefined) {
      const normalizedStatus = status === 'calculated' ? 'calculated' : 'in_progress';
      updates.calculation_status = normalizedStatus;
      nextStatus = normalizedStatus;
    }

    let nextDueMonth = entry.calculationDueMonth;
    if (dueMonth !== undefined) {
      if (typeof dueMonth === 'string' && dueMonth.trim().length > 0) {
        const trimmed = dueMonth.trim();
        updates.calculation_due_month = trimmed;
        nextDueMonth = trimmed;
      } else {
        updates.calculation_due_month = null;
        nextDueMonth = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return {
        productId: entry.productId,
        productSlug: entry.slug,
        calculationStatus: entry.calculationStatus,
        calculationDueMonth: entry.calculationDueMonth
      };
    }

    const { error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', entry.productId);

    if (error) {
      logger.error('Failed to update product status in Supabase:', error);
      throw new Error('Не удалось обновить статус в базе данных');
    }

    return {
      productId: entry.productId,
      productSlug: entry.slug,
      calculationStatus: nextStatus,
      calculationDueMonth: nextDueMonth
    };
  }

  async loadAggregatedData() {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const rows = await this.fetchAllProductRows();
    const aggregation = this.aggregateRows(rows);

    try {
      const stripeData = await StripeAnalyticsService.listPayments();
      this.mergeStripeData(aggregation.products, stripeData.items || []);
      aggregation.stripeSummary = stripeData.summary || null;
    } catch (error) {
      logger.error('Failed to merge Stripe payments into product report', {
        error: error.message
      });
      aggregation.stripeSummary = null;
    }

    return aggregation;
  }

  async loadDatabaseOnlyData() {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const rows = await this.fetchAllProductRows();
    const aggregation = this.aggregateRows(rows);

    // Не добавляем Stripe данные - только продукты из базы данных
    aggregation.stripeSummary = null;

    return aggregation;
  }

  async fetchAllProductRows() {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    let offset = 0;
    const rows = [];
    let includeStatusColumns = true;
    let includeLineTotal = true;

    while (true) {
      const rangeStart = offset;
      const rangeEnd = offset + PRODUCT_PAGE_SIZE - 1;

      const { data, error } = await this.fetchProductRowsRange(rangeStart, rangeEnd, includeStatusColumns, includeLineTotal);

      if (error) {
        if (error.code === '42703') {
          const diagnostic = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase();

          if (includeStatusColumns && (diagnostic.includes('calculation_status') || diagnostic.includes('calculation_due_month'))) {
            logger.warn('Supabase products table has no calculation status columns, retrying without them');
            includeStatusColumns = false;
            continue;
          }

          if (includeLineTotal && diagnostic.includes('line_total')) {
            logger.warn('Supabase proforma_products table has no line_total column, retrying without it');
            includeLineTotal = false;
            continue;
          }
        }

        logger.error('Supabase error while fetching product rows:', error);
        throw new Error('Не удалось получить данные продуктов из базы');
      }

      if (!data || data.length === 0) {
        break;
      }

      rows.push(...data);

      if (data.length < PRODUCT_PAGE_SIZE) {
        break;
      }

      offset += PRODUCT_PAGE_SIZE;
    }

    return rows;
  }

  async fetchProductRowsRange(rangeStart, rangeEnd, includeStatusColumns, includeLineTotal = true) {
    const productFields = includeStatusColumns
      ? 'id,name,normalized_name,calculation_status,calculation_due_month'
      : 'id,name,normalized_name';

    const selectedColumns = includeLineTotal
      ? `
        proforma_id,
        product_id,
        quantity,
        unit_price,
        line_total,
        name,
        proformas (
          id,
          fullnumber,
          issued_at,
          currency,
          total,
          currency_exchange,
          payments_total,
          payments_total_pln,
          payments_currency_exchange,
          pipedrive_deal_id,
          buyer_name,
          buyer_alt_name,
          buyer_email,
          buyer_phone,
          buyer_street,
          buyer_zip,
          buyer_city,
          buyer_country,
          status
        ),
        products (${productFields})
      `
      : `
        proforma_id,
        product_id,
        quantity,
        unit_price,
        name,
        proformas (
          id,
          fullnumber,
          issued_at,
          currency,
          total,
          currency_exchange,
          payments_total,
          payments_total_pln,
          payments_currency_exchange,
          pipedrive_deal_id,
          buyer_name,
          buyer_alt_name,
          buyer_email,
          buyer_phone,
          buyer_street,
          buyer_zip,
          buyer_city,
          buyer_country,
          status
        ),
        products (${productFields})
      `;

    return supabase
      .from('proforma_products')
      .select(selectedColumns)
      .eq('proformas.status', 'active')
      .order('proforma_id', { ascending: true })
      .range(rangeStart, rangeEnd);
  }

  mergeStripeData(products, stripePayments = []) {
    if (!Array.isArray(stripePayments) || stripePayments.length === 0) {
      return;
    }

    // Build a lookup map of existing products by normalized name for faster matching
    const productsByName = new Map();
    products.forEach((entry, key) => {
      if (entry.productKey) {
        const normalizedKey = entry.productKey.toLowerCase().trim();
        if (!productsByName.has(normalizedKey)) {
          productsByName.set(normalizedKey, entry);
        }
      }
    });

    stripePayments.forEach((payment) => {
      // Try to find existing product by campProductId first
      let mapKey = null;
      let matchedEntry = null;
      
      if (payment.campProductId) {
        mapKey = `id:${payment.campProductId}`;
        matchedEntry = products.get(mapKey);
        if (!matchedEntry) {
          mapKey = null; // Reset if not found
        }
      }

      // If not found by campProductId, try to find by normalized product name
      if (!mapKey && payment.productName) {
        const normalizedName = normalizeProductName(payment.productName);
        if (normalizedName) {
          // Try exact match first
          const nameKey = `key:${normalizedName}`;
          matchedEntry = products.get(nameKey);
          if (matchedEntry) {
            mapKey = nameKey;
          } else {
            // Try fuzzy match by normalized name in lookup map
            const lookupKey = normalizedName.toLowerCase().trim();
            matchedEntry = productsByName.get(lookupKey);
            if (matchedEntry) {
              mapKey = matchedEntry.mapKey;
            }
          }
        }
      }

      // If still not found, use resolveStripeMapKey (creates new entry)
      if (!mapKey) {
        mapKey = this.resolveStripeMapKey(payment);
        if (!mapKey) return;

        if (!products.has(mapKey)) {
          const entry = createEmptyEntry({
            mapKey,
            productId: payment.campProductId || null,
            productName: payment.productName || payment.crmProductId || 'Без названия',
            productKey: normalizeProductName(payment.productName || payment.crmProductId || ''),
            slug: this.buildStripeSlug(payment)
          });
          products.set(mapKey, entry);
          matchedEntry = entry;
        } else {
          matchedEntry = products.get(mapKey);
        }
      } else {
        matchedEntry = products.get(mapKey);
      }

      const entry = matchedEntry;
      if (!entry) return;

      if (!entry.stripeTotals) {
        entry.stripeTotals = {
          paymentsCount: 0,
          grossRevenue: 0,
          grossRevenuePln: 0,
          grossTax: 0,
          grossTaxPln: 0,
          expectedVatCount: 0,
          missingVatCount: 0,
          invalidAddressCount: 0,
          b2bCount: 0,
          b2cCount: 0,
          originalTotals: {},
          lastPaymentAt: null
        };
      }
      if (!Array.isArray(entry.stripePayments)) {
        entry.stripePayments = [];
      }

      const totals = entry.stripeTotals;
      const currency = (payment.currency || 'PLN').toUpperCase();
      const amount = toNumber(payment.amount) || 0;
      const amountPln = toNumber(payment.amountPln) || 0;
      const amountTax = toNumber(payment.amountTax) || 0;
      const amountTaxPln = toNumber(payment.amountTaxPln) || 0;
      const createdAt = payment.createdAt || payment.processedAt || null;

      totals.paymentsCount += 1;
      totals.grossRevenue += amount;
      totals.grossRevenuePln += amountPln;
      totals.grossTax += amountTax;
      totals.grossTaxPln += amountTaxPln;
      totals.originalTotals[currency] = (totals.originalTotals[currency] || 0) + amount;

      if (payment.expectedVat) {
        totals.expectedVatCount += 1;
        if (!(amountTax > 0 || amountTaxPln > 0)) {
          totals.missingVatCount += 1;
        }
        if (payment.addressValidated === false) {
          totals.invalidAddressCount += 1;
        }
      }

      if (payment.customerType === 'organization') {
        totals.b2bCount += 1;
      } else {
        totals.b2cCount += 1;
      }

      if (createdAt && (!totals.lastPaymentAt || createdAt > totals.lastPaymentAt)) {
        totals.lastPaymentAt = createdAt;
      }
      if (createdAt && (!entry.lastSaleDate || createdAt > entry.lastSaleDate)) {
        entry.lastSaleDate = createdAt;
      }

      entry.stripePayments.push({
        sessionId: payment.sessionId || null,
        paymentType: payment.paymentType || null,
        customerType: payment.customerType || 'person',
        customerName: payment.customerName || null,
        customerEmail: payment.customerEmail || null,
        companyName: payment.companyName || null,
        companyTaxId: payment.companyTaxId || null,
        companyCountry: payment.companyCountry || null,
        currency,
        amount,
        amountPln,
        taxAmount: amountTax,
        taxAmountPln: amountTaxPln,
        expectedVat: Boolean(payment.expectedVat),
        addressValidated: payment.addressValidated !== false,
        paymentMode: payment.paymentMode || null,
        createdAt,
        processedAt: payment.processedAt || null
      });
    });

    products.forEach((entry) => {
      if (Array.isArray(entry.stripePayments) && entry.stripePayments.length > 1) {
        entry.stripePayments.sort((a, b) => {
          const aDate = a.createdAt || '';
          const bDate = b.createdAt || '';
          return bDate.localeCompare(aDate);
        });
      }
    });
  }

  resolveStripeMapKey(payment) {
    if (!payment) return null;
    if (payment.campProductId) {
      return `id:${payment.campProductId}`;
    }
    if (payment.productId) {
      return `stripe:${payment.productId}`;
    }
    const normalizedName = normalizeProductName(payment.productName);
    if (normalizedName) {
      return `stripe-name:${normalizedName}`;
    }
    if (payment.sessionId) {
      return `stripe-session:${payment.sessionId}`;
    }
    return null;
  }

  buildStripeSlug(payment) {
    if (payment.campProductId) {
      return `id-${payment.campProductId}`;
    }
    if (payment.productId) {
      return `stripe-${payment.productId}`;
    }
    const normalizedName = normalizeProductName(payment.productName);
    if (normalizedName) {
      return `stripe-${normalizedName}`;
    }
    return `stripe-${payment.sessionId || Date.now()}`;
  }

  aggregateRows(rows) {
    const products = new Map();
    let totalGrossPln = 0;
    let processedProformas = 0;
    let missingDealIdCount = 0;

    rows.forEach((row) => {
      // Пропускаем строки где proformas не загрузилась (удаленные проформы)
      if (!row.proformas || !row.proformas.id) {
        return;
      }
      const productRecord = row.products || {};
      const productId = productRecord.id || row.product_id || null;
      const productName = productRecord.name || row.name || 'Без названия';
      const productKey = productRecord.normalized_name
        || normalizeProductName(productName)
        || 'без названия';
      const slug = productId ? `id-${productId}` : `slug-${productKey}`;

      const mapKey = productId ? `id:${productId}` : `key:${productKey}`;

      if (!products.has(mapKey)) {
        const entry = createEmptyEntry({
          mapKey,
          productId,
          productName,
          productKey,
          slug
        });
        entry.calculationStatus = productRecord.calculation_status || STATUS_DEFAULT;
        entry.calculationDueMonth = productRecord.calculation_due_month || null;
        products.set(mapKey, entry);
      }

      const entry = products.get(mapKey);
      if (!entry.calculationStatus) {
        entry.calculationStatus = productRecord.calculation_status || STATUS_DEFAULT;
      }
      if (entry.calculationDueMonth === undefined) {
        entry.calculationDueMonth = productRecord.calculation_due_month || null;
      }
      const proforma = row.proformas || {};
      const proformaId = proforma.id || row.proforma_id || null;
      const issuedAt = proforma.issued_at || null;
      const proformaDealIdRaw = proforma.pipedrive_deal_id;
      const proformaDealId = proformaDealIdRaw !== undefined && proformaDealIdRaw !== null
        ? String(proformaDealIdRaw).trim()
        : null;
      const proformaDealUrl = proformaDealId
        ? `${CRM_DEAL_BASE_URL}${encodeURIComponent(proformaDealId)}`
        : null;

      if (proformaId) {
        entry.proformaIds.add(proformaId);
        processedProformas += 1;
        if (!proformaDealId) {
          missingDealIdCount += 1;
        }
      }

      if (issuedAt && (!entry.lastSaleDate || issuedAt > entry.lastSaleDate)) {
        entry.lastSaleDate = issuedAt;
      }

      const quantity = toNumber(row.quantity) || 0;
      const unitPrice = toNumber(row.unit_price) || 0;
      const lineTotal = toNumber(row.line_total)
        ?? (quantity * unitPrice)
        ?? toNumber(proforma.total)
        ?? 0;

      const currency = (proforma.currency || 'PLN').toUpperCase();
      const exchangeRate = toNumber(proforma.currency_exchange);

      const plnValue = convertToPln(lineTotal, currency, exchangeRate);

      if (Number.isFinite(lineTotal)) {
        entry.totals.originalTotals[currency] = (entry.totals.originalTotals[currency] || 0) + lineTotal;
      }

      if (Number.isFinite(plnValue)) {
        entry.totals.grossPln += plnValue;
        totalGrossPln += plnValue;
      }

      const paymentsTotalPln = toNumber(proforma.payments_total_pln);
      const paymentsTotal = toNumber(proforma.payments_total);
      const paymentsExchange = toNumber(proforma.payments_currency_exchange) || exchangeRate || (currency === 'PLN' ? 1 : null);

      let paidPln = 0;
      if (Number.isFinite(paymentsTotalPln)) {
        paidPln = paymentsTotalPln;
      } else if (Number.isFinite(paymentsTotal) && Number.isFinite(paymentsExchange)) {
        paidPln = paymentsTotal * paymentsExchange;
      }

      if (Number.isFinite(plnValue)) {
        entry.totals.paidPln += Math.min(paidPln, plnValue);
      }

      if (proformaId) {
        if (!entry.proformaDetails.has(proformaId)) {
          entry.proformaDetails.set(proformaId, {
            proformaId,
            fullnumber: proforma.fullnumber || null,
            date: issuedAt,
            currencyTotals: {},
            totalPln: 0,
            paidPln: 0,
            dealId: proformaDealId || null,
            dealUrl: proformaDealUrl,
            buyerName: proforma.buyer_name || proforma.buyer_alt_name || null,
            buyerAltName: proforma.buyer_alt_name || null,
            buyerEmail: proforma.buyer_email || null,
            buyerPhone: proforma.buyer_phone || null,
            buyerStreet: proforma.buyer_street || null,
            buyerZip: proforma.buyer_zip || null,
            buyerCity: proforma.buyer_city || null,
            buyerCountry: proforma.buyer_country || null
          });
        }
        const detail = entry.proformaDetails.get(proformaId);
        if (!detail.dealId && proformaDealId) {
          detail.dealId = proformaDealId;
          detail.dealUrl = proformaDealUrl;
        }
        if (!detail.buyerName && (proforma.buyer_name || proforma.buyer_alt_name)) {
          detail.buyerName = proforma.buyer_name || proforma.buyer_alt_name;
        }
        if (!detail.buyerAltName && proforma.buyer_alt_name) {
          detail.buyerAltName = proforma.buyer_alt_name;
        }
        if (!detail.buyerEmail && proforma.buyer_email) {
          detail.buyerEmail = proforma.buyer_email;
        }
        if (!detail.buyerPhone && proforma.buyer_phone) {
          detail.buyerPhone = proforma.buyer_phone;
        }
        if (!detail.buyerStreet && proforma.buyer_street) {
          detail.buyerStreet = proforma.buyer_street;
        }
        if (!detail.buyerZip && proforma.buyer_zip) {
          detail.buyerZip = proforma.buyer_zip;
        }
        if (!detail.buyerCity && proforma.buyer_city) {
          detail.buyerCity = proforma.buyer_city;
        }
        if (!detail.buyerCountry && proforma.buyer_country) {
          detail.buyerCountry = proforma.buyer_country;
        }
        if (Number.isFinite(lineTotal)) {
          detail.currencyTotals[currency] = (detail.currencyTotals[currency] || 0) + lineTotal;
        }
        if (Number.isFinite(plnValue)) {
          detail.totalPln += plnValue;
        }
        if (Number.isFinite(paidPln)) {
          detail.paidPln = Math.min(detail.totalPln, paidPln);
        }
      }
    });

    if (processedProformas > 0) {
      logger.info('Product aggregation deal link coverage', {
        processedProformas,
        missingDealIdCount
      });
    }

    return {
      products,
      totalGrossPln
    };
  }

  findProductEntry(products, identifier) {
    if (!identifier) return null;

    const normalized = String(identifier).trim();
    if (!normalized) return null;

    if (normalized.startsWith('id:')) {
      return products.get(normalized) || null;
    }

    if (normalized.startsWith('key:')) {
      return products.get(normalized) || null;
    }

    if (normalized.startsWith('id-')) {
      const id = parseInt(normalized.slice(3), 10);
      if (Number.isFinite(id)) {
        return products.get(`id:${id}`) || null;
      }
    }

    if (normalized.startsWith('slug-')) {
      const slug = normalized.slice(5);
      return Array.from(products.values()).find((entry) => entry.slug === `slug-${slug}`) || null;
    }

    if (normalized.startsWith('stripe-')) {
      return Array.from(products.values()).find((entry) => entry.slug === normalized) || null;
    }

    if (/^\d+$/.test(normalized)) {
      return products.get(`id:${parseInt(normalized, 10)}`) || null;
    }

    const fallbackKey = `key:${normalizeProductName(normalized)}`;
    return products.get(fallbackKey) || null;
  }
}

module.exports = ProductReportService;

