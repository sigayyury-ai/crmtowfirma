# Tasks: VAT маржа — сопоставление платежей

**Input**: Design documents in `/specs/003-vat-margin-tracker/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md, test.csv

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 Создать директорию UI прототипа `frontend/vat-margin/` и скопировать `test.csv` в доступный путь для разработки
- [ ] T002 Добавить в `package.json` скрипт `serve:vat` для локального запуска прототипа (использовать `http-server` или `live-server`)
- [ ] T003 Настроить `npm install papaparse multer` и обновить `package-lock.json`
- [ ] T004 Добавить `.env` шаблон переменных для авторизации страницы (Google OAuth / API key) в `env.example`

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T005 Реализовать middleware авторизации (заглушка) в `src/middleware/auth.js` с проверкой заголовка/токена
- [ ] T006 Добавить rate limiting и ограничение размера файла в `src/server.js` (использовать `express-rate-limit`, `multer` limits)
- [ ] T007 Создать сервис логирования VAT маржи `src/utils/vatLogger.js` с redaction и интегрировать в существующий логгер
- [ ] T008 Обновить `README.md`/`docs` описанием безопасности и требований к доступу к странице

## Phase 3: User Story 1 – Автосопоставление банковских поступлений (Priority P1)

**Goal**: Автоматически сопоставлять платежи из CSV с проформами wFirma, фиксируя результаты и статусы
**Independent Test**: Загрузить `test.csv`, убедиться, что большинство строк сопоставлено, доступны данные проформы, рассчитана разница

### Implementation

- [ ] T009 [US1] Создать прототип раздела «Загрузка файла» в `frontend/vat-margin/index.html` и `styles.css`
- [ ] T010 [P] [US1] Подготовить модуль тестовых данных `frontend/vat-margin/sample-data.js` с массивом транзакций `test.csv`
- [ ] T011 [US1] Реализовать парсер CSV `src/services/vatMargin/csvParser.js` с потоковой обработкой и нормализацией сумм
- [ ] T012 [US1] Добавить сервис поиска проформ `src/services/vatMargin/wfirmaLookup.js` использующий `WfirmaClient`
- [ ] T013 [US1] Создать агрегатор результатов `src/services/vatMargin/matchProcessor.js` (статусы, разницы)
- [ ] T014 [US1] Реализовать маршрут загрузки `POST /api/vat-margin/upload` в `src/routes/vatMargin.js`
- [ ] T015 [US1] Обновить `src/index.js`, подключив новый маршрут с middleware авторизации
- [ ] T016 [US1] Настроить хранение jobId и результатов в `src/services/vatMargin/jobStore.js` (in-memory Map)
- [ ] T017 [P] [US1] Написать unit-тесты для парсера и сопоставления `tests/unit/vatMargin/csvParser.test.js` и `matchProcessor.test.js`
- [ ] T018 [US1] Добавить интеграционный тест загрузки `tests/integration/vatMargin/upload.test.js`

## Phase 4: User Story 2 – Агрегированный отчёт по продуктам и месяцам (Priority P2)

**Goal**: Показывать сводку по продуктам/месяцам с ожидаемыми и фактическими суммами, статусами оплат
**Independent Test**: После загрузки `test.csv` отчёт показывает корректные суммы/разницы по каждому продукту и месяцу

### Implementation

- [ ] T019 [US2] Добавить на прототип вкладку «Отчёт» с таблицей агрегатов (`frontend/vat-margin/index.html`, `script.js`)
- [ ] T020 [US2] Реализовать сервис агрегации `src/services/vatMargin/aggregator.js` (по продукту и месяцу)
- [ ] T021 [US2] Добавить маршрут получения отчёта `GET /api/vat-margin/report` в `src/routes/vatMargin.js`
- [ ] T022 [US2] Обновить `jobStore` для хранения агрегатов и статусов
- [ ] T023 [US2] Написать unit-тесты агрегатора `tests/unit/vatMargin/aggregator.test.js`
- [ ] T024 [US2] Обновить quickstart и документацию по отчётам

## Phase 5: User Story 3 – Ручная обработка неподтверждённых операций (Priority P3)

**Goal**: Управлять очередью ручной обработки, позволять назначить продукт/проформу или оставить комментарий
**Independent Test**: Операции без проформы отображаются в очереди, после ручной обработки попадают в общий отчёт

### Implementation

- [ ] T025 [US3] Добавить на прототип вкладку «Ручная обработка» с таблицей/формой (`frontend/vat-margin/index.html`, `script.js`)
- [ ] T026 [US3] Реализовать сервис очереди `src/services/vatMargin/manualQueue.js` (CRUD операции)
- [ ] T027 [US3] Добавить маршруты `GET /api/vat-margin/manual` и `POST /api/vat-margin/manual/:id`
- [ ] T028 [US3] Написать unit-тесты очереди `tests/unit/vatMargin/manualQueue.test.js`
- [ ] T029 [US3] Обновить интеграционный тест для ручной обработки `tests/integration/vatMargin/manual.test.js`

## Phase 6: Polish & Cross-cutting Concerns

- [ ] T030 Обновить `frontend/vat-margin/styles.css` — доступность, адаптивность
- [ ] T031 Добавить экспорт отчёта (CSV) `src/services/vatMargin/exporter.js` и маршрут `GET /api/vat-margin/export`
- [ ] T032 Обновить логирование и мониторинг (установка alert’ов, проверка Winston конфигурации)
- [ ] T033 Дополнить `docs/` разделом об использовании страницы и прототипа (например, `docs/vat-margin.md`)
- [ ] T034 Провести UX-ревью прототипа, зафиксировать изменения и обновить UI (при необходимости)

## Dependencies & Execution Order

- Phase 1 → Phase 2 → User Story 1 (P1) → User Story 2 (P2) → User Story 3 (P3) → Polish
- User Story 1 должен завершиться до начала User Story 2/3 (отчёт и ручная обработка зависят от базы)

## Parallel Opportunities

- Создание UI прототипа (T009-T010) можно делать параллельно с backend парсером (T011-T013)
- Тесты (T017, T018, T023, T028, T029) можно выполнять параллельно после реализации соответствующих модулей
- Polish задачи (T030-T034) частично параллельны, но лучше после завершения основных историй

## Implementation Strategy

### MVP (User Story 1)
1. Выполнить Phase 1 и Phase 2
2. Реализовать Tasки T009-T018
3. Протестировать загрузку CSV, получить базовое сопоставление

### Incremental Delivery
1. После MVP добавить агрегированный отчёт (Phase 4)
2. Затем очередь ручной обработки (Phase 5)
3. Завершить фазой Polish (Phase 6)


