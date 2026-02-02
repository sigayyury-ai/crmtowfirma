const BaseMicroservice = require('./baseMicroservice');
const supabase = require('../supabaseClient');

/**
 * ValidationService
 * 
 * Микросервис для валидации данных перед созданием Stripe Checkout Session.
 * Проверяет обязательные поля, B2B-специфичные поля и генерирует предупреждения
 * для отсутствующих каналов уведомлений без блокировки создания сессии.
 */
class ValidationService extends BaseMicroservice {
  constructor(options = {}) {
    super(options);
    this.supabase = options.supabase || supabase;
  }

  /**
   * Валидация данных для создания Stripe Checkout Session
   * 
   * ВАЖНО: Валидация выполняется ПЕРЕД созданием Stripe Checkout Session,
   * когда менеджер создает сессию, а не когда клиент оплачивает.
   * 
   * @param {Object} data - Данные для валидации
   * @param {string} data.deal_id - ID сделки в Pipedrive
   * @param {string} data.email - Email клиента
   * @param {number} data.amount - Сумма платежа
   * @param {string} data.currency - Валюта (PLN, EUR, USD, GBP)
   * @param {Object} data.product - Продукт сделки
   * @param {Object} data.address - Адрес клиента
   * @param {string} data.customer_name - Имя клиента
   * @param {string} data.customer_type - Тип клиента ('person' или 'company')
   * @param {string} data.organization_id - ID организации (для B2B)
   * @param {Object} data.organization - Данные организации (для B2B)
   * @param {string} data.sendpulse_id - SendPulse ID (опционально)
   * @param {string} data.telegram_chat_id - Telegram Chat ID (опционально)
   * @returns {Promise<Object>} Результат валидации с errors и warnings
   */
  async validateSessionData(data) {
    this.log('debug', 'Validating session data', { deal_id: data.deal_id });

    const errors = [];
    const fieldErrors = {};
    const missingFields = [];
    const invalidFields = [];

    // 1. Проверка обязательных полей - Deal ID
    if (!data.deal_id) {
      errors.push({ field: 'deal_id', message: 'deal_id is required', code: 'REQUIRED_FIELD' });
      missingFields.push('deal_id');
    }

    // 2. Проверка статуса сделки
    if (data.deal_status === 'lost' || data.deal_status === 'deleted' || data.deal_deleted === true) {
      errors.push({ 
        field: 'deal_status', 
        message: `Deal is ${data.deal_status || 'deleted'}, cannot create checkout session`, 
        code: 'INVALID_DEAL_STATUS' 
      });
      invalidFields.push('deal_status');
      fieldErrors.deal_status = `Deal status is ${data.deal_status || 'deleted'}`;
    }

    // 3. Проверка продукта (ОБЯЗАТЕЛЬНО)
    if (!data.product || !data.product.id) {
      errors.push({ 
        field: 'product', 
        message: 'Product is required - deal must have at least one product', 
        code: 'REQUIRED_FIELD' 
      });
      missingFields.push('product');
    } else {
      // Дополнительная проверка названия продукта
      if (!data.product.name || String(data.product.name).trim() === '') {
        errors.push({ 
          field: 'product', 
          message: 'Product name is required', 
          code: 'REQUIRED_FIELD' 
        });
        invalidFields.push('product');
        fieldErrors.product = 'Product name is required';
      }
    }

    // 4. Проверка цены (ОБЯЗАТЕЛЬНО)
    if (data.amount === null || data.amount === undefined) {
      errors.push({ field: 'amount', message: 'amount is required', code: 'REQUIRED_FIELD' });
      missingFields.push('amount');
    } else if (isNaN(data.amount)) {
      errors.push({ field: 'amount', message: 'amount must be a number', code: 'INVALID_TYPE' });
      invalidFields.push('amount');
      fieldErrors.amount = 'amount must be a number';
    } else if (data.amount <= 0) {
      errors.push({ field: 'amount', message: 'amount must be positive', code: 'INVALID_VALUE' });
      invalidFields.push('amount');
      fieldErrors.amount = 'amount must be positive';
    } else if (data.deal_amount && data.amount > data.deal_amount) {
      errors.push({ 
        field: 'amount', 
        message: `amount (${data.amount}) exceeds deal amount (${data.deal_amount})`, 
        code: 'AMOUNT_EXCEEDS_DEAL' 
      });
      invalidFields.push('amount');
      fieldErrors.amount = `Amount exceeds deal amount`;
    }

    // 5. Проверка адреса (ОБЯЗАТЕЛЬНО)
    if (!data.address) {
      errors.push({ 
        field: 'address', 
        message: 'Address is required - customer address must be specified', 
        code: 'REQUIRED_FIELD' 
      });
      missingFields.push('address');
    } else {
      // Проверка страны в адресе
      if (!data.address.country || String(data.address.country).trim() === '') {
        errors.push({ 
          field: 'address', 
          message: 'Address country is required', 
          code: 'REQUIRED_FIELD' 
        });
        invalidFields.push('address');
        fieldErrors.address = 'Address country is required';
      }
      // Для VAT-требуемых стран (PL) проверяем полноту адреса
      if (data.address.country === 'PL' && (!data.address.street || !data.address.city || !data.address.postal_code)) {
        errors.push({ 
          field: 'address', 
          message: 'Complete address is required for VAT (PL) - street, city, postal_code', 
          code: 'INCOMPLETE_ADDRESS' 
        });
        invalidFields.push('address');
        fieldErrors.address = 'Complete address required for VAT';
      }
    }

    // 6. Проверка имени клиента (ОБЯЗАТЕЛЬНО)
    if (!data.customer_name || String(data.customer_name).trim() === '') {
      errors.push({ 
        field: 'customer_name', 
        message: 'Customer name is required - Person name or Organization name must be specified', 
        code: 'REQUIRED_FIELD' 
      });
      missingFields.push('customer_name');
    }

    // 7. Проверка B2B специфичных полей (если это B2B сделка)
    // ВАЖНО: B2B валидация включается ТОЛЬКО если есть organization_id (не пустой, не 0, не null)
    // customer_type === 'company' сам по себе не достаточен для B2B валидации
    const hasOrganizationId = data.organization_id && 
                               data.organization_id !== '0' && 
                               data.organization_id !== null && 
                               data.organization_id !== '';
    const isB2B = hasOrganizationId || (data.organization && data.organization.id);
    
    if (isB2B) {
      // Если isB2B = true, значит organization_id уже есть, можно сразу проверять B2B-специфичные поля
      
      // Проверка Business ID (NIP/VAT)
      const businessId = data.company_tax_id || 
                        data.organization?.nip || 
                        data.organization?.tax_id || 
                        data.organization?.vat_number;
      
      if (!businessId || String(businessId).trim() === '') {
        errors.push({ 
          field: 'company_tax_id', 
          message: 'Business ID (NIP/VAT) is required for B2B deals', 
          code: 'REQUIRED_FIELD' 
        });
        missingFields.push('company_tax_id');
        fieldErrors.company_tax_id = 'Business ID (NIP/VAT) is required for B2B deals';
      }

      // Проверка названия компании
      const companyName = data.company_name || data.organization?.name;
      if (!companyName || String(companyName).trim() === '') {
        errors.push({ 
          field: 'company_name', 
          message: 'Company name is required for B2B deals', 
          code: 'REQUIRED_FIELD' 
        });
        missingFields.push('company_name');
        fieldErrors.company_name = 'Company name is required for B2B deals';
      }

      // Для B2B адрес должен быть полным (особенно для PL)
      if (data.address && data.address.country === 'PL') {
        if (!data.address.street || !data.address.city || !data.address.postal_code) {
          errors.push({ 
            field: 'address', 
            message: 'Complete address is required for B2B deals in Poland (street, city, postal_code)', 
            code: 'INCOMPLETE_ADDRESS' 
          });
          invalidFields.push('address');
          fieldErrors.address = 'Complete address required for B2B in PL';
        }
      }
    }

    // 8. Проверка email (ОБЯЗАТЕЛЬНО)
    if (!data.email) {
      errors.push({ field: 'email', message: 'email is required', code: 'REQUIRED_FIELD' });
      missingFields.push('email');
    } else if (!this.isValidEmail(data.email)) {
      errors.push({ field: 'email', message: 'Invalid email format', code: 'INVALID_FORMAT' });
      invalidFields.push('email');
      fieldErrors.email = 'Invalid email format';
    }

    // 9. Проверка валюты (ОБЯЗАТЕЛЬНО)
    if (!data.currency) {
      errors.push({ field: 'currency', message: 'currency is required', code: 'REQUIRED_FIELD' });
      missingFields.push('currency');
    } else if (!['PLN', 'EUR', 'USD', 'GBP'].includes(data.currency)) {
      errors.push({ field: 'currency', message: 'Unsupported currency', code: 'INVALID_VALUE' });
      invalidFields.push('currency');
      fieldErrors.currency = `Unsupported currency: ${data.currency}`;
    }

    // 10. Проверка канала уведомлений (ПРЕДУПРЕЖДЕНИЕ, НЕ блокирует)
    const sendpulseId = data.sendpulse_id || 
                        data.person?.sendpulse_id || 
                        data.person?.custom_fields?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'];
    const telegramChatId = data.telegram_chat_id || 
                          data.person?.telegram_chat_id ||
                          data.person?.custom_fields?.[data.telegram_chat_id_field_key];
    
    const warnings = [];
    
    if (!sendpulseId && !telegramChatId) {
      // Генерируем предупреждение, а не ошибку
      warnings.push({ 
        field: 'notification_channel_id', 
        message: 'SendPulse ID or Telegram Chat ID not found - notifications will be sent via email only. Consider adding SendPulse ID or Telegram Chat ID for better communication.', 
        code: 'MISSING_NOTIFICATION_CHANNEL',
        severity: 'warning'
      });
      
      // НЕ добавляем в errors - это не блокирует создание сессии
      // Email используется как резервный канал уведомлений
    }

    const result = {
      valid: errors.length === 0, // Валидация проходит даже с предупреждениями
      errors,
      warnings, // Добавляем предупреждения отдельно
      field_errors: fieldErrors,
      missing_fields: missingFields,
      invalid_fields: invalidFields
    };

    this.log('debug', 'Validation completed', { 
      deal_id: data.deal_id, 
      valid: result.valid, 
      errors_count: errors.length, 
      warnings_count: warnings.length 
    });

    return result;
  }

