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

  async listEvents({ limit = 50, from = null, to = null } = {}) {
    if (!this.supabase) {
      throw new Error('StripeEventReportService: Supabase client is not configured');
    }

    const boundedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    let query = this.supabase
      .from('stripe_event_summary')
      .select('*')
      .order('last_payment_at', { ascending: false })
      .limit(boundedLimit);

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

    const lastUpdated = await this.getLastAggregationTimestamp();

    return {
      items: data || [],
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

    const { data: participants, error: participantsError } = await this.supabase
      .from('stripe_event_participants')
      .select('*')
      .eq('event_key', eventKey)
      .order('total_amount_pln', { ascending: false });

    if (participantsError) {
      throw new Error(`Failed to load event participants: ${participantsError.message}`);
    }

    return {
      eventKey: summary.event_key,
      eventLabel: summary.event_label,
      currency: summary.currency || 'PLN',
      totalSessions: summary.payments_count,
      totalLineItems: summary.payments_count,
      warnings: summary.warnings || [],
      participants: participants || [],
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

