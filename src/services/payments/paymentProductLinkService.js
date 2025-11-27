const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');

class PaymentProductLinkService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. PaymentProductLinkService disabled.');
    }
  }

  async listInProgressProducts() {
    if (!supabase) {
      return [];
    }

    const { data, error } = await supabase
      .from('products')
      .select('id, name, normalized_name, calculation_status')
      .eq('calculation_status', 'in_progress')
      .order('name', { ascending: true });

    if (error) {
      logger.error('Failed to load in-progress products for linking', {
        error: error.message
      });
      throw new Error('Не удалось получить список продуктов');
    }

    return data || [];
  }

  async ensurePayment(paymentId) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('id, direction, amount, currency, deleted_at')
      .eq('id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Платёж не найден');
      }
      logger.error('Failed to fetch payment for link', { error: error.message, paymentId });
      throw new Error('Ошибка при получении платежа');
    }

    if (data?.deleted_at) {
      throw new Error('Нельзя связать удалённый платеж');
    }

    return data;
  }

  async ensureProduct(productId) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const { data, error } = await supabase
      .from('products')
      .select('id, name, calculation_status')
      .eq('id', productId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new Error('Продукт не найден');
      }
      logger.error('Failed to fetch product for link', { error: error.message, productId });
      throw new Error('Ошибка при получении продукта');
    }

    if (data?.calculation_status !== 'in_progress') {
      throw new Error('Связать можно только продукт со статусом In Progress');
    }

    return data;
  }

  async getLinkByPayment(paymentId) {
    if (!supabase) {
      return null;
    }

    const { data, error } = await supabase
      .from('payment_product_links')
      .select(`
        *,
        product:product_id(id, name, normalized_name)
      `)
      .eq('payment_id', paymentId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      logger.error('Failed to fetch payment link', { error: error.message, paymentId });
      throw new Error('Ошибка при получении связи');
    }

    return data;
  }

  async createLink({ paymentId, productId, linkedBy }) {
    const payment = await this.ensurePayment(paymentId);
    await this.ensureProduct(productId);

    const existingLink = await this.getLinkByPayment(paymentId);
    if (existingLink) {
      throw new Error('Платеж уже связан с продуктом');
    }

    const payload = {
      payment_id: paymentId,
      product_id: productId,
      direction: payment.direction,
      linked_by: linkedBy || null
    };

    const { error } = await supabase
      .from('payment_product_links')
      .insert(payload);

    if (error) {
      logger.error('Failed to create payment/product link', { error: error.message, payload });
      throw new Error('Не удалось создать связь платежа с продуктом');
    }

    return this.getLinkByPayment(paymentId);
  }

  async removeLink({ paymentId }) {
    await this.ensurePayment(paymentId);

    const { error } = await supabase
      .from('payment_product_links')
      .delete()
      .eq('payment_id', paymentId);

    if (error) {
      logger.error('Failed to remove payment/product link', { error: error.message, paymentId });
      throw new Error('Не удалось удалить связь');
    }

    return true;
  }

  async getLinkedPayments(productId) {
    if (!supabase) {
      return [];
    }

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
          source
        )
      `)
      .eq('product_id', productId)
      .order('linked_at', { ascending: false });

    if (error) {
      logger.error('Failed to load linked payments by product', { error: error.message, productId });
      throw new Error('Не удалось получить связанные платежи');
    }

    return (data || []).map((row) => ({
      ...row,
      payment: row.payment || null
    }));
  }
}

module.exports = PaymentProductLinkService;