  /**
   * Валидация данных платежа
   * 
   * @param {Object} data - Данные платежа
   * @param {string} data.session_id - Stripe Checkout Session ID
   * @param {string} data.deal_id - ID сделки в Pipedrive
   * @returns {Promise<Object>} Результат валидации
   */
  async validatePaymentData(data) {
    this.log('debug', 'Validating payment data', { deal_id: data.deal_id, session_id: data.session_id });

    const errors = [];

    if (!data.session_id) {
      errors.push({ field: 'session_id', message: 'session_id is required', code: 'REQUIRED_FIELD' });
    }

    if (!data.deal_id) {
      errors.push({ field: 'deal_id', message: 'deal_id is required', code: 'REQUIRED_FIELD' });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Сохранение ошибок валидации в БД
   * 
   * @param {string} dealId - ID сделки
   * @param {string} processType - Тип процесса ('session_creation', 'payment_processing', 'webhook_processing')
   * @param {Object} validationResult - Результат валидации с errors, field_errors, missing_fields, invalid_fields
   * @param {Object} data - Данные, которые не прошли валидацию
   * @param {string|null} processId - ID процесса (опционально)
   * @returns {Promise<boolean|null>} true если успешно, null если ошибка
   */
  async saveValidationError(dealId, processType, validationResult, data, processId = null) {
    if (!this.supabase) {
      this.log('warn', 'Supabase client not available, skipping error save');
      return null;
    }

    try {
      const { error } = await this.supabase
        .from('validation_errors')
        .insert({
          deal_id: String(dealId),
          process_type: processType,
          process_id: processId,
          errors: validationResult.errors || [],
          field_errors: validationResult.field_errors || {},
          missing_fields: validationResult.missing_fields || [],
          invalid_fields: validationResult.invalid_fields || [],
          data: data,
          status: 'pending',
          severity: 'error' // Ошибки блокируют создание сессии
        });

      if (error) {
        this.log('warn', 'Failed to save validation error', { error: error.message, deal_id: dealId });
        return null;
      }

      this.log('info', 'Validation error saved', { deal_id: dealId, process_type: processType, errors_count: validationResult.errors?.length || 0 });
      return true;
    } catch (error) {
      this.log('error', 'Exception saving validation error', { error: error.message, deal_id: dealId });
      return null;
    }
  }

  /**
   * Сохранение предупреждений валидации в БД
   * 
   * Предупреждения НЕ блокируют создание сессии, но сохраняются для уведомления менеджера.
   * 
   * @param {string} dealId - ID сделки
   * @param {string} processType - Тип процесса
   * @param {Array} warnings - Массив предупреждений
   * @param {Object} data - Данные, для которых сгенерированы предупреждения
   * @param {string|null} processId - ID процесса (опционально)
   * @returns {Promise<boolean|null>} true если успешно, null если ошибка
   */
  async saveValidationWarning(dealId, processType, warnings, data, processId = null) {
    if (!this.supabase) {
      this.log('warn', 'Supabase client not available, skipping warning save');
      return null;
    }

    if (!warnings || warnings.length === 0) {
      return null; // Нет предупреждений для сохранения
    }

    try {
      // Сохраняем предупреждения как записи с severity='warning'
      const { error } = await this.supabase
        .from('validation_errors')
        .insert({
          deal_id: String(dealId),
          process_type: processType,
          process_id: processId,
          errors: warnings, // Предупреждения сохраняются в errors для единообразия
          field_errors: warnings.reduce((acc, w) => {
            acc[w.field] = w.message;
            return acc;
          }, {}),
          missing_fields: warnings.map(w => w.field),
          invalid_fields: [],
          data: data,
          status: 'pending',
          severity: 'warning' // Предупреждения НЕ блокируют создание сессии
        });

      if (error) {
        this.log('warn', 'Failed to save validation warning', { error: error.message, deal_id: dealId });
        return null;
      }

      this.log('info', 'Validation warning saved', { deal_id: dealId, process_type: processType, warnings_count: warnings.length });
      return true;
    } catch (error) {
      this.log('error', 'Exception saving validation warning', { error: error.message, deal_id: dealId });
      return null;
    }
  }

  /**
   * Проверка формата email
   * 
   * @param {string} email - Email для проверки
   * @returns {boolean} true если email валидный
   */
  isValidEmail(email) {
    if (!email || typeof email !== 'string') {
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  }
}

module.exports = ValidationService;
