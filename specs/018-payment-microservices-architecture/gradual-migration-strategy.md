# Стратегия постепенной миграции на микросервисы

**Подход**: Strangler Fig Pattern - постепенное вычленение функциональности из монолита  
**Принцип**: Начинаем с микросервисов вокруг основного процессора, постепенно переносим функциональность

## Преимущества постепенного подхода

✅ **Минимальный риск** - не нужно переписывать всё сразу  
✅ **Постепенное обучение** - команда изучает микросервисы постепенно  
✅ **Быстрая обратная связь** - можно откатить изменения на любом этапе  
✅ **Непрерывная работа** - система продолжает работать во время миграции  
✅ **Тестирование в продакшене** - каждый новый микросервис тестируется отдельно

## Стратегия миграции

### Принцип работы

```
Текущее состояние:
┌─────────────────────────────────────┐
│   StripeProcessorService (монолит)  │
│   - Все функции внутри              │
└─────────────────────────────────────┘

После миграции (постепенно):
┌─────────────────────────────────────┐
│   StripeProcessorService (уменьшен) │
│   └─→ Вызывает микросервисы         │
└─────────────────────────────────────┘
         │
         ├─→ Validation Service ───────┐
         ├─→ Duplicate Prevention ────┤
         ├─→ Notification Service ────┤ Микросервисы
         └─→ CRM Status Service ───────┘

В будущем (полная миграция):
┌─────────────────────────────────────┐
│   Event Bus (центральная шина)      │
└─────────────────────────────────────┘
         │
    ┌────┴────┬──────────┬──────────┐
    │         │          │          │
    ▼         ▼          ▼          ▼
┌────────┐ ┌──────┐ ┌────────┐ ┌────────┐
│Session │ │Webhook│ │Payment │ │  CRM   │
│Service │ │Service│ │Service │ │Service │
└────────┘ └──────┘ └────────┘ └────────┘
```

## План постепенной миграции

### Фаза 0: Подготовка инфраструктуры (1-2 недели)

**Цель**: Подготовить инфраструктуру для микросервисов без изменения текущего кода

**Задачи**:
1. **Настроить Event Bus** (опционально, можно начать без него)
   - RabbitMQ, Redis PubSub, или начать с in-memory EventEmitter
   - Для начала можно использовать простой EventEmitter в Node.js

2. **Создать базовые таблицы БД**
   - `validation_errors` - ошибки валидации
   - `process_states` - состояния процессов
   - `notification_logs` - расширенный лог уведомлений
   - `payment_status_history` - история статусов
   - `payment_amount_history` - история изменений сумм

3. **Создать базовую структуру микросервисов**
   - Папка `src/services/microservices/`
   - Базовый класс `BaseMicroservice` с общими методами
   - Общие утилиты для логирования и мониторинга

**Результат**: Инфраструктура готова, но монолит продолжает работать как раньше

---

### Фаза 1: Выделение Validation Service (1 неделя)

**Цель**: Вынести валидацию данных в отдельный микросервис

**Подход**: 
- Создать `ValidationService` как отдельный класс
- Монолит вызывает ValidationService вместо внутренней валидации
- Постепенно переносить логику валидации

**Шаги**:

1. **Создать ValidationService**
```javascript
// src/services/microservices/validationService.js
class ValidationService {
  async validateSessionData(data) {
    // Валидация данных для создания сессии
    // Возвращает { valid: boolean, errors: [] }
  }
  
  async validatePaymentData(data) {
    // Валидация данных платежа
  }
}
```

2. **Интегрировать в монолит**
```javascript
// В StripeProcessorService или PaymentSessionCreator
const validationService = new ValidationService();

// Заменить внутреннюю валидацию на вызов сервиса
const validationResult = await validationService.validateSessionData(data);
if (!validationResult.valid) {
  // Сохранить ошибки в БД
  // Уведомить менеджера
  // Вернуть ошибку без блокировки процесса
}
```

3. **Добавить сохранение ошибок**
```javascript
// При ошибке валидации
await saveValidationError({
  deal_id: dealId,
  errors: validationResult.errors,
  data: data,
  process_type: 'session_creation'
});
```

**Результат**: 
- ✅ Валидация вынесена в отдельный сервис
- ✅ Ошибки сохраняются в БД
- ✅ Менеджеры получают уведомления об ошибках
- ✅ Монолит продолжает работать, но использует новый сервис

---

### Фаза 2: Выделение Duplicate Prevention Service (1 неделя)

**Цель**: Централизовать проверку дубликатов

**Подход**:
- Создать `DuplicatePreventionService`
- Заменить все проверки дубликатов в коде на вызовы сервиса
- Использовать БД таблицы вместо in-memory кэша

