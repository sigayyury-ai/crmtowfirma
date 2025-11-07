const supabase = require('./supabaseClient');
const logger = require('../utils/logger');

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

class ProformaRepository {
  constructor() {
    this.supabase = supabase;
    if (!this.supabase) {
      logger.warn('Supabase client is not configured. ProformaRepository will be disabled.');
    }
  }

  isEnabled() {
    return !!this.supabase;
  }

  normalizeProductName(name) {
    if (!name) return null;
    const trimmed = normalizeWhitespace(String(name));
    if (!trimmed) return null;
    return trimmed
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s\.\-_/]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  toNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = parseFloat(value.replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  toDateString(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
    return null;
  }

  async ensureProductId(name) {
    if (!this.isEnabled()) return null;

    const normalizedName = this.normalizeProductName(name);
    if (!normalizedName) {
      return null;
    }

    const trimmedName = normalizeWhitespace(name).slice(0, 255);

    const { data, error } = await this.supabase
      .from('products')
      .select('id')
      .eq('normalized_name', normalizedName)
      .limit(1);

    if (error) {
      logger.error('Supabase error while fetching product by normalized_name:', error);
      throw error;
    }

    if (data && data.length > 0) {
      return data[0].id;
    }

    const { data: upserted, error: upsertError } = await this.supabase
      .from('products')
      .upsert({
        name: trimmedName,
        normalized_name: normalizedName
      }, { onConflict: 'normalized_name' })
      .select('id')
      .single();

    if (upsertError) {
      logger.error('Supabase error while upserting product:', upsertError);
      throw upsertError;
    }

    return upserted?.id || null;
  }

  compactRecord(record) {
    return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
  }

  async upsertProforma(proforma) {
    if (!this.isEnabled()) {
      logger.debug('Supabase not configured. Skipping proforma persistence.');
      return;
    }

    if (!proforma || !proforma.id) {
      logger.warn('Cannot upsert proforma without ID');
      return;
    }

    const proformaId = String(proforma.id);
    const issueDate = this.toDateString(proforma.date) || this.toDateString(new Date());
    const currency = proforma.currency || 'PLN';
    const total = this.toNumber(proforma.total) ?? 0;
    const currencyExchange = this.toNumber(proforma.currencyExchange);
    const paymentsTotal = this.toNumber(proforma.paymentsTotal) ?? 0;
    const paymentsCount = Array.isArray(proforma.payments)
      ? proforma.payments.length
      : this.toNumber(proforma.paymentsCount) ?? 0;

    const fullnumber = proforma.fullnumber
      ? normalizeWhitespace(String(proforma.fullnumber)).slice(0, 255)
      : proforma.number
        ? normalizeWhitespace(String(proforma.number)).slice(0, 255)
        : null;

    const proformaRecord = this.compactRecord({
      id: proformaId,
      fullnumber,
      issued_at: issueDate,
      currency,
      total,
      currency_exchange: currencyExchange,
      payments_total: paymentsTotal,
      payments_count: paymentsCount
    });

    const { error: upsertError } = await this.supabase
      .from('proformas')
      .upsert(proformaRecord, { onConflict: 'id' });

    if (upsertError) {
      logger.error('Supabase error while upserting proforma:', upsertError);
      throw upsertError;
    }

    const products = Array.isArray(proforma.products) ? proforma.products : [];

    const { error: deleteError } = await this.supabase
      .from('proforma_products')
      .delete()
      .eq('proforma_id', proformaId);

    if (deleteError) {
      logger.error('Supabase error while clearing proforma products:', deleteError);
      throw deleteError;
    }

    if (products.length === 0) {
      logger.warn(`Proforma ${proformaId} has no products to persist.`);
      return;
    }

    const rows = [];

    for (const product of products) {
      const originalName = product?.name || 'Без названия';
      const normalizedName = this.normalizeProductName(originalName);
      const trimmedName = normalizedName ? normalizeWhitespace(originalName).slice(0, 255) : null;

      if (!normalizedName || !trimmedName) {
        logger.warn(`Skipping product without valid name for proforma ${proformaId}`);
        continue;
      }

      const quantity = this.toNumber(product.count ?? product.quantity) ?? 1;
      const unitPrice = this.toNumber(product.price ?? product.unit_price) ?? 0;
      const goodId = product.goodId || product.good_id || null;

      let productId = null;
      try {
        productId = await this.ensureProductId(trimmedName);
      } catch (ensureError) {
        logger.error(`Failed to ensure product ID for "${trimmedName}":`, ensureError);
        continue;
      }

      rows.push({
        proforma_id: proformaId,
        product_id: productId,
        name: trimmedName,
        good_id: goodId,
        quantity,
        unit_price: unitPrice
      });
    }

    if (rows.length === 0) {
      logger.warn(`No valid product rows prepared for proforma ${proformaId}.`);
      return;
    }

    const chunkSize = 50;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: insertError } = await this.supabase
        .from('proforma_products')
        .insert(chunk);

      if (insertError) {
        logger.error('Supabase error while inserting proforma_products:', insertError);
        throw insertError;
      }
    }

    logger.info(`Proforma ${proformaId} persisted to Supabase with ${rows.length} product rows.`);
  }
}

module.exports = ProformaRepository;

