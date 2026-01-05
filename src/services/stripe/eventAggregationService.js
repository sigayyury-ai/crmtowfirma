const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

const PARTICIPANT_FALLBACK_PREFIX = 'anon';
const PAGE_SIZE = 1000;

function normalizeProductName(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || null;
}

class StripeEventAggregationService {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
    this.logger = options.logger || logger;
  }

  buildParticipantId(item) {
    if (item.customer_email) return item.customer_email.toLowerCase();
    if (item.customer_id) return item.customer_id;
    return `${PARTICIPANT_FALLBACK_PREFIX}-${item.session_id}-${item.line_item_id}`;
  }

  async loadEventItems() {
    const items = [];
    let page = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await this.supabase
        .from('stripe_event_items')
        .select('*')
        .order('updated_at', { ascending: false })
        .range(from, to);

      if (error) {
        throw new Error(`Failed to load event items: ${error.message}`);
      }

      if (!data || data.length === 0) {
        break;
      }

      items.push(...data);

      if (data.length < PAGE_SIZE) {
        break;
      }
      page += 1;
    }
    return items;
  }

  aggregate(items) {
    const summaryMap = new Map();
    const participantMap = new Map();

    for (const item of items) {
      const key = item.event_key;
      if (!summaryMap.has(key)) {
        summaryMap.set(key, {
          event_key: key,
          event_label: item.event_label || key,
          currency: item.currency || 'PLN',
          gross_revenue: 0,
          gross_revenue_pln: 0,
          payments_count: 0,
          participants_count: 0,
          refunds_count: 0,
          warnings: [],
          last_payment_at: item.updated_at || item.created_at || null
        });
      }

      const summary = summaryMap.get(key);
      summary.gross_revenue += Number(item.amount) || 0;
      summary.gross_revenue_pln += Number(item.amount_pln) || 0;
      summary.payments_count += 1;

      if (item.refund_status) {
        summary.refunds_count += 1;
      }
      if (
        summary.last_payment_at &&
        item.updated_at &&
        new Date(item.updated_at) > new Date(summary.last_payment_at)
      ) {
        summary.last_payment_at = item.updated_at;
      }

      const participantId = this.buildParticipantId(item);
      const participantKey = `${key}::${participantId}`;
      if (!participantMap.has(participantKey)) {
        participantMap.set(participantKey, {
          event_key: key,
          participant_id: participantId,
          display_name: item.customer_name || item.customer_email || 'Участник',
          email: item.customer_email || null,
          currency: item.currency || 'PLN',
          total_amount: 0,
          total_amount_pln: 0,
          payments_count: 0,
          refund_amount_pln: 0
        });
      }

      const participant = participantMap.get(participantKey);
      participant.total_amount += Number(item.amount) || 0;
      participant.total_amount_pln += Number(item.amount_pln) || 0;
      participant.payments_count += 1;
      if (item.refund_status) {
          participant.refund_amount_pln += Number(item.amount_pln) || 0;
      }
    }

    // Update participants_count
    for (const summary of summaryMap.values()) {
      const uniqueParticipants = Array.from(participantMap.values()).filter(
        (p) => p.event_key === summary.event_key
      );
      summary.participants_count = uniqueParticipants.length;
    }

    return {
      summary: Array.from(summaryMap.values()),
      participants: Array.from(participantMap.values())
    };
  }

  async resetTables() {
    await this.supabase.from('stripe_event_participants').delete().neq('event_key', '');
    await this.supabase.from('stripe_event_summary').delete().neq('event_key', '');
  }

  async upsertSummary(rows) {
    if (!rows.length) return;
    const { error } = await this.supabase.from('stripe_event_summary').upsert(rows);
    if (error) {
      throw new Error(`Failed to upsert summary: ${error.message}`);
    }
  }

  async upsertParticipants(rows) {
    if (!rows.length) return;
    
    // Проверяем существующие записи перед вставкой, чтобы избежать дубликатов
    const eventKeys = [...new Set(rows.map(r => r.event_key))];
    const participantIds = [...new Set(rows.map(r => r.participant_id).filter(Boolean))];
    
    let existingRows = [];
    if (eventKeys.length > 0 && participantIds.length > 0) {
      try {
        const { data, error: queryError } = await this.supabase
          .from('stripe_event_participants')
          .select('event_key, participant_id')
          .in('event_key', eventKeys)
          .in('participant_id', participantIds);
        
        if (queryError) {
          this.logger.warn('Failed to check existing participants, proceeding with insert', {
            error: queryError.message
          });
        } else {
          existingRows = data || [];
        }
      } catch (error) {
        this.logger.warn('Error checking existing participants, proceeding with insert', {
          error: error.message
        });
      }
    }
    
    // Создаем Set для быстрой проверки существующих записей
    const existingSet = new Set(
      existingRows.map(r => `${r.event_key}:${r.participant_id}`)
    );
    
    // Фильтруем дубликаты
    const uniqueRows = rows.filter(row => {
      const key = `${row.event_key}:${row.participant_id}`;
      return !existingSet.has(key);
    });
    
    if (uniqueRows.length === 0) {
      this.logger.debug('All participants already exist, skipping insert');
      return;
    }
    
    if (uniqueRows.length < rows.length) {
      this.logger.info('Filtered duplicate participants', {
        total: rows.length,
        unique: uniqueRows.length,
        duplicates: rows.length - uniqueRows.length
      });
    }
    
    // Используем upsert вместо insert для обработки конфликтов
    const { error } = await this.supabase
      .from('stripe_event_participants')
      .upsert(uniqueRows, {
        onConflict: 'event_key,participant_id',
        ignoreDuplicates: false
      });
    
    if (error) {
      // Если ошибка связана с дубликатами, логируем предупреждение, но не выбрасываем ошибку
      if (error.message && error.message.includes('duplicate') || error.code === '23505') {
        this.logger.warn('Duplicate participants detected during upsert (this is expected)', {
          error: error.message,
          rowsCount: uniqueRows.length
        });
        return; // Не выбрасываем ошибку для дубликатов
      }
      throw new Error(`Failed to upsert participants: ${error.message}`);
    }
  }

  async syncProductsWithEvents(summaryRows = []) {
    if (!this.supabase || !Array.isArray(summaryRows) || summaryRows.length === 0) {
      return;
    }

    const uniqueMap = new Map();
    summaryRows.forEach((row) => {
      const label = (row.event_label || row.event_key || '').trim();
      const normalized = normalizeProductName(label || row.event_key);
      if (!normalized) {
        return;
      }
      if (!uniqueMap.has(normalized)) {
        uniqueMap.set(normalized, {
          name: label || row.event_key || 'Stripe Event',
          normalized_name: normalized
        });
      }
    });

    const normalizedList = Array.from(uniqueMap.keys());
    if (normalizedList.length === 0) {
      return;
    }

    let existing = [];
    try {
      const { data, error } = await this.supabase
        .from('products')
        .select('normalized_name')
        .in('normalized_name', normalizedList);
      if (error) {
        throw error;
      }
      existing = data || [];
    } catch (error) {
      this.logger.warn('StripeEventAggregationService: failed to load existing products for events', {
        error: error.message
      });
      return;
    }

    const existingSet = new Set(existing.map((row) => row.normalized_name));
    const rowsToInsert = normalizedList
      .filter((key) => !existingSet.has(key))
      .map((key) => ({
        name: uniqueMap.get(key).name,
        normalized_name: key,
        calculation_status: 'in_progress',
        calculation_due_month: null
      }));

    if (!rowsToInsert.length) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('products')
        .insert(rowsToInsert);
      if (error) {
        throw error;
      }
      this.logger.info('StripeEventAggregationService: synced event products', {
        inserted: rowsToInsert.length
      });
    } catch (error) {
      this.logger.warn('StripeEventAggregationService: failed to insert event products', {
        error: error.message
      });
    }
  }

  async logJob(payload) {
    const { error } = await this.supabase.from('stripe_event_aggregation_jobs').insert(payload);
    if (error) {
      this.logger.warn('StripeEventAggregationService: failed to log job', {
        error: error.message
      });
    }
  }

  async aggregateAll() {
    if (!this.supabase) {
      throw new Error('StripeEventAggregationService: Supabase client not configured');
    }

    const job = {
      started_at: new Date().toISOString(),
      status: 'running',
      processed_sessions: 0,
      detected_refunds: 0
    };

    try {
      const items = await this.loadEventItems();
      const { summary, participants } = this.aggregate(items);

      await this.resetTables();
      await this.upsertSummary(
        summary.map((row) => ({
          ...row,
          gross_revenue: Number(row.gross_revenue.toFixed(2)),
          gross_revenue_pln: Number(row.gross_revenue_pln.toFixed(2)),
          updated_at: new Date().toISOString()
        }))
      );
      await this.upsertParticipants(
        participants.map((row) => ({
          ...row,
          total_amount: Number(row.total_amount.toFixed(2)),
          total_amount_pln: Number(row.total_amount_pln.toFixed(2)),
          updated_at: new Date().toISOString()
        }))
      );
      await this.syncProductsWithEvents(summary);

      job.finished_at = new Date().toISOString();
      job.status = 'success';
      job.processed_sessions = summary.length;
      job.detected_refunds = summary.reduce((acc, row) => acc + row.refunds_count, 0);
      await this.logJob(job);
      this.logger.info('Stripe events aggregation completed', {
        events: summary.length,
        participants: participants.length
      });
    } catch (error) {
      job.finished_at = new Date().toISOString();
      job.status = 'failure';
      job.error_message = error.message;
      await this.logJob(job);
      this.logger.error('Stripe events aggregation failed', { error: error.message });
      throw error;
    }
  }
}

module.exports = StripeEventAggregationService;

