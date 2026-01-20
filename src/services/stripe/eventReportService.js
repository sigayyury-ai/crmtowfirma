const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

function buildCsvValue(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function normalizeProductName(name) {
  if (!name) return null;
  const trimmed = String(name || '').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  return trimmed
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class StripeEventReportService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
  }

  async getLastAggregationTimestamp() {
    const { data, error } = await this.supabase
      .from('stripe_event_aggregation_jobs')
      .select('finished_at')
      .eq('status', 'success')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn('Failed to load aggregation jobs', { error: error.message });
      return null;
    }
    return data?.finished_at || null;
  }

  async listEvents({ limit = 50, from = null, to = null, cabinetOnly = true } = {}) {
    if (!this.supabase) {
      throw new Error('StripeEventReportService: Supabase client is not configured');
    }

    // При cabinetOnly=true фильтруем события, оставляя только те, которые соответствуют продуктам из кабинета
    // Логика фильтрации ниже, после загрузки событий

    const boundedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    let query = this.supabase
      .from('stripe_event_summary')
      .select('*')
      .order('last_payment_at', { ascending: false })
      .limit(boundedLimit * 2); // Загружаем больше, чтобы после фильтрации осталось достаточно

    if (from) {
      query = query.gte('last_payment_at', from);
    }
    if (to) {
      query = query.lte('last_payment_at', to);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load event summary: ${error.message}`);
    }

    // Фильтруем события: оставляем только те, которые связаны с продуктами из кабинета
    // Используем тот же подход, что и в productReportService.addStripeEventEntries:
    // сначала получаем нормализованные имена событий, затем находим соответствующие продукты
    let filteredData = data || [];
    if (cabinetOnly) {
      // Нормализуем имена всех событий
      const normalizedEventNames = (data || [])
        .map((event) => normalizeProductName(event.event_label || event.event_key || ''))
        .filter(Boolean);

      if (normalizedEventNames.length === 0) {
        // Если нет нормализованных имен событий, не показываем никакие события
        filteredData = [];
      } else {
        // Находим продукты, которые соответствуют нормализованным именам событий
        const { data: matchedProducts, error: productsError } = await this.supabase
          .from('products')
          .select('normalized_name')
          .in('normalized_name', normalizedEventNames);

        if (productsError) {
          this.logger.warn('Failed to load matched products for filtering', { error: productsError.message });
        }

        // Создаем Set нормализованных имен продуктов, которые соответствуют событиям
        const matchedProductNames = new Set();
        if (Array.isArray(matchedProducts)) {
          matchedProducts.forEach((product) => {
            if (product.normalized_name) {
              matchedProductNames.add(product.normalized_name);
            }
          });
        }

        // Фильтруем события: оставляем только те, чье нормализованное имя есть в matchedProductNames
        this.logger.info('Filtering Stripe events by cabinet products', {
          totalEvents: (data || []).length,
          normalizedEventNamesCount: normalizedEventNames.length,
          matchedProductsCount: matchedProductNames.size,
          matchedProductNames: Array.from(matchedProductNames).slice(0, 10) // Первые 10 для логов
        });

        filteredData = (data || []).filter((event) => {
          const eventLabel = event.event_label || event.event_key || '';
          const normalizedLabel = normalizeProductName(eventLabel);
          const isMatched = normalizedLabel && matchedProductNames.has(normalizedLabel);
          
          if (!isMatched && normalizedLabel) {
            this.logger.debug('Filtering out event (no product match)', {
              eventKey: event.event_key,
              eventLabel: event.event_label,
              normalizedLabel
            });
          } else if (isMatched) {
            this.logger.debug('Keeping event (has product match)', {
              eventKey: event.event_key,
              eventLabel: event.event_label,
              normalizedLabel
            });
          }
          
          return isMatched;
        });

        this.logger.info('Filtered Stripe events result', {
          beforeFilter: (data || []).length,
          afterFilter: filteredData.length,
          filteredOut: (data || []).length - filteredData.length
        });
      }
    }

    // Ограничиваем результат до запрошенного лимита
    filteredData = filteredData.slice(0, boundedLimit);

    const lastUpdated = await this.getLastAggregationTimestamp();

    return {
      items: filteredData,
      pageInfo: {
        limit: boundedLimit,
        hasMore: false,
        nextCursor: null
      },
      source: 'supabase',
      lastUpdated
    };
  }

  async getEventReport(eventKey) {
    if (!this.supabase) {
      throw new Error('StripeEventReportService: Supabase client is not configured');
    }
    if (!eventKey) {
      throw new Error('eventKey is required');
    }

    const { data: summary, error: summaryError } = await this.supabase
      .from('stripe_event_summary')
      .select('*')
      .eq('event_key', eventKey)
      .maybeSingle();

    if (summaryError) {
      throw new Error(`Failed to load event summary: ${summaryError.message}`);
    }
    if (!summary) {
      const error = new Error('Event not found');
      error.statusCode = 404;
      throw error;
    }

    const { data: participantsData, error: participantsError } = await this.supabase
      .from('stripe_event_participants')
      .select('*')
      .eq('event_key', eventKey)
      .order('total_amount_pln', { ascending: false });

    if (participantsError) {
      throw new Error(`Failed to load event participants: ${participantsError.message}`);
    }

    const participants = (participantsData || []).map((participant) => ({
      id: participant.id,
      eventKey: participant.event_key,
      participantId: participant.participant_id,
      displayName: participant.display_name,
      email: participant.email,
      currency: participant.currency || summary.currency || 'PLN',
      totalAmount: participant.total_amount,
      totalAmountPln: participant.total_amount_pln,
      paymentsCount: participant.payments_count,
      refundAmountPln: participant.refund_amount_pln,
      updatedAt: participant.updated_at
    }));

    return {
      eventKey: summary.event_key,
      eventLabel: summary.event_label,
      currency: summary.currency || 'PLN',
      totalSessions: summary.payments_count,
      totalLineItems: summary.payments_count,
      warnings: summary.warnings || [],
      participants,
      totals: {
        grossRevenue: summary.gross_revenue,
        grossRevenuePln: summary.gross_revenue_pln,
        participantsCount: summary.participants_count,
        sessionsCount: summary.payments_count
      },
      generatedAt: new Date().toISOString(),
      lastPaymentAt: summary.last_payment_at,
      lastUpdated: summary.updated_at
    };
  }

  async generateExportCsv(eventKey) {
    const report = await this.getEventReport(eventKey);
    const header = [
      'Name',
      'Email',
      'Total Amount (PLN)',
      `Total Amount (${report.currency})`,
      'Payments Count'
    ];

    const rows = (report.participants || []).map((participant) => [
      participant.display_name || '',
      participant.email || '',
      participant.total_amount_pln?.toFixed
        ? participant.total_amount_pln.toFixed(2)
        : Number(participant.total_amount_pln || 0).toFixed(2),
      participant.total_amount?.toFixed
        ? participant.total_amount.toFixed(2)
        : Number(participant.total_amount || 0).toFixed(2),
      participant.payments_count || 0
    ]);

    const totalsRow = [
      'Итого',
      '',
      report.totals.grossRevenuePln?.toFixed
        ? report.totals.grossRevenuePln.toFixed(2)
        : Number(report.totals.grossRevenuePln || 0).toFixed(2),
      report.totals.grossRevenue?.toFixed
        ? report.totals.grossRevenue.toFixed(2)
        : Number(report.totals.grossRevenue || 0).toFixed(2),
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

