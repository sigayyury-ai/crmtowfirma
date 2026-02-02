# Quickstart Guide: Payment Microservices Architecture

**Feature**: 018-payment-microservices-architecture  
**Date**: 2026-02-02  
**Approach**: Постепенная миграция (Strangler Fig Pattern)

## Обзор

Это руководство поможет начать постепенную миграцию монолитной системы обработки Stripe платежей на микросервисную архитектуру. Мы начинаем с малого и постепенно расширяем функциональность.

## Предварительные требования

- Node.js 18+ (22.x локально)
- Доступ к Supabase (PostgreSQL)
- Stripe API ключи настроены
- Pipedrive API токен настроен
- SendPulse credentials (опционально)

## Фаза 0: Подготовка инфраструктуры

### Шаг 1: Создание таблиц БД

Выполните миграции для создания новых таблиц:

```bash
# Создать миграции (примеры)
psql $DATABASE_URL -f scripts/migrations/020_create_validation_errors.sql
psql $DATABASE_URL -f scripts/migrations/021_create_process_states.sql
psql $DATABASE_URL -f scripts/migrations/022_create_notification_logs.sql
psql $DATABASE_URL -f scripts/migrations/023_create_payment_history_tables.sql
psql $DATABASE_URL -f scripts/migrations/024_create_session_duplicate_checks.sql
psql $DATABASE_URL -f scripts/migrations/025_create_event_logs.sql
psql $DATABASE_URL -f scripts/migrations/026_create_customer_payment_history.sql
```

**Проверка**: Убедитесь, что таблицы созданы:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'validation_errors',
  'process_states',
  'notification_logs',
  'payment_status_history',
  'payment_amount_history',
  'session_duplicate_checks',
  'event_logs',
  'customer_payment_history'
);
```

### Шаг 2: Создание базовой структуры микросервисов

Создайте папку для микросервисов:

```bash
mkdir -p src/services/microservices
```

Создайте базовый класс `BaseMicroservice`:

```javascript
// src/services/microservices/baseMicroservice.js
const logger = require('../../utils/logger');

class BaseMicroservice {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.name = this.constructor.name;
  }

  log(level, message, context = {}) {
    this.logger[level](`[${this.name}] ${message}`, {
      service: this.name,
      ...context
    });
  }

  async handleError(error, context = {}) {
    this.log('error', 'Service error', {
      error: error.message,
      stack: error.stack,
      ...context
    });
    throw error;
  }
}

module.exports = BaseMicroservice;
```

**Проверка**: Убедитесь, что структура создана:
```bash
ls -la src/services/microservices/
```

---

## Фаза 1: Validation Service (Первая неделя)

### Шаг 1: Создание ValidationService

Создайте файл `src/services/microservices/validationService.js`:

```javascript
const BaseMicroservice = require('./baseMicroservice');
const supabase = require('../../supabaseClient');

class ValidationService extends BaseMicroservice {
  constructor(options = {}) {
    super(options);
    this.supabase = options.supabase || supabase;
  }

