const supabase = require('./supabaseClient');
const logger = require('../utils/logger');

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const ALLOWED_SORT_FIELDS = new Set([
  'deleted_at',
  'issued_at',
  'fullnumber',
  'total',
  'payments_total',
  'payments_total_pln'
]);

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizePageSize(pageSize) {
  const parsed = Number.parseInt(pageSize, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
}

function escapeIlikeValue(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/,/g, '\\,');
}

function buildSearchConditions(pattern, rawSearch) {
  const conditions = [
    `fullnumber.ilike.${pattern}`,
    `buyer_name.ilike.${pattern}`,
    `buyer_email.ilike.${pattern}`
  ];

  if (/^\d+$/.test(rawSearch)) {
    conditions.push(`deal_id.eq.${rawSearch}`);
  }

  return conditions.join(',');
}

class DeletedProformaReportService {
  constructor() {
    this.supabase = supabase;
  }

  isEnabled() {
    return !!this.supabase;
  }

  buildFilters({ startDate, endDate, status, buyer, search }) {
    return (query) => {
      let builder = query;

      if (Array.isArray(status) && status.length) {
        builder = builder.in('status', status);
      } else if (status) {
        builder = builder.eq('status', status);
      } else {
        builder = builder.eq('status', 'deleted');
      }

      if (startDate) {
        builder = builder.gte('deleted_at', new Date(startDate).toISOString());
      }

      if (endDate) {
        const end = new Date(endDate);
        if (!Number.isNaN(end.getTime())) {
          end.setHours(23, 59, 59, 999);
          builder = builder.lte('deleted_at', end.toISOString());
        }
      }

      if (buyer) {
        const pattern = `*${escapeIlikeValue(buyer)}*`;
        builder = builder.ilike('buyer_name', pattern);
      }

      if (search) {
        const escaped = escapeIlikeValue(search);
        const pattern = `*${escaped}*`;
        builder = builder.or(buildSearchConditions(pattern, search));
      }

      return builder;
    };
  }

  normalizeSort(sort = 'deleted_at', order = 'desc') {
    const field = ALLOWED_SORT_FIELDS.has(sort) ? sort : 'deleted_at';
    const ascending = String(order).toLowerCase() === 'asc';
    return { field, ascending };
  }

  buildSummary(rows = []) {
    const summary = {
      totalCount: rows.length,
      totalsByCurrency: {},
      statusCounts: {}
    };

    rows.forEach((row) => {
      const currency = row.currency || 'UNKNOWN';
      const total = toNumber(row.total) || 0;
      const paymentsTotal =
        toNumber(row.payments_total ?? row.paymentsTotal) || 0;
      const paymentsTotalPln =
        toNumber(row.payments_total_pln ?? row.paymentsTotalPln);
      const status = row.status || 'unknown';

      if (!summary.totalsByCurrency[currency]) {
        summary.totalsByCurrency[currency] = {
          total: 0,
          payments: 0,
          paymentsPln: 0,
          balance: 0
        };
      }

      summary.totalsByCurrency[currency].total += total;
      summary.totalsByCurrency[currency].payments += paymentsTotal;
      summary.totalsByCurrency[currency].paymentsPln += paymentsTotalPln || 0;
      summary.totalsByCurrency[currency].balance += paymentsTotal - total;

      summary.statusCounts[status] = (summary.statusCounts[status] || 0) + 1;
    });

    return summary;
  }

  hydrateRow(row) {
    const total = toNumber(row.total);
    const paymentsTotal = toNumber(row.payments_total);
    const paymentsTotalPln = toNumber(row.payments_total_pln);
    const paymentsCount = toNumber(row.payments_count);

    return {
      id: row.id,
      proformaId: row.id,
      proformaNumber: row.fullnumber || null,
      dealId: row.pipedrive_deal_id || null,
      buyerName: row.buyer_name || null,
      buyerEmail: row.buyer_email || null,
      buyerCountry: row.buyer_country || null,
      buyerCity: row.buyer_city || null,
      buyerPhone: row.buyer_phone || null,
      currency: row.currency || null,
      total,
      paymentsTotal,
      paymentsTotalPln,
      paymentsCount,
      balance: (paymentsTotal || 0) - (total || 0),
      status: row.status || 'deleted',
      deletedAt: row.deleted_at || null,
      issuedAt: row.issued_at || null,
      issuedMonth: row.issued_at ? String(row.issued_at).slice(0, 7) : null
    };
  }

