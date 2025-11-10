# Tasks: Отчет по мероприятиям (Stripe)

**Input**: Design docs `/specs/001-stripe-event-report/` (spec, plan, research, data-model, contracts, quickstart)  
**Goal**: Реализовать отчет по мероприятиям на данных Stripe, распределение расходов и экспорт

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Создать структуру UI отчета `frontend/stripe-event-report/` с файлами `index.html`, `styles.css`, `script.js`
- [ ] T002 Добавить статический маршрут/статическую раздачу для новой страницы в `src/index.js` и обновить навигацию `frontend/index.html`
- [ ] T003 Обновить `env.example`, задокументировав `STRIPE_API_KEY` и связанные переменные (`STRIPE_TIMEOUT_MS`, при необходимости)
- [ ] T004 Установить Stripe SDK `npm install stripe` и обновить `package-lock.json`
- [ ] T005 Добавить записи в `docs/` или `README.md` о новой странице и требованиях доступа

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T006 Создать модуль `src/services/stripe/client.js` (инициализация Stripe SDK, таймауты, retries)
- [ ] T007 Реализовать utility `src/utils/currency.js` (конвертация из minor units, банковское округление, форматирование)
- [ ] T008 Обновить `src/middleware/auth.js` или соответствующий middleware, чтобы ограничить доступ к отчётным маршрутам ролью `finance`
- [ ] T009 Настроить логирование Stripe вызовов в `src/utils/logger.js`/`vatLogger.js` (маскировка PII, correlation-id)
- [ ] T010 Добавить health-check маршрут `GET /api/reports/stripe-events/health` в `src/routes/api.js`, использующий новый клиент

## Phase 3: User Story 1 – Формирование отчета по мероприятию (Priority P1)

**Goal**: Аналитик получает таблицу участников с суммами, расходами (пока 0) и VAT на основе Stripe данных  
**Independent Test**: Запрос `GET /api/reports/stripe-events/:eventKey` возвращает корректный отчёт для тестового мероприятия; UI отображает таблицу участников и итоги

### Backend

- [ ] T011 [P] [US1] Реализовать сервис `src/services/stripe/eventReportService.js` (загрузка Checkout Sessions, фильтрация по status, агрегирование line items, построение `EventReport`)
- [ ] T012 [US1] Добавить кэш (in-memory Map) и опцию invalidate в сервисе (`eventReportCache.js`)
- [ ] T013 [US1] Реализовать API `GET /api/reports/stripe-events/summary` и `GET /api/reports/stripe-events/:eventKey` в `src/routes/stripeEventReport.js` и подключить к `src/routes/api.js`
- [ ] T014 [US1] Написать unit-тесты сервиса: `tests/unit/stripe/eventReportService.test.js` (моки Stripe клиента, проверки агрегации, мультивалютности)
- [ ] T015 [US1] Создать интеграционный тест `tests/integration/stripe/eventReportRoutes.test.js` (mocks, проверка ответов и ошибок)

### Frontend

- [ ] T016 [US1] Реализовать загрузку списка мероприятий и детализации в `frontend/stripe-event-report/script.js` (fetch summary + detail, state management)
- [ ] T017 [US1] Сверстать таблицу участников и блок итогов в `frontend/stripe-event-report/index.html`/`styles.css`
- [ ] T018 [US1] Добавить отображение предупреждений (мультивалютность, пустые данные) и даты построения отчета

## Phase 4: User Story 2 – Ввод и распределение расходов (Priority P2)

**Goal**: Аналитик вводит общую сумму расходов, система пересчитывает расход на участника, маржу и VAT  
**Independent Test**: POST `/expenses` + UI форма обновляют участника и итоги без ручных расчётов

### Backend

- [ ] T019 [US2] Реализовать POST `/api/reports/stripe-events/:eventKey/expenses` (валидация, сохранение вводимых расходов в кэше, перерасчет `EventReport`)
- [ ] T020 [US2] Добавить тесты перерасчета расходов `tests/unit/stripe/expenseAllocation.test.js`
- [ ] T021 [US2] Обновить интеграционный тест маршрутов, проверяя workflow «получить отчёт → отправить расходы → получить обновлённый отчёт»

### Frontend

- [ ] T022 [US2] Добавить форму ввода расходов (общая сумма + таблица категорий) и обновление UI при сохранении
- [ ] T023 [US2] Реализовать отображение доли расхода на участника и маржи в таблице
- [ ] T024 [US2] Обновить UX для ошибок/валидации (неверные суммы, валюты)

## Phase 5: User Story 3 – Контроль итогов и экспорт (Priority P3)

**Goal**: Аналитик сверяет итоги и сохраняет отчёт (CSV), минимизируя ручную работу  
**Independent Test**: Экспортированный CSV совпадает с UI, блок итогов отображает финальные суммы и VAT

### Backend

- [ ] T025 [US3] Реализовать `GET /api/reports/stripe-events/:eventKey/export?format=csv` (используя `reportExports/csvFormatter.js`)
- [ ] T026 [US3] Дополнить сервис итогами (`ReportTotals`) и обеспечить валидацию мультивалютности (возвращать предупреждение/ошибку 409)
- [ ] T027 [US3] Добавить тесты экспортера `tests/unit/stripe/reportExport.test.js`

### Frontend

- [ ] T028 [US3] Добавить кнопку «Экспорт CSV» и обработку загрузки файла в `frontend/stripe-event-report/script.js`
- [ ] T029 [US3] Отобразить блок итогов (доход, расходы, маржа, VAT) и их сверку с таблицей
- [ ] T030 [US3] Добавить индикаторы статуса отчёта (например, «готов к экспорту», «требует ручной проверки»)

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T031 Дополнить документацию (`docs/`, `quickstart.md`, README) финальными инструкциями и скриншотами
- [ ] T032 Провести security review: убедиться, что ключ Stripe не логируется, middleware применён ко всем маршрутам, PII маскированы
- [ ] T033 Добавить мониторинг ошибок (alert/лог) и проверить `logs/` на отсутствие чистых email
- [ ] T034 Провести UX walkthrough с финансовой командой, собрать фидбек и зафиксировать follow-up задачи
- [ ] T035 Актуализировать `frontend/style.css` или общие стили, чтобы новая страница была консистентна с существующим интерфейсом

## Dependencies & Execution Order

- Phase 1 (Setup) → Phase 2 (Foundational) → US1 (P1) → US2 (P2) → US3 (P3) → Polish
- US1 должен завершиться до начала US2/US3 (они используют сервис отчета)
- Экспорт (US3) можно начинать параллельно с UI обновлениями US2 после готовности API

## Parallel Opportunities

- В Phase 1 параллельно можно выполнять T001/T002 (UI) и T003/T004 (backend настроики)
- Foundational задачи T006–T010 частично параллельны (разные файлы)
- В US1 frontend (T016–T018) и backend (T011–T015) могут идти параллельно через контракт API
- Тесты (T014, T015, T020, T021, T027) можно запускать после завершения соответствующих модулей, не блокируя UI

## Implementation Strategy

### MVP (User Story 1)
1. Завершить Phase 1 и Phase 2
2. Реализовать T011–T018
3. Демонстрировать базовый отчёт без расходов/экспорта

### Incremental Delivery
1. После MVP добавить ввод расходов (US2)
2. Затем итоги + экспорт (US3)
3. Завершить полиш-задания и документирование

