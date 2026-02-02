const logger = require('../../utils/logger');
const StripeRepository = require('./repository');
const PaymentScheduleService = require('./paymentScheduleService');
const PaymentStateAnalyzer = require('./paymentStateAnalyzer');
const DealAmountCalculator = require('./dealAmountCalculator');
const PipedriveClient = require('../pipedrive');
const { getStripeClient } = require('./client');
const { roundBankers, toMinorUnit, normaliseCurrency } = require('../../utils/currency');
const { extractCashFields } = require('../cash/cashFieldParser');
const ValidationService = require('../microservices/validationService');

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
    this.validationService = options.validationService || new ValidationService({ logger: this.logger });
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

      // 2. Получить данные клиента (нужны для валидации)
      const person = fullDealResult.person;
      const organization = fullDealResult.organization;
      const customerEmail = person?.email?.[0]?.value || person?.email || 
                           organization?.email?.[0]?.value || organization?.email || null;

      // 2.5. РАННЯЯ ВАЛИДАЦИЯ - проверяем базовые поля ДО получения продуктов
      // Это позволяет валидировать все поля, включая отсутствие продуктов
      
      // Получаем продукты для валидации (но не останавливаемся если их нет)
      const dealProductsResult = await this.pipedriveClient.getDealProducts(dealId);
      const products = dealProductsResult.success && dealProductsResult.products ? dealProductsResult.products : [];
      const firstProduct = products.length > 0 ? products[0] : null;

      // Определяем график платежей (нужен для расчета суммы)
      let schedule = null;
      if (paymentSchedule) {
        const closeDate = fullDeal.expected_close_date || fullDeal.close_date;
        schedule = this.scheduleService.determineSchedule(closeDate, new Date(), { dealId });
        schedule.schedule = paymentSchedule;
      } else {
        schedule = this.scheduleService.determineScheduleFromDeal(fullDeal);
      }

      // Рассчитываем сумму платежа (может быть 0 если нет продуктов, но это валидируется)
      let paymentAmount = 0;
      if (customAmount && customAmount > 0) {
        paymentAmount = customAmount;
      } else if (products.length > 0) {
        paymentAmount = this.amountCalculator.calculatePaymentAmount(
          fullDeal,
          products,
          schedule.schedule,
          paymentType
        );
      }

      // Получаем валюту
      const rawCurrency = fullDeal.currency || 'PLN';
      const currency = normaliseCurrency(rawCurrency);

      // ВАЛИДАЦИЯ ДАННЫХ ПЕРЕД СОЗДАНИЕМ СЕССИИ
      // ВАЖНО: Валидация выполняется ПЕРЕД созданием Stripe Checkout Session,
      // когда менеджер создает сессию, а не когда клиент оплачивает
      
      // Определяем тип клиента (B2B или B2C)
      const isB2B = Boolean(organization || fullDeal.organization_id);
      const organizationId = fullDeal.organization_id || organization?.id;

      // Подготовка данных для валидации
      const validationData = {
        deal_id: String(dealId),
        email: customerEmail,
        amount: paymentAmount,
        currency: currency,
        deal_amount: parseFloat(fullDeal.value) || null,
        deal_status: fullDeal.status,
        deal_deleted: fullDeal.deleted,
        product: firstProduct ? {
          id: firstProduct.product_id || firstProduct.product?.id,
          name: firstProduct.name || firstProduct.product?.name || fullDeal.title,
          price: paymentAmount,
          quantity: parseFloat(firstProduct.quantity) || 1
        } : null,
        address: {
          street: person?.address_street || organization?.address_street || null,
          city: person?.address_city || organization?.address_city || null,
          postal_code: person?.address_postal_code || organization?.address_postal_code || null,
          country: person?.address_country || organization?.address_country || null,
          validated: false
        },
        customer_name: person?.name || organization?.name || null,
        customer_type: isB2B ? 'company' : 'person',
        organization_id: organizationId,
        organization: organization ? {
          id: organization.id,
          name: organization.name,
          nip: organization.nip,
          tax_id: organization.tax_id,
          vat_number: organization.vat_number
        } : null,
        company_name: organization?.name || null,
        company_tax_id: organization?.nip || organization?.tax_id || organization?.vat_number || null,
        // Notification channels
        sendpulse_id: person?.custom_fields?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'] || null,
        telegram_chat_id: person?.custom_fields?.[process.env.PIPEDRIVE_TELEGRAM_CHAT_ID_FIELD_KEY] || null,
        person: person ? {
          sendpulse_id: person.custom_fields?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'],
          telegram_chat_id: person.custom_fields?.[process.env.PIPEDRIVE_TELEGRAM_CHAT_ID_FIELD_KEY]
        } : null,
        payment_type: paymentType,
        payment_schedule: schedule.schedule
      };

      // Выполняем валидацию
      const validationResult = await this.validationService.validateSessionData(validationData);

      // Обработка ошибок валидации (блокируют создание сессии)
      if (!validationResult.valid) {
        // Сохраняем ошибки в БД
        await this.validationService.saveValidationError(
          dealId,
          'session_creation',
          validationResult,
          validationData
        );

        // Формируем сообщение об ошибках для менеджера с улучшенным форматированием на русском языке
        // Маппинг полей на русские названия
        const fieldNamesRu = {
          'product': 'Продукт',
          'amount': 'Сумма платежа',
          'address': 'Адрес клиента',
          'customer_name': 'Имя клиента',
          'email': 'Email клиента',
          'currency': 'Валюта',
          'deal_id': 'ID сделки',
          'organization': 'Организация (B2B)',
          'company_tax_id': 'Business ID (NIP/VAT)',
          'company_name': 'Название компании',
          'deal_status': 'Статус сделки'
        };

        // Маппинг сообщений об ошибках на русский язык
        const getErrorMessageRu = (error) => {
          const fieldRu = fieldNamesRu[error.field] || error.field;
          
          if (error.code === 'REQUIRED_FIELD') {
            if (error.field === 'product') return 'Не указан продукт в сделке';
            if (error.field === 'amount') return 'Не указана сумма платежа';
            if (error.field === 'address') return 'Не указан адрес клиента';
            if (error.field === 'customer_name') return 'Не указано имя клиента';
            if (error.field === 'email') return 'Не указан email клиента';
            if (error.field === 'currency') return 'Не указана валюта';
            if (error.field === 'organization') return 'Не указана организация в CRM (требуется для B2B)';
            if (error.field === 'company_tax_id') return 'Не указан Business ID (NIP/VAT) (требуется для B2B)';
            if (error.field === 'company_name') return 'Не указано название компании (требуется для B2B)';
            return `${fieldRu} не указано`;
          }
          
          if (error.code === 'INVALID_VALUE') {
            if (error.field === 'amount') return 'Сумма должна быть больше нуля';
            if (error.field === 'currency') return 'Неподдерживаемая валюта';
            return `${fieldRu} имеет некорректное значение`;
          }
          
          if (error.code === 'INVALID_TYPE') {
            return `${fieldRu} имеет некорректный тип данных`;
          }
          
          if (error.code === 'INVALID_FORMAT') {
            if (error.field === 'email') return 'Некорректный формат email';
            return `${fieldRu} имеет некорректный формат`;
          }
          
          if (error.code === 'INVALID_DEAL_STATUS') {
            return 'Сделка закрыта или удалена, нельзя создать сессию';
          }
          
          if (error.code === 'AMOUNT_EXCEEDS_DEAL') {
            return 'Сумма платежа превышает сумму сделки';
          }
          
          if (error.code === 'INCOMPLETE_ADDRESS') {
            return 'Адрес неполный (для VAT требуется: улица, город, почтовый индекс)';
          }
          
          // Fallback на оригинальное сообщение, если нет перевода
          return error.message;
        };

        // Формируем список ошибок - одна ошибка на строку
        const errorMessagesRu = validationResult.errors.map((e, index) => {
          const fieldRu = fieldNamesRu[e.field] || e.field;
          const messageRu = getErrorMessageRu(e);
          return `${index + 1}. ${fieldRu}: ${messageRu}`;
        }).join('\n');

        // Формируем список недостающих полей
        const missingFieldsRu = validationResult.missing_fields.length > 0
          ? validationResult.missing_fields.map(f => fieldNamesRu[f] || f).join(', ')
          : '';

        // Формируем список некорректных полей
        const invalidFieldsRu = validationResult.invalid_fields.length > 0
          ? validationResult.invalid_fields.map(f => fieldNamesRu[f] || f).join(', ')
          : '';

        // Формируем итоговое сообщение с улучшенным форматированием
        // Используем двойные переносы строк для разделения секций
        let taskMessage = '❌ Ошибки валидации при создании платежной сессии\n\n';
        taskMessage += 'Обнаружены следующие ошибки:\n';
        taskMessage += errorMessagesRu;
        
        if (missingFieldsRu) {
          taskMessage += `\n\n📋 Недостающие поля: ${missingFieldsRu}`;
        }
        
        if (invalidFieldsRu) {
          taskMessage += `\n\n⚠️ Некорректные поля: ${invalidFieldsRu}`;
        }
        
        taskMessage += '\n\n💡 Действия:\n';
        taskMessage += '1. Исправьте указанные ошибки в сделке\n';
        taskMessage += '2. Перезапустите создание платежной сессии';

        // Создаем задачу в CRM для менеджера
        try {
          // Используем owner_id сделки вместо user_id (owner_id может быть объектом или ID)
          const taskOwnerId = (fullDeal.owner_id?.id || fullDeal.owner_id) || (fullDeal.user_id?.id || fullDeal.user_id) || null;
          
          await this.pipedriveClient.createTask({
            deal_id: dealId,
            subject: 'Ошибки валидации при создании платежной сессии',
            note: taskMessage,
            public_description: taskMessage, // Дублируем в public_description для отображения в интерфейсе
            type: 'task',
            due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Завтра
            assigned_to_user_id: taskOwnerId, // Используем owner_id вместо user_id
            person_id: person?.id || null
          });
          
          this.logger.info('Validation error task created in CRM', { dealId, taskOwnerId });
        } catch (taskError) {
          // Если не удалось создать с assigned_to_user_id, пробуем без него
          try {
            await this.pipedriveClient.createTask({
              deal_id: dealId,
              subject: 'Ошибки валидации при создании платежной сессии',
              note: taskMessage,
              public_description: taskMessage, // Используем public_description для лучшего форматирования
              type: 'task',
              due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              // Не указываем assigned_to_user_id - задача будет назначена текущему пользователю API
              person_id: person?.id || null
            });
            this.logger.info('Validation error task created in CRM (without assigned user)', { dealId });
          } catch (retryError) {
            this.logger.warn('Failed to create validation error task in CRM', {
              dealId,
              error: retryError.message,
              originalError: taskError.message
            });
          }
        }

        return {
          success: false,
          error: 'Validation failed',
          validation_errors: validationResult.errors,
          missing_fields: validationResult.missing_fields,
          invalid_fields: validationResult.invalid_fields,
          field_errors: validationResult.field_errors
        };
      }

      // Обработка предупреждений валидации (НЕ блокируют создание сессии)
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        // Сохраняем предупреждения в БД
        await this.validationService.saveValidationWarning(
          dealId,
          'session_creation',
          validationResult.warnings,
          validationData
        );

        // Логируем предупреждения
        this.logger.warn('Validation warnings (non-blocking)', {
          dealId,
          warnings: validationResult.warnings.map(w => `${w.field}: ${w.message}`)
        });

        // Создаем задачу в CRM для менеджера о предупреждениях
        // Маппинг полей на русские названия
        const fieldNamesRu = {
          'notification_channel_id': 'Каналы уведомлений'
        };
        
        const warningMessagesRu = validationResult.warnings.map((w, index) => {
          const fieldRu = fieldNamesRu[w.field] || w.field;
          let messageRu = w.message;
          
          if (w.field === 'notification_channel_id') {
            messageRu = 'Не указан SendPulse ID или Telegram Chat ID. Уведомления будут отправляться только по email. Рекомендуется добавить SendPulse ID или Telegram Chat ID для улучшения коммуникации.';
          }
          
          return `${index + 1}. ${fieldRu}: ${messageRu}`;
        }).join('\n');
        try {
          // Используем owner_id сделки вместо user_id (owner_id может быть объектом или ID)
          const taskOwnerId = (fullDeal.owner_id?.id || fullDeal.owner_id) || (fullDeal.user_id?.id || fullDeal.user_id) || null;
          
          const warningTaskMessage = `⚠️ Предупреждения при создании платежной сессии<br><br><strong>Обнаружены следующие предупреждения:</strong><br>${warningMessagesRu.replace(/\n/g, '<br>')}<br><br>✅ Сессия создана успешно, но рекомендуется исправить предупреждения для улучшения качества данных.`;
          
          await this.pipedriveClient.createTask({
            deal_id: dealId,
            subject: 'Предупреждения валидации: отсутствуют каналы уведомлений',
            note: warningTaskMessage,
            public_description: warningTaskMessage, // Используем public_description для лучшего форматирования
            type: 'task',
            due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Через неделю
            assigned_to_user_id: taskOwnerId,
            person_id: person?.id || null
          });
          
          this.logger.info('Validation warning task created in CRM', { dealId, taskOwnerId });
        } catch (taskError) {
          // Если не удалось создать с assigned_to_user_id, пробуем без него
          try {
            await this.pipedriveClient.createTask({
              deal_id: dealId,
              subject: 'Предупреждения валидации: отсутствуют каналы уведомлений',
              note: `Предупреждения при создании платежной сессии:\n\n${warningMessages}\n\nСессия создана успешно, но рекомендуется добавить SendPulse ID или Telegram Chat ID для лучшей коммуникации с клиентом.`,
              type: 'task',
              due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
              person_id: person?.id || null
            });
            this.logger.info('Validation warning task created in CRM (without assigned user)', { dealId });
          } catch (retryError) {
            this.logger.warn('Failed to create validation warning task in CRM', {
              dealId,
              error: retryError.message,
              originalError: taskError.message
            });
          }
        }
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