  async validateSessionData(data) {
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
        message: `Deal is ${data.deal_status}, cannot create checkout session`, 
        code: 'INVALID_DEAL_STATUS' 
      });
      invalidFields.push('deal_status');
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
      if (!data.product.name || data.product.name.trim() === '') {
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
    if (!data.amount || data.amount === null || data.amount === undefined) {
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
      if (!data.address.country || data.address.country.trim() === '') {
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
    if (!data.customer_name || data.customer_name.trim() === '') {
      errors.push({ 
        field: 'customer_name', 
        message: 'Customer name is required - Person name or Organization name must be specified', 
        code: 'REQUIRED_FIELD' 
      });
      missingFields.push('customer_name');
    }

    // 7. Проверка B2B специфичных полей (если это B2B сделка)
    const isB2B = data.customer_type === 'company' || data.organization_id || data.organization;
    
    if (isB2B) {
      // Проверка Organization в CRM
      if (!data.organization_id || data.organization_id === '0' || data.organization_id === null) {
        errors.push({ 
          field: 'organization', 
          message: 'Organization is required for B2B deals - deal must be linked to Organization in CRM', 
          code: 'REQUIRED_FIELD' 
        });
        missingFields.push('organization');
        fieldErrors.organization = 'Organization is required for B2B deals';
      }

      // Проверка Business ID (NIP/VAT)
      const businessId = data.company_tax_id || 
                        data.organization?.nip || 
                        data.organization?.tax_id || 
                        data.organization?.vat_number;
      
      if (!businessId || businessId.trim() === '') {
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
      if (!companyName || companyName.trim() === '') {
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

    // 7. Проверка email (ОБЯЗАТЕЛЬНО)
    if (!data.email) {
      errors.push({ field: 'email', message: 'email is required', code: 'REQUIRED_FIELD' });
      missingFields.push('email');
    } else if (!this.isValidEmail(data.email)) {
      errors.push({ field: 'email', message: 'Invalid email format', code: 'INVALID_FORMAT' });
      invalidFields.push('email');
      fieldErrors.email = 'Invalid email format';
    }

    // 8. Проверка валюты (ОБЯЗАТЕЛЬНО)
    if (!data.currency) {
      errors.push({ field: 'currency', message: 'currency is required', code: 'REQUIRED_FIELD' });
      missingFields.push('currency');
    } else if (!['PLN', 'EUR', 'USD', 'GBP'].includes(data.currency)) {
      errors.push({ field: 'currency', message: 'Unsupported currency', code: 'INVALID_VALUE' });
      invalidFields.push('currency');
    }

    // 9. Проверка канала уведомлений (ПРЕДУПРЕЖДЕНИЕ, НЕ блокирует)
    const sendpulseId = data.sendpulse_id || data.person?.sendpulse_id || 
                        data.person?.custom_fields?.['ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c'];
    const telegramChatId = data.telegram_chat_id || data.person?.telegram_chat_id ||
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

    return {
      valid: errors.length === 0, // Валидация проходит даже с предупреждениями
      errors,
      warnings, // Добавляем предупреждения отдельно
      field_errors: fieldErrors,
      missing_fields: missingFields,
      invalid_fields: invalidFields
    };
  }

  async validatePaymentData(data) {
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

  async saveValidationError(dealId, processType, validationResult, data, processId = null) {
    if (!this.supabase) return null;

    try {
      const { error } = await this.supabase
        .from('validation_errors')
        .insert({
          deal_id: dealId,
          process_type: processType,
          process_id: processId,
          errors: validationResult.errors,
          field_errors: validationResult.field_errors,
          missing_fields: validationResult.missing_fields,
          invalid_fields: validationResult.invalid_fields,
          data: data,
          status: 'pending',
          severity: 'error' // Ошибки блокируют создание сессии
        });

      if (error) {
        this.log('warn', 'Failed to save validation error', { error: error.message });
        return null;
      }

      return true;
    } catch (error) {
      this.log('error', 'Exception saving validation error', { error: error.message });
      return null;
    }
  }

  async saveValidationWarning(dealId, processType, warnings, data, processId = null) {
    if (!this.supabase) return null;

    try {
      // Сохраняем предупреждения как записи с severity='warning'
      const { error } = await this.supabase
        .from('validation_errors')
        .insert({
          deal_id: dealId,
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
        this.log('warn', 'Failed to save validation warning', { error: error.message });
        return null;
      }

      return true;
    } catch (error) {
      this.log('error', 'Exception saving validation warning', { error: error.message });
      return null;
    }
  }

  isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
}

module.exports = ValidationService;
```

### Шаг 2: Интеграция в PaymentSessionCreator

Обновите `src/services/stripe/paymentSessionCreator.js`:

```javascript
const ValidationService = require('../microservices/validationService');

class PaymentSessionCreator {
  constructor(options = {}) {
    // ... существующий код ...
    this.validationService = options.validationService || new ValidationService();
  }

  async createSession(deal, options = {}) {
    // ВАЖНО: Валидация выполняется ПЕРЕД созданием Stripe Checkout Session
    // Это происходит когда менеджер создает сессию, а не когда клиент оплачивает
    
    // ... существующий код до валидации ...

    // Определяем тип клиента (B2B или B2C)
    const isB2B = Boolean(organization || fullDeal.organization_id);
    const organizationId = fullDeal.organization_id || organization?.id;

    // Валидация через микросервис (ПЕРЕД созданием сессии в Stripe)
    const validationData = {
      deal_id: dealId,
      email: customerEmail,
      amount: paymentAmount,
      currency: currency,
      deal_amount: parseFloat(fullDeal.value) || null,
      deal_status: fullDeal.status,
      deal_deleted: fullDeal.deleted,
      product: {
        id: firstProduct.product_id || firstProduct.product?.id,
        name: firstProduct.name || firstProduct.product?.name || fullDeal.title,
        price: paymentAmount,
        quantity: parseFloat(firstProduct.quantity) || 1
      },
      address: {
        street: person?.address_street || organization?.address_street || null,
        city: person?.address_city || organization?.address_city || null,
        postal_code: person?.address_postal_code || organization?.address_postal_code || null,
        country: person?.address_country || organization?.address_country || null,
        validated: false // Будет проверено отдельно
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

      // Логируем ошибки
      this.logger.warn(`[Deal #${dealId}] Validation failed`, {
        errors: validationResult.errors,
        missing_fields: validationResult.missing_fields,
        invalid_fields: validationResult.invalid_fields
      });

      // Возвращаем ошибку - сессия НЕ создается
      return {
        success: false,
        error: 'Validation failed',
        errors: validationResult.errors,
        field_errors: validationResult.field_errors,
        missing_fields: validationResult.missing_fields,
        invalid_fields: validationResult.invalid_fields
      };
    }

    // Обработка предупреждений (НЕ блокируют создание сессии)
    if (validationResult.warnings && validationResult.warnings.length > 0) {
      // Сохраняем предупреждения в БД (с флагом warning)
      await this.validationService.saveValidationWarning(
        dealId,
        'session_creation',
        validationResult.warnings,
        validationData
      );

      // Логируем предупреждения
      this.logger.info(`[Deal #${dealId}] Validation warnings (session will be created)`, {
        warnings: validationResult.warnings
      });

      // Создаем задачу в CRM для менеджера (если есть предупреждения о notification channels)
      const notificationWarnings = validationResult.warnings.filter(w => 
        w.field === 'notification_channel_id'
      );
      
      if (notificationWarnings.length > 0) {
        await this.createCrmTaskForManager(dealId, {
          title: 'Рекомендуется заполнить SendPulse ID или Telegram Chat ID',
          note: 'Уведомления будут отправляться только по email. Для улучшения коммуникации рекомендуется заполнить SendPulse ID или Telegram Chat ID в Person.',
          type: 'recommendation'
        });
      }
    }

    // ... остальная логика создания сессии продолжается ...
  }
}
```

### Шаг 3: Тестирование

Создайте тестовый скрипт:

```bash
# scripts/test-validation-service.js
const ValidationService = require('../src/services/microservices/validationService');

async function test() {
  const service = new ValidationService();

  // Тест 1: Валидные данные (все обязательные поля присутствуют)
  const validResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: {
      id: 'prod_123',
      name: 'Camp Service'
    },
    address: {
      street: 'Main St 1',
      city: 'Warsaw',
      postal_code: '00-001',
      country: 'PL'
    },
    customer_name: 'John Doe'
  });
  console.log('Valid data:', validResult.valid); // true

  // Тест 2: Отсутствует продукт
  const noProductResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    address: { country: 'PL' },
    customer_name: 'John Doe'
  });
  console.log('No product:', noProductResult.valid); // false
  console.log('Missing fields:', noProductResult.missing_fields); // ['product']

  // Тест 3: Отсутствует адрес
  const noAddressResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    customer_name: 'John Doe'
  });
  console.log('No address:', noAddressResult.missing_fields); // ['address']

  // Тест 4: Отсутствует имя клиента
  const noNameResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    address: { country: 'PL' }
  });
  console.log('No customer name:', noNameResult.missing_fields); // ['customer_name']

  // Тест 5: Некорректная цена (отрицательная)
  const invalidPriceResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: -100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    address: { country: 'PL' },
    customer_name: 'John Doe'
  });
  console.log('Invalid price:', invalidPriceResult.invalid_fields); // ['amount']

  // Тест 6: Неполный адрес для PL (требуется VAT)
  const incompleteAddressResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    address: { country: 'PL' }, // Нет street, city, postal_code
    customer_name: 'John Doe'
  });
  console.log('Incomplete address:', incompleteAddressResult.invalid_fields); // ['address']

  // Тест 7: B2B сделка без Organization
  const b2bNoOrgResult = await service.validateSessionData({
    deal_id: '123',
    email: 'company@example.com',
    amount: 1000,
    currency: 'PLN',
    product: { id: 'prod_123', name: 'Camp' },
    address: { street: 'Main St 1', city: 'Warsaw', postal_code: '00-001', country: 'PL' },
    customer_name: 'Company Name',
    customer_type: 'company'
    // Нет organization_id и organization
  });
  console.log('B2B without Organization:', b2bNoOrgResult.missing_fields); // ['organization']

  // Тест 8: B2B сделка без Business ID (NIP)
  const b2bNoTaxIdResult = await service.validateSessionData({
    deal_id: '123',
    email: 'company@example.com',
    amount: 1000,
    currency: 'PLN',
    product: { id: 'prod_123', name: 'Camp' },
    address: { street: 'Main St 1', city: 'Warsaw', postal_code: '00-001', country: 'PL' },
    customer_name: 'Company Name',
    customer_type: 'company',
    organization_id: '456',
    organization: {
      id: '456',
      name: 'Company Name'
      // Нет nip, tax_id, vat_number
    }
  });
  console.log('B2B without Business ID:', b2bNoTaxIdResult.missing_fields); // ['company_tax_id']

  // Тест 9: Валидная B2B сделка
  const validB2BResult = await service.validateSessionData({
    deal_id: '123',
    email: 'company@example.com',
    amount: 1000,
    currency: 'PLN',
    product: { id: 'prod_123', name: 'Camp' },
    address: { street: 'Main St 1', city: 'Warsaw', postal_code: '00-001', country: 'PL' },
    customer_name: 'Company Name',
    customer_type: 'company',
    organization_id: '456',
    organization: {
      id: '456',
      name: 'Company Name',
      nip: '1234567890' // Business ID для Польши
    },
    company_name: 'Company Name',
    company_tax_id: '1234567890',
    sendpulse_id: 'sp_123456' // SendPulse ID для уведомлений
  });
  console.log('Valid B2B:', validB2BResult.valid); // true

  // Тест 10: Отсутствует канал уведомлений (предупреждение, НЕ ошибка)
  const noNotificationChannelResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    address: { country: 'PL' },
    customer_name: 'John Doe'
    // Нет sendpulse_id и telegram_chat_id
  });
  console.log('No notification channel - valid:', noNotificationChannelResult.valid); // true (не блокирует)
  console.log('No notification channel - warnings:', noNotificationChannelResult.warnings); // [{ field: 'notification_channel_id', ... }]

  // Тест 11: Валидная сделка с Telegram Chat ID (без SendPulse ID)
  const validWithTelegramResult = await service.validateSessionData({
    deal_id: '123',
    email: 'test@example.com',
    amount: 100,
    currency: 'EUR',
    product: { id: 'prod_123', name: 'Camp' },
    address: { country: 'PL' },
    customer_name: 'John Doe',
    telegram_chat_id: '123456789' // Telegram Chat ID вместо SendPulse ID
  });
  console.log('Valid with Telegram:', validWithTelegramResult.valid); // true
}

