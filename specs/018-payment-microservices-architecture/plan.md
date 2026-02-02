# Implementation Plan: Payment Microservices Architecture

**Branch**: `018-payment-microservices-architecture` | **Date**: 2026-02-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/018-payment-microservices-architecture/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Постепенная миграция монолитной системы обработки Stripe платежей на микросервисную архитектуру с использованием паттерна Strangler Fig. Начинаем с выделения микросервисов вокруг основного процессора (`StripeProcessorService`, 6420+ строк), постепенно вычленяя функциональность: валидация данных, защита от дублирования, отправка уведомлений, обновление статусов CRM, обработка платежей. Каждый микросервис сначала вызывается из монолита синхронно, затем переходим на асинхронную коммуникацию через Event Bus. Система должна поддерживать Stripe платежи для физ лиц и юрлиц, гибридные платежи (Stripe + наличные), изменение сумм в процессе, проверку платежей и истекших сессий, напоминания об оплате, автоматическую смену статусов в CRM и отправку уведомлений. Ключевые требования: защита от ошибок (неблокирующая обработка, сохранение состояния для перезапуска), валидация данных с уведомлениями менеджерам, полная история всех платежей и сессий клиента, защита от дублирования сессий и уведомлений на уровне БД.

## Technical Context

**Language/Version**: Node.js 18+ (Render prod) / 22.x локально  
**Primary Dependencies**: Express.js, Stripe Node SDK (@stripe/stripe-js), Supabase client (@supabase/supabase-js), Pipedrive REST API, SendPulse API, Winston logger  
**Storage**: PostgreSQL (Supabase) - существующая БД с таблицами `stripe_payments`, `stripe_event_items`, `stripe_reminder_logs`, `cash_payments`, `product_links`. Новые таблицы: `validation_errors`, `process_states`, `notification_logs`, `payment_status_history`, `payment_amount_history`, `session_duplicate_checks`, `event_logs`, `customer_payment_history`  
**Testing**: Ручные интеграционные тесты через скрипты, smoke-тесты для каждого микросервиса, проверка через существующие диагностические эндпоинты  
**Target Platform**: Linux server (Render), Node.js runtime  
**Project Type**: Backend API (Express.js приложение)  
**Performance Goals**: Обработка до 100 одновременных платежей без деградации, время обработки платежа от webhook до обновления CRM не более 10 секунд, обработка 99% платежей без ручного вмешательства в течение 5 минут  
**Constraints**: Обратная совместимость с существующим монолитом во время миграции, сохранение всех существующих API эндпоинтов, поддержка существующих интеграций (Pipedrive, Stripe, SendPulse), сохранение логики обработки платежей (графики 50/50, 100%, VAT для PL)  
**Scale/Scope**: 529+ записей в `stripe_payments`, обработка всех типов платежей (deposit, rest, single), поддержка B2C и B2B клиентов, гибридные платежи, автоматизация статусов для всех сделок

**Event Bus Technology**: RabbitMQ, Redis PubSub, или начать с in-memory EventEmitter (Node.js EventEmitter для начала, затем миграция на внешний брокер)  
**Миграционная стратегия**: Strangler Fig Pattern - постепенное вычленение функциональности из монолита без остановки системы

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Invoice Data Fidelity
✅ **PASS** - Микросервисы не изменяют логику обработки данных платежей, только реорганизуют код. Сохранение данных в существующие таблицы `stripe_payments` сохраняет маппинг между Pipedrive deals и платежами.

### Reliable Automation Flow
✅ **PASS** - Микросервисы добавляют guardrails (валидация, защита от дублирования, retry механизмы) без изменения основного flow. Сохранение состояний процессов позволяет перезапускать после ошибок.

### Transparent Observability
✅ **PASS** - Каждый микросервис логирует операции через общий logger с correlation ID. Структурированные логи для всех операций, метрики для мониторинга.

### Secure Credential Stewardship
✅ **PASS** - Микросервисы используют существующие environment variables (STRIPE_API_KEY, SUPABASE_SERVICE_ROLE_KEY, SENDPULSE_ID). Не добавляются новые секреты, существующие используются через общие клиенты.

### Spec-Driven Delivery Discipline
✅ **PASS** - План следует стандартному пути: spec → plan → tasks → implement. Все NEEDS CLARIFICATION разрешены через research.md и gradual-migration-strategy.md.

