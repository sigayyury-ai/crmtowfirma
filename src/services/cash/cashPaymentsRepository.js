const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

class CashPaymentsRepository {
  constructor() {
    this.supabase = supabase;
    if (!this.supabase) {
      logger.warn('Supabase client is not configured. CashPaymentsRepository will be disabled.');
    }
  }

  isEnabled() {
    return !!this.supabase;
  }

  toNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const parsed = parseFloat(value.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  roundCurrency(value) {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100) / 100;
  }

  async createPayment(payload) {
    if (!this.isEnabled()) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_payments')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to create cash payment', { error, payload });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while creating cash payment', { error: err.message, payload });
      return null;
    }
  }

  async updatePayment(id, updates) {
    if (!this.isEnabled() || !id) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_payments')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        logger.error('Failed to update cash payment', { error, id, updates });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while updating cash payment', { error: err.message, id, updates });
      return null;
    }
  }

  async getPaymentById(id) {
    if (!this.isEnabled() || !id) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_payments')
        .select(`
          *,
          proformas (
            id,
            fullnumber,
            currency,
            total,
            payments_total_cash,
            payments_total_cash_pln,
            buyer_name,
            buyer_email
          ),
          products (
            id,
            name
          )
        `)
        .eq('id', id)
        .maybeSingle();

      if (error) {
        logger.error('Failed to fetch cash payment by id', { error, id });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while fetching cash payment', { error: err.message, id });
      return null;
    }
  }

  buildListQuery(filters = {}) {
    let query = this.supabase
      .from('cash_payments')
      .select(`
        *,
        proformas (
          id,
          fullnumber,
          currency,
          total,
          payments_total_cash,
          payments_total_cash_pln,
          buyer_name,
          buyer_email
        ),
        products ( id, name )
      `)
      .order(filters.orderBy || 'created_at', { ascending: filters.ascending ?? false });

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters.dealId) {
      query = query.eq('deal_id', filters.dealId);
    }

    if (filters.proformaId) {
      query = query.eq('proforma_id', filters.proformaId);
    }

    if (filters.productId) {
      query = query.eq('product_id', filters.productId);
    }

    if (filters.source) {
      query = query.eq('source', filters.source);
    }

    if (filters.searchFullnumber) {
      query = query.ilike('proforma_fullnumber', `%${filters.searchFullnumber}%`);
    }

    if (filters.expectedFrom) {
      query = query.gte('expected_date', filters.expectedFrom);
    }

    if (filters.expectedTo) {
      query = query.lte('expected_date', filters.expectedTo);
    }

    if (filters.createdFrom) {
      query = query.gte('created_at', filters.createdFrom);
    }

    if (filters.createdTo) {
      query = query.lte('created_at', filters.createdTo);
    }

    if (filters.metadata && typeof filters.metadata === 'object') {
      query = query.contains('metadata', filters.metadata);
    }

    if (typeof filters.limit === 'number' && filters.limit > 0) {
      query = query.limit(Math.min(filters.limit, 500));
    }

    if (typeof filters.offset === 'number' && filters.offset >= 0) {
      const effectiveLimit = Math.min(filters.limit || 50, 500);
      query = query.range(filters.offset, filters.offset + effectiveLimit - 1);
    }

    return query;
  }

  async listPayments(filters = {}) {
    if (!this.isEnabled()) return [];

    try {
      const query = this.buildListQuery(filters);
      const { data, error } = await query;

      if (error) {
        logger.error('Failed to list cash payments', { error, filters });
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('Exception while listing cash payments', { error: err.message, filters });
      return [];
    }
  }

  async logEvent(paymentId, eventType, { source = null, payload = null, createdBy = null } = {}) {
    if (!this.isEnabled() || !paymentId || !eventType) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_payment_events')
        .insert({
          cash_payment_id: paymentId,
          event_type: eventType,
          source,
          payload,
          created_by: createdBy
        })
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to log cash payment event', { error, paymentId, eventType });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while logging cash payment event', { error: err.message, paymentId, eventType });
      return null;
    }
  }

  async listEvents(paymentId, limit = 50) {
    if (!this.isEnabled() || !paymentId) return [];

    try {
      const { data, error } = await this.supabase
        .from('cash_payment_events')
        .select('*')
        .eq('cash_payment_id', paymentId)
        .order('created_at', { ascending: false })
        .limit(Math.min(limit, 200));

      if (error) {
        logger.error('Failed to fetch cash payment events', { error, paymentId });
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('Exception while fetching cash payment events', { error: err.message, paymentId });
      return [];
    }
  }

  async createRefund(payload) {
    if (!this.isEnabled()) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_refunds')
        .insert(payload)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to create cash refund', { error, payload });
        return null;
      }

      return data;
    } catch (err) {
      logger.error('Exception while creating cash refund', { error: err.message, payload });
      return null;
    }
  }

  async confirmPayment(paymentId, { amount, currency, confirmedAt, confirmedBy, note } = {}) {
    if (!this.isEnabled() || !paymentId) return null;

    try {
      const existing = await this.getPaymentById(paymentId);
      if (!existing) {
        return null;
      }

      const value = this.roundCurrency(
        this.toNumber(amount) ??
        this.toNumber(existing.cash_received_amount) ??
        this.toNumber(existing.cash_expected_amount)
      );

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid confirmation amount');
      }

      const normalizedCurrency = (currency || existing.currency || 'PLN').toUpperCase();
      let amountPln = this.toNumber(existing.amount_pln);
      const exchangeRate = this.toNumber(existing.proformas?.currency_exchange);

      if (normalizedCurrency === 'PLN') {
        amountPln = value;
      } else if (!Number.isFinite(amountPln) && Number.isFinite(exchangeRate) && exchangeRate > 0) {
        amountPln = this.roundCurrency(value * exchangeRate);
      }

      const payload = {
        cash_received_amount: value,
        currency: normalizedCurrency,
        amount_pln: amountPln,
        status: 'received',
        confirmed_at: confirmedAt || new Date().toISOString(),
        confirmed_by: confirmedBy || existing.confirmed_by || null,
        note: note || existing.note
      };

      const updated = await this.updatePayment(paymentId, payload);
      if (!updated) {
        return null;
      }

      await this.logEvent(paymentId, 'api:confirm', {
        source: 'api',
        payload: { amount: value },
        createdBy: confirmedBy || 'api'
      });

      if (updated.proforma_id) {
        await this.updateProformaCashTotals(updated.proforma_id);
      }

      return updated;
    } catch (err) {
      logger.error('Failed to confirm cash payment', {
        error: err.message,
        paymentId
      });
      throw err;
    }
  }

  async refundPayment(paymentId, { amount, currency, reason, processedBy, processedAt, note } = {}) {
    if (!this.isEnabled() || !paymentId) return null;

    try {
      const existing = await this.getPaymentById(paymentId);
      if (!existing) {
        return null;
      }

      const value = this.roundCurrency(
        this.toNumber(amount) ??
        this.toNumber(existing.cash_received_amount) ??
        this.toNumber(existing.cash_expected_amount)
      );

      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Invalid refund amount');
      }

      const normalizedCurrency = (currency || existing.currency || 'PLN').toUpperCase();

      const refund = await this.createRefund({
        cash_payment_id: paymentId,
        amount: value,
        currency: normalizedCurrency,
        reason: reason || 'Cash refund',
        processed_by: processedBy || 'api',
        processed_at: processedAt || new Date().toISOString(),
        status: 'processed',
        note: note || null
      });

      const updated = await this.updatePayment(paymentId, {
        status: 'refunded',
        note: note || existing.note,
        cash_received_amount: value,
        confirmed_by: processedBy || existing.confirmed_by || null,
        confirmed_at: processedAt || existing.confirmed_at || new Date().toISOString()
      });

      await this.logEvent(paymentId, 'api:refund', {
        source: 'api',
        payload: { amount: value, reason },
        createdBy: processedBy || 'api'
      });

      if (updated?.proforma_id) {
        await this.updateProformaCashTotals(updated.proforma_id);
      }

      return { payment: updated, refund };
    } catch (err) {
      logger.error('Failed to refund cash payment', {
        error: err.message,
        paymentId
      });
      throw err;
    }
  }

  async listRefunds(filters = {}) {
    if (!this.isEnabled()) return [];

    try {
      let query = this.supabase
        .from('cash_refunds')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters.cashPaymentId) {
        query = query.eq('cash_payment_id', filters.cashPaymentId);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to list cash refunds', { error, filters });
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('Exception while listing cash refunds', { error: err.message, filters });
      return [];
    }
  }

  async findDealExpectation(dealId) {
    if (!this.isEnabled() || !dealId) return null;

    try {
      const normalizedDealId = typeof dealId === 'string' ? dealId.trim() : dealId;
      const { data, error } = await this.supabase
        .from('cash_payments')
        .select('*')
        .eq('deal_id', normalizedDealId)
        .eq('source', 'crm')
        .is('proforma_id', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) {
        logger.error('Failed to fetch deal cash expectation', { error, dealId });
        return null;
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (err) {
      logger.error('Exception while fetching deal cash expectation', { error: err.message, dealId });
      return null;
    }
  }

  async findByStripeSession(sessionId) {
    if (!this.isEnabled() || !sessionId) return null;

    try {
      const { data, error } = await this.supabase
        .from('cash_payments')
        .select('*')
        .contains('metadata', { session_id: sessionId })
        .limit(1);

      if (error) {
        logger.error('Failed to fetch cash payment by Stripe session', { error, sessionId });
        return null;
      }

      return data && data.length > 0 ? data[0] : null;
    } catch (err) {
      logger.error('Exception while fetching cash payment by Stripe session', { error: err.message, sessionId });
      return null;
    }
  }

  async updateProformaCashTotals(proformaId) {
    if (!this.isEnabled() || !proformaId) return null;

    try {
      const { data: proforma, error: proformaError } = await this.supabase
        .from('proformas')
        .select('id, currency, currency_exchange')
        .eq('id', proformaId)
        .maybeSingle();

      if (proformaError) {
        logger.error('Failed to fetch proforma for cash totals', { error: proformaError, proformaId });
        return null;
      }

      const { data: payments, error: paymentsError } = await this.supabase
        .from('cash_payments')
        .select('cash_expected_amount, cash_received_amount, amount_pln, currency, status')
        .eq('proforma_id', proformaId);

      if (paymentsError) {
        logger.error('Failed to fetch cash payments for totals', { error: paymentsError, proformaId });
        return null;
      }

      let total = 0;
      let totalPln = 0;
      let hasPln = false;
      const exchangeRate = this.toNumber(proforma?.currency_exchange);

      (payments || []).forEach((payment) => {
        const value = this.toNumber(payment.cash_received_amount) ?? this.toNumber(payment.cash_expected_amount);
        if (!Number.isFinite(value)) {
          return;
        }

        let plnValue = this.toNumber(payment.amount_pln);
        if (!Number.isFinite(plnValue) && payment.currency === 'PLN') {
          plnValue = value;
        }
        if (!Number.isFinite(plnValue) && Number.isFinite(exchangeRate) && exchangeRate > 0) {
          plnValue = value * exchangeRate;
        }

        if (payment.status === 'received') {
          total += value;
          if (Number.isFinite(plnValue)) {
            totalPln += plnValue;
            hasPln = true;
          }
        } else if (payment.status === 'refunded') {
          total -= value;
          if (Number.isFinite(plnValue)) {
            totalPln -= plnValue;
            hasPln = true;
          }
        }
      });

      total = this.roundCurrency(Math.max(total, 0)) ?? 0;
      totalPln = this.roundCurrency(Math.max(totalPln, 0)) ?? 0;

      const forcePlnColumn = (proforma?.currency || 'PLN') === 'PLN';
      const updatePayload = {
        payments_total_cash: total,
        payments_total_cash_pln: hasPln || forcePlnColumn ? totalPln : null
      };

      const { error: updateError } = await this.supabase
        .from('proformas')
        .update(updatePayload)
        .eq('id', proformaId);

      if (updateError) {
        logger.error('Failed to update proforma cash totals', { error: updateError, proformaId });
        return null;
      }

      return updatePayload;
    } catch (err) {
      logger.error('Exception while updating proforma cash totals', { error: err.message, proformaId });
      return null;
    }
  }

  async getMonthlySummary(filters = {}) {
    if (!this.isEnabled()) return [];

    try {
      let query = this.supabase
        .from('cash_summary_monthly')
        .select('*')
        .order('period_month', { ascending: false });

      if (filters.from && filters.to) {
        query = query.gte('period_month', filters.from).lte('period_month', filters.to);
      } else if (filters.from) {
        query = query.gte('period_month', filters.from);
      } else if (filters.to) {
        query = query.lte('period_month', filters.to);
      }

      if (filters.periodMonth) {
        query = query.eq('period_month', filters.periodMonth);
      }

      if (filters.productId) {
        query = query.eq('product_id', filters.productId);
      }

      if (filters.currency) {
        query = query.eq('currency', filters.currency);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to fetch cash summary monthly', { error, filters });
        return [];
      }

      return data || [];
    } catch (err) {
      logger.error('Exception while fetching cash summary monthly', { error: err.message, filters });
      return [];
    }
  }
}

module.exports = CashPaymentsRepository;