**Шаги**:

1. **Создать DuplicatePreventionService**
```javascript
// src/services/microservices/duplicatePreventionService.js
class DuplicatePreventionService {
  async checkSessionDuplicate(dealId, paymentType) {
    // Проверка дубликатов сессий через БД
  }
  
  async checkNotificationDuplicate(recipient, type, ttl) {
    // Проверка дубликатов уведомлений через БД
  }
  
  async checkEventDuplicate(eventId) {
    // Проверка дубликатов событий через БД
  }
}
```

2. **Интегрировать в монолит**
```javascript
// В PaymentSessionCreator
const duplicateService = new DuplicatePreventionService();

// Перед созданием сессии
const duplicateCheck = await duplicateService.checkSessionDuplicate(dealId, paymentType);
if (duplicateCheck.hasDuplicate) {
  return {
    success: false,
    error: 'Duplicate session exists',
    existingSession: duplicateCheck.existingSession
  };
}
```

3. **Заменить in-memory кэши**
```javascript
// Заменить notificationCache в processor на вызовы DuplicatePreventionService
const canSend = await duplicateService.checkNotificationDuplicate(
  customerEmail,
  'payment_link_created',
  24 * 60 * 60 * 1000 // 24 часа
);
```

**Результат**:
- ✅ Проверка дубликатов централизована
- ✅ Используется БД вместо in-memory кэша
- ✅ Работает между процессами и после рестарта
- ✅ Монолит использует новый сервис

---

### Фаза 3: Выделение Notification Service (1 неделя)

**Цель**: Вынести отправку уведомлений в отдельный микросервис

**Подход**:
- Создать `NotificationService`
- Монолит вызывает NotificationService вместо прямых вызовов SendPulse
- Постепенно переносить всю логику уведомлений

**Шаги**:

1. **Создать NotificationService**
```javascript
// src/services/microservices/notificationService.js
class NotificationService {
  async sendPaymentLink(dealId, sessionUrl) {
    // Отправка ссылки на оплату
    // Проверка дубликатов через DuplicatePreventionService
    // Логирование в notification_logs
  }
  
  async sendPaymentConfirmation(dealId, paymentData) {
    // Отправка подтверждения оплаты
  }
  
  async sendReminder(dealId, reminderType) {
    // Отправка напоминания
  }
}
```

2. **Интегрировать в монолит**
```javascript
// В StripeProcessorService
const notificationService = new NotificationService();

// Заменить sendPaymentNotificationForDeal на:
await notificationService.sendPaymentLink(dealId, sessionUrl);
```

**Результат**:
- ✅ Уведомления вынесены в отдельный сервис
- ✅ Централизованное логирование уведомлений
- ✅ Защита от дубликатов через DuplicatePreventionService
- ✅ Монолит использует новый сервис

---

### Фаза 4: Выделение CRM Status Service (1 неделя)

**Цель**: Вынести обновление статусов CRM в отдельный микросервис

**Подход**:
- Создать `CRMStatusService`
- Монолит вызывает CRMStatusService вместо прямых вызовов
- Постепенно переносить логику расчета статусов

**Шаги**:

1. **Создать CRMStatusService**
```javascript
// src/services/microservices/crmStatusService.js
class CRMStatusService {
  async updateDealStatus(dealId, paymentData) {
    // Расчет целевого статуса
    // Обновление в Pipedrive
    // Публикация события (если Event Bus настроен)
  }
  
  async calculateTargetStatus(dealId, payments) {
    // Расчет статуса на основе платежей
  }
}
```

2. **Интегрировать в монолит**
```javascript
// В StripeProcessorService
const crmStatusService = new CRMStatusService();

// Заменить triggerCrmStatusAutomation на:
await crmStatusService.updateDealStatus(dealId, paymentData);
```

**Результат**:
- ✅ Обновление статусов вынесено в отдельный сервис
- ✅ Логика расчета статусов централизована
- ✅ Можно тестировать независимо
- ✅ Монолит использует новый сервис

---

### Фаза 5: Выделение Payment Processing Service (2 недели)

**Цель**: Вынести обработку платежей в отдельный микросервис

**Подход**:
- Создать `PaymentProcessingService`
- Перенести логику из `persistSession()`
- Монолит вызывает сервис вместо прямой обработки

**Шаги**:

1. **Создать PaymentProcessingService**
```javascript
// src/services/microservices/paymentProcessingService.js
class PaymentProcessingService {
  async processPayment(sessionId, eventData) {
    // Валидация через ValidationService
    // Конвертация валют через ExchangeRateService
    // Сохранение в БД
    // Публикация события payment.processed
  }
  
  async savePayment(paymentData) {
    // Сохранение платежа в БД
  }
  
  async updatePaymentAmount(paymentId, newAmount, reason) {
    // Изменение суммы с сохранением истории
  }
}
```