**GATE STATUS**: ✅ **PASSED** - Все принципы соблюдены, миграция не нарушает существующие constraints.

## Project Structure

### Documentation (this feature)

```text
specs/018-payment-microservices-architecture/
├── plan.md                              # This file (/speckit.plan command output)
├── spec.md                              # Feature specification
├── research.md                          # Phase 0 output - исследование текущей БД
├── current-vs-proposed-architecture.md  # Сравнение архитектур
├── gradual-migration-strategy.md        # Стратегия постепенной миграции
├── architecture-proposal.md            # Предложение архитектуры микросервисов
├── data-model.md                        # Phase 1 output - модель данных
├── quickstart.md                        # Phase 1 output - quickstart guide
├── contracts/                           # Phase 1 output - API контракты
│   ├── validation-service-api.yaml
│   ├── duplicate-prevention-service-api.yaml
│   ├── notification-service-api.yaml
│   └── ...
├── validation-timing.md                 # Когда срабатывает валидация
├── deal-update-validation.md           # Валидация при обновлении сделок
├── diagnostics-integration.md           # Интеграция валидации с Deal Diagnostics Service
├── deployment-strategy.md               # Стратегия развертывания
└── tasks.md                             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── stripe/                          # Существующий монолит (будет уменьшаться)
│   │   ├── processor.js                 # StripeProcessorService (6420+ строк, будет рефакториться)
│   │   ├── paymentSessionCreator.js     # Будет основой для Payment Session Service
│   │   ├── secondPaymentSchedulerService.js  # Будет основой для Reminder Scheduler Service
│   │   ├── repository.js                # Существующий репозиторий (используется как есть)
│   │   └── ...
│   │
│   ├── microservices/                  # НОВАЯ ПАПКА - микросервисы
│   │   ├── baseMicroservice.js         # Базовый класс для всех микросервисов
│   │   ├── validationService.js        # Validation Service (Фаза 1)
│   │   ├── duplicatePreventionService.js  # Duplicate Prevention Service (Фаза 2)
│   │   ├── notificationService.js      # Notification Service (Фаза 3)
│   │   ├── crmStatusService.js         # CRM Status Service (Фаза 4)
│   │   ├── paymentProcessingService.js # Payment Processing Service (Фаза 5)
│   │   ├── webhookProcessingService.js  # Webhook Processing Service (Фаза 7)
│   │   ├── paymentSessionService.js    # Payment Session Service (Фаза 8)
│   │   ├── sessionMonitorService.js    # Session Monitor Service (Фаза 8)
│   │   ├── sessionRecreationService.js # Session Recreation Service (Фаза 8)
│   │   ├── reminderSchedulerService.js # Reminder Scheduler Service (из secondPaymentSchedulerService)
│   │   ├── cashPaymentService.js       # Cash Payment Service (уже существует частично)
│   │   └── exchangeRateService.js      # Exchange Rate Service (уже существует)
│   │
│   ├── eventBus/                        # НОВАЯ ПАПКА - Event Bus
│   │   ├── eventBus.js                  # Базовый Event Bus (начать с EventEmitter)
│   │   ├── eventTypes.js                # Определения типов событий
│   │   └── eventHandlers.js             # Обработчики событий
│   │
│   ├── crm/                             # Существующие сервисы CRM
│   │   ├── stripeStatusAutomationService.js  # Будет основой для CRM Status Service
│   │   └── ...
│   │
│   ├── cash/                            # Существующие сервисы наличных платежей
│   │   ├── cashPaymentsRepository.js   # Будет основой для Cash Payment Service
│   │   └── ...
│   │
│   └── sendpulse.js                     # Существующий клиент (используется в Notification Service)
│
├── routes/
│   ├── stripeWebhook.js                 # Существующий webhook handler (будет использовать Webhook Processing Service)
│   └── api.js                           # Существующие API эндпоинты
│
└── utils/
    ├── logger.js                        # Существующий logger (используется всеми сервисами)
    └── currency.js                      # Существующие утилиты валют

scripts/
├── migrations/                          # Миграции БД для новых таблиц
│   ├── 020_create_validation_errors.sql
│   ├── 021_create_process_states.sql
│   ├── 022_create_notification_logs.sql
│   ├── 023_create_payment_history_tables.sql
│   └── ...
└── inspect-stripe-payments-table.js    # Существующий скрипт для инспекции БД
```

