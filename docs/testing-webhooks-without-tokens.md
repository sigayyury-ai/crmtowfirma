# Тестирование Webhooks без реальных токенов API

Это руководство описывает, как протестировать обработку Pipedrive webhooks без реальных токенов API.

---

## 🎯 Варианты тестирования

### Вариант 1: Тестирование логики webhook (рекомендуется)

Используйте скрипт `scripts/test-pipedrive-webhook-mock.js` для отправки mock событий на локальный сервер:

```bash
# По умолчанию тесты отправляются на продакшн сервер
# https://invoices.comoon.io/api/webhooks/pipedrive

# Запустите тест
node scripts/test-pipedrive-webhook-mock.js stripeTrigger

# Для локального тестирования укажите URL:
WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive \
node scripts/test-pipedrive-webhook-mock.js stripeTrigger
node scripts/test-pipedrive-webhook-mock.js proformaTrigger
node scripts/test-pipedrive-webhook-mock.js refundTrigger
node scripts/test-pipedrive-webhook-mock.js workflowAutomationFull
```

**Что тестируется:**
- ✅ Парсинг webhook данных
- ✅ Определение типа события (Stripe, Proforma, Refund, Delete)
- ✅ Логика обработки webhook
- ✅ Формирование ответов

**Ограничения:**
- ⚠️ Если webhook handler пытается сделать реальный запрос к Pipedrive API (например, `getDeal()`), он упадет с ошибкой
- ⚠️ Для полного тестирования нужны моки PipedriveClient

---

### Вариант 2: Тестирование с моками PipedriveClient

Для полного тестирования без реальных API запросов нужно замокать `PipedriveClient`.

#### Шаг 1: Создайте тестовый файл с моками

Создайте файл `src/services/pipedrive.mock.js`:

```javascript
const logger = require('../utils/logger');

// Mock данные
const mockDeal = {
  id: 1600,
  title: 'Test Deal',
  status: 'open',
  stage_id: 18,
  value: 10000,
  currency: 'PLN',
  expected_close_date: '2025-12-31',
  person_id: 123,
  org_id: 456,
  [process.env.PIPEDRIVE_INVOICE_TYPE_FIELD_KEY || 'ad67729ecfe0345287b71a3b00910e8ba5b3b496']: null
};

const mockPerson = {
  id: 123,
  name: 'Test Person',
  email: [{ value: 'test@example.com', primary: true }],
  phone: [{ value: '+48123456789', primary: true }]
};

const mockOrganization = {
  id: 456,
  name: 'Test Organization',
  address: 'Test Address 123'
};

class MockPipedriveClient {
  async getDeal(dealId) {
    logger.info(`[MOCK] getDeal(${dealId})`);
    return {
      success: true,
      deal: { ...mockDeal, id: parseInt(dealId, 10) }
    };
  }

  async getDealWithRelatedData(dealId) {
    logger.info(`[MOCK] getDealWithRelatedData(${dealId})`);
    return {
      success: true,
      deal: { ...mockDeal, id: parseInt(dealId, 10) },
      person: mockPerson,
      organization: mockOrganization
    };
  }

  async updateDeal(dealId, data) {
    logger.info(`[MOCK] updateDeal(${dealId})`, data);
    return {
      success: true,
      deal: { ...mockDeal, id: parseInt(dealId, 10), ...data }
    };
  }

  async getDeals(options) {
    logger.info(`[MOCK] getDeals()`, options);
    return {
      success: true,
      deals: [mockDeal]
    };
  }
}

module.exports = MockPipedriveClient;
```

#### Шаг 2: Используйте моки в тестовом режиме

В `src/services/pipedrive.js` добавьте проверку тестового режима:

```javascript
// В начале файла
const TEST_MODE = process.env.TEST_MODE === 'true' || process.env.NODE_ENV === 'test';

// В конце файла, перед module.exports
if (TEST_MODE && process.env.USE_MOCK_PIPEDRIVE === 'true') {
  const MockPipedriveClient = require('./pipedrive.mock');
  module.exports = MockPipedriveClient;
} else {
  module.exports = PipedriveClient;
}
```

#### Шаг 3: Запустите тесты с моками

```bash
# Установите переменные окружения
export TEST_MODE=true
export USE_MOCK_PIPEDRIVE=true

# Запустите сервер
npm run dev

# В другом терминале запустите тест
node scripts/test-pipedrive-webhook-mock.js stripeTrigger
```