2. **Интегрировать в монолит**
```javascript
// В StripeProcessorService.persistSession()
const paymentProcessingService = new PaymentProcessingService();

// Заменить логику persistSession на:
await paymentProcessingService.processPayment(sessionId, eventData);
```

**Результат**:
- ✅ Обработка платежей вынесена в отдельный сервис
- ✅ История изменений сохраняется
- ✅ Можно масштабировать независимо
- ✅ Монолит использует новый сервис

---

### Фаза 6: Внедрение Event Bus (2 недели)

**Цель**: Перейти на асинхронную коммуникацию через Event Bus

**Подход**:
- Настроить Event Bus (RabbitMQ/Redis PubSub)
- Постепенно заменять прямые вызовы на события
- Начать с некритичных операций

**Шаги**:

1. **Настроить Event Bus**
```javascript
// src/services/microservices/eventBus.js
class EventBus {
  async publish(eventType, data) {
    // Публикация события
  }
  
  async subscribe(eventType, handler) {
    // Подписка на события
  }
}
```

2. **Заменить прямые вызовы на события**
```javascript
// Вместо прямого вызова:
// await notificationService.sendPaymentLink(dealId, sessionUrl);

// Публикуем событие:
await eventBus.publish('session.created', {
  dealId,
  sessionId,
  sessionUrl
});

// NotificationService подписан на событие и обрабатывает его асинхронно
```

3. **Начать с некритичных операций**
- Сначала: уведомления (не критично, если задержка)
- Потом: обновление статусов CRM
- В конце: обработка платежей (критично)

**Результат**:
- ✅ Асинхронная коммуникация между сервисами
- ✅ Улучшенная производительность
- ✅ Лучшая отказоустойчивость
- ✅ Возможность горизонтального масштабирования

---

### Фаза 7: Выделение Webhook Processing Service (1 неделя)

**Цель**: Вынести обработку webhook в отдельный микросервис

**Подход**:
- Создать `WebhookProcessingService`
- Webhook handler вызывает сервис вместо прямого вызова processor
- Сервис публикует события в Event Bus

**Шаги**:

1. **Создать WebhookProcessingService**
```javascript
// src/services/microservices/webhookProcessingService.js
class WebhookProcessingService {
  async processWebhookEvent(event) {
    // Валидация подписи
    // Проверка дубликатов через DuplicatePreventionService
    // Публикация события в Event Bus
  }
}
```

2. **Интегрировать в webhook handler**
```javascript
// В routes/stripeWebhook.js
const webhookService = new WebhookProcessingService();

// Заменить прямые вызовы processor на:
await webhookService.processWebhookEvent(event);
```

**Результат**:
- ✅ Webhook обработка вынесена в отдельный сервис
- ✅ События публикуются в Event Bus
- ✅ Другие сервисы подписываются на события
- ✅ Монолит больше не обрабатывает webhook напрямую

---

### Фаза 8: Выделение Session Services (2 недели)

**Цель**: Вынести создание и мониторинг сессий в отдельные микросервисы

**Подход**:
- Создать `PaymentSessionService` из `PaymentSessionCreator`
- Создать `SessionMonitorService` из `SecondPaymentSchedulerService`
- Создать `SessionRecreationService`

**Результат**:
- ✅ Все операции с сессиями в отдельных микросервисах
- ✅ Монолит больше не создает сессии напрямую
- ✅ Полная микросервисная архитектура

---

## Принципы постепенной миграции

### 1. Обратная совместимость
- Монолит продолжает работать во время миграции
- Новые микросервисы вызываются из монолита
- Старый код не удаляется сразу, а помечается как deprecated

### 2. Двойной запуск (Dual Running)
- Старый код и новый сервис работают параллельно
- Сравниваем результаты
- Переключаемся на новый сервис только после проверки

### 3. Feature Flags
- Используем feature flags для переключения между старым и новым кодом
- Можно быстро откатить изменения
- Тестируем в продакшене на части трафика

### 4. Постепенное отключение старого кода
- После успешной миграции помечаем старый код как deprecated
- Удаляем старый код только после полной уверенности
- Документируем изменения

## Пример миграции: Validation Service

### До миграции:
```javascript
// В PaymentSessionCreator
async createSession(deal, options) {
  // Валидация в коде
  if (!deal.deal_id) {
    throw new Error('deal_id is required');
  }
  if (!deal.email) {
    throw new Error('email is required');
  }
  // ... остальная логика
}
```

