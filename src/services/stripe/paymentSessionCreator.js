const logger = require('../../utils/logger');
const StripeRepository = require('./repository');
const PaymentScheduleService = require('./paymentScheduleService');
const PaymentStateAnalyzer = require('./paymentStateAnalyzer');
const DealAmountCalculator = require('./dealAmountCalculator');
const PipedriveClient = require('../pipedrive');
const { getStripeClient } = require('./client');
const { roundBankers, toMinorUnit, normaliseCurrency } = require('../../utils/currency');
const { extractCashFields } = require('../cash/cashFieldParser');

/**
 * PaymentSessionCreator
 * 
 * Унифицированный сервис для создания Stripe Checkout Sessions.
 * Заменяет дублирующуюся логику создания сессий в processor.js и pipedriveWebhook.js
 * 
 * Использует:
 * - PaymentScheduleService для определения графика платежей
 * - PaymentStateAnalyzer для анализа состояния платежей
 * - DealAmountCalculator для расчета сумм
 * 
 * @see docs/stripe-payment-logic-code-review.md - раздел "Дублирование логики создания сессий"
 */
class PaymentSessionCreator {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.repository = options.repository || new StripeRepository();
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.stripe = options.stripe || getStripeClient();
    this.mode = 'live'; // Всегда live режим
    this.checkoutSuccessUrl = process.env.STRIPE_CHECKOUT_SUCCESS_URL || 'https://comoon.io/comoonity/';
    this.checkoutCancelUrl = process.env.STRIPE_CHECKOUT_CANCEL_URL || this.checkoutSuccessUrl;
    this.invoiceTypeFieldKey = process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    this.invoiceDoneValue = String(process.env.PIPEDRIVE_INVOICE_DONE_VALUE || '73');
    
