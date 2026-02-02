const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const StripeAnalyticsService = require('../stripe/analyticsService');
const PaymentRevenueReportService = require('./paymentRevenueReportService');

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

function createEmptyEntry({ mapKey, productId, productName, productKey, slug, source = 'product', eventKey = null }) {
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
    source,
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
    stripePayments: [],
    eventKey: eventKey || null
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
    this.paymentRevenueReportService = new PaymentRevenueReportService();
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
          source: entry.source || 'product',
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

    // Создаем карту Stripe платежей по deal_id для учета в paidPln проформ
    const stripePaymentsByDealId = new Map();
    if (Array.isArray(entry.stripePayments)) {
      entry.stripePayments.forEach((payment) => {
        if (payment.dealId) {
          const dealIdStr = String(payment.dealId);
          if (!stripePaymentsByDealId.has(dealIdStr)) {
            stripePaymentsByDealId.set(dealIdStr, []);
          }
          stripePaymentsByDealId.get(dealIdStr).push(payment);
        }
      });
    }

    const proformas = Array.from(entry.proformaDetails.values())
      .map((detail) => {
        // Добавляем Stripe платежи к paidPln, если есть deal_id
        let finalPaidPln = detail.paidPln;
        
        // Если у проформы есть deal_id, ищем Stripe платежи с таким же deal_id
        if (detail.dealId) {
          const dealIdStr = String(detail.dealId);
          const stripePaymentsForDeal = stripePaymentsByDealId.get(dealIdStr) || [];
          
          if (stripePaymentsForDeal.length > 0) {
            // Суммируем все Stripe платежи для этой сделки
            const stripePaidPln = stripePaymentsForDeal.reduce((sum, p) => {
              return sum + (toNumber(p.amountPln) || 0);
            }, 0);
            
            // Добавляем Stripe платежи к paidPln проформы
            finalPaidPln = Math.min(detail.totalPln, detail.paidPln + stripePaidPln);
          }
        }
        
        const status = determinePaymentStatus(detail.totalPln, finalPaidPln);
        return {
          proformaId: detail.proformaId,
          fullnumber: detail.fullnumber,
          date: detail.date,
          currencyTotals: roundCurrencyMap(detail.currencyTotals),
          totalPln: Number(detail.totalPln.toFixed(2)),
          paidPln: Number(finalPaidPln.toFixed(2)),
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
          buyerCountry: detail.buyerCountry || null,
          paymentCount: Number(detail.paymentCount) || 0,
          pipedrive_deal_id: detail.dealId || null,
          payments_total_cash_pln: detail.paymentsTotalCashPln || detail.payments_total_cash_pln || null
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
          lastPaymentAt: entry.stripeTotals.lastPaymentAt,
          note: entry.source === 'stripe' ? 'Выручка полностью из Stripe' : null
        }
      : null;

    if (
      (!entry.stripePayments || entry.stripePayments.length === 0)
      && entry.source === 'stripe_event'
      && entry.eventKey
    ) {
      try {
        const participants = await this.loadStripeEventParticipants(entry.eventKey);
        if (Array.isArray(participants) && participants.length > 0) {
          entry.stripePayments = participants.map((participant) => ({
            sessionId: participant.participant_id || participant.email || null,
            paymentType: 'stripe_event',
            customerType: participant.company_name ? 'organization' : 'person',
            customerName: participant.display_name || participant.company_name || participant.email || participant.participant_id || null,
            customerEmail: participant.email || null,
            companyName: participant.company_name || null,
            companyTaxId: participant.company_tax_id || null,
            companyCountry: participant.company_country || null,
            currency: participant.currency || 'PLN',
            amount: toNumber(participant.total_amount) || 0,
            amountPln: toNumber(participant.total_amount_pln) || toNumber(participant.total_amount) || 0,
            taxAmount: 0,
            taxAmountPln: 0,
            expectedVat: false,
            addressValidated: true,
            paymentMode: 'event',
            createdAt: participant.updated_at || null,
            processedAt: participant.updated_at || null,
            paymentsCount: participant.payments_count || 0
          }));
        }
      } catch (error) {
        logger.warn('Failed to load Stripe event participants for product detail', {
          eventKey: entry.eventKey,
          error: error.message
        });
      }
    }

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
        processedAt: payment.processedAt || null,
        dealId: payment.dealId || null // Сохраняем deal_id для отображения
      }))
      : [];

    let linkedPayments = { incoming: [], outgoing: [] };
    if (entry.productId) {
      try {
        linkedPayments = await this.loadLinkedPayments(entry.productId);
      } catch (error) {
        logger.warn('Failed to load linked payments for product detail', {
          productId: entry.productId,
          error: error.message
        });
      }
    }

    // Load cash payments for product
    let cashTotalPln = 0;
    let cashDealsCount = 0;
    let cashMonthly = [];
    if (entry.productId) {
      try {
        const cashData = await this.loadCashPaymentsTotal(entry.productId, proformas);
        cashTotalPln = cashData.totalPln || 0;
        cashDealsCount = cashData.dealsCount || 0;
      } catch (error) {
        logger.warn('Failed to load cash payments for product detail', {
          productId: entry.productId,
          error: error.message
        });
      }
    }

    // Monthly cash breakdown (to align with PNL month aggregation)
    if (entry.productId) {
      try {
        cashMonthly = await this.loadCashPaymentsMonthly(entry.productId, proformas);
      } catch (error) {
        logger.warn('Failed to load monthly cash payments for product detail', {
          productId: entry.productId,
          error: error.message
        });
      }
    }

    const proformaGrossPln = Number(entry.totals.grossPln.toFixed(2));
    const stripeGrossPln = entry.stripeTotals?.grossRevenuePln || 0;
    const grossPln = Number((proformaGrossPln + stripeGrossPln).toFixed(2)); // Включаем и проформы, и Stripe платежи
    const netPln = grossPln; // net = gross для проформ без VAT
    const marginPln = netPln; // margin = net для проформ
    const proformaCount = entry.proformaIds.size;
    const averageDealSize = proformaCount > 0 ? Number((proformaGrossPln / proformaCount).toFixed(2)) : 0;

    // Рассчитываем месячную сводку платежей
    // Используем linkedPayments для получения реальных дат платежей
    // Передаем расходы на участника для расчета фактуры маржи
    const totalExpenses = this.calculateExpenseTotals(linkedPayments).totalPln;
    const totalParticipants = this.calculateParticipantsCount(proformas, stripePayments);
    const expensesPerParticipant = totalParticipants > 0 ? totalExpenses / totalParticipants : 0;
    const monthlyBreakdown = await this.calculateMonthlyBreakdownFromPaymentReport({
      productId: entry.productId,
      proformas,
      stripePayments,
      linkedPayments,
      expensesPerParticipant
    });

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
      stripePayments,
      linkedPayments,
      expenseTotals: this.calculateExpenseTotals(linkedPayments),
      participantsCount: this.calculateParticipantsCount(proformas, stripePayments),
      monthlyBreakdown,
      cashTotalPln: Number(cashTotalPln.toFixed(2)),
      cashDealsCount: cashDealsCount
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

    try {
      const eventsInfo = await this.addStripeEventEntries(aggregation.products);
      aggregation.totalGrossPln += eventsInfo.totalEventsPln;
      aggregation.stripeEventsSummary = eventsInfo;
    } catch (error) {
      logger.error('Failed to append Stripe events to product report', {
        error: error.message
      });
    }

    return aggregation;
  }

  async addStripeEventEntries(productsMap) {
    if (!supabase) {
      return { totalEvents: 0, totalEventsPln: 0 };
    }

    const { data, error } = await supabase
      .from('stripe_event_summary')
      .select('*')
      .order('last_payment_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to load stripe_event_summary: ${error.message}`);
    }

    if (!data || !data.length) {
      return { totalEvents: 0, totalEventsPln: 0 };
    }

    let totalEventsPln = 0;
    const normalizedNames = data
      .map((event) => normalizeProductName(event.event_label || event.event_key || ''))
      .filter(Boolean);

    let productLookup = new Map();
    if (normalizedNames.length) {
      const { data: productRows, error: productError } = await supabase
        .from('products')
        .select('id,name,normalized_name,calculation_status,calculation_due_month')
        .in('normalized_name', normalizedNames);

      if (!productError && Array.isArray(productRows)) {
        productRows.forEach((row) => {
          const key = row.normalized_name || normalizeProductName(row.name);
          if (key) {
            productLookup.set(key, row);
          }
        });
      }
    }

    data.forEach((event) => {
      const normalized = normalizeProductName(event.event_label || event.event_key || '');
      const matchedProduct = normalized ? productLookup.get(normalized) : null;
      const slug = matchedProduct ? `id-${matchedProduct.id}` : `stripe-event-${event.event_key}`;
      // Используем тот же формат ключа, что и в aggregateRows: id:${productId} или slug для Stripe events
      const mapKey = matchedProduct ? `id:${matchedProduct.id}` : `stripe-event:${event.event_key}`;

      // Проверяем, есть ли уже продукт с таким ключом в Map
      const existingEntry = productsMap.get(mapKey);
      
      const entry = existingEntry || createEmptyEntry({
        mapKey,
        productId: matchedProduct ? matchedProduct.id : null,
        productName: matchedProduct?.name || `Stripe Event: ${event.event_label}`,
        productKey: matchedProduct?.normalized_name || normalizeProductName(event.event_label || event.event_key || ''),
        slug,
        source: 'stripe_event',
        eventKey: event.event_key || null
      });

      if (matchedProduct) {
        entry.calculationStatus = matchedProduct.calculation_status || entry.calculationStatus;
        entry.calculationDueMonth = matchedProduct.calculation_due_month || entry.calculationDueMonth;
        entry.eventKey = entry.eventKey || event.event_key || null;
      }

      // Don't overwrite existing grossPln from proformas - only set if entry is new (grossPln = 0)
      // This preserves proforma totals when Stripe events are added to existing products
      const eventGrossPln = Number(event.gross_revenue_pln || 0);
      if (entry.totals.grossPln === 0 || !existingEntry) {
        entry.totals.grossPln = eventGrossPln;
        entry.totals.paidPln = eventGrossPln;
      } else {
        // If entry already has proforma data, add Stripe event amount to it
        entry.totals.grossPln += eventGrossPln;
        entry.totals.paidPln += eventGrossPln;
      }
      entry.totals.originalTotals = {
        [event.currency || 'PLN']: Number(event.gross_revenue || 0)
      };
      entry.lastSaleDate = event.last_payment_at;
      entry.stripeTotals = {
        paymentsCount: event.payments_count,
        grossPln: Number(event.gross_revenue_pln || 0),
        grossRevenuePln: Number(event.gross_revenue_pln || 0),
        grossRevenue: Number(event.gross_revenue || 0),
        lastPaymentAt: event.last_payment_at,
        refundsCount: event.refunds_count || 0
      };
      entry.source = 'stripe_event';

      // Добавляем/обновляем продукт только если его еще нет
      if (!existingEntry) {
        productsMap.set(mapKey, entry);
      }
      totalEventsPln += entry.totals.grossPln;
    });

    return {
      totalEvents: data.length,
      totalEventsPln
    };
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
          payments_total_cash,
          payments_total_cash_pln,
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
          payments_total_cash,
          payments_total_cash_pln,
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
      if (
        !payment.campProductId
        && !payment.productName
        && !payment.crmProductId
      ) {
        return;
      }
      // Try to find existing product by campProductId first
      let mapKey = null;
      let matchedEntry = null;
      
      if (payment.campProductId) {
        // Try both string and number formats
        const campProductIdStr = String(payment.campProductId);
        const campProductIdNum = Number(payment.campProductId);
        mapKey = `id:${campProductIdNum}`;
        matchedEntry = products.get(mapKey);
        if (!matchedEntry && Number.isFinite(campProductIdNum)) {
          // Try string format
          mapKey = `id:${campProductIdStr}`;
          matchedEntry = products.get(mapKey);
        }
        if (!matchedEntry) {
          mapKey = null; // Reset if not found
        }
      }

      // If not found by campProductId, try crmProductId
      if (!mapKey && payment.crmProductId) {
        const crmProductIdStr = String(payment.crmProductId);
        const crmProductIdNum = Number(payment.crmProductId);
        mapKey = `id:${crmProductIdNum}`;
        matchedEntry = products.get(mapKey);
        if (!matchedEntry && Number.isFinite(crmProductIdNum)) {
          mapKey = `id:${crmProductIdStr}`;
          matchedEntry = products.get(mapKey);
        }
        if (!matchedEntry) {
          mapKey = null;
        }
      }

      // If not found by campProductId or crmProductId, try to find by normalized product name
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

        // Before creating new entry, check if we can match by productId
        // This handles cases where campProductId doesn't match but we have the same productId
        // Try both campProductId and crmProductId to find existing entry from proformas
        if (payment.campProductId) {
          const checkMapKey = `id:${Number(payment.campProductId)}`;
          if (products.has(checkMapKey)) {
            mapKey = checkMapKey;
            matchedEntry = products.get(mapKey);
          }
        }
        if (!matchedEntry && payment.crmProductId) {
          const checkMapKey = `id:${Number(payment.crmProductId)}`;
          if (products.has(checkMapKey)) {
            mapKey = checkMapKey;
            matchedEntry = products.get(mapKey);
          }
        }

        // Only create new entry if we really can't find an existing one
        if (!matchedEntry && !products.has(mapKey)) {
          const entry = createEmptyEntry({
            mapKey,
            productId: payment.campProductId || payment.crmProductId || null,
            productName: payment.productName || payment.crmProductId || 'Без названия',
            productKey: normalizeProductName(payment.productName || payment.crmProductId || ''),
            slug: this.buildStripeSlug(payment)
          });
          products.set(mapKey, entry);
          matchedEntry = entry;
        } else if (!matchedEntry) {
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
        processedAt: payment.processedAt || null,
        dealId: payment.dealId || null // Сохраняем deal_id для связи с проформами
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
            buyerCountry: proforma.buyer_country || null,
            paymentCount: Number(proforma.payments_count) || 0,
            paymentsTotalCashPln: proforma.payments_total_cash_pln || null
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
        const directEntry = products.get(`id:${id}`);
        if (directEntry) {
          return directEntry;
        }
        // Stripe-only entries that were injected via slug (id-<id>) should still be accessible
        const fallbackEntry = Array.from(products.values()).find((entry) => entry.slug === normalized);
        if (fallbackEntry) {
          return fallbackEntry;
        }
        return null;
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

  async loadCashPaymentsTotal(productId, proformas = []) {
    if (!supabase || !productId) {
      return { totalPln: 0, dealsCount: 0 };
    }

    try {
      // Load cash payments directly linked to product or through proformas
      const { data: directCash, error: directError } = await supabase
        .from('cash_payments')
        .select('amount_pln, cash_received_amount, cash_expected_amount, currency, status, product_id, deal_id')
        .eq('product_id', productId)
        .eq('status', 'received');

      if (directError) {
        logger.warn('Failed to load direct cash payments', {
          productId,
          error: directError.message
        });
      }

      // Load cash payments through proformas
      const { data: proformaProducts, error: proformaError } = await supabase
        .from('proforma_products')
        .select('proforma_id')
        .eq('product_id', productId);

      let proformaCash = [];
      if (!proformaError && proformaProducts && proformaProducts.length > 0) {
        const proformaIds = proformaProducts.map(pp => pp.proforma_id);
        
        const { data: cashViaProformas, error: cashError } = await supabase
          .from('cash_payments')
          .select('amount_pln, cash_received_amount, cash_expected_amount, currency, status, proforma_id, deal_id')
          .in('proforma_id', proformaIds)
          .eq('status', 'received')
          .is('product_id', null); // Only get cash payments not directly linked to product

        if (!cashError && cashViaProformas) {
          proformaCash = cashViaProformas;
        }
      }

      // Calculate total: use amount_pln if available, otherwise convert
      let total = 0;
      const uniqueDealIds = new Set();
      
      [...(directCash || []), ...proformaCash].forEach(cash => {
        // Count unique deals
        if (cash.deal_id) {
          uniqueDealIds.add(cash.deal_id);
        }

        // Calculate total amount
        if (cash.amount_pln != null) {
          total += Number(cash.amount_pln) || 0;
        } else if (cash.cash_received_amount != null) {
          // If currency is PLN, use as is; otherwise would need exchange rate
          const amount = Number(cash.cash_received_amount) || 0;
          total += (cash.currency === 'PLN' ? amount : amount); // Simplified: assume 1:1 if no conversion
        } else if (cash.cash_expected_amount != null && cash.currency === 'PLN') {
          total += Number(cash.cash_expected_amount) || 0;
        }
      });

      // Also check cash payments from proforma aggregates (payments_total_cash_pln)
      // This covers cases where cash was recorded in proforma aggregates but not in cash_payments table
      if (Array.isArray(proformas) && proformas.length > 0) {
        proformas.forEach(proforma => {
          const cashPln = proforma.payments_total_cash_pln;
          if (cashPln != null && cashPln !== undefined) {
            const proformaCashAmount = Number(cashPln) || 0;
            if (proformaCashAmount > 0) {
              total += proformaCashAmount;
              // Count deal if proforma has deal_id
              if (proforma.pipedrive_deal_id) {
                uniqueDealIds.add(proforma.pipedrive_deal_id);
              }
            }
          }
        });
      } else if (!proformaError && proformaProducts && proformaProducts.length > 0) {
        // If proformas not passed, load them from proforma_products
        const proformaIds = proformaProducts.map(pp => pp.proforma_id);
        const { data: proformasData, error: proformasLoadError } = await supabase
          .from('proformas')
          .select('id, pipedrive_deal_id, payments_total_cash_pln')
          .in('id', proformaIds);

        if (!proformasLoadError && proformasData && proformasData.length > 0) {
          proformasData.forEach(proforma => {
            const cashPln = proforma.payments_total_cash_pln;
            if (cashPln != null && cashPln !== undefined) {
              const proformaCashAmount = Number(cashPln) || 0;
              if (proformaCashAmount > 0) {
                total += proformaCashAmount;
                if (proforma.pipedrive_deal_id) {
                  uniqueDealIds.add(proforma.pipedrive_deal_id);
                }
              }
            }
          });
        }
      }

      return {
        totalPln: total,
        dealsCount: uniqueDealIds.size
      };
    } catch (error) {
      logger.error('Error loading cash payments total', {
        productId,
        error: error.message
      });
      return { totalPln: 0, dealsCount: 0 };
    }
  }

  async loadLinkedPayments(productId) {
    if (!supabase || !productId) {
      return { incoming: [], outgoing: [] };
    }

    // Load bank payment links
    const { data, error } = await supabase
      .from('payment_product_links')
      .select(`
        id,
        payment_id,
        product_id,
        direction,
        linked_by,
        linked_at,
        payment:payment_id (
          id,
          operation_date,
          description,
          amount,
          currency,
          direction,
          payer_name,
          manual_status,
          manual_proforma_fullnumber,
          income_category_id,
          expense_category_id,
          source,
          expense_category:expense_category_id (
            id,
            name
          )
        )
      `)
      .eq('product_id', productId)
      .order('linked_at', { ascending: false });

    if (error) {
      logger.error('Failed to load payment-product links for detail', {
        productId,
        error: error.message
      });
    }

    const mapped = (data || [])
      .map((row) => {
        const payment = row.payment || {};
        const amount = toNumber(payment.amount);
        return {
          linkId: row.id,
          paymentId: row.payment_id,
          direction: payment.direction || row.direction || null,
          amount: Number((amount || 0).toFixed(2)),
          currency: (payment.currency || 'PLN').toUpperCase(),
          description: payment.description || null,
          payerName: payment.payer_name || null,
          operationDate: payment.operation_date || null,
          manualStatus: payment.manual_status || null,
          manualProforma: payment.manual_proforma_fullnumber || null,
          source: payment.source || null,
          linkedBy: row.linked_by || null,
          linkedAt: row.linked_at || null,
          expenseCategoryId: payment.expense_category_id || null,
          expenseCategoryName: payment.expense_category?.name || null
        };
      })
      .filter((item) => Number.isFinite(item.amount));

    // Load Facebook Ads expenses
    const { data: facebookAdsData, error: facebookAdsError } = await supabase
      .from('facebook_ads_expenses')
      .select('*')
      .eq('product_id', productId)
      .order('report_start_date', { ascending: false });

    if (facebookAdsError) {
      logger.error('Failed to load Facebook Ads expenses for product', {
        productId,
        error: facebookAdsError.message
      });
    }

    logger.info('Facebook Ads expenses loaded for product', {
      productId,
      count: facebookAdsData?.length || 0,
      expenses: (facebookAdsData || []).map(e => ({
        campaign_name: e.campaign_name,
        amount_pln: e.amount_pln,
        product_id: e.product_id
      }))
    });

    const facebookAdsMapped = (facebookAdsData || [])
      .map((expense) => ({
        linkId: null,
        paymentId: null,
        direction: 'out',
        amount: Number((toNumber(expense.amount_pln) || 0).toFixed(2)),
        currency: (expense.currency || 'PLN').toUpperCase(),
        description: `Facebook Ads: ${expense.campaign_name}`,
        payerName: expense.campaign_name || null,
        operationDate: expense.report_end_date || null,
        manualStatus: null,
        manualProforma: null,
        source: 'facebook_ads',
        linkedBy: null,
        linkedAt: expense.created_at || null,
        expenseCategoryId: null,
        expenseCategoryName: 'Facebook Ads',
        campaignName: expense.campaign_name,
        reportStartDate: expense.report_start_date,
        reportEndDate: expense.report_end_date,
        isCampaignActive: expense.is_campaign_active
      }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);

    logger.info('Facebook Ads expenses mapped for product', {
      productId,
      mappedCount: facebookAdsMapped.length,
      totalAmount: facebookAdsMapped.reduce((sum, item) => sum + item.amount, 0)
    });

    // Combine bank payments and Facebook Ads expenses
    const allPayments = [...mapped, ...facebookAdsMapped];

    return {
      incoming: allPayments.filter((item) => item.direction === 'in'),
      outgoing: allPayments.filter((item) => item.direction === 'out')
    };
  }

  async loadStripeEventParticipants(eventKey) {
    if (!supabase || !eventKey) {
      return [];
    }

    const { data, error } = await supabase
      .from('stripe_event_participants')
      .select('*')
      .eq('event_key', eventKey)
      .order('total_amount_pln', { ascending: false });

    if (error) {
      logger.warn('Failed to load stripe event participants', {
        eventKey,
        error: error.message
      });
      return [];
    }

    return data || [];
  }

  calculateExpenseTotals(linkedPayments) {
    const totals = {
      currencyTotals: {},
      totalPln: 0
    };

    if (!linkedPayments || !Array.isArray(linkedPayments.outgoing)) {
      return totals;
    }

    linkedPayments.outgoing.forEach((item) => {
      const amount = toNumber(item.amount);
      if (!Number.isFinite(amount)) {
        return;
      }
      const currency = (item.currency || 'PLN').toUpperCase();
      totals.currencyTotals[currency] = (totals.currencyTotals[currency] || 0) + amount;
      if (currency === 'PLN') {
        totals.totalPln += amount;
      }
    });

    totals.currencyTotals = roundCurrencyMap(totals.currencyTotals);
    totals.totalPln = Number(totals.totalPln.toFixed(2));
    return totals;
  }

  calculateParticipantsCount(proformas, stripePayments) {
    const proformaCount = Array.isArray(proformas) ? proformas.length : 0;
    const stripeCount = Array.isArray(stripePayments) ? stripePayments.length : 0;
    return proformaCount + stripeCount;
  }

  toMonthKeyUtc(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  async loadCashPaymentsMonthly(productId, proformas = []) {
    if (!supabase || !productId) {
      return [];
    }

    // Collect proforma ids to include cash payments that are linked via proforma_id
    const proformaIds = Array.isArray(proformas)
      ? proformas.map((p) => p?.proformaId).filter(Boolean)
      : [];

    let query = supabase
      .from('cash_payments')
      .select('id, product_id, proforma_id, currency, cash_received_amount, amount_pln, confirmed_at, expected_date, created_at, status')
      .eq('status', 'received');

    // Include both: directly linked to product AND linked via proforma_id
    if (proformaIds.length > 0) {
      query = query.or(`product_id.eq.${productId},proforma_id.in.(${proformaIds.join(',')})`);
    } else {
      query = query.eq('product_id', productId);
    }

    const { data, error } = await query.limit(5000);
    if (error) {
      throw new Error(`Failed to load cash_payments monthly: ${error.message}`);
    }

    const items = Array.isArray(data) ? data : [];
    return items
      .map((row) => {
        const dateToUse = row.confirmed_at || row.expected_date || row.created_at || null;
        const monthKey = this.toMonthKeyUtc(dateToUse);
        if (!monthKey) return null;

        let amountPln = toNumber(row.amount_pln);
        if (!Number.isFinite(amountPln)) {
          const currency = (row.currency || 'PLN').toUpperCase();
          const raw = toNumber(row.cash_received_amount);
          if (currency === 'PLN' && Number.isFinite(raw)) {
            amountPln = raw;
          }
        }

        if (!Number.isFinite(amountPln) || amountPln <= 0) {
          return null;
        }

        return { monthKey, amountPln };
      })
      .filter(Boolean);
  }

  resolveProductDetailDateRange({ proformas = [], stripePayments = [], linkedPayments = { incoming: [] } } = {}) {
    const dates = [];
    (proformas || []).forEach((p) => p?.date && dates.push(p.date));
    (stripePayments || []).forEach((p) => (p?.createdAt || p?.processedAt) && dates.push(p.createdAt || p.processedAt));
    (linkedPayments?.incoming || []).forEach((p) => p?.operationDate && dates.push(p.operationDate));

    const parsed = dates
      .map((d) => new Date(d))
      .filter((d) => !Number.isNaN(d.getTime()));

    if (!parsed.length) {
      // Fallback: last 24 months
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear() - 2, 0, 1));
      const to = new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
      return { dateFrom: from, dateTo: to };
    }

    const min = new Date(Math.min(...parsed.map((d) => d.getTime())));
    const max = new Date(Math.max(...parsed.map((d) => d.getTime())));
    const from = new Date(Date.UTC(min.getUTCFullYear(), 0, 1));
    const to = new Date(Date.UTC(max.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
    return { dateFrom: from, dateTo: to };
  }

  buildMonthlyVatInvoiceRows(monthlyTotals = []) {
    const MARGIN_RATE = 0.35; // 35% маржа
    const VAT_RATE = 0.23; // 23% НДС

    return (monthlyTotals || [])
      .map((entry) => {
        const razemBrutto = Number((toNumber(entry.amountPln) || 0).toFixed(2));
        const quantity = Number(entry.count) || 0;

        const expenses = Number((razemBrutto * MARGIN_RATE).toFixed(2));
        const netMargin = Number((razemBrutto - expenses).toFixed(2));
        const vatAmount = Number((netMargin * VAT_RATE).toFixed(2));
        const totalWithVat = Number((razemBrutto + vatAmount).toFixed(2));

        return {
          month: entry.monthKey,
          razemBrutto,
          quantity,
          expenses,
          netMargin,
          vatRate: VAT_RATE,
          vatAmount,
          totalWithVat
        };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }

  async calculateMonthlyBreakdownFromPaymentReport({
    productId,
    proformas = [],
    stripePayments = [],
    linkedPayments = { incoming: [] },
    expensesPerParticipant = 0
  }) {
    if (!productId) {
      return [];
    }

    const { dateFrom, dateTo } = this.resolveProductDetailDateRange({
      proformas,
      stripePayments,
      linkedPayments
    });

    // Use the same aggregation source as /api/vat-margin/payment-report
    const report = await this.paymentRevenueReportService.getReport({
      dateFrom,
      dateTo,
      status: 'approved'
    });

    const groups = Array.isArray(report?.products) ? report.products : [];
    const group = groups.find((g) => Number(g.product_id) === Number(productId)) || null;
    if (!group) {
      return [];
    }

    const monthlyMap = new Map(); // monthKey -> { monthKey, amountPln, count }
    const ensure = (monthKey) => {
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { monthKey, amountPln: 0, count: 0 });
      }
      return monthlyMap.get(monthKey);
    };

    // Walk through the same payment entries used in payment-report totals
    (group.entries || []).forEach((agg) => {
      (agg.payments || []).forEach((payment) => {
        const monthKey = this.toMonthKeyUtc(payment.date);
        if (!monthKey) return;
        const amountPln = toNumber(payment.amount_pln);
        if (!Number.isFinite(amountPln) || amountPln <= 0) return;
        const row = ensure(monthKey);
        row.amountPln += amountPln;
        row.count += 1;
      });
    });

    // Keep signature compatibility; expensesPerParticipant is not used in month totals
    void expensesPerParticipant;

    return this.buildMonthlyVatInvoiceRows(Array.from(monthlyMap.values()));
  }
}

module.exports = ProductReportService;
