const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const StripeRepository = require('../stripe/repository');
const IncomeCategoryService = require('../pnl/incomeCategoryService');

const CRM_DEAL_BASE_URL = 'https://comoon.pipedrive.com/deal/';
const DEFAULT_STATUS_SCOPE = 'approved';
const AMOUNT_TOLERANCE = 5; // PLN tolerance for determining payment status

function normalizeWhitespace(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeKeyValue(value, fallback = 'unknown') {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return fallback;
  }
  return normalized.toLowerCase();
}

function normalizeProductKey(name) {
  if (!name) return 'без названия';
  return normalizeWhitespace(String(name))
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim() || 'без названия';
}

function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseFloat(value.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function getMonthRange(month, year) {
  const now = new Date();
  const targetYear = Number.isFinite(year) ? year : now.getUTCFullYear();
  const targetMonth = Number.isFinite(month) ? month - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(targetYear, targetMonth, 1));
  const end = endOfMonth(start);
  return { dateFrom: start, dateTo: end };
}

function toIsoDate(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

function convertToPln(amount, currency, exchangeRate) {
  const numericAmount = toNumber(amount) ?? 0;
  const normalizedCurrency = (currency || 'PLN').toUpperCase();
  const numericRate = toNumber(exchangeRate);

  if (normalizedCurrency === 'PLN') {
    return numericAmount;
  }

  if (numericRate && numericRate > 0) {
    return numericAmount * numericRate;
  }

  return null;
}

function determinePaymentStatus(totalPln, paidPln) {
  const total = toNumber(totalPln) ?? 0;
  const paid = toNumber(paidPln) ?? 0;

  if (!total || total <= 0) {
    return { code: 'unknown', label: 'Статус неизвестен', className: 'auto' };
  }

  if (paid >= total + AMOUNT_TOLERANCE) {
    return { code: 'overpaid', label: 'Переплата', className: 'needs_review' };
  }

  if (paid >= total - AMOUNT_TOLERANCE) {
    return { code: 'paid', label: 'Оплачено', className: 'matched' };
  }

  if (paid > 0) {
    return { code: 'partial', label: 'Частично оплачено', className: 'needs_review' };
  }

  return { code: 'unpaid', label: 'Ожидает оплаты', className: 'unmatched' };
}

function buildDealUrl(dealId) {
  if (!dealId) return null;
  const trimmed = String(dealId).trim();
  if (!trimmed) return null;
  return `${CRM_DEAL_BASE_URL}${encodeURIComponent(trimmed)}`;
}

function buildStripeAggregateKey(payment, productKey) {
  const payerKey = normalizeKeyValue(payment.payer_normalized_name || payment.payer_name);
  const dealKey = payment.stripe_deal_id ? `deal:${payment.stripe_deal_id}` : 'deal:none';
  const productPart = productKey || 'product:unknown';
  const sourcePart = payment.source || 'stripe';
  return `${sourcePart}:${payerKey}:${productPart}:${dealKey}`;
}

function escapeCsv(value) {
  if (value === null || value === undefined) {
    return '';
  }
  const stringValue = String(value).replace(/\r?\n/g, ' ');
  if (/[",]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

class PaymentRevenueReportService {
  constructor() {
    if (!supabase) {
      logger.warn('Supabase client is not configured. Payment revenue report will be unavailable.');
    }
    this.supabase = supabase;
    this.stripeRepository = new StripeRepository();
    this.incomeCategoryService = new IncomeCategoryService();
    this.refundsIncomeCategoryId = null;
    this.pipedriveClient = null; // Lazy load when needed
  }

  async getPipedriveClient() {
    if (!this.pipedriveClient) {
      const PipedriveClient = require('../pipedrive');
      this.pipedriveClient = new PipedriveClient();
    }
    return this.pipedriveClient;
  }

  async getRefundsIncomeCategoryId() {
    if (this.refundsIncomeCategoryId !== null) {
      return this.refundsIncomeCategoryId;
    }

    if (!this.incomeCategoryService) {
      this.refundsIncomeCategoryId = undefined;
      return this.refundsIncomeCategoryId;
    }

    try {
      const categories = await this.incomeCategoryService.listCategories();
      const refundsCategory = categories.find(
        (category) => typeof category.name === 'string'
          && /возврат/i.test(category.name)
      );
      this.refundsIncomeCategoryId = refundsCategory ? refundsCategory.id : undefined;
    } catch (error) {
      logger.warn('Failed to resolve refunds income category id', { error: error.message });
      this.refundsIncomeCategoryId = undefined;
    }
    return this.refundsIncomeCategoryId;
  }

  resolveDateRange({ dateFrom, dateTo, month, year } = {}) {
    const parsedFrom = parseDate(dateFrom);
    const parsedTo = parseDate(dateTo);

    if (parsedFrom && parsedTo) {
      return { dateFrom: parsedFrom, dateTo: parsedTo };
    }

    if (typeof month !== 'undefined' || typeof year !== 'undefined') {
      const numericMonth = toNumber(month);
      const numericYear = toNumber(year);
      return getMonthRange(
        Number.isFinite(numericMonth) ? numericMonth : undefined,
        Number.isFinite(numericYear) ? numericYear : undefined
      );
    }

    const now = new Date();
    return {
      dateFrom: startOfMonth(now),
      dateTo: endOfMonth(now)
    };
  }

  normalizeStatusScope(raw) {
    if (!raw || typeof raw !== 'string') {
      return DEFAULT_STATUS_SCOPE;
    }
    const normalized = raw.trim().toLowerCase();
    if (['approved', 'all'].includes(normalized)) {
      return normalized;
    }
    return DEFAULT_STATUS_SCOPE;
  }

  extractProformaIds(payments) {
    const ids = new Set();
    const fullnumbers = new Set();
    payments.forEach((payment) => {
      if (payment.manual_proforma_id) {
        ids.add(String(payment.manual_proforma_id));
      } else if (payment.proforma_id) {
        ids.add(String(payment.proforma_id));
      }
      // Also collect fullnumbers for Stripe payments that may not have proforma_id
      if (payment.manual_proforma_fullnumber) {
        fullnumbers.add(String(payment.manual_proforma_fullnumber).trim());
      } else if (payment.proforma_fullnumber) {
        fullnumbers.add(String(payment.proforma_fullnumber).trim());
      }
    });
    return { ids: Array.from(ids), fullnumbers: Array.from(fullnumbers) };
  }

  mapProformas(records = []) {
    const mapById = new Map();
    const mapByFullnumber = new Map();
    records.forEach((record) => {
      if (!record || !record.id) {
        return;
      }

      const id = String(record.id);
      const fullnumber = record.fullnumber ? String(record.fullnumber).trim() : null;
      const currency = record.currency || 'PLN';
      const currencyExchange = toNumber(record.currency_exchange);
      const total = toNumber(record.total) ?? 0;
      const totalPln = currency === 'PLN'
        ? total
        : (currencyExchange && currencyExchange > 0 ? total * currencyExchange : null);
      const paymentsTotal = toNumber(record.payments_total) ?? 0;
      const paymentsTotalPln = toNumber(record.payments_total_pln)
        ?? (currency === 'PLN'
          ? paymentsTotal
          : (toNumber(record.payments_currency_exchange) ?? currencyExchange ?? 0) * paymentsTotal);

      const products = Array.isArray(record.proforma_products) ? record.proforma_products : [];
      let primaryProduct = null;

      if (products.length > 0) {
        const [firstProduct] = products;
        const productId = firstProduct.product_id || firstProduct.products?.id || null;
        const productName = firstProduct.products?.name || firstProduct.name || 'Без названия';
        const productKey = productId ? `id:${productId}` : `key:${normalizeProductKey(productName)}`;
        primaryProduct = {
          id: productId,
          key: productKey,
          name: productName
        };
      } else {
        primaryProduct = {
          id: null,
          key: `proforma:${id}`,
          name: 'Без названия'
        };
      }

      const proformaData = {
        id,
        fullnumber: record.fullnumber || null,
        issued_at: record.issued_at || null,
        currency,
        currency_exchange: currencyExchange,
        total,
        total_pln: totalPln,
        payments_total: paymentsTotal,
        payments_total_pln: paymentsTotalPln,
        payments_count: Number.isFinite(record.payments_count) ? Number(record.payments_count) : null,
        buyer: {
          name: record.buyer_name || record.buyer_alt_name || null,
          alt_name: record.buyer_alt_name || null,
          email: record.buyer_email || null,
          phone: record.buyer_phone || null,
          street: record.buyer_street || null,
          zip: record.buyer_zip || null,
          city: record.buyer_city || null,
          country: record.buyer_country || null
        },
        pipedrive_deal_id: record.pipedrive_deal_id || null,
        pipedrive_deal_url: buildDealUrl(record.pipedrive_deal_id),
        product: primaryProduct
      };

      mapById.set(id, proformaData);
      if (fullnumber) {
        mapByFullnumber.set(fullnumber, proformaData);
      }
    });
    return { byId: mapById, byFullnumber: mapByFullnumber };
  }

  buildPaymentEntry(payment, proforma) {
    const amount = toNumber(payment.amount) ?? 0;
    const currency = payment.currency || 'PLN';
    const proformaCurrency = proforma?.currency || null;
    const exchangeRate = proforma?.currency_exchange ?? null;

    // For Stripe payments, use pre-calculated PLN amount if available
    let amountPln = null;
    if (
      (payment.source === 'stripe' || payment.source === 'stripe_event')
      && payment.stripe_amount_pln !== null
      && payment.stripe_amount_pln !== undefined
    ) {
      amountPln = toNumber(payment.stripe_amount_pln);
    }

    // Fallback to conversion if no pre-calculated amount
    if (!Number.isFinite(amountPln)) {
      amountPln = convertToPln(amount, currency, exchangeRate);
      if (!Number.isFinite(amountPln) && proformaCurrency && proformaCurrency !== currency) {
        amountPln = convertToPln(amount, proformaCurrency, exchangeRate);
      }
    }

    const paymentSummary = proforma
      ? {
          total: proforma.total,
          total_pln: proforma.total_pln,
          paid: proforma.payments_total,
          paid_pln: proforma.payments_total_pln,
          remaining_pln: Number.isFinite(proforma.total_pln) && Number.isFinite(proforma.payments_total_pln)
            ? Math.max(proforma.total_pln - proforma.payments_total_pln, 0)
            : null
        }
      : null;

    // Определяем статус платежа
    // Для Stripe платежей статус определяется по stripe_payment_status, а не по наличию проформы
    let status = { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
    
    // Приоритет 1: Если есть проформа - определяем статус по сумме проформы
    if (proforma) {
      status = determinePaymentStatus(paymentSummary.total_pln, paymentSummary.paid_pln);
    }
    // Приоритет 2: Для Stripe платежей определяем статус по stripe_payment_status
    else if (payment.source === 'stripe' || payment.source === 'stripe_event') {
      const stripeStatus = payment.stripe_payment_status || payment.payment_status || null;
      if (stripeStatus === 'paid') {
        status = { code: 'paid', label: 'Оплачено', className: 'matched' };
      } else if (stripeStatus === 'pending' || stripeStatus === 'processing') {
        status = { code: 'pending', label: 'В обработке', className: 'needs_review' };
      } else if (stripeStatus === 'failed' || stripeStatus === 'canceled') {
        status = { code: 'failed', label: 'Не удалось', className: 'unmatched' };
      } else {
        // Если статус неизвестен, но это Stripe платеж - считаем оплаченным (Stripe показывает только оплаченные)
        status = { code: 'paid', label: 'Оплачено', className: 'matched' };
      }
    }
    // Приоритет 3: Отклоненные платежи
    else if (payment.manual_status === 'rejected') {
      status = { code: 'rejected', label: 'Отклонено', className: 'unmatched manual' };
    }
    // Приоритет 4: Для банковских платежей без проформы - "Не привязан"
    else {
      status = { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
    }

    return {
      id: payment.id,
      date: payment.operation_date || null,
      description: payment.description || null,
      amount,
      currency,
      amount_pln: Number.isFinite(amountPln) ? amountPln : null,
      payer_name: payment.payer_name || null,
      payer_normalized_name: payment.payer_normalized_name || null,
      manual_status: payment.manual_status || null,
      match_status: payment.match_status || null,
      status,
      source: payment.source || null, // 'stripe' or 'bank'
      stripe_payment_status: payment.stripe_payment_status || null, // 'paid', 'pending', etc.
      proforma: proforma
        ? {
            id: proforma.id,
            fullnumber: proforma.fullnumber,
            issued_at: proforma.issued_at,
            currency: proforma.currency,
            currency_exchange: proforma.currency_exchange,
            total: proforma.total,
            total_pln: proforma.total_pln,
            payments_total: proforma.payments_total,
            payments_total_pln: proforma.payments_total_pln,
            buyer: proforma.buyer,
            pipedrive_deal_id: proforma.pipedrive_deal_id,
            pipedrive_deal_url: proforma.pipedrive_deal_url,
            product: proforma.product,
            payment_summary: paymentSummary
          }
        : null
    };
  }

  async aggregateProducts(payments, proformaMap, productLinksMap = new Map(), productCatalog = null, dateFrom = null, dateTo = null) {
    const productMap = new Map();
    const summary = {
      payments_count: 0,
      products_count: 0,
      currency_totals: {},
      total_pln: 0,
      unmatched_count: 0
    };
    
    // Фильтруем платежи по дате, если указан диапазон дат
    // Это предотвращает включение старых платежей, которые не попадают в диапазон дат
    // ВАЖНО: Платежи уже отфильтрованы на уровне загрузки (loadPayments),
    // но эта проверка нужна для дополнительной безопасности и для случаев,
    // когда платежи могут попасть через проформы
    let filteredPayments = payments;
    if (dateFrom || dateTo) {
      filteredPayments = payments.filter((payment) => {
        // Если у платежа нет даты операции, включаем его (может быть старый платеж)
        if (!payment.operation_date) {
          // Для Stripe платежей проверяем stripe_payment_status
          // Если это unpaid платеж без даты операции, исключаем его
          if (payment.source === 'stripe' || payment.source === 'stripe_event') {
            if (payment.stripe_payment_status === 'unpaid') {
              return false;
            }
          }
          return true; // Включаем платежи без даты для обратной совместимости
        }
        const paymentDate = parseDate(payment.operation_date);
        if (!paymentDate) {
          // Если дату не удалось распарсить, включаем платеж
          return true;
        }
        
        if (dateFrom && paymentDate < dateFrom) return false;
        if (dateTo && paymentDate > dateTo) return false;
        
        return true;
      });
      
      // Логируем, если были отфильтрованы платежи
      if (filteredPayments.length !== payments.length) {
        const filteredIds = payments.filter(p => !filteredPayments.includes(p)).map(p => p.id);
        logger.info('Фильтрация платежей по дате в aggregateProducts', {
          originalCount: payments.length,
          filteredCount: filteredPayments.length,
          filteredIds: filteredIds.slice(0, 10), // Логируем только первые 10
          dateFrom: dateFrom?.toISOString(),
          dateTo: dateTo?.toISOString()
        });
      }
    }

    const catalogById = productCatalog?.byId instanceof Map ? productCatalog.byId : new Map();
    const catalogByName = productCatalog?.byNormalizedName instanceof Map
      ? productCatalog.byNormalizedName
      : new Map();

    const resolveCatalogEntryById = (rawId) => {
      if (rawId === null || rawId === undefined || rawId === '') {
        return null;
      }
      return catalogById.get(String(rawId)) || null;
    };

    const resolveCatalogEntryByName = (rawName) => {
      if (!rawName || typeof rawName !== 'string') {
        return null;
      }
      const normalized = normalizeProductKey(rawName);
      if (!normalized || normalized === 'без названия') {
        return null;
      }
      return catalogByName.get(normalized) || null;
    };

    filteredPayments.forEach((payment) => {
      summary.payments_count += 1;
      const amount = toNumber(payment.amount) ?? 0;
      if (payment.currency) {
        summary.currency_totals[payment.currency] = (summary.currency_totals[payment.currency] || 0) + amount;
      }

      const proformaId = payment.manual_proforma_id || payment.proforma_id || null;
      const proformaFullnumber = payment.manual_proforma_fullnumber || payment.proforma_fullnumber || null;
      let proformaInfo = null;
      if (proformaId) {
        proformaInfo = proformaMap.byId.get(String(proformaId)) || null;
      }
      if (!proformaInfo && proformaFullnumber) {
        proformaInfo = proformaMap.byFullnumber.get(String(proformaFullnumber).trim()) || null;
      }
      const paymentEntry = this.buildPaymentEntry(payment, proformaInfo);
      
      // Диагностическое логирование для deal #2106
      const paymentIdStr = payment.id ? String(payment.id) : '';
      if (payment.deal_id === '2106' || paymentIdStr.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
        logger.info('🔍 [Deal #2106] После buildPaymentEntry', {
          paymentId: payment.id,
          paymentCurrency: payment.currency,
          paymentAmount: payment.amount,
          paymentSource: payment.source,
          paymentEntryAmount: paymentEntry.amount,
          paymentEntryCurrency: paymentEntry.currency,
          paymentEntryAmountPln: paymentEntry.amount_pln,
          hasProforma: !!proformaInfo
        });
      }
      
      if (Number.isFinite(paymentEntry.amount_pln)) {
        summary.total_pln += paymentEntry.amount_pln;
      }

      let productKey = 'unmatched';
      let productName = 'Без категории';
      let productId = null;

      if (productKey === 'unmatched' && payment.product_id) {
        const catalogEntry = resolveCatalogEntryById(payment.product_id);
        if (catalogEntry) {
          productId = catalogEntry.id;
          productName = catalogEntry.name || productName;
          if (productId !== null && productId !== undefined && productId !== '') {
            productKey = `id:${productId}`;
          }
        }
      }

      // For Stripe payments, use product_links to find product by ID (not by name!)
      // payment.stripe_product_id is actually product_link.id (UUID) from stripe_payments table
      if (payment.source === 'stripe' && payment.stripe_product_id) {
        // Try to find product_link by its ID (UUID)
        const productLink = productLinksMap.get(payment.stripe_product_id);
        if (productLink) {
          productName = productLink.crm_product_name || 'Без названия';
          
          // Priority 1: Use camp_product_id from product_links if available
          // Convert to number if it's a string (Supabase returns strings)
          productId = productLink.camp_product_id 
            ? (typeof productLink.camp_product_id === 'string' 
                ? parseInt(productLink.camp_product_id, 10) 
                : productLink.camp_product_id)
            : null;
          if (productId && !Number.isNaN(productId)) {
            productKey = `id:${productId}`;
          } else {
            // Priority 2: Find product in proformaMap by matching product ID from proformas
            // Look for proformas that have products matching this crm_product_id
            // We need to find the camp_product_id by looking at proforma products
            for (const [, proforma] of proformaMap.byId.entries()) {
              if (proforma.product && proforma.product.id) {
                // Check if this proforma's product matches by name (temporary until camp_product_id is set)
                // But prefer to find by ID if we can match crm_product_id somehow
                const proformaProductName = normalizeProductKey(proforma.product.name);
                const linkProductName = normalizeProductKey(productName);
                if (proformaProductName === linkProductName) {
                  productId = proforma.product.id;
                  productKey = proforma.product.key;
                  break;
                }
              }
            }
            
            // Priority 3: Check if productMap already has a product with matching ID
            if (productKey === 'unmatched' && productId) {
              if (productMap.has(`id:${productId}`)) {
                productKey = `id:${productId}`;
              }
            }
            
            // Priority 4: Check if productMap has a product with matching name (fallback)
            if (productKey === 'unmatched') {
              const normalizedName = normalizeProductKey(productName);
              for (const [existingKey, existingProduct] of productMap.entries()) {
                if (normalizeProductKey(existingProduct.name) === normalizedName) {
                  productKey = existingKey;
                  productId = existingProduct.product_id;
                  break;
                }
              }
            }
            
            // Last resort: create key by normalized name (should not happen if data is correct)
            if (productKey === 'unmatched') {
              productKey = `key:${normalizeProductKey(productName)}`;
            }
          }
        }
      }

      if (productKey === 'unmatched' && payment.source === 'stripe') {
        if (payment.stripe_crm_product_id) {
          productId = Number(payment.stripe_crm_product_id);
          if (Number.isFinite(productId)) {
            productKey = `id:${productId}`;
          } else {
            productKey = `crm:${payment.stripe_crm_product_id}`;
            productId = null;
          }
          productName = payment.stripe_product_name || `CRM продукт ${payment.stripe_crm_product_id}`;
        } else if (payment.stripe_product_name) {
          const normalizedName = normalizeProductKey(payment.stripe_product_name);
          productKey = `stripe-name:${normalizedName}`;
          productName = payment.stripe_product_name;
        }
      }

      if (productKey === 'unmatched' && payment.source === 'stripe_event') {
        // Priority 1: Check payment.product_id (set in loadStripeEventItems from catalog)
        // This is the most reliable source
        let catalogEntry = null;
        if (payment.product_id) {
          catalogEntry = resolveCatalogEntryById(payment.product_id);
        }
        
        // Priority 2: Check payment.stripe_crm_product_id (legacy field)
        if (!catalogEntry && payment.stripe_crm_product_id) {
          catalogEntry = resolveCatalogEntryById(payment.stripe_crm_product_id);
        }
        
        // Priority 3: Try to find by event_key with strict matching
        // Only use if product_id was not set (meaning loadStripeEventItems didn't find a match)
        if (!catalogEntry && payment.stripe_event_key) {
          const foundEntry = resolveCatalogEntryByName(payment.stripe_event_key);
          if (foundEntry) {
            // Double-check: make sure the found product name actually contains the event_key
            // This prevents false matches (e.g., 'ny2026' matching 'czarna stodola')
            const eventKeyUpper = payment.stripe_event_key.toUpperCase();
            const foundNameUpper = (foundEntry.name || '').toUpperCase();
            if (foundNameUpper.includes(eventKeyUpper) || 
                normalizeProductKey(foundEntry.name || '') === normalizeProductKey(payment.stripe_event_key)) {
              catalogEntry = foundEntry;
            }
          }
        }
        
        // Priority 4: Try to find by stripe_product_name as fallback (with strict matching)
        if (!catalogEntry && payment.stripe_product_name) {
          const foundEntry = resolveCatalogEntryByName(payment.stripe_product_name);
          if (foundEntry) {
            // Double-check: make sure the found product name actually contains the stripe_product_name
            const productNameUpper = payment.stripe_product_name.toUpperCase();
            const foundNameUpper = (foundEntry.name || '').toUpperCase();
            if (foundNameUpper.includes(productNameUpper) ||
                normalizeProductKey(foundEntry.name || '') === normalizeProductKey(payment.stripe_product_name)) {
              catalogEntry = foundEntry;
            }
          }
        }

        if (catalogEntry) {
          productId = catalogEntry.id ?? null;
          productName = catalogEntry.name || payment.stripe_product_name || payment.stripe_event_key || 'Мероприятие';
          if (productId !== null && productId !== undefined && productId !== '') {
            productKey = `id:${productId}`;
          } else if (catalogEntry.normalizedName) {
            productKey = `key:${catalogEntry.normalizedName}`;
          }
        } else {
          // Only create fallback key if we really couldn't find a product
          // This prevents creating groups with wrong names
          const fallbackName = payment.stripe_product_name || payment.stripe_event_key || 'Stripe Event';
          const normalizedFallback = fallbackName ? normalizeProductKey(fallbackName) : null;
          if (normalizedFallback && normalizedFallback !== 'без названия') {
            productKey = `stripe-event:${normalizedFallback}`;
          } else if (payment.stripe_event_key) {
            productKey = `stripe-event:${payment.stripe_event_key}`;
          }
          productName = fallbackName;
        }
      }

      // Fallback to proforma product if no Stripe product found
      if (productKey === 'unmatched' && proformaInfo?.product) {
        productKey = proformaInfo.product.key;
        productName = proformaInfo.product.name || 'Без названия';
        productId = proformaInfo.product.id || null;
      }

      // CRITICAL: Deduplicate products by productId and name BEFORE creating/accessing the group
      // This must happen AFTER all productId determination logic but BEFORE productMap.has() check
      // Goal: merge groups with same productId OR same normalized name to prevent duplicates
      const normalizedName = normalizeProductKey(productName);
      
      if (productId !== null && productId !== undefined && productId !== '') {
        // Case 1: We have productId - check for existing group with same ID first
        let foundExistingKey = null;
        for (const [existingKey, existingProduct] of productMap.entries()) {
          if (existingProduct.product_id === productId) {
            foundExistingKey = existingKey;
            // Use the existing product name to maintain consistency
            if (existingProduct.name && existingProduct.name !== 'Без названия') {
              productName = existingProduct.name;
            }
            break;
          }
        }
        
        // If we found an existing group with this productId, use its key
        if (foundExistingKey) {
          productKey = foundExistingKey;
        } else {
          // No group with same ID found - ensure we use id:${productId} format
          // Migration of groups with same name but no ID will happen when creating the new group
          productKey = `id:${productId}`;
        }
      } else if (productKey !== 'unmatched' && productName !== 'Без категории' && normalizedName && normalizedName !== 'без названия') {
        // Case 3: We don't have productId, but have a productName
        // Check if there's already a group with the same normalized name
        let foundGroupWithId = null;
        let foundGroupWithoutId = null;
        
        for (const [existingKey, existingProduct] of productMap.entries()) {
          const existingNormalizedName = normalizeProductKey(existingProduct.name);
          if (existingNormalizedName === normalizedName) {
            // Prefer groups with ID (they are more reliable)
            if (existingProduct.product_id && !foundGroupWithId) {
              foundGroupWithId = { key: existingKey, product: existingProduct };
            } else if (!existingProduct.product_id && !foundGroupWithoutId) {
              foundGroupWithoutId = { key: existingKey, product: existingProduct };
            }
          }
        }
        
        // Use group with ID if found (prefer ID-based grouping)
        if (foundGroupWithId) {
          productKey = foundGroupWithId.key;
          productId = foundGroupWithId.product.product_id;
          if (foundGroupWithId.product.name && foundGroupWithId.product.name !== 'Без названия') {
            productName = foundGroupWithId.product.name;
          }
        } else if (foundGroupWithoutId) {
          // Use existing group without ID if no group with ID found
          productKey = foundGroupWithoutId.key;
          if (foundGroupWithoutId.product.name && foundGroupWithoutId.product.name !== 'Без названия') {
            productName = foundGroupWithoutId.product.name;
          }
        }
      }

      if (productKey === 'unmatched' && paymentEntry.status.code === 'unmatched') {
        summary.unmatched_count += 1;
      }

      const determineGroupSource = () => {
        if (payment.source === 'stripe_event') {
          return 'stripe_event';
        }
        if (payment.source === 'stripe') {
          return 'stripe';
        }
        return 'product';
      };

      // Now check if group exists (after deduplication logic)
      if (!productMap.has(productKey)) {
        // Before creating new group with ID, check if there's an existing group with same name but no ID
        // This handles the case where some payments were grouped by name before ID was determined
        let groupToMigrate = null;
        let groupToMigrateKey = null;
        if (productId !== null && productId !== undefined && productId !== '' && normalizedName && normalizedName !== 'без названия') {
          for (const [existingKey, existingProduct] of productMap.entries()) {
            const existingNormalizedName = normalizeProductKey(existingProduct.name);
            if (existingNormalizedName === normalizedName && !existingProduct.product_id) {
              // Found group with same name but no ID - migrate its data
              groupToMigrate = existingProduct;
              groupToMigrateKey = existingKey;
              break;
            }
          }
        }
        
        // Create new group
        const newGroup = {
          key: productKey,
          name: productName,
          product_id: productId,
          source: determineGroupSource(),
          totals: {
            payments_count: 0,
            currency_totals: {},
            pln_total: 0,
            proforma_ids: new Set()
          },
          aggregates: new Map()
        };
        
        // If we found a group to migrate, merge its data into the new group
        if (groupToMigrate) {
          // Merge totals
          newGroup.totals.payments_count = groupToMigrate.totals.payments_count || 0;
          newGroup.totals.pln_total = groupToMigrate.totals.pln_total || 0;
          newGroup.totals.proforma_ids = new Set(groupToMigrate.totals.proforma_ids || []);
          
          // Merge currency totals
          Object.entries(groupToMigrate.totals.currency_totals || {}).forEach(([cur, amount]) => {
            newGroup.totals.currency_totals[cur] = (newGroup.totals.currency_totals[cur] || 0) + amount;
          });
          
          // Merge aggregates
          groupToMigrate.aggregates.forEach((aggregate, aggKey) => {
            newGroup.aggregates.set(aggKey, aggregate);
          });
          
          // Use the better name if available
          if (groupToMigrate.name && groupToMigrate.name !== 'Без названия' && groupToMigrate.name !== productName) {
            newGroup.name = groupToMigrate.name;
          }
          
          // Remove old group
          productMap.delete(groupToMigrateKey);
        }
        
        productMap.set(productKey, newGroup);
      }

      const group = productMap.get(productKey);
      if (group && payment.source === 'stripe_event') {
        group.source = 'stripe_event';
      }
      group.totals.payments_count += 1;
      if (Number.isFinite(paymentEntry.amount_pln)) {
        group.totals.pln_total += paymentEntry.amount_pln;
      }
      if (paymentEntry.currency) {
        const currencyKey = paymentEntry.currency.toUpperCase();
        const amountToAdd = toNumber(paymentEntry.amount) ?? 0;
        group.totals.currency_totals[currencyKey] =
          (group.totals.currency_totals[currencyKey] || 0) + amountToAdd;
        
        // Диагностическое логирование для deal #2106
        const paymentIdStr2 = payment.id ? String(payment.id) : '';
        if (payment.deal_id === '2106' || paymentIdStr2.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
          logger.info('🔍 [Deal #2106] Добавление в currency_totals', {
            paymentId: payment.id,
            paymentEntryCurrency: paymentEntry.currency,
            currencyKey,
            amountToAdd,
            currentTotal: group.totals.currency_totals[currencyKey],
            allCurrencyTotals: Object.keys(group.totals.currency_totals)
          });
        }
      }
      if (proformaInfo?.id) {
        group.totals.proforma_ids.add(proformaInfo.id);
      }

      let aggregateKey;
      const isStripeLike = (payment.source === 'stripe' || payment.source === 'stripe_event');
      const hasStripeGrouping = isStripeLike && (payment.payer_name || payment.payer_normalized_name);
      if (hasStripeGrouping) {
        aggregateKey = buildStripeAggregateKey(payment, productKey);
      } else if (proformaInfo?.id) {
        aggregateKey = `proforma:${proformaInfo.id}`;
      } else {
        aggregateKey = `payment:${payment.id}`;
      }
      if (!group.aggregates.has(aggregateKey)) {
        group.aggregates.set(aggregateKey, {
          key: aggregateKey,
          proforma: proformaInfo,
          source: payment.source || null,
          stripe_deal_id: null,
          stripe_deal_url: null,
          totals: {
            payment_count: 0,
            currency_totals: {},
            pln_total: 0
          },
          payments: [],
          payer_names: new Set(),
          first_payment_date: null,
          last_payment_date: null
        });
      }

      const aggregate = group.aggregates.get(aggregateKey);
      if (proformaInfo && !aggregate.proforma) {
        aggregate.proforma = proformaInfo;
      }
      aggregate.payments.push(paymentEntry);
      aggregate.totals.payment_count += 1;
      if (paymentEntry.currency) {
        const currencyKey = paymentEntry.currency.toUpperCase();
        const amountToAdd = toNumber(paymentEntry.amount) ?? 0;
        aggregate.totals.currency_totals[currencyKey] =
          (aggregate.totals.currency_totals[currencyKey] || 0) + amountToAdd;
        
        // Диагностическое логирование для deal #2106
        const paymentIdStr3 = payment.id ? String(payment.id) : '';
        if (payment.deal_id === '2106' || paymentIdStr3.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
          logger.info('🔍 [Deal #2106] Добавление в aggregate currency_totals', {
            paymentId: payment.id,
            paymentEntryCurrency: paymentEntry.currency,
            currencyKey,
            amountToAdd,
            currentTotal: aggregate.totals.currency_totals[currencyKey],
            allCurrencyTotals: Object.keys(aggregate.totals.currency_totals)
          });
        }
      }
      if (Number.isFinite(paymentEntry.amount_pln)) {
        aggregate.totals.pln_total += paymentEntry.amount_pln;
      }

      if (!aggregate.proforma && (payment.stripe_deal_id || payment.stripe_deal_url)) {
        if (payment.stripe_deal_id && !aggregate.stripe_deal_id) {
          aggregate.stripe_deal_id = payment.stripe_deal_id;
          aggregate.stripe_deal_url = buildDealUrl(payment.stripe_deal_id);
        }
      }

      if (paymentEntry.payer_name) {
        aggregate.payer_names.add(paymentEntry.payer_name);
      }

      const paymentDate = paymentEntry.date ? new Date(paymentEntry.date) : null;
      if (paymentDate) {
        if (!aggregate.first_payment_date || paymentDate < aggregate.first_payment_date) {
          aggregate.first_payment_date = paymentDate;
        }
        if (!aggregate.last_payment_date || paymentDate > aggregate.last_payment_date) {
          aggregate.last_payment_date = paymentDate;
        }
      }
    });

    const products = await Promise.all(Array.from(productMap.values()).map(async (group) => {
      const entriesPromises = Array.from(group.aggregates.values()).map(async (entry) => {
        // Нормализуем ключи валют к верхнему регистру при сериализации
        entry.totals.currency_totals = Object.fromEntries(
          Object.entries(entry.totals.currency_totals).map(([cur, value]) => {
            const normalizedCur = (cur || 'PLN').toUpperCase();
            return [normalizedCur, Number(value.toFixed(2))];
          })
        );
        entry.totals.pln_total = Number(entry.totals.pln_total.toFixed(2));
        entry.payer_names = Array.from(entry.payer_names.values());
        if ((!entry.payer_names || entry.payer_names.length === 0) && entry.proforma?.buyer?.name) {
          entry.payer_names = [entry.proforma.buyer.name];
        }
        entry.first_payment_date = entry.first_payment_date ? entry.first_payment_date.toISOString() : null;
        entry.last_payment_date = entry.last_payment_date ? entry.last_payment_date.toISOString() : null;

        const lifetimePaymentCount = Number.isFinite(entry.proforma?.payments_count)
          ? entry.proforma.payments_count
          : entry.totals.payment_count;
        entry.lifetime_payment_count = lifetimePaymentCount;

        if (entry.proforma) {
          // Если есть проформа - определяем статус по сумме проформы
          // ВАЖНО: Используем общую оплаченную сумму проформы (payments_total_pln),
          // а не сумму платежей из диапазона дат, чтобы статус отражал реальное состояние оплаты
          // независимо от выбранного периода отчета
          const targetTotalPln = Number.isFinite(entry.proforma.total_pln)
            ? entry.proforma.total_pln
            : convertToPln(entry.proforma.total, entry.proforma.currency, entry.proforma.currency_exchange);
          // Используем общую оплаченную сумму проформы (все платежи, независимо от даты)
          const paidPln = Number.isFinite(entry.proforma.payments_total_pln)
            ? entry.proforma.payments_total_pln
            : 0;
          entry.status = determinePaymentStatus(targetTotalPln, paidPln);
          
          // Логируем для диагностики сделки #2077
          if (entry.proforma.pipedrive_deal_id === '2077') {
            logger.info('🔍 [Deal #2077] Определение статуса проформы', {
              proformaId: entry.proforma.id,
              proformaFullnumber: entry.proforma.fullnumber,
              targetTotalPln,
              paidPlnInRange: paidPln,
              paidPlnAll: entry.proforma.payments_total_pln,
              paymentsCount: entry.payments.length,
              paymentIds: entry.payments.map(p => p.id).slice(0, 5),
              status: entry.status
            });
          }
        } else {
          // Если нет проформы - определяем статус по сумме сделки и общей оплаченной сумме
          // ВАЖНО: Для Stripe платежей сравниваем сумму сделки с общей суммой всех оплаченных платежей
          // независимо от выбранного периода отчета
          if (entry.stripe_deal_id && entry.payments.length > 0) {
            try {
              // Получаем сумму сделки из Pipedrive
              const pipedriveClient = await this.getPipedriveClient();
              const dealResult = await pipedriveClient.getDeal(entry.stripe_deal_id);
              
              if (dealResult.success && dealResult.deal) {
                const deal = dealResult.deal;
                const dealValue = parseFloat(deal.value) || 0;
                const dealCurrency = deal.currency || 'PLN';
                
                // Загружаем ВСЕ Stripe платежи для этой сделки (независимо от периода)
                const allDealStripePayments = await this.stripeRepository.listPayments({
                  dealId: entry.stripe_deal_id,
                  limit: 1000
                });
                
                // Фильтруем только оплаченные платежи
                const paidPayments = allDealStripePayments.filter(
                  p => p.payment_status === 'paid' || p.status === 'processed'
                );
                
                // Суммируем все оплаченные платежи в PLN
                let totalPaidPln = 0;
                for (const payment of paidPayments) {
                  const amountPln = parseFloat(payment.amount_pln) || 0;
                  totalPaidPln += amountPln;
                }
                
                // Конвертируем сумму сделки в PLN для сравнения
                let dealValuePln = dealValue;
                if (dealCurrency !== 'PLN') {
                  // Используем курс из первого платежа или конвертируем
                  const firstPayment = paidPayments[0];
                  if (firstPayment && firstPayment.exchange_rate) {
                    dealValuePln = dealValue * parseFloat(firstPayment.exchange_rate);
                  } else {
                    // Fallback: используем простую конвертацию через amount_pln / original_amount
                    if (paidPayments.length > 0 && paidPayments[0].original_amount) {
                      const rate = totalPaidPln / (paidPayments.reduce((sum, p) => sum + (parseFloat(p.original_amount) || 0), 0));
                      dealValuePln = dealValue * rate;
                    }
                  }
                }
                
                // Определяем статус по соотношению общей суммы сделки и фактически оплаченной
                entry.status = determinePaymentStatus(dealValuePln, totalPaidPln);
              } else {
                // Если не удалось получить данные сделки, используем статус из платежей
                const firstStatus = entry.payments.find((item) => item.status)?.status
                  || { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
                entry.status = firstStatus;
              }
            } catch (error) {
              logger.warn('Failed to determine payment status for Stripe entry', {
                dealId: entry.stripe_deal_id,
                error: error.message
              });
              // Fallback: используем статус из платежей
              const firstStatus = entry.payments.find((item) => item.status)?.status
                || { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
              entry.status = firstStatus;
            }
          } else {
            // Если нет deal_id - используем статус из платежей
            // Для Stripe платежей статус уже определен в buildPaymentEntry по stripe_payment_status
            const firstStatus = entry.payments.find((item) => item.status)?.status
              || { code: 'unmatched', label: 'Не привязан', className: 'unmatched' };
            entry.status = firstStatus;
            
            // Дополнительная проверка: если это Stripe платеж без проформы, но статус "Не привязан"
            // проверяем stripe_payment_status напрямую
            if (firstStatus.code === 'unmatched' && entry.payments.length > 0) {
              const stripePayment = entry.payments.find(p => p.source === 'stripe' || p.source === 'stripe_event');
              if (stripePayment) {
                // Используем статус из stripe_payment_status, если он есть
                const stripeStatus = stripePayment.stripe_payment_status || stripePayment.payment_status;
                if (stripeStatus === 'paid') {
                  entry.status = { code: 'paid', label: 'Оплачено', className: 'matched' };
                }
              }
            }
          }
        }

        return entry;
      });
      
      const entries = await Promise.all(entriesPromises);

      const finalProduct = {
        key: group.key,
        name: group.name,
        product_id: group.product_id,
        source: group.source || 'product',
        totals: {
          payments_count: group.totals.payments_count,
          proforma_count: Array.from(group.totals.proforma_ids).length,
          // Нормализуем ключи валют к верхнему регистру при сериализации
          currency_totals: Object.fromEntries(
            Object.entries(group.totals.currency_totals).map(([cur, value]) => {
              const normalizedCur = (cur || 'PLN').toUpperCase();
              return [normalizedCur, Number(value.toFixed(2))];
            })
          ),
          pln_total: Number(group.totals.pln_total.toFixed(2))
        },
        entries
      };
      
      // Диагностическое логирование для deal #2106
      if (group.product_id === 57 || group.name?.includes('Girls retreat')) {
        logger.info('🔍 [Deal #2106] Финальный продукт перед возвратом', {
          productId: finalProduct.product_id,
          productName: finalProduct.name,
          currencyTotals: finalProduct.totals.currency_totals,
          entriesCount: finalProduct.entries.length,
          firstEntryCurrencyTotals: finalProduct.entries[0]?.totals?.currency_totals
        });
      }
      
      return finalProduct;
    }));

    summary.products_count = products.length;
    summary.total_pln = Number(summary.total_pln.toFixed(2));
    summary.currency_totals = Object.fromEntries(
      Object.entries(summary.currency_totals).map(([cur, value]) => [cur, Number(value.toFixed(2))])
    );

    return { products, summary };
  }

  async loadPayments({ dateFrom, dateTo, statusScope, productCatalog }) {
    if (!this.supabase) {
      throw new Error('Supabase client is not configured');
    }

    const refundsIncomeCategoryId = await this.getRefundsIncomeCategoryId();

    const fromIso = toIsoDate(dateFrom);
    const toIso = toIsoDate(dateTo);
    const query = this.supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        direction,
        payer_name,
        payer_normalized_name,
        manual_status,
        manual_proforma_id,
        manual_proforma_fullnumber,
        proforma_id,
        proforma_fullnumber,
        match_status,
        match_confidence,
        match_reason,
        source,
        income_category_id
      `)
      .eq('direction', 'in')
      .is('deleted_at', null)
      .order('operation_date', { ascending: false });

    if (fromIso) {
      query.gte('operation_date', fromIso);
    }
    if (toIso) {
      query.lte('operation_date', toIso);
    }

    if (statusScope !== 'all') {
      // show manually approved and auto-matched payments to include bank + Stripe flows
      query.or('manual_status.eq.approved,match_status.eq.matched');
    }

    // Always exclude manually rejected payments from reports
    query.neq('manual_status', 'rejected');

    const { data, error } = await query.limit(5000);

    if (error) {
      logger.error('Supabase error while fetching payments for report:', error);
      throw new Error('Не удалось получить платежи из базы');
    }

    let bankPayments = Array.isArray(data) ? data : [];
    if (refundsIncomeCategoryId) {
      bankPayments = bankPayments.filter(
        (payment) => payment.income_category_id === null
          || String(payment.income_category_id) !== String(refundsIncomeCategoryId)
      );
    }

    // Enrich bank payments with product_id from payment_product_links so that
    // the report reflects link/unlink; after unlink, product_id is not set and payment goes to "Без категории"
    if (bankPayments.length > 0 && this.supabase) {
      const bankPaymentIds = bankPayments.map((p) => p.id).filter(Boolean);
      try {
        const { data: linksData, error: linksError } = await this.supabase
          .from('payment_product_links')
          .select('payment_id, product_id')
          .in('payment_id', bankPaymentIds);

        if (!linksError && Array.isArray(linksData) && linksData.length > 0) {
          const linkByPaymentId = new Map(linksData.map((row) => [row.payment_id, row.product_id]));
          bankPayments = bankPayments.map((p) => {
            const productId = linkByPaymentId.get(p.id);
            return productId !== undefined ? { ...p, product_id: productId } : p;
          });
        }
      } catch (err) {
        logger.warn('Failed to load payment_product_links for report', { error: err.message });
      }
    }

    // Load Stripe payments
    let stripePayments = [];
    let stripeEventPayments = [];
    try {
      if (this.stripeRepository.isEnabled()) {
        // Загружаем Stripe платежи с фильтрацией по дате и статусу
        // ВАЖНО: Не фильтруем по paymentStatus на уровне БД, чтобы не исключить старые платежи
        // Фильтрация по payment_status будет выполнена в коде ниже
        const stripeData = await this.stripeRepository.listPayments({
          dateFrom: fromIso || null,
          dateTo: toIso || null,
          status: 'processed'
          // Не фильтруем по paymentStatus здесь, чтобы включить старые платежи без этого поля
        });
        
        // Логируем количество загруженных Stripe платежей для диагностики
        if (stripeData && stripeData.length > 0) {
          logger.debug('Загружено Stripe платежей для отчета', {
            count: stripeData.length,
            dateFrom: fromIso,
            dateTo: toIso,
            sampleIds: stripeData.slice(0, 3).map(sp => sp.session_id || sp.id)
          });
        }

        // Get list of refunded payments to exclude them from reports
        let refundedPaymentIds = new Set();
        try {
          const refunds = await this.stripeRepository.listDeletions({
            dateFrom: fromIso || null,
            dateTo: toIso || null,
            reason: 'deal_lost' // Also include 'stripe_refund' if needed
          });
          refunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });
          
          // Also get refunds with reason 'stripe_refund' (from Stripe API)
          const stripeRefunds = await this.stripeRepository.listDeletions({
            dateFrom: fromIso || null,
            dateTo: toIso || null,
            reason: 'stripe_refund'
          });
          stripeRefunds.forEach((refund) => {
            if (refund.payment_id) {
              refundedPaymentIds.add(String(refund.payment_id));
            }
          });
        } catch (refundError) {
          logger.warn('Failed to load refunds for payment report', {
            error: refundError.message
          });
        }

        // Convert Stripe payments to payment report format and filter out refunded payments
        stripePayments = (stripeData || [])
          .map((sp) => {
            // Диагностическое логирование для deal #2106
            if (sp.deal_id === '2106' || sp.session_id?.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
              logger.info('🔍 [Deal #2106] Данные из базы для Stripe платежа', {
                sessionId: sp.session_id,
                dealId: sp.deal_id,
                original_amount: sp.original_amount,
                original_amount_type: typeof sp.original_amount,
                amount_pln: sp.amount_pln,
                amount_pln_type: typeof sp.amount_pln,
                currency: sp.currency,
                currency_type: typeof sp.currency,
                rawPayload: sp.raw_payload ? {
                  amount_subtotal: sp.raw_payload.amount_subtotal,
                  amount_total: sp.raw_payload.amount_total,
                  currency: sp.raw_payload.currency
                } : null
              });
            }
            return sp;
          })
          .filter((sp) => {
            // Exclude payments that have been refunded
            if (sp.session_id && refundedPaymentIds.has(String(sp.session_id))) {
              return false;
            }
            // Exclude payments that are explicitly not paid (unpaid, pending, etc.)
            // Но включаем платежи, у которых payment_status отсутствует или null (старые платежи)
            // Это важно для обратной совместимости со старыми данными
            if (sp.payment_status !== undefined && sp.payment_status !== null && sp.payment_status !== 'paid') {
              return false;
            }
            const metadata = (sp.raw_payload && sp.raw_payload.metadata) || {};
            // Include Stripe payments if we can derive product linkage (product link, CRM product or deal)
            return sp.product_id || sp.deal_id || metadata.product_id || metadata.product_name;
          })
          .map((sp) => {
            // Use processed_at as payment date, fallback to created_at
            const paymentDate = sp.processed_at || sp.created_at || null;
            
            // Фильтрация по дате уже выполнена в запросе к БД через listPayments,
            // поэтому здесь не нужно дублировать проверку
            // Оставляем только преобразование данных
            
            // Determine amount and currency for Stripe payments
            // Priority 1: Use original_amount if available (sum in original currency before conversion)
            // Priority 2: If original_amount is null/undefined but amount_pln exists, use amount_pln with PLN currency
            // Priority 3: Fallback to 0
            // IMPORTANT: Convert to number to handle string values from database
            const originalAmountNum = toNumber(sp.original_amount);
            const amountPlnNum = toNumber(sp.amount_pln);
            const hasOriginalAmount = originalAmountNum !== null && originalAmountNum !== undefined && originalAmountNum !== 0;
            const hasAmountPln = amountPlnNum !== null && amountPlnNum !== undefined && amountPlnNum !== 0;
            const paymentCurrency = (sp.currency || 'PLN').toUpperCase();
            
            let amount;
            let currency;
            
            if (hasOriginalAmount) {
              // Use original_amount with its currency (this is the correct way for Stripe payments)
              amount = originalAmountNum;
              currency = paymentCurrency;
            } else if (hasAmountPln) {
              // If no original_amount, use amount_pln (already in PLN)
              // This should only happen for very old records or edge cases
              amount = amountPlnNum;
              currency = 'PLN';
            } else {
              // Fallback: try to use amount field if exists, otherwise 0
              amount = toNumber(sp.amount) || 0;
              currency = paymentCurrency;
            }
            
            // Determine document number: invoice_number for B2B, receipt_number for B2C
            // These fields may not exist in older database schemas, so check safely
            const documentNumber = (sp.invoice_number !== undefined && sp.invoice_number !== null) 
              ? sp.invoice_number 
              : ((sp.receipt_number !== undefined && sp.receipt_number !== null) 
                ? sp.receipt_number 
                : null);
            
            const metadata = (sp.raw_payload && sp.raw_payload.metadata) || {};
            const stripeCrmProductId = metadata.product_id ? String(metadata.product_id) : null;
            const stripeProductName = metadata.product_name || metadata.crm_product_name || null;
            
            // Диагностическое логирование для проверки валюты и суммы
            if (sp.deal_id === '2106' || sp.session_id?.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
              logger.info('🔍 [Deal #2106] Формирование Stripe платежа для отчета', {
                sessionId: sp.session_id,
                dbOriginalAmount: sp.original_amount,
                dbCurrency: sp.currency,
                dbAmountPln: sp.amount_pln,
                hasOriginalAmount,
                hasAmountPln,
                paymentCurrency,
                finalAmount: amount,
                finalCurrency: currency,
                rawPayloadAmountSubtotal: sp.raw_payload?.amount_subtotal,
                rawPayloadAmountTotal: sp.raw_payload?.amount_total,
                rawPayloadCurrency: sp.raw_payload?.currency
              });
            }

            const paymentObject = {
              id: `stripe_${sp.session_id || sp.id}`,
              operation_date: paymentDate,
              description: `Stripe payment: ${sp.session_id || 'unknown'}`,
              amount: amount,
              currency: currency,
              direction: 'in',
              payer_name: sp.customer_name || sp.company_name || null,
              payer_normalized_name: null,
              manual_status: 'approved',
              manual_proforma_id: null,
              manual_proforma_fullnumber: documentNumber, // Use invoice/receipt number instead of null
              proforma_id: null,
              proforma_fullnumber: documentNumber, // Use invoice/receipt number for identification
              match_status: 'matched',
              match_confidence: 1.0,
              match_reason: 'stripe',
              source: 'stripe',
              // Stripe-specific fields
              stripe_session_id: sp.session_id,
              stripe_product_id: sp.product_id, // This is product_link.id (UUID), not stripe_product_id from Stripe
              stripe_deal_id: sp.deal_id,
              deal_id: sp.deal_id, // Add deal_id for tracking
              stripe_amount_pln: sp.amount_pln || null,
              stripe_payment_status: sp.payment_status || null, // 'paid', 'pending', etc.
              stripe_invoice_number: sp.invoice_number || null,
              stripe_receipt_number: sp.receipt_number || null,
              stripe_crm_product_id: stripeCrmProductId,
              stripe_product_name: stripeProductName
            };
            
            // Диагностическое логирование перед возвратом
            if (sp.deal_id === '2106' || sp.session_id?.includes('a1PC44eNoHrrmdaLCNV1aYwOD2exzFkYplh5Rtl0WRKuyd67oksVW6DGvT')) {
              logger.info('🔍 [Deal #2106] Возвращаемый объект платежа', {
                paymentId: paymentObject.id,
                paymentAmount: paymentObject.amount,
                paymentCurrency: paymentObject.currency,
                dealId: paymentObject.deal_id
              });
            }
            
            return paymentObject;
          })
          .filter((p) => p !== null); // Удаляем null значения (отфильтрованные платежи)
      }
    } catch (error) {
      logger.warn('Failed to load Stripe payments for payment report', {
        error: error.message
      });
    }

    // Load Stripe event items as synthetic payments
    // ВАЖНО: Исключаем дублирование - если платеж уже есть в stripePayments, не добавляем его из stripeEventPayments
    try {
      const allStripeEventPayments = await this.loadStripeEventItems({
        dateFrom,
        dateTo,
        productCatalog
      });
      
      // Создаем Set session_id из уже загруженных Stripe платежей
      // Используем stripe_session_id из объекта платежа
      const stripeSessionIds = new Set(
        stripePayments
          .map(p => {
            // Пытаемся извлечь session_id из разных полей
            if (p.stripe_session_id) return p.stripe_session_id;
            // Если id имеет формат stripe_<session_id>, извлекаем session_id
            if (p.id && p.id.startsWith('stripe_')) {
              return p.id.replace('stripe_', '');
            }
            return null;
          })
          .filter(Boolean)
      );
      
      // Фильтруем event items - исключаем те, которые уже есть в stripePayments
      stripeEventPayments = allStripeEventPayments.filter((eventPayment) => {
        // Извлекаем session_id из event item
        // В loadStripeEventItems session_id сохраняется в поле stripe_session_id
        const eventSessionId = eventPayment.stripe_session_id || 
          (eventPayment.session_id ? eventPayment.session_id : null);
        
        // Если session_id есть в stripePayments, исключаем этот event item
        if (eventSessionId && stripeSessionIds.has(eventSessionId)) {
          return false;
        }
        
        return true;
      });
      
      // Логируем, если были исключены дубликаты
      if (allStripeEventPayments.length !== stripeEventPayments.length) {
        const excludedCount = allStripeEventPayments.length - stripeEventPayments.length;
        logger.info('Исключены дублирующиеся Stripe event items', {
          totalEventItems: allStripeEventPayments.length,
          excludedCount,
          includedCount: stripeEventPayments.length,
          stripePaymentsCount: stripePayments.length
        });
      }
    } catch (error) {
      logger.warn('Failed to load Stripe event payments for payment report', {
        error: error.message
      });
      stripeEventPayments = [];
    }

    // Combine bank, Stripe, and Stripe event payments
    return [...bankPayments, ...stripePayments, ...stripeEventPayments];
  }

  async loadStripeEventItems({ dateFrom, dateTo, productCatalog }) {
    if (!this.supabase) {
      return [];
    }

    const fromIso = toIsoDate(dateFrom);
    const toIso = toIsoDate(dateTo);

    let query = this.supabase
      .from('stripe_event_items')
      .select(
        `
        line_item_id,
        session_id,
        event_key,
        event_label,
        currency,
        amount,
        amount_pln,
        payment_status,
        customer_name,
        customer_email,
        updated_at,
        created_at
      `
      )
      .order('created_at', { ascending: false })
      .limit(5000);

    if (fromIso) {
      query = query.gte('created_at', fromIso);
    }
    if (toIso) {
      query = query.lte('created_at', toIso);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to query stripe_event_items: ${error.message}`);
    }

    const sessionIds = Array.from(
      new Set((data || []).map((item) => item.session_id).filter(Boolean))
    );

    let paymentDateMap = new Map();
    if (sessionIds.length) {
      // Supabase can reject very large IN() lists (URL too long / limits).
      // Load in chunks and merge into a single map.
      const chunkSize = 200;
      const chunks = [];
      for (let i = 0; i < sessionIds.length; i += chunkSize) {
        chunks.push(sessionIds.slice(i, i + chunkSize));
      }

      const allPayments = [];
      for (const chunk of chunks) {
        const { data: payments, error: paymentsError } = await this.supabase
          .from('stripe_payments')
          .select('session_id, processed_at, created_at')
          .in('session_id', chunk);

        if (paymentsError) {
          throw new Error(`Failed to load stripe payments for events: ${paymentsError.message}`);
        }
        if (Array.isArray(payments) && payments.length) {
          allPayments.push(...payments);
        }
      }

      paymentDateMap = new Map(allPayments.map((row) => [row.session_id, row]));
    }

    const catalogByName = productCatalog?.byNormalizedName instanceof Map
      ? productCatalog.byNormalizedName
      : new Map();
    const catalogById = productCatalog?.byId instanceof Map ? productCatalog.byId : new Map();

    const toDateOnly = (value) => {
      if (!value) return null;
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    };

    const originalFrom = toDateOnly(dateFrom);
    const originalTo = toDateOnly(dateTo);

    return (data || [])
      .map((item) => {
        // Priority 1: Check if item has product_id (if field exists in table)
        let catalogEntry = null;
        if (item.product_id && catalogById.has(String(item.product_id))) {
          catalogEntry = catalogById.get(String(item.product_id));
        }
        
        // Priority 2: Try to find by exact event_key match first (e.g., 'NY2026')
        // This is more reliable than normalized name matching
        if (!catalogEntry && item.event_key) {
          const normalizedEventKey = normalizeProductKey(item.event_key);
          if (normalizedEventKey && catalogByName.has(normalizedEventKey)) {
            const foundEntry = catalogByName.get(normalizedEventKey);
            // Double-check: make sure the found product name actually contains the event_key
            // This prevents false matches (e.g., 'ny2026' matching 'czarna stodola' if normalized names somehow collide)
            const foundNameNormalized = normalizeProductKey(foundEntry.name || '');
            if (foundNameNormalized === normalizedEventKey || 
                (foundEntry.name && foundEntry.name.toUpperCase().includes(item.event_key.toUpperCase()))) {
              catalogEntry = foundEntry;
            }
          }
        }
        
        // Priority 3: Try to find by normalized event_label as fallback
        if (!catalogEntry && item.event_label) {
          const normalizedLabel = normalizeProductKey(item.event_label);
          if (normalizedLabel && catalogByName.has(normalizedLabel)) {
            const foundEntry = catalogByName.get(normalizedLabel);
            // Double-check: make sure the found product name actually contains the event_label
            const foundNameNormalized = normalizeProductKey(foundEntry.name || '');
            if (foundNameNormalized === normalizedLabel ||
                (foundEntry.name && foundEntry.name.toUpperCase().includes(item.event_label.toUpperCase()))) {
              catalogEntry = foundEntry;
            }
          }
        }

        const resolvedProductId = catalogEntry?.id ?? null;
        const resolvedProductName = catalogEntry?.name
          || item.event_label
          || item.event_key
          || 'Мероприятие';

        const paymentRecord = paymentDateMap.get(item.session_id) || null;
        const paidAt = paymentRecord?.processed_at
          || paymentRecord?.created_at
          || item.created_at
          || item.updated_at
          || null;

        return {
          id: `stripe_event_${item.line_item_id}`,
          operation_date: paidAt,
          description: resolvedProductName
            ? `Stripe Event: ${resolvedProductName}`
            : `Stripe Event: ${item.event_label || item.event_key || '—'}`,
          amount: Number(item.amount) || 0,
          currency: item.currency || 'PLN',
          direction: 'in',
          payer_name: item.customer_name || item.customer_email || null,
          payer_normalized_name: normalizeWhitespace(item.customer_name || item.customer_email || ''),
          manual_status: 'approved',
          manual_proforma_id: null,
          manual_proforma_fullnumber: null,
          proforma_id: null,
          proforma_fullnumber: null,
          match_status: 'matched',
          match_confidence: 1.0,
          match_reason: 'stripe_event',
          source: 'stripe_event',
          stripe_event_key: item.event_key,
          stripe_product_name: resolvedProductName,
          stripe_payment_status: item.payment_status || 'paid',
          stripe_amount_pln: Number(item.amount_pln) || 0,
          stripe_product_id: null,
          stripe_crm_product_id: resolvedProductId ? String(resolvedProductId) : null,
          stripe_session_id: item.session_id || null, // Сохраняем session_id для дедупликации
          product_id: resolvedProductId || null,
          paid_at: paidAt
        };
      })
      .filter((item) => {
        const paidDate = item.paid_at ? new Date(item.paid_at) : null;
        if (paidDate) {
          if (originalFrom && paidDate < originalFrom) {
            return false;
          }
          if (originalTo && paidDate > originalTo) {
            return false;
          }
        }
        return true;
      });
  }

  async loadProformas({ ids = [], fullnumbers = [] } = {}) {
    if (!this.supabase || (ids.length === 0 && fullnumbers.length === 0)) {
      return [];
    }

    let query = this.supabase
      .from('proformas')
      .select(`
        id,
        fullnumber,
        issued_at,
        currency,
        total,
        currency_exchange,
        payments_total,
        payments_total_pln,
        payments_currency_exchange,
        payments_count,
        buyer_name,
        buyer_alt_name,
        buyer_email,
        buyer_phone,
        buyer_street,
        buyer_zip,
        buyer_city,
        buyer_country,
        pipedrive_deal_id,
        proforma_products (
          product_id,
          quantity,
          unit_price,
          line_total,
          name,
          products (
            id,
            name,
            normalized_name
          )
        )
      `)
      .in('status', ['active', 'deleted']);

    // Build OR condition for IDs and fullnumbers
    if (ids.length > 0 && fullnumbers.length > 0) {
      query = query.or(`id.in.(${ids.join(',')}),fullnumber.in.(${fullnumbers.map(fn => `"${fn}"`).join(',')})`);
    } else if (ids.length > 0) {
      query = query.in('id', ids);
    } else if (fullnumbers.length > 0) {
      query = query.in('fullnumber', fullnumbers);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Supabase error while fetching proformas for payment report:', error);
      throw new Error('Не удалось получить проформы из базы');
    }

    return Array.isArray(data) ? data : [];
  }

  async loadProductCatalog() {
    const emptyCatalog = {
      byId: new Map(),
      byNormalizedName: new Map()
    };

    if (!this.supabase) {
      return emptyCatalog;
    }

    try {
      const { data, error } = await this.supabase
        .from('products')
        .select('id,name,normalized_name');

      if (error) {
        logger.warn('Supabase error while fetching product catalog for payment report', {
          error: error.message
        });
        return emptyCatalog;
      }

      const catalog = {
        byId: new Map(),
        byNormalizedName: new Map()
      };

      (data || []).forEach((product) => {
        if (!product) {
          return;
        }

        const numericId = Number(product.id);
        const productId = Number.isNaN(numericId) ? product.id : numericId;
        const normalizedFromDb = typeof product.normalized_name === 'string'
          ? normalizeProductKey(product.normalized_name)
          : null;
        const normalizedFromName = product.name ? normalizeProductKey(product.name) : null;

        const normalizedName = normalizedFromDb && normalizedFromDb !== 'без названия'
          ? normalizedFromDb
          : (normalizedFromName && normalizedFromName !== 'без названия' ? normalizedFromName : null);

        const entry = {
          id: productId,
          name: product.name || 'Без названия',
          normalizedName
        };

        if (productId !== null && productId !== undefined && productId !== '') {
          catalog.byId.set(String(productId), entry);
        }
        if (normalizedName) {
          catalog.byNormalizedName.set(normalizedName, entry);
        }
      });

      return catalog;
    } catch (error) {
      logger.warn('Failed to load product catalog for payment report', {
        error: error.message
      });
      return emptyCatalog;
    }
  }

  async getReport(options = {}) {
    try {
      const dateRange = this.resolveDateRange(options);
      const statusScope = this.normalizeStatusScope(options.status);

      const productCatalog = await this.loadProductCatalog();

      // Load payments - handle errors gracefully
      let payments = [];
      try {
        payments = await this.loadPayments({
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
          statusScope,
          productCatalog
        });
      } catch (error) {
        logger.error('Failed to load payments for report', {
          error: error.message,
          stack: error.stack
        });
        // Return empty report instead of failing
        return {
          products: [],
          summary: {
            payments_count: 0,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          },
          filters: {
            dateFrom: dateRange.dateFrom.toISOString(),
            dateTo: dateRange.dateTo.toISOString(),
            status: statusScope
          }
        };
      }

      // Ensure payments is an array
      if (!Array.isArray(payments)) {
        logger.warn('Payments is not an array', { payments: typeof payments });
        payments = [];
      }

      const { ids: proformaIds, fullnumbers: proformaFullnumbers } = this.extractProformaIds(payments);
      
      // Load proformas - handle errors gracefully
      let proformas = [];
      try {
        proformas = await this.loadProformas({ ids: proformaIds, fullnumbers: proformaFullnumbers });
      } catch (error) {
        logger.warn('Failed to load proformas for report', {
          error: error.message,
          proformaIdsCount: proformaIds.length,
          proformaFullnumbersCount: proformaFullnumbers.length
        });
        proformas = [];
      }
      
      const proformaMap = this.mapProformas(proformas);

      // Load product links for Stripe payments
      // Stripe payments have product_id which is product_link.id (UUID), not stripe_product_id
      const stripeProductLinkIds = Array.from(new Set(
        payments
          .filter((p) => p && p.source === 'stripe' && p.stripe_product_id)
          .map((p) => p.stripe_product_id)
      ));
      
      // Also get product_link IDs directly from stripe_payments.product_id
      const directProductLinkIds = Array.from(new Set(
        payments
          .filter((p) => p && p.source === 'stripe' && p.stripe_product_id && typeof p.stripe_product_id === 'string' && p.stripe_product_id.length > 30)
          .map((p) => p.stripe_product_id)
      ));
      
      const allProductLinkIds = [...stripeProductLinkIds, ...directProductLinkIds];
      let productLinksMap = new Map();
      if (allProductLinkIds.length > 0 && this.stripeRepository.isEnabled()) {
        try {
          // listProductLinksByIds returns a Map directly
          productLinksMap = await this.stripeRepository.listProductLinksByIds(allProductLinkIds);
          // Ensure it's a Map
          if (!(productLinksMap instanceof Map)) {
            logger.warn('listProductLinksByIds did not return a Map', {
              type: typeof productLinksMap
            });
            productLinksMap = new Map();
          }
        } catch (error) {
          logger.warn('Failed to load product links for Stripe payments', {
            error: error.message
          });
          productLinksMap = new Map();
        }
      }

      // Aggregate products - ensure it always returns valid structure
      let aggregation;
      try {
        aggregation = await this.aggregateProducts(payments, proformaMap, productLinksMap, productCatalog, dateRange.dateFrom, dateRange.dateTo);
      } catch (error) {
        logger.error('Failed to aggregate products for report', {
          error: error.message,
          stack: error.stack,
          paymentsCount: payments.length
        });
        // Return empty aggregation on error
        aggregation = {
          products: [],
          summary: {
            payments_count: payments.length,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          }
        };
      }

      // Ensure aggregation structure is valid
      if (!aggregation || typeof aggregation !== 'object') {
        logger.warn('Invalid aggregation result', { aggregation });
        aggregation = {
          products: [],
          summary: {
            payments_count: payments.length,
            products_count: 0,
            currency_totals: {},
            total_pln: 0,
            unmatched_count: 0
          }
        };
      }

      return {
        products: Array.isArray(aggregation.products) ? aggregation.products : [],
        summary: aggregation.summary || {
          payments_count: payments.length,
          products_count: 0,
          currency_totals: {},
          total_pln: 0,
          unmatched_count: 0
        },
        filters: {
          dateFrom: dateRange.dateFrom.toISOString(),
          dateTo: dateRange.dateTo.toISOString(),
          status: statusScope
        }
      };
    } catch (error) {
      logger.error('Error in getReport', {
        error: error.message,
        stack: error.stack,
        options
      });
      // Return empty report instead of throwing
      const dateRange = this.resolveDateRange(options);
      const statusScope = this.normalizeStatusScope(options.status);
      return {
        products: [],
        summary: {
          payments_count: 0,
          products_count: 0,
          currency_totals: {},
          total_pln: 0,
          unmatched_count: 0
        },
        filters: {
          dateFrom: dateRange.dateFrom.toISOString(),
          dateTo: dateRange.dateTo.toISOString(),
          status: statusScope
        }
      };
    }
  }

  async exportCsv(options = {}) {
    const report = await this.getReport(options);
    const rows = [];

    (report.products || []).forEach((group) => {
      (group.entries || []).forEach((entry) => {
        const proforma = entry.proforma || null;
        const buyer = proforma?.buyer?.name || proforma?.buyer?.alt_name || '';
        const amountPln = toNumber(entry.totals?.pln_total);
        const totalPln = toNumber(proforma?.payment_summary?.total_pln ?? proforma?.total_pln);
        const defaultCurrency = proforma?.currency || Object.keys(entry.totals?.currency_totals || {})[0] || 'PLN';
        const amountInDefaultCurrency = toNumber(entry.totals?.currency_totals?.[defaultCurrency]);
        const row = [
          escapeCsv(group.key || ''),
          escapeCsv(group.name || ''),
          escapeCsv(entry.proforma ? entry.proforma.id || '' : ''),
          escapeCsv(entry.first_payment_date || ''),
          escapeCsv(entry.payer_names && entry.payer_names.length ? entry.payer_names.join(', ') : ''),
          escapeCsv(buyer),
          escapeCsv(Number.isFinite(amountInDefaultCurrency) ? amountInDefaultCurrency.toFixed(2) : ''),
          escapeCsv(defaultCurrency),
          escapeCsv(Number.isFinite(amountPln) ? amountPln.toFixed(2) : ''),
          escapeCsv(entry.status?.label || ''),
          escapeCsv(proforma?.fullnumber || ''),
          escapeCsv(proforma?.issued_at || ''),
          escapeCsv(Number.isFinite(totalPln)
            ? totalPln.toFixed(2)
            : ''),
          escapeCsv(proforma?.pipedrive_deal_id || ''),
          escapeCsv(proforma?.pipedrive_deal_url || '')
        ];
        rows.push(row.join(','));

      });
    });

    const header = [
      'product_key',
      'product_name',
      'proforma_id',
      'first_payment_date',
      'payer',
      'buyer',
      'amount',
      'currency',
      'amount_pln',
      'payment_status',
      'proforma_fullnumber',
      'proforma_issue_date',
      'proforma_total_pln',
      'deal_id',
      'deal_url'
    ].join(',');

    return `${header}\n${rows.join('\n')}`;
  }
}

module.exports = PaymentRevenueReportService;