test();
```

Запустите тест:
```bash
node scripts/test-validation-service.js
```

**Проверка**: 
- ✅ ValidationService работает корректно
- ✅ Ошибки сохраняются в БД (проверьте таблицу `validation_errors`)
- ✅ Монолит использует ValidationService вместо внутренней валидации

---

## Фаза 2: Duplicate Prevention Service (Вторая неделя)

### Шаг 1: Создание DuplicatePreventionService

Создайте файл `src/services/microservices/duplicatePreventionService.js`:

```javascript
const BaseMicroservice = require('./baseMicroservice');
const supabase = require('../../supabaseClient');

class DuplicatePreventionService extends BaseMicroservice {
  constructor(options = {}) {
    super(options);
    this.supabase = options.supabase || supabase;
  }

  async checkSessionDuplicate(dealId, paymentType) {
    if (!this.supabase) {
      this.log('warn', 'Supabase not available, skipping duplicate check');
      return { hasDuplicate: false };
    }

    try {
      // Проверяем наличие активной сессии того же типа
      const { data, error } = await this.supabase
        .from('stripe_payments')
        .select('session_id, payment_status, checkout_url')
        .eq('deal_id', String(dealId))
        .eq('payment_type', paymentType)
        .eq('payment_status', 'unpaid')
        .limit(1)
        .maybeSingle();

      if (error) {
        this.log('warn', 'Failed to check session duplicate', { error: error.message });
        return { hasDuplicate: false };
      }

      if (data) {
        // Записываем проверку в лог
        await this.recordSessionCheck(dealId, paymentType, true, data.session_id);

        return {
          hasDuplicate: true,
          existingSession: {
            session_id: data.session_id,
            status: data.payment_status,
            checkout_url: data.checkout_url
          }
        };
      }

      // Записываем проверку в лог
      await this.recordSessionCheck(dealId, paymentType, false, null);

      return { hasDuplicate: false };
    } catch (error) {
      this.log('error', 'Exception checking session duplicate', { error: error.message });
      return { hasDuplicate: false };
    }
  }

