const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const IncomeCategoryService = require('../pnl/incomeCategoryService');

class CashPnlSyncService {
  constructor() {
    this.supabase = supabase;
    this.incomeCategoryService = new IncomeCategoryService();
    this.categoryName = 'Приходы — Наличные';
    this.categoryId = null;
  }

  isEnabled() {
    return !!this.supabase;
  }

  async ensureCategory() {
    if (this.categoryId) {
      return this.categoryId;
    }

    try {
      const categories = await this.incomeCategoryService.listCategories();
      const existing = categories.find((cat) => cat.name === this.categoryName);
      if (!existing) {
        logger.warn(`P&L category "${this.categoryName}" not found. Cash confirmations will not appear in P&L until it is created.`);
        return null;
      }

      this.categoryId = existing.id;
      return this.categoryId;
    } catch (error) {
      logger.error('Failed to ensure cash P&L category', { error: error.message });
      return null;
    }
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

  async upsertEntryFromPayment(payment) {
    if (!this.isEnabled() || !payment || payment.status !== 'received') {
      return;
    }

    const categoryId = await this.ensureCategory();
    if (!categoryId) {
      return;
    }

    const amountCurrency = this.toNumber(payment.cash_received_amount) ??
      this.toNumber(payment.cash_expected_amount) ?? 0;
    const amountPln = this.toNumber(payment.amount_pln) ??
      (payment.currency === 'PLN' ? amountCurrency : null);

    try {
      const { data: existing } = await this.supabase
        .from('pnl_revenue_entries')
        .select('id')
        .eq('cash_payment_id', payment.id)
        .limit(1);

      const payload = {
        category_id: categoryId,
        cash_payment_id: payment.id,
        cash_amount: this.toNumber(payment.cash_received_amount) ?? amountCurrency,
        amount_pln: amountPln ?? amountCurrency,
        currency: payment.currency || 'PLN',
        deal_id: payment.deal_id ? String(payment.deal_id) : null,
        description: payment.note || 'Cash payment confirmed',
        updated_at: new Date().toISOString()
      };

      if (existing && existing.length) {
        await this.supabase
          .from('pnl_revenue_entries')
          .update(payload)
          .eq('id', existing[0].id);
      } else {
        payload.created_at = new Date().toISOString();
        await this.supabase
          .from('pnl_revenue_entries')
          .insert(payload);
      }
    } catch (error) {
      logger.warn('Failed to upsert cash entry into pnl_revenue_entries', {
        error: error.message,
        paymentId: payment.id
      });
    }
  }

  async markEntryRefunded(payment, reason = 'Cash refund') {
    if (!this.isEnabled() || !payment?.id) {
      return;
    }

    try {
      await this.supabase
        .from('pnl_revenue_entries')
        .update({
          cash_amount: 0,
          amount_pln: 0,
          description: reason,
          updated_at: new Date().toISOString()
        })
        .eq('cash_payment_id', payment.id);
    } catch (error) {
      logger.warn('Failed to mark PNL cash entry refunded', {
        error: error.message,
        paymentId: payment.id
      });
    }
  }
}

module.exports = new CashPnlSyncService();