**Structure Decision**: Используем существующую структуру проекта (single backend application). Микросервисы размещаются в `src/services/microservices/` как отдельные классы, которые могут быть вызваны из монолита синхронно или через Event Bus асинхронно. 

**ВАЖНО - Развертывание и стоимость**:
- На начальном этапе микросервисы - это **классы в том же Node.js процессе**, что позволяет постепенную миграцию **без необходимости отдельного развертывания**
- **Развертывание остается одним сервисом на Render** (как сейчас) - стоимость НЕ увеличивается
- Все микросервисы работают в одном процессе, вызываются синхронно из монолита
- В будущем можно вынести в отдельные процессы/контейнеры **только при необходимости** (масштабирование, изоляция критичных сервисов)
- **Нет необходимости** создавать отдельные сервисы на Render для каждого микросервиса - это архитектурное разделение кода, а не инфраструктурное

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Нет нарушений конституции - все принципы соблюдены.

---

## Phase 0: Research & Analysis

**Status**: ✅ **COMPLETE**

### Research Tasks

**Output**: `research.md` - Исследование текущей структуры БД для Stripe платежей

**Найденные решения**:

1. **Структура БД**: Изучена реальная структура таблицы `stripe_payments` (39 полей), обнаружены дополнительные поля (customer_email, customer_name, company_* для B2B, address_validated, expected_vat). Проблема: 62% записей имеют `payment_type = NULL`.

2. **Миграционная стратегия**: Выбран Strangler Fig Pattern - постепенное вычленение функциональности из монолита. Начинаем с микросервисов вокруг процессора, затем переходим на Event Bus.

3. **Event Bus**: Начинаем с in-memory EventEmitter (Node.js), затем мигрируем на внешний брокер (RabbitMQ/Redis PubSub) после стабилизации сервисов.

4. **Технологии**: Используем существующий стек (Node.js, Express, Supabase, Stripe SDK) без добавления новых зависимостей на начальном этапе.

5. **Валидация**: Централизованный ValidationService с сохранением ошибок в БД и уведомлениями менеджерам.

6. **Дубликаты**: DuplicatePreventionService с таблицами БД вместо in-memory кэша для работы между процессами.

7. **Текущая архитектура**: Монолитная система с `StripeProcessorService` (6420+ строк). Микросервисы не реализованы, требуется постепенная миграция.

**Дополнительные документы**:
- `current-vs-proposed-architecture.md` - детальное сравнение текущей и предложенной архитектур
- `gradual-migration-strategy.md` - стратегия постепенной миграции с планом по фазам

---

## Phase 1: Design & Contracts

**Status**: ✅ **COMPLETE**

### Data Model

**Output**: `data-model.md` - Модель данных для микросервисной архитектуры

**Основные сущности**:

1. **validation_errors** - ошибки валидации данных с детальной информацией о недостающих/некорректных полях
2. **process_states** - состояния процессов для перезапуска после исправления ошибок
3. **notification_logs** - расширенный лог отправленных уведомлений с TTL для предотвращения дубликатов
4. **payment_status_history** - история изменений статусов платежей для аудита
5. **payment_amount_history** - история изменений сумм платежей для аудита
6. **session_duplicate_checks** - логирование проверок дубликатов сессий
7. **event_logs** - логи обработанных событий для идемпотентности
8. **customer_payment_history** - агрегированная история всех платежей клиента для быстрого доступа

**Расширения существующих таблиц**:
- `stripe_payments`: добавление индекса на `customer_email`, уникальное ограничение на активные сессии

### API Contracts

**Output**: `contracts/` - OpenAPI спецификации для микросервисов

**Созданные контракты**:

1. **validation-service-api.yaml** - API для валидации данных сессий и платежей
2. **duplicate-prevention-service-api.yaml** - API для проверки дубликатов сессий, уведомлений и событий
3. **notification-service-api.yaml** - API для отправки уведомлений (payment link, confirmation, reminders)
4. **crm-status-service-api.yaml** - API для обновления статусов сделок в CRM
5. **payment-processing-service-api.yaml** - API для обработки и сохранения платежей
6. **event-bus-api.yaml** - API для публикации и подписки на события