  async checkNotificationDuplicate(recipient, notificationType, ttlHours = 24) {
    if (!this.supabase) {
      return { canSend: true };
    }

    try {
      const ttlMs = ttlHours * 60 * 60 * 1000;
      const ttlAgo = new Date(Date.now() - ttlMs).toISOString();

      // Проверяем отправленные уведомления в пределах TTL
      const { data, error } = await this.supabase
        .from('notification_logs')
        .select('sent_at')
        .eq('recipient', recipient)
        .eq('notification_type', notificationType)
        .gte('sent_at', ttlAgo)
        .eq('success', true)
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        this.log('warn', 'Failed to check notification duplicate', { error: error.message });
        return { canSend: true }; // В случае ошибки разрешаем отправку
      }

      if (data) {
        return {
          canSend: false,
          lastSentAt: data.sent_at
        };
      }

      return { canSend: true };
    } catch (error) {
      this.log('error', 'Exception checking notification duplicate', { error: error.message });
      return { canSend: true }; // В случае ошибки разрешаем отправку
    }
  }

  async checkEventDuplicate(eventId) {
    if (!this.supabase) {
      return { alreadyProcessed: false };
    }

    try {
      const { data, error } = await this.supabase
        .from('event_logs')
        .select('processed, processed_at')
        .eq('event_id', eventId)
        .maybeSingle();

      if (error) {
        this.log('warn', 'Failed to check event duplicate', { error: error.message });
        return { alreadyProcessed: false };
      }

      if (data && data.processed) {
        return {
          alreadyProcessed: true,
          processedAt: data.processed_at
        };
      }

      return { alreadyProcessed: false };
    } catch (error) {
      this.log('error', 'Exception checking event duplicate', { error: error.message });
      return { alreadyProcessed: false };
    }
  }

  async recordSessionCheck(dealId, paymentType, duplicateFound, existingSessionId) {
    if (!this.supabase) return;

    try {
      await this.supabase
        .from('session_duplicate_checks')
        .insert({
          deal_id: String(dealId),
          payment_type: paymentType,
          check_type: 'before_creation',
          duplicate_found: duplicateFound,
          existing_session_id: existingSessionId,
          action_taken: duplicateFound ? 'skipped' : 'created'
        });
    } catch (error) {
      this.log('warn', 'Failed to record session check', { error: error.message });
    }
  }

  async recordNotificationSent(notificationData) {
    if (!this.supabase) return;

    try {
      const expiresAt = new Date(Date.now() + (notificationData.ttl_hours || 24) * 60 * 60 * 1000);

      await this.supabase
        .from('notification_logs')
        .insert({
          deal_id: notificationData.deal_id,
          recipient: notificationData.recipient,
          recipient_type: notificationData.recipient_type || 'email',
          notification_type: notificationData.notification_type,
          channel: notificationData.channel || 'email',
          ttl_hours: notificationData.ttl_hours || 24,
          expires_at: expiresAt,
          sent_by: notificationData.sent_by || 'system',
          success: notificationData.success !== false,
          error_message: notificationData.error_message,
          metadata: notificationData.metadata
        });
    } catch (error) {
      this.log('warn', 'Failed to record notification', { error: error.message });
    }
  }
}