    // Initialize services
    this.scheduleService = PaymentScheduleService;
    this.stateAnalyzer = new PaymentStateAnalyzer({
      repository: this.repository,
      stripe: this.stripe,
      logger: this.logger
    });
    this.amountCalculator = DealAmountCalculator;
  }

  /**
   * Создать Checkout Session для сделки
   * 
   * @param {Object} deal - Объект сделки (из webhook или API)
   * @param {Object} options - Опции создания сессии
   * @param {string} options.paymentType - Тип платежа ('deposit', 'rest', 'single')
   * @param {string} options.paymentSchedule - График платежей ('50/50' или '100%')
   * @param {number} options.customAmount - Кастомная сумма (для rest после deposit)
   * @param {string} options.trigger - Триггер создания ('pipedrive_webhook', 'cron', etc.)
   * @param {string} options.runId - ID запуска для логирования
   * @param {boolean} options.skipNotification - Пропустить отправку уведомления
   * @returns {Promise<Object>} - Результат создания сессии
   */
  async createSession(deal, options = {}) {
    const {
      paymentType,
      paymentSchedule,
      customAmount,
      trigger = 'manual',
      runId = null,
      skipNotification = false
    } = options;

    const dealId = deal.id;
    const startTime = Date.now();

    try {
      this.logger.info(`🔄 [Deal #${dealId}] Creating Checkout Session`, {
        paymentType,
        paymentSchedule,
        trigger
      });

      // 1. Получить полные данные сделки из API
      const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      if (!fullDealResult.success || !fullDealResult.deal) {
        return {
          success: false,
          error: `Failed to fetch deal: ${fullDealResult.error || 'unknown'}`
        };
      }

      const fullDeal = fullDealResult.deal;
      
      // Мержим данные из webhook в fullDeal (приоритет у API данных)
      if (deal && deal !== fullDeal) {
        Object.keys(deal).forEach(key => {
          const webhookValue = deal[key];
          const apiValue = fullDeal[key];
          if (webhookValue !== null && webhookValue !== undefined && webhookValue !== '' && 
              (apiValue === null || apiValue === undefined || apiValue === '')) {
            fullDeal[key] = webhookValue;
          }
        });
      }

      // 2. Определить график платежей
      let schedule = null;
      if (paymentSchedule) {
        // Если график передан явно, используем его
        const closeDate = fullDeal.expected_close_date || fullDeal.close_date;
        schedule = this.scheduleService.determineSchedule(closeDate, new Date(), { dealId });
        schedule.schedule = paymentSchedule; // Переопределяем график
      } else {
        // Определяем график автоматически
        schedule = this.scheduleService.determineScheduleFromDeal(fullDeal);
      }

      // 3. Получить продукты сделки
      const dealProductsResult = await this.pipedriveClient.getDealProducts(dealId);
      if (!dealProductsResult.success || !dealProductsResult.products || dealProductsResult.products.length === 0) {
        return {
          success: false,
          error: 'No products found in deal'
        };
      }

      const products = dealProductsResult.products;
      const firstProduct = products[0];

      // 4. Рассчитать сумму платежа
      let paymentAmount;
      if (customAmount && customAmount > 0) {
        paymentAmount = customAmount;
        this.logger.debug('Using custom amount for payment', {
          dealId,
          customAmount,
          paymentType
        });
      } else {
        paymentAmount = this.amountCalculator.calculatePaymentAmount(
          fullDeal,
          products,
          schedule.schedule,
          paymentType
        );
      }

      // 5. Получить валюту
      const rawCurrency = fullDeal.currency || 'PLN';
      const currency = normaliseCurrency(rawCurrency);

      // 6. Получить данные клиента
      const person = fullDealResult.person;
      const organization = fullDealResult.organization;
      const customerEmail = person?.email?.[0]?.value || person?.email || 
                           organization?.email?.[0]?.value || organization?.email || null;

      if (!customerEmail) {
        return {
          success: false,
          error: 'No email found for customer'
        };
      }

      // 7. Получить или создать Stripe Product
      const stripeProductId = await this._getOrCreateStripeProduct(
        dealId,
        firstProduct,
        fullDeal,
        currency
      );

      if (!stripeProductId) {
        return {
          success: false,
          error: 'Failed to get or create Stripe product'
        };
      }

      // 8. Подготовить параметры сессии
      const sessionParams = await this._prepareSessionParams({
        dealId,
        fullDeal,
        person,
        organization,
        customerEmail,
        paymentAmount,
        currency,
        paymentType,
        paymentSchedule: schedule.schedule,
        stripeProductId,
        firstProduct,
        trigger,
        runId
      });

      // 9. Создать сессию в Stripe
      const session = await this.stripe.checkout.sessions.create(sessionParams);

      // 10. Сохранить платеж в БД
      const paymentRecord = await this._savePaymentRecord({
        dealId,
        session,
        paymentType,
        paymentSchedule: schedule.schedule,
        paymentAmount,
        currency,
        trigger,
        runId
      });

      // 11. Обновить invoice_type в CRM (если нужно)
      if (paymentRecord) {
        await this._updateInvoiceType(dealId, paymentRecord.id);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      this.logger.info(`✅ [Deal #${dealId}] Checkout Session created`, {
        sessionId: session.id,
        paymentType,
        amount: paymentAmount,
        currency,
        duration: `${duration}s`
      });

      return {
        success: true,
        sessionId: session.id,
        sessionUrl: session.url,
        amount: paymentAmount,
        currency,
        paymentType,
        paymentSchedule: schedule.schedule,
        paymentRecordId: paymentRecord?.id || null
      };
    } catch (error) {
      this.logger.error(`❌ [Deal #${dealId}] Failed to create Checkout Session`, {
        error: error.message,
        stack: error.stack,
        paymentType,
        paymentSchedule
      });

      return {
        success: false,
        error: error.message,
        details: error.stack
      };
    }
  }

  /**
   * Получить или создать Stripe Product
   * 
   * @private
   */
  async _getOrCreateStripeProduct(dealId, firstProduct, deal, currency) {
    const crmProductId = firstProduct.product_id || firstProduct.product?.id || null;
    const productName = firstProduct.name || firstProduct.product?.name || deal.title || 'Camp / Tourist service';

    // 1. Проверить product link в БД
    let productLink = null;
    if (crmProductId) {
      productLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
    }

    let stripeProductId = null;
    if (productLink?.stripe_product_id) {
      // Проверить, существует ли продукт в Stripe
      try {
        await this.stripe.products.retrieve(productLink.stripe_product_id);
        stripeProductId = productLink.stripe_product_id;
      } catch (error) {
        this.logger.warn('Stripe product from link not found, searching by CRM ID', {
          oldProductId: productLink.stripe_product_id,
          error: error.message
        });
        productLink = null;
      }
    }

    // 2. Поиск по CRM ID в metadata
    if (!stripeProductId && crmProductId) {
      try {
        const products = await this.stripe.products.list({ limit: 100 });
        const matchingProduct = products.data.find(p => 
          p.metadata?.crm_product_id === String(crmProductId)
          // Убрали проверку mode, так как работаем только в live режиме
        );
        if (matchingProduct) {
          stripeProductId = matchingProduct.id;
          // Обновить product link
          if (productLink) {
            await this.repository.upsertProductLink({
              crmProductId: String(crmProductId),
              crmProductName: productName,
              stripeProductId,
              campProductId: null,
              status: 'active'
            });
          }
        }
      } catch (error) {
        this.logger.warn('Failed to search for existing product', {
          crmProductId,
          error: error.message
        });
      }
    }

    // 3. Создать новый продукт, если не найден
    if (!stripeProductId) {
      this.logger.info('Creating new Stripe product', {
        productName,
        crmProductId: crmProductId || 'none'
      });

      const stripeProduct = await this.stripe.products.create({
        name: productName,
        description: `Camp product: ${productName}`,
        metadata: {
          crm_product_id: crmProductId ? String(crmProductId) : null,
          deal_id: String(dealId),
          created_by: 'payment_session_creator'
          // Убрали mode из metadata, так как работаем только в live режиме
        }
      });
      stripeProductId = stripeProduct.id;

      // Сохранить product link
      if (crmProductId) {
        await this.repository.upsertProductLink({
          crmProductId: String(crmProductId),
          crmProductName: productName,
          stripeProductId,
          campProductId: null,
          status: 'active'
        });
      }
    }

    return stripeProductId;
  }

  /**
   * Подготовить параметры для создания сессии
   * 
   * @private
   */
  async _prepareSessionParams({
    dealId,
    fullDeal,
    person,
    organization,
    customerEmail,
    paymentAmount,
    currency,
    paymentType,
    paymentSchedule,
    stripeProductId,
    firstProduct,
    trigger,
    runId
  }) {
    const quantity = parseFloat(firstProduct.quantity) || 1;
    const amountInMinorUnits = toMinorUnit(paymentAmount, currency);

    // Line item
    const lineItem = {
      price_data: {
        currency: currency.toLowerCase(),
        product: stripeProductId,
        unit_amount: amountInMinorUnits
      },
      quantity
    };

    // Metadata
    const crmProductId = firstProduct.product_id || firstProduct.product?.id || null;
    let productLinkId = null;
    if (crmProductId) {
      const existingLink = await this.repository.findProductLinkByCrmId(String(crmProductId));
      if (existingLink?.id) {
        productLinkId = existingLink.id;
      }
    }

    const productName = firstProduct.name || firstProduct.product?.name || fullDeal.title || 'Camp / Tourist service';
    const metadata = {
      deal_id: String(dealId),
      product_id: crmProductId ? String(crmProductId) : null,
      product_link_id: productLinkId ? String(productLinkId) : null,
      payment_id: `deal_${dealId}_${Date.now()}`,
      payment_type: paymentType || 'deposit',
      payment_schedule: paymentSchedule || '100%',
      payment_part: paymentSchedule === '50/50' 
        ? (paymentType === 'deposit' ? '1 of 2' : '2 of 2') 
        : '1 of 1',
      created_by: 'payment_session_creator',
      trigger,
      run_id: runId || null
    };

    // Session parameters
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [lineItem],
      metadata,
      success_url: this._buildCheckoutUrl(this.checkoutSuccessUrl, dealId, 'success'),
      cancel_url: this._buildCheckoutUrl(this.checkoutCancelUrl, dealId, 'cancel'),
      customer_email: customerEmail,
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: productName
        }
      },
      customer_update: {
        name: 'auto',
        address: 'auto'
      }
    };

    return sessionParams;
  }

  /**
   * Сохранить запись о платеже в БД
   * 
   * @private
   */
  async _savePaymentRecord({
    dealId,
    session,
    paymentType,
    paymentSchedule,
    paymentAmount,
    currency,
    trigger,
    runId
  }) {
    try {
      const paymentRecord = await this.repository.createPayment({
        deal_id: String(dealId),
        session_id: session.id,
        checkout_url: session.url,
        payment_type: paymentType,
        payment_schedule: paymentSchedule,
        original_amount: paymentAmount,
        currency: currency,
        payment_status: 'unpaid',
        metadata: {
          trigger,
          run_id: runId,
          created_at: new Date().toISOString()
        }
      });

      return paymentRecord;
    } catch (error) {
      this.logger.error('Failed to save payment record', {
        dealId,
        sessionId: session.id,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Обновить invoice_type в CRM
   * 
   * @private
   */
  async _updateInvoiceType(dealId, paymentRecordId) {
    try {
      // Логика обновления invoice_type (если нужно)
      // Пока оставляем пустым, так как это может быть специфично для проекта
      this.logger.debug('Invoice type update skipped (to be implemented)', {
        dealId,
        paymentRecordId
      });
    } catch (error) {
      this.logger.warn('Failed to update invoice type', {
        dealId,
        error: error.message
      });
    }
  }

  /**
   * Построить URL для checkout
   * 
   * @private
   */
  _buildCheckoutUrl(baseUrl, dealId, status) {
    const url = new URL(baseUrl);
    url.searchParams.set('deal_id', String(dealId));
    url.searchParams.set('status', status);
    return url.toString();
  }
}

module.exports = PaymentSessionCreator;