**Примечание**: На начальном этапе микросервисы вызываются синхронно из монолита. API контракты описывают интерфейсы классов, которые будут использоваться внутри процесса. В будущем эти контракты могут стать HTTP API при вынесении микросервисов в отдельные процессы.

### Quickstart Guide

**Output**: `quickstart.md` - Пошаговое руководство по началу миграции

**Содержание**:
- Фаза 0: Подготовка инфраструктуры (создание таблиц БД, базовая структура)
- Фаза 1: Validation Service (создание, интеграция, тестирование)
- Фаза 2: Duplicate Prevention Service (создание, интеграция)
- Фаза 3: Notification Service (создание, интеграция)
- Troubleshooting и метрики успеха

**Готовность**: Quickstart guide готов для начала реализации Фазы 1

---

## Phase 2: Implementation Planning

**Status**: ⏳ **PENDING** - Будет выполнен через `/speckit.tasks`

После завершения Phase 1 будет создан `tasks.md` с детальными задачами для каждой фазы миграции.

---

## Generated Artifacts Summary

### Phase 0: Research ✅
- ✅ `research.md` - Исследование текущей структуры БД (529 записей проанализировано)
- ✅ `current-vs-proposed-architecture.md` - Сравнение монолитной и микросервисной архитектур
- ✅ `gradual-migration-strategy.md` - Стратегия постепенной миграции с планом по фазам

### Phase 1: Design ✅
- ✅ `data-model.md` - Модель данных с 8 новыми таблицами для микросервисов
- ✅ `contracts/validation-service-api.yaml` - API контракт Validation Service
- ✅ `contracts/duplicate-prevention-service-api.yaml` - API контракт Duplicate Prevention Service
- ✅ `contracts/notification-service-api.yaml` - API контракт Notification Service
- ✅ `contracts/crm-status-service-api.yaml` - API контракт CRM Status Service
- ✅ `contracts/payment-processing-service-api.yaml` - API контракт Payment Processing Service
- ✅ `contracts/event-bus-api.yaml` - API контракт Event Bus
- ✅ `quickstart.md` - Пошаговое руководство по началу миграции (Фазы 0-3)

### Ready for Phase 2
Все артефакты Phase 0 и Phase 1 готовы. Можно переходить к `/speckit.tasks` для создания детальных задач реализации.

---

## Implementation Strategy

### Подход: Постепенная миграция (Strangler Fig Pattern)

**Принцип**: Начинаем с микросервисов вокруг монолита, постепенно вычленяем функциональность

**Порядок миграции**:

1. **Фаза 0** (1-2 недели): Подготовка инфраструктуры
   - Создание таблиц БД для истории и процессов
   - Базовые классы для микросервисов
   - Event Bus (начать с EventEmitter)

2. **Фаза 1** (1 неделя): Validation Service
   - Выделение валидации в отдельный сервис
   - Сохранение ошибок в БД
   - Уведомления менеджерам

3. **Фаза 2** (1 неделя): Duplicate Prevention Service
   - Централизация проверки дубликатов
   - Замена in-memory кэша на БД

4. **Фаза 3** (1 неделя): Notification Service
   - Выделение отправки уведомлений
   - Централизованное логирование

5. **Фаза 4** (1 неделя): CRM Status Service
   - Выделение обновления статусов
   - Изоляция логики расчета

6. **Фаза 5** (2 недели): Payment Processing Service
   - Выделение обработки платежей
   - История изменений

7. **Фаза 6** (2 недели): Event Bus
   - Внедрение асинхронной коммуникации
   - Постепенный переход на события

8. **Фаза 7** (1 неделя): Webhook Processing Service
   - Выделение обработки webhook
   - Публикация событий

9. **Фаза 8** (2 недели): Session Services
   - Payment Session Service
   - Session Monitor Service
   - Session Recreation Service

**Общее время**: 12-14 недель (3-3.5 месяца)

**Подробности**: См. [gradual-migration-strategy.md](./gradual-migration-strategy.md)

---

## Success Criteria

- ✅ Каждый микросервис работает параллельно со старым кодом
- ✅ Результаты идентичны (или лучше) старой системе
- ✅ Нет деградации производительности
- ✅ Ошибки изолированы и не влияют на монолит
- ✅ Команда понимает новый сервис
- ✅ Система масштабируется горизонтально
- ✅ Event Bus обрабатывает всю коммуникацию
- ✅ Мониторинг показывает здоровье всех сервисов