### После миграции (Фаза 1):
```javascript
// В PaymentSessionCreator
const validationService = new ValidationService();

async createSession(deal, options) {
  // Валидация через сервис
  const validationResult = await validationService.validateSessionData({
    deal_id: deal.deal_id,
    email: deal.email,
    amount: deal.amount,
    currency: deal.currency
  });
  
  if (!validationResult.valid) {
    // Сохраняем ошибки в БД
    await saveValidationError({
      deal_id: deal.deal_id,
      errors: validationResult.errors,
      process_type: 'session_creation'
    });
    
    // Уведомляем менеджера
    await notifyManagerAboutErrors(deal.deal_id, validationResult.errors);
    
    // Возвращаем ошибку, но не блокируем процесс
    return {
      success: false,
      error: 'Validation failed',
      errors: validationResult.errors
    };
  }
  
  // ... остальная логика продолжается
}
```

### После полной миграции (Фаза 6+):
```javascript
// В PaymentSessionCreator
async createSession(deal, options) {
  // Валидация через сервис
  const validationResult = await validationService.validateSessionData({...});
  
  if (!validationResult.valid) {
    // Публикуем событие об ошибке
    await eventBus.publish('validation.failed', {
      deal_id: deal.deal_id,
      errors: validationResult.errors
    });
    
    return { success: false, errors: validationResult.errors };
  }
  
  // Создаем сессию
  const session = await stripe.checkout.sessions.create({...});
  
  // Публикуем событие
  await eventBus.publish('session.created', {
    deal_id: deal.deal_id,
    session_id: session.id,
    session_url: session.url
  });
  
  // NotificationService подписан на событие и отправляет уведомление асинхронно
}
```

## Метрики успеха миграции

### Для каждой фазы:
- ✅ Микросервис работает параллельно со старым кодом
- ✅ Результаты идентичны (или лучше)
- ✅ Нет деградации производительности
- ✅ Ошибки изолированы и не влияют на монолит
- ✅ Команда понимает новый сервис

### Для полной миграции:
- ✅ Все функции вынесены в микросервисы
- ✅ Монолит уменьшен до минимума (или удален)
- ✅ Event Bus обрабатывает всю коммуникацию
- ✅ Система масштабируется горизонтально
- ✅ Мониторинг показывает здоровье всех сервисов

## Риски и митигация

### Риск: Сложность отладки
**Митигация**: 
- Централизованное логирование с correlation ID
- Трейсинг запросов через все сервисы
- Подробные логи на каждом этапе

### Риск: Производительность
**Митигация**:
- Начинаем с синхронных вызовов (без Event Bus)
- Переходим на Event Bus постепенно
- Мониторим метрики производительности

### Риск: Консистентность данных
**Митигация**:
- Используем транзакции для критических операций
- Eventual consistency для некритичных операций
- Компенсирующие транзакции при ошибках

## Временная шкала

- **Фаза 0**: 1-2 недели (инфраструктура)
- **Фаза 1**: 1 неделя (Validation Service)
- **Фаза 2**: 1 неделя (Duplicate Prevention Service)
- **Фаза 3**: 1 неделя (Notification Service)
- **Фаза 4**: 1 неделя (CRM Status Service)
- **Фаза 5**: 2 недели (Payment Processing Service)
- **Фаза 6**: 2 недели (Event Bus)
- **Фаза 7**: 1 неделя (Webhook Processing Service)
- **Фаза 8**: 2 недели (Session Services)

**Общее время**: 12-14 недель (3-3.5 месяца)

**Можно ускорить**: Параллельная работа над несколькими фазами после Фазы 2

## Рекомендации

1. **Начать с Фазы 1** (Validation Service) - быстрый результат, низкий риск
2. **Затем Фаза 2** (Duplicate Prevention) - улучшает надежность
3. **Потом Фаза 3** (Notification Service) - изолирует некритичные операции
4. **Event Bus внедрять позже** (Фаза 6) - после того как сервисы работают стабильно

5. **Не спешить удалять старый код** - оставить как fallback на первое время
6. **Использовать feature flags** - для безопасного переключения
7. **Мониторить метрики** - сравнивать производительность старого и нового

## Вывод

**Да, такой подход не только возможен, но и рекомендуется!**

Постепенная миграция позволяет:
- ✅ Минимизировать риски
- ✅ Тестировать каждый шаг
- ✅ Обучать команду постепенно
- ✅ Не прерывать работу системы
- ✅ Быстро откатывать изменения при проблемах

Начинайте с малого (Validation Service) и постепенно расширяйте!