---

### Вариант 3: Unit-тесты с полными моками

Создайте unit-тесты с использованием библиотеки для моков (например, `jest` или `sinon`):

```javascript
// tests/unit/pipedriveWebhook.test.js
const { jest } = require('@jest/globals');

// Mock PipedriveClient перед импортом модулей
jest.mock('../../src/services/pipedrive', () => {
  return {
    getDeal: jest.fn().mockResolvedValue({
      success: true,
      deal: { id: 1600, status: 'open' }
    }),
    getDealWithRelatedData: jest.fn().mockResolvedValue({
      success: true,
      deal: { id: 1600 },
      person: { id: 123 },
      organization: { id: 456 }
    })
  };
});

// Теперь можно импортировать и тестировать webhook handler
const webhookHandler = require('../../src/routes/pipedriveWebhook');
```

---

## 📋 Доступные тестовые события

### Стандартный формат Pipedrive webhook:

- `stripeTrigger` - Изменение invoice_type на Stripe (75)
- `proformaTrigger` - Изменение invoice_type на Proforma (70)
- `refundTrigger` - Изменение статуса на "lost" с reason "Refund"
- `deleteTrigger` - Изменение invoice_type на Delete (74)

### Workflow Automation формат:

- `workflowAutomationMinimal` - Только Deal ID
- `workflowAutomationFull` - Полные данные сделки
- `workflowAutomationRefund` - Рефанд через workflow automation

---

## 🔍 Что проверяется

### ✅ Успешно тестируется без токенов:

1. **Парсинг webhook данных**
   - Определение формата (стандартный vs workflow automation)
   - Извлечение Deal ID, invoice_type, status и т.д.

2. **Логика определения триггеров**
   - Stripe trigger (invoice_type = 75)
   - Proforma trigger (invoice_type = 70, 71, 72)
   - Delete trigger (invoice_type = 74 или "delete")
   - Refund trigger (status = "lost" + reason = "Refund")

3. **Формирование ответов**
   - Успешные ответы
   - Ошибки валидации
   - Логирование событий

### ⚠️ Требует моков или реальных токенов:

1. **API запросы к Pipedrive**
   - `getDeal()` - получение данных сделки
   - `getDealWithRelatedData()` - получение сделки с контактом и организацией
   - `updateDeal()` - обновление сделки

2. **Создание Checkout Sessions**
   - Требует реального Stripe API ключа (можно использовать test ключ)

3. **Создание инвойсов в wFirma**
   - Требует реальных wFirma API ключей

---

## 💡 Рекомендации

### Для разработки:

1. **Используйте Вариант 1** для быстрого тестирования логики webhook
2. **Используйте test Stripe ключи** (`sk_test_*`) для тестирования создания Checkout Sessions
3. **Используйте моки** для Pipedrive API, если токены недоступны

### Для CI/CD:

1. **Используйте Вариант 3** (unit-тесты с моками)
2. **Настройте тестовые токены** для интеграционных тестов
3. **Используйте Docker** для изоляции тестовой среды

---

## 🚀 Быстрый старт

```bash
# 1. Запустите тест (по умолчанию на продакшн сервер)
node scripts/test-pipedrive-webhook-mock.js stripeTrigger

# 2. Проверьте логи сервера для деталей обработки
#    (на Render.com или где запущен продакшн сервер)

# Для локального тестирования:
WEBHOOK_URL=http://localhost:3000/api/webhooks/pipedrive \
node scripts/test-pipedrive-webhook-mock.js stripeTrigger
```

---

## 📝 Примеры использования

### Тест Stripe trigger:

```bash
node scripts/test-pipedrive-webhook-mock.js stripeTrigger
```

Ожидаемый результат:
- Webhook обработан успешно
- Попытка создать Checkout Session (требует Stripe API ключ)

### Тест Proforma trigger:

```bash
node scripts/test-pipedrive-webhook-mock.js proformaTrigger
```

Ожидаемый результат:
- Webhook обработан успешно
- Попытка создать инвойс в wFirma (требует wFirma API ключи)

### Тест Refund trigger:

```bash
node scripts/test-pipedrive-webhook-mock.js refundTrigger
```

Ожидаемый результат:
- Webhook обработан успешно
- Попытка обработать рефанды (требует Stripe API ключ)

---

**Дата создания:** 2025-11-18

