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
      // If constraint doesn't exist (42P10), try to find and update or insert
      if (error.code === '42P10') {
        logger.warn('Unique constraint not found, attempting find-and-update instead', { error: error.message });
        // Try to find existing record by crm_product_id or stripe_product_id
        let existingLink = null;
        if (crmProductId) {
          existingLink = await this.findProductLinkByCrmId(crmProductId);
        }
        if (!existingLink && stripeProductId) {
          existingLink = await this.findProductLinkByStripeId(stripeProductId);
        }
        
        if (existingLink) {
          // Update existing record
          const updateResult = await this.supabase
            .from('product_links')
            .update(payload)
            .eq('id', existingLink.id)
            .select()
            .maybeSingle();
          if (updateResult.error) {
            logger.error('Failed to update product link', { error: updateResult.error });
            return null;
          }
          return updateResult.data;
        } else {
          // Insert new record
          const insertResult = await this.supabase
            .from('product_links')
            .insert(payload)
            .select()
            .maybeSingle();
          if (insertResult.error) {
            // If duplicate key error, try to find and update
            if (insertResult.error.code === '23505') {
              logger.warn('Duplicate key error, attempting to find and update existing record', { 
                error: insertResult.error.message 
              });
              if (crmProductId) {
                existingLink = await this.findProductLinkByCrmId(crmProductId);
              }
              if (existingLink) {
                const updateResult = await this.supabase
                  .from('product_links')
                  .update(payload)
                  .eq('id', existingLink.id)
                  .select()
                  .maybeSingle();
                if (updateResult.error) {
                  logger.error('Failed to update product link after duplicate key error', { error: updateResult.error });
                  return null;
                }
                return updateResult.data;
              }
            }
            logger.error('Failed to insert product link', { error: insertResult.error });
            return null;
          }
          return insertResult.data;
        }
      }
      // Handle duplicate key error (23505) - record already exists
      if (error.code === '23505') {
        logger.warn('Duplicate key error, attempting to find and update existing record', { error: error.message });
        let existingLink = null;
        if (crmProductId) {
          existingLink = await this.findProductLinkByCrmId(crmProductId);
        }
        if (!existingLink && stripeProductId) {
          existingLink = await this.findProductLinkByStripeId(stripeProductId);
        }
        
        if (existingLink) {
          // Update existing record
          const updateResult = await this.supabase
            .from('product_links')
            .update(payload)
            .eq('id', existingLink.id)
            .select()
            .maybeSingle();
          if (updateResult.error) {
            logger.error('Failed to update product link after duplicate key error', { error: updateResult.error });
            return null;
          }
          return updateResult.data;
        } else {
          logger.error('Duplicate key error but existing record not found', { error: error.message, crmProductId, stripeProductId });
          return null;
        }
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
      
      // Handle missing columns (invoice_number, receipt_number, payment_schedule, checkout_url) - retry without them
      const errorCode = error.code || '';
      const errorMessage = error.message || '';
      const missingColumns = ['invoice_number', 'receipt_number', 'payment_schedule', 'checkout_url'];
      const hasMissingColumn = missingColumns.some(col => errorMessage.includes(col));
      
      if (errorCode === 'PGRST204' && hasMissingColumn) {
        logger.debug('Database columns not found, retrying without optional fields', {
          sessionId: payment.session_id,
          errorMessage
        });
        
        // Remove optional fields and retry
        const paymentWithoutOptionalFields = { ...payment };
        missingColumns.forEach(col => {
          delete paymentWithoutOptionalFields[col];
        });

        // Also handle checkout_url specifically
        if (errorMessage.includes('checkout_url')) {
          delete paymentWithoutOptionalFields.checkout_url;
        }
        
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
      .order('created_at', { ascending: false })
      .neq('status', 'event_placeholder');

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

  /**
   * Удаляет запись о платеже по ID
   * @param {number|string} paymentId - ID записи в БД
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async deletePayment(paymentId) {
    if (!this.isEnabled() || !paymentId) {
      return { success: false, error: 'Repository disabled or no payment ID' };
    }

    try {
      const { error } = await this.supabase
        .from('stripe_payments')
        .delete()
        .eq('id', paymentId);

      if (error) {
        if (isTableMissing(error)) {
          logger.warn('stripe_payments table missing, cannot delete payment');
          return { success: false, error: 'Table not found' };
        }
        logger.error('Failed to delete stripe payment', { error, paymentId });
        return { success: false, error: error.message };
      }

      return { success: true };
    } catch (err) {
      logger.error('Exception while deleting stripe payment', {
        error: err.message,
        paymentId
      });
      return { success: false, error: err.message };
    }
  }

  /**
   * Дата-заглушка для записей "уведомление о ссылке на оплату отправлено" в stripe_reminder_logs
   * (в таблице second_payment_date NOT NULL, для payment_link_sent используем фиксированную дату)
   */
  static PAYMENT_LINK_SENTINEL_DATE = '2000-01-01';

  /**
   * Получить время последней отправки уведомления о ссылке на оплату по сделке (из БД).
   * Используется для защиты от дублирования при перезапуске и кроне.
   * @param {number|string} dealId - ID сделки
   * @returns {Promise<{ sentAt: Date | null }>}
   */
  async getLastPaymentLinkNotificationSent(dealId) {
    if (!this.isEnabled()) return { sentAt: null };
    try {
      const { data, error } = await this.supabase
        .from('stripe_reminder_logs')
        .select('sent_at')
        .eq('deal_id', parseInt(dealId, 10))
        .eq('second_payment_date', StripeRepository.PAYMENT_LINK_SENTINEL_DATE)
        .eq('action_type', 'payment_link_sent')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        if (isTableMissing(error)) return { sentAt: null };
        logger.warn('Failed to get last payment link notification sent', { dealId, error: error.message });
        return { sentAt: null };
      }
      const sentAt = data?.sent_at ? new Date(data.sent_at) : null;
      return { sentAt };
    } catch (err) {
      logger.warn('Exception getLastPaymentLinkNotificationSent', { dealId, error: err.message });
      return { sentAt: null };
    }
  }

  /**
   * Сохранить факт отправки уведомления о ссылке на оплату (персистентно в БД).
   * @param {number|string} dealId - ID сделки
   * @param {string} [sessionId] - ID сессии, для которой отправлено уведомление
   */
  async persistPaymentLinkNotificationSent(dealId, sessionId = null) {
    if (!this.isEnabled()) return;
    try {
      const payload = {
        deal_id: parseInt(dealId, 10),
        second_payment_date: StripeRepository.PAYMENT_LINK_SENTINEL_DATE,
        session_id: sessionId || '',
        sent_date: new Date().toISOString().split('T')[0],
        sent_at: new Date().toISOString(),
        action_type: 'payment_link_sent'
      };
      const { error } = await this.supabase
        .from('stripe_reminder_logs')
        .upsert(payload, {
          onConflict: 'deal_id,second_payment_date,action_type',
          ignoreDuplicates: false
        });
      if (error) {
        logger.warn('Failed to persist payment link notification sent', { dealId, error: error.message });
      }
    } catch (err) {
      logger.warn('Exception persistPaymentLinkNotificationSent', { dealId, error: err.message });
    }
  }
}

module.exports = StripeRepository;
