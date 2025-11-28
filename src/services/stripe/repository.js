const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

function compact(record = {}) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isTableMissing(error) {
  return error?.code === 'PGRST205';
}

class StripeRepository {
  constructor() {
    this.supabase = supabase;
    if (!this.supabase) {
      logger.warn('Supabase client is not configured. StripeRepository will be disabled.');
    }
  }

  isEnabled() {
    return !!this.supabase;
  }

  /**
   * Ensure we always have a stable product link between CRM ↔ Stripe ↔ internal id.
   */
  async upsertProductLink({
    crmProductId,
    crmProductName,
    stripeProductId,
    campProductId,
    status = 'active'
  }) {
    if (!this.isEnabled()) return null;

    if (!crmProductId && !stripeProductId) {
      logger.warn('Cannot upsert product link without CRM or Stripe product id');
      return null;
    }

    const payload = compact({
      crm_product_id: crmProductId ? String(crmProductId) : undefined,
      crm_product_name: crmProductName || undefined,
      stripe_product_id: stripeProductId || undefined,
      camp_product_id: campProductId || undefined,
      status,
      updated_at: new Date().toISOString()
    });

    let data, error;
    const result = await this.supabase
      .from('product_links')
      .upsert(payload, { onConflict: 'crm_product_id,stripe_product_id' })
      .select()
      .maybeSingle();
    data = result.data;
    error = result.error;

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table product_links is missing; skipping product link upsert');
        return null;
      }
      // If constraint doesn't exist (42P10), try simple insert
      if (error.code === '42P10') {
        logger.warn('Unique constraint not found, attempting insert instead', { error: error.message });
        const insertResult = await this.supabase
          .from('product_links')
          .insert(payload)
          .select()
          .maybeSingle();
        if (insertResult.error) {
          logger.error('Failed to insert product link', { error: insertResult.error });
          return null;
        }
        return insertResult.data;
      }
      logger.error('Failed to upsert product link', { error });
      // Don't throw - allow processor to continue without product link
      return null;
    }

    return data;
  }

  async findProductLinkByCrmId(crmProductId) {
    if (!this.isEnabled() || !crmProductId) return null;
    const { data, error } = await this.supabase
      .from('product_links')
      .select()
      .eq('crm_product_id', String(crmProductId))
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table product_links is missing; cannot fetch by CRM id');
        return null;
      }
      logger.error('Failed to load product link by CRM id', { error });
      throw error;
    }
    return data;
  }

  async findProductLinkByStripeId(stripeProductId) {
    if (!this.isEnabled() || !stripeProductId) return null;
    const { data, error } = await this.supabase
      .from('product_links')
      .select()
      .eq('stripe_product_id', stripeProductId)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table product_links is missing; cannot fetch by Stripe id');
        return null;
      }
      logger.error('Failed to load product link by Stripe id', { error });
      throw error;
    }
    return data;
  }

  async findProductLinkById(productLinkId) {
    if (!this.isEnabled() || !productLinkId) return null;
    const { data, error } = await this.supabase
      .from('product_links')
      .select()
      .eq('id', productLinkId)
      .maybeSingle();
    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table product_links is missing; cannot fetch by id');
        return null;
      }
      logger.error('Failed to load product link by internal id', { error });
      throw error;
    }
    return data;
  }

  /**
   * Persist Stripe payment row (idempotent on session_id)
   */
  async savePayment(payment) {
    if (!this.isEnabled()) return null;
    if (!payment?.session_id) {
      logger.warn('Cannot save Stripe payment without session_id');
      return null;
    }

    const { error } = await this.supabase
      .from('stripe_payments')
      .upsert(compact(payment), { onConflict: 'session_id' });

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payments is missing; skipping payment persistence', {
          sessionId: payment.session_id
        });
        return null;
      }
      
      // Handle missing columns (invoice_number, receipt_number) - retry without them
      const errorCode = error.code || '';
      const errorMessage = error.message || '';
      if (errorCode === 'PGRST204' && (errorMessage.includes('invoice_number') || errorMessage.includes('receipt_number'))) {
        logger.debug('Database columns invoice_number/receipt_number not found, retrying without them', {
          sessionId: payment.session_id
        });
        
        // Remove optional fields and retry
        const paymentWithoutOptionalFields = { ...payment };
        delete paymentWithoutOptionalFields.invoice_number;
        delete paymentWithoutOptionalFields.receipt_number;
        
        const { error: retryError } = await this.supabase
          .from('stripe_payments')
          .upsert(compact(paymentWithoutOptionalFields), { onConflict: 'session_id' });
        
        if (retryError) {
          logger.error('Failed to upsert stripe payment after removing optional fields', { 
            error: retryError, 
            sessionId: payment.session_id 
          });
          throw retryError;
        }
        
        return payment.session_id;
      }
      
      logger.error('Failed to upsert stripe payment', { error, sessionId: payment.session_id });
      throw error;
    }
    return payment.session_id;
  }

  async findPaymentBySessionId(sessionId) {
    if (!this.isEnabled() || !sessionId) return null;
    const { data, error } = await this.supabase
      .from('stripe_payments')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payments is missing; cannot fetch payment by session id');
        return null;
      }
      logger.error('Failed to load stripe payment by session id', { error, sessionId });
      throw error;
    }

    return data;
  }

  async findPaymentByPaymentIntent(paymentIntentId) {
    if (!this.isEnabled() || !paymentIntentId) return null;

    const { data, error } = await this.supabase
      .from('stripe_payments')
      .select('*')
      .eq('raw_payload->>payment_intent', paymentIntentId)
      .maybeSingle();

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payments is missing; cannot fetch by payment intent', {
          paymentIntentId
        });
        return null;
      }
      logger.error('Failed to load stripe payment by payment intent', { error, paymentIntentId });
      throw error;
    }

    return data;
  }

  /**
   * Update payment status for an existing payment
   * @param {string} sessionId - Stripe Checkout Session ID
   * @param {string} paymentStatus - New payment status (paid, unpaid, no_payment_required, etc.)
   * @returns {Promise<boolean>} - Returns true if update was successful
   */
  async updatePaymentStatus(sessionId, paymentStatus) {
    if (!this.isEnabled() || !sessionId || !paymentStatus) {
      logger.warn('Cannot update payment status: missing sessionId or paymentStatus', {
        sessionId,
        paymentStatus
      });
      return false;
    }

    const { error } = await this.supabase
      .from('stripe_payments')
      .update({
        payment_status: paymentStatus,
        updated_at: new Date().toISOString()
      })
      .eq('session_id', sessionId);

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payments is missing; cannot update payment status', {
          sessionId
        });
        return false;
      }
      logger.error('Failed to update payment status', { error, sessionId, paymentStatus });
      throw error;
    }

    logger.info('Payment status updated', { sessionId, paymentStatus });
    return true;
  }

  async listProductLinksByIds(ids = []) {
    if (!this.isEnabled() || !Array.isArray(ids) || ids.length === 0) {
      return new Map();
    }

    const { data, error } = await this.supabase
      .from('product_links')
      .select()
      .in('id', ids);

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table product_links is missing; cannot list by ids');
        return new Map();
      }
      logger.error('Failed to load product links by ids', { error });
      throw error;
    }

    const map = new Map();
    (data || []).forEach((row) => {
      if (row?.id) {
        map.set(row.id, row);
      }
    });
    return map;
  }

  async listPayments(filters = {}) {
    if (!this.isEnabled()) return [];

    let query = this.supabase
      .from('stripe_payments')
      .select('*')
      .order('created_at', { ascending: false });

    // Filter by processed_at (payment date) if available, fallback to created_at
    if (filters.dateFrom) {
      // Use processed_at for filtering payment date, but also check created_at for sessions without processed_at
      query = query.or(`processed_at.gte.${filters.dateFrom},and(processed_at.is.null,created_at.gte.${filters.dateFrom})`);
    }
    if (filters.dateTo) {
      query = query.or(`processed_at.lte.${filters.dateTo},and(processed_at.is.null,created_at.lte.${filters.dateTo})`);
    }
    if (filters.productIds?.length) {
      query = query.in('product_id', filters.productIds);
    }
    if (filters.dealId) {
      query = query.eq('deal_id', String(filters.dealId));
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payments is missing; returning empty payment list');
        return [];
      }
      logger.error('Failed to list stripe payments', { error });
      throw error;
    }

    return data || [];
  }

  async saveDocuments(documents = []) {
    if (!this.isEnabled() || !documents.length) return;
    const rows = documents
      .filter((doc) => doc && doc.payment_id && doc.document_type)
      .map((doc) => compact(doc));
    if (!rows.length) return;

    const { error } = await this.supabase
      .from('stripe_documents')
      .upsert(rows, { onConflict: 'payment_id,document_type' });

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_documents is missing; skipping document persistence');
        return;
      }
      logger.error('Failed to upsert stripe documents', { error });
      throw error;
    }
  }

  async logDeletion(entry) {
    if (!this.isEnabled() || !entry?.payment_id) return;
    const payload = compact({
      ...entry,
      logged_at: entry.logged_at || new Date().toISOString()
    });

    // Skip duplicates (Stripe often replays the same refund data)
    if (payload.payment_id && payload.reason) {
      try {
        let duplicateQuery = this.supabase
          .from('stripe_payment_deletions')
          .select('id')
          .eq('payment_id', payload.payment_id)
          .eq('reason', payload.reason)
          .limit(1);

        if (payload.metadata?.refund_id) {
          duplicateQuery = duplicateQuery.eq('metadata->>refund_id', String(payload.metadata.refund_id));
        } else if (payload.reason === 'stripe_refund' && payload.raw_payload?.id) {
          duplicateQuery = duplicateQuery.eq('raw_payload->>id', payload.raw_payload.id);
        }

        const { data: existing, error: duplicateError } = await duplicateQuery;
        if (duplicateError) {
          if (isTableMissing(duplicateError)) {
            logger.warn('Supabase table stripe_payment_deletions missing during duplicate check');
          } else {
            logger.warn('Failed to check duplicate stripe deletion log', { error: duplicateError });
          }
        } else if (existing && existing.length > 0) {
          logger.debug('Skipping duplicate stripe deletion log', {
            paymentId: payload.payment_id,
            reason: payload.reason,
            refundId: payload.metadata?.refund_id || payload.raw_payload?.id || null
          });
          return existing[0];
        }
      } catch (duplicateCheckError) {
        logger.warn('Duplicate stripe deletion check failed', { error: duplicateCheckError });
      }
    }

    const { error } = await this.supabase
      .from('stripe_payment_deletions')
      .insert(payload);

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payment_deletions is missing; skipping deletion log');
        return;
      }
      logger.error('Failed to insert stripe deletion log', { error });
      throw error;
    }
  }

  async listDeletions(filters = {}) {
    if (!this.isEnabled()) return [];

    let query = this.supabase
      .from('stripe_payment_deletions')
      .select('*')
      .order('logged_at', { ascending: false });

    if (filters.paymentId) {
      query = query.eq('payment_id', String(filters.paymentId));
    }
    if (filters.dealId) {
      query = query.eq('deal_id', String(filters.dealId));
    }
    if (filters.reason) {
      query = query.eq('reason', filters.reason);
    }
    if (filters.dateFrom) {
      query = query.gte('logged_at', new Date(filters.dateFrom).toISOString());
    }
    if (filters.dateTo) {
      query = query.lte('logged_at', new Date(filters.dateTo).toISOString());
    }
    if (filters.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      if (isTableMissing(error)) {
        logger.warn('Supabase table stripe_payment_deletions is missing; returning empty deletion list');
        return [];
      }
      logger.error('Failed to list stripe payment deletions', { error });
      throw error;
    }

    return data || [];
  }

  async deletePaymentsByDealId(dealId) {
    if (!this.isEnabled() || !dealId) {
      return { deleted: 0, sessions: [] };
    }

    try {
      const { data, error } = await this.supabase
        .from('stripe_payments')
        .select('session_id')
        .eq('deal_id', String(dealId));

      if (error) {
        if (isTableMissing(error)) {
          logger.warn('stripe_payments table missing, cannot delete by deal');
          return { deleted: 0, sessions: [] };
        }
        logger.error('Failed to fetch stripe payments before deletion', { error, dealId });
        return { deleted: 0, sessions: [] };
      }

      if (!data || data.length === 0) {
        return { deleted: 0, sessions: [] };
      }

      const { error: deleteError } = await this.supabase
        .from('stripe_payments')
        .delete()
        .eq('deal_id', String(dealId));

      if (deleteError) {
        if (isTableMissing(deleteError)) {
          logger.warn('stripe_payments table missing during deletion');
          return { deleted: 0, sessions: [] };
        }
        logger.error('Failed to delete stripe payments by deal', { error: deleteError, dealId });
        return { deleted: 0, sessions: [] };
      }

      return {
        deleted: data.length,
        sessions: data.map((row) => row.session_id).filter(Boolean)
      };
    } catch (err) {
      logger.error('Exception while deleting stripe payments by deal', {
        error: err.message,
        dealId
      });
      return { deleted: 0, sessions: [] };
    }
  }
}

module.exports = StripeRepository;