module.exports = DuplicatePreventionService;
```

### Шаг 2: Интеграция в PaymentSessionCreator

Обновите `PaymentSessionCreator` для использования DuplicatePreventionService:

```javascript
const DuplicatePreventionService = require('../microservices/duplicatePreventionService');

class PaymentSessionCreator {
  constructor(options = {}) {
    // ... существующий код ...
    this.duplicatePreventionService = options.duplicatePreventionService || new DuplicatePreventionService();
  }

  async createSession(deal, options = {}) {
    // ... валидация через ValidationService ...

    // Проверка дубликатов через DuplicatePreventionService
    const duplicateCheck = await this.duplicatePreventionService.checkSessionDuplicate(
      dealId,
      paymentType
    );

    if (duplicateCheck.hasDuplicate) {
      this.logger.info(`[Deal #${dealId}] Duplicate session found, skipping creation`, {
        existingSession: duplicateCheck.existingSession
      });

      return {
        success: false,
        error: 'Duplicate session exists',
        existingSession: duplicateCheck.existingSession
      };
    }

    // ... создание сессии продолжается ...
  }
}
```

**Проверка**:
- ✅ DuplicatePreventionService работает корректно
- ✅ Проверки записываются в БД (таблица `session_duplicate_checks`)
- ✅ Дубликаты обнаруживаются и блокируются

---

## Фаза 3: Notification Service (Третья неделя)

### Шаг 1: Создание NotificationService

Создайте файл `src/services/microservices/notificationService.js`:

```javascript
const BaseMicroservice = require('./baseMicroservice');
const DuplicatePreventionService = require('./duplicatePreventionService');
const SendPulseClient = require('../sendpulse');