  async fetchDeletedProformas(options = {}) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Supabase client is not configured' };
    }

    const page = Number.isFinite(options.page) ? Math.max(1, Number.parseInt(options.page, 10)) : 1;
    const pageSize = normalizePageSize(options.pageSize);
    const offset = (page - 1) * pageSize;
    const filters = this.buildFilters(options);
    const { field, ascending } = this.normalizeSort(options.sort, options.order);

    try {
      // Load deleted proformas
      const dataQuery = filters(
        this.supabase
          .from('proformas')
          .select(`
            id,
            fullnumber,
            pipedrive_deal_id,
            buyer_name,
            buyer_email,
            buyer_phone,
            buyer_country,
            buyer_city,
            currency,
            total,
            payments_total,
            payments_total_pln,
            payments_count,
            status,
            deleted_at,
            issued_at
          `, { count: 'exact' })
      ).order(field, { ascending });

      const { data, error, count } = await dataQuery.range(offset, offset + pageSize - 1);

      if (error) {
        logger.error('Supabase error while fetching deleted proformas:', error);
        return { success: false, error: error.message };
      }

      // Load Stripe refunds (deletions) and convert them to proforma-like format
      const StripeRepository = require('./stripe/repository');
      const stripeRepo = new StripeRepository();
      let stripeDeletions = [];
      
      try {
        // Build filters for Stripe deletions (match proforma filters)
        const deletionFilters = {};
        if (options.startDate) {
          deletionFilters.dateFrom = options.startDate;
        }
        if (options.endDate) {
          deletionFilters.dateTo = options.endDate;
        }
        
        const allDeletions = await stripeRepo.listDeletions(deletionFilters);
        
        // Convert Stripe deletions to proforma-like format
        stripeDeletions = allDeletions.map((deletion) => {
          const metadata = deletion.metadata || {};
          const rawPayload = deletion.raw_payload || {};
          const payment = rawPayload.payment || {};
          
          return {
            id: `stripe_${deletion.payment_id}`,
            fullnumber: `REFUND-${deletion.payment_id?.substring(0, 8) || 'N/A'}`,
            pipedrive_deal_id: deletion.deal_id || metadata.deal_id || null,
            buyer_name: payment.customer_name || metadata.customer_name || 'Stripe Refund',
            buyer_email: payment.customer_email || metadata.customer_email || null,
            buyer_phone: null,
            buyer_country: null,
            buyer_city: null,
            currency: deletion.currency || 'PLN',
            total: Math.abs(deletion.amount || 0), // Refund amount is negative, convert to positive
            payments_total: Math.abs(deletion.amount || 0),
            payments_total_pln: Math.abs(deletion.amount_pln || 0),
            payments_count: 1,
            status: 'deleted',
            deleted_at: deletion.logged_at || deletion.created_at,
            issued_at: payment.created_at || deletion.logged_at,
            source: 'stripe_refund'
          };
        });
      } catch (stripeError) {
        logger.warn('Failed to load Stripe refunds for deleted proforma report', {
          error: stripeError.message
        });
      }

      // Combine proformas and Stripe refunds
      const allItems = [
        ...(data || []).map((row) => ({ ...this.hydrateRow(row), source: 'proforma' })),
        ...stripeDeletions.map((row) => this.hydrateRow(row))
      ];
      
      // Sort combined items
      const sortField = field === 'deleted_at' ? 'deletedAt' : 
                       field === 'issued_at' ? 'issuedAt' : 
                       field === 'fullnumber' ? 'proformaNumber' : field;
      allItems.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        if (ascending) {
          return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        } else {
          return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
        }
      });
      
      // Apply pagination to combined results
      const paginatedItems = allItems.slice(offset, offset + pageSize);
      const items = paginatedItems;
      
      let summary;

      try {
        // Build summary from all items (proformas + Stripe refunds)
        summary = this.buildSummary(allItems);
        summary.totalCount = allItems.length;
      } catch (summaryError) {
        logger.warn('Falling back to page-level summary for deleted proforma report', {
          error: summaryError.message
        });
        summary = this.buildSummary(items);
        summary.totalCount = allItems.length;
      }

      return {
        success: true,
        page,
        pageSize,
        total: allItems.length,
        summary,
        data: items
      };
    } catch (error) {
      logger.error('Unexpected error while fetching deleted proforma report:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = DeletedProformaReportService;