class NotificationService extends BaseMicroservice {
  constructor(options = {}) {
    super(options);
    this.duplicatePreventionService = options.duplicatePreventionService || new DuplicatePreventionService();
    this.sendpulseClient = options.sendpulseClient || null;
    
    // Инициализация SendPulse если доступен
    if (!this.sendpulseClient && process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET) {
      try {
        this.sendpulseClient = new SendPulseClient();
      } catch (error) {
        this.log('warn', 'SendPulse not available', { error: error.message });
      }
    }
  }

  async sendPaymentLink(dealId, sessionUrl, customerEmail, options = {}) {
    // Проверка дубликатов
    const duplicateCheck = await this.duplicatePreventionService.checkNotificationDuplicate(
      customerEmail,
      'payment_link_created',
      24 // TTL 24 часа
    );

    if (!duplicateCheck.canSend) {
      this.log('info', 'Notification duplicate detected, skipping', {
        dealId,
        recipient: customerEmail,
        lastSentAt: duplicateCheck.lastSentAt
      });
      return {
        success: false,
        error: 'Duplicate notification',
        lastSentAt: duplicateCheck.lastSentAt
      };
    }

    // Отправка уведомления через SendPulse
    let sent = false;
    let errorMessage = null;

    try {
      if (this.sendpulseClient) {
        // Отправка через SendPulse (Telegram)
        // Реализация зависит от вашего SendPulse клиента
        sent = true;
      } else {
        this.log('warn', 'SendPulse not available, notification not sent', { dealId });
      }
    } catch (error) {
      errorMessage = error.message;
      this.log('error', 'Failed to send notification', { error: error.message });
    }

    // Запись в лог
    await this.duplicatePreventionService.recordNotificationSent({
      deal_id: dealId,
      recipient: customerEmail,
      recipient_type: 'email',
      notification_type: 'payment_link_created',
      channel: 'telegram',
      ttl_hours: 24,
      sent_by: 'notification_service',
      success: sent,
      error_message: errorMessage,
      metadata: {
        session_url: sessionUrl
      }
    });

    return {
      success: sent,
      notification_id: null, // Можно генерировать UUID
      sent_at: new Date().toISOString()
    };
  }

  async sendPaymentConfirmation(dealId, customerEmail, options = {}) {
    // Аналогично sendPaymentLink
    // Проверка дубликатов + отправка + логирование
  }

  async sendReminder(dealId, reminderType, options = {}) {
    // Аналогично sendPaymentLink
    // Проверка дубликатов + отправка + логирование
  }
}

module.exports = NotificationService;
```

### Шаг 2: Интеграция в монолит

Обновите `StripeProcessorService` для использования NotificationService:

```javascript
const NotificationService = require('../microservices/notificationService');

class StripeProcessorService {
  constructor(options = {}) {
    // ... существующий код ...
    this.notificationService = options.notificationService || new NotificationService();
  }

  async sendPaymentNotificationForDeal(dealId, options = {}) {
    // Заменить существующую логику на вызов NotificationService
    const result = await this.notificationService.sendPaymentLink(
      dealId,
      options.sessionUrl,
      options.customerEmail,
      options
    );

    return result;
  }
}
```

**Проверка**:
- ✅ NotificationService работает корректно
- ✅ Уведомления отправляются
- ✅ Дубликаты предотвращаются
- ✅ Все отправки логируются в БД

---

## Следующие шаги

После успешного завершения Фаз 1-3:

1. **Фаза 4**: Выделение CRM Status Service
2. **Фаза 5**: Выделение Payment Processing Service
3. **Фаза 6**: Внедрение Event Bus
4. **Фаза 7**: Выделение Webhook Processing Service
5. **Фаза 8**: Выделение Session Services

Подробности каждой фазы см. в [gradual-migration-strategy.md](./gradual-migration-strategy.md)

---

## Troubleshooting

### Проблема: Таблицы не создаются
**Решение**: Проверьте права доступа к БД, убедитесь что миграции выполняются от правильного пользователя

### Проблема: Микросервис не вызывается из монолита
**Решение**: Проверьте пути импорта, убедитесь что класс экспортируется правильно

### Проблема: Ошибки валидации не сохраняются
**Решение**: Проверьте что таблица `validation_errors` создана, проверьте права доступа Supabase

### Проблема: Дубликаты не обнаруживаются
**Решение**: Проверьте что данные в БД корректны, проверьте логику проверки в DuplicatePreventionService

---

## Метрики успеха

После каждой фазы проверьте:

- ✅ Микросервис работает параллельно со старым кодом
- ✅ Результаты идентичны (или лучше) старой системе
- ✅ Нет деградации производительности
- ✅ Ошибки изолированы и не влияют на монолит
- ✅ Данные сохраняются в новые таблицы БД
- ✅ Логи показывают работу микросервиса

---

## Дополнительные ресурсы

- [Спецификация](./spec.md)
- [Исследование БД](./research.md)
- [Сравнение архитектур](./current-vs-proposed-architecture.md)
- [Стратегия миграции](./gradual-migration-strategy.md)
- [Предложение архитектуры](./architecture-proposal.md)
