# Tasks: Безопасное логирование без чувствительных данных

**Input**: Design documents from `/specs/002-sanitize-logs/`  
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: Автотесты не обязательны, но unit-тест для санитайзера добавлен для ключевой логики.

**Organization**: Tasks organized by user story to enable independent implementation and testing.

## Phase 1: Setup (Shared Infrastructure)

- [ ] T001 [P] Создать исследование по шаблонам PII `specs/002-sanitize-logs/research.md`
- [ ] T002 [P] Задокументировать структуры LogEntry и IncidentReport `specs/002-sanitize-logs/data-model.md`
- [ ] T003 [P] Подготовить quickstart с инструкциями по проверке логов `specs/002-sanitize-logs/quickstart.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

- [ ] T004 Создать модуль санитайзера `src/utils/logSanitizer.js`
- [ ] T005 [P] Добавить unit-тесты для санитайзера `tests/unit/logSanitizer.test.js`
- [ ] T006 Интегрировать санитайзер в общий логгер `src/utils/logger.js`
- [ ] T007 Обновить конфигурацию логирования и ENV-флаги `src/index.js`

---

## Phase 3: User Story 1 - Сотрудник видит только обезличенные логи (Priority: P1) 🎯 MVP

**Goal**: Исключить попадание PII и финансовых данных в консоль браузера.

**Independent Test**: Запустить ручной сценарий обработки и убедиться, что в консоли нет email, телефонов, номеров проформ или сумм.

### Implementation for User Story 1

- [ ] T008 [US1] Реализовать маскировку email/phone/token `src/utils/logSanitizer.js`
- [ ] T009 [US1] Реализовать маскировку номеров проформ и сумм `src/utils/logSanitizer.js`
- [ ] T010 [P] [US1] Обновить фронтовые логи для использования санитайзера `frontend/script.js`
- [X] T011 [US1] Заменить прямой вывод PII в сервисах `src/services/invoiceProcessing.js`
- [X] T012 [US1] Обновить инструкции операторов о безопасности логов `specs/002-sanitize-logs/quickstart.md`

---

## Phase 4: User Story 2 - Разработчик сохраняет диагностическую ценность (Priority: P2)

**Goal**: Сохранить техническую информативность логов без раскрытия данных клиентов.

**Independent Test**: Включить режим разработки и убедиться, что статусы/тайминги доступны, а PII остаётся замаскированной.

### Implementation for User Story 2

- [X] T013 [US2] Добавить структурированное поле metadata в вывод логов `src/utils/logger.js`
- [ ] T014 [P] [US2] Реализовать флаг DEV_VERBOSE_LOGS и обработку `src/utils/logger.js`
- [ ] T015 [US2] Добавить проверки флага в unit-тестах `tests/unit/logSanitizer.test.js`
- [ ] T016 [US2] Обновить developer guidelines в quickstart `specs/002-sanitize-logs/quickstart.md`

---

## Phase 5: User Story 3 - Аналитик получает отчёт о нарушениях (Priority: P3)

**Goal**: Предоставить отчёт о замаскированных данных и потенциальных инцидентах.

**Independent Test**: Сформировать отчёт после тестового прогона и убедиться, что все замаскированные поля отражены.

### Implementation for User Story 3

- [ ] T017 [US3] Реализовать счётчик инцидентов и регистрацию `src/utils/logSanitizer.js`
- [ ] T018 [P] [US3] Создать CLI-скрипт экспорта отчёта `src/scripts/export-log-incidents.js`
- [ ] T019 [US3] Задокументировать процесс экспорта отчёта `specs/002-sanitize-logs/quickstart.md`
- [ ] T020 [US3] Добавить сценарий ручной проверки отчёта `specs/002-sanitize-logs/research.md`

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 Проверить и очистить существующие `console.log` на соответствие политике `src/**/*.js`
- [ ] T022 Провести smoke-тесты в staging и зафиксировать результаты `docs/business-requirements.md`

---

## Dependencies & Execution Order

- Setup (Phase 1) → Foundational (Phase 2) → User Story 1 (P1) → User Story 2 (P2) → User Story 3 (P3) → Polish.
- User Story 1 является MVP и должна быть внедрена первой.
- User Story 2 и 3 могут стартовать только после завершения базовой интеграции санитайзера (Phase 2) и выполнения US1.

## Parallel Opportunities

- T001–T003 (документация) могут выполняться параллельно.
- T005, T010, T014, T018 помечены как [P] и могут выполняться одновременно при отсутствии конфликтов.
- После завершения T004–T007 задачи в рамках каждого user story можно распределять между разработчиками.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Выполнить фазы Setup и Foundational.
2. Реализовать User Story 1 и провести ручной тест.
3. Выпустить минимальное обновление для безопасности логов.

### Incremental Delivery

1. После MVP добавить User Story 2 для сохранения диагностической ценности.
2. Затем внедрить User Story 3 с отчётами и мониторингом.
3. Завершить Polish-этапом и smoke-тестами.

### Parallel Team Strategy

- Разработчик A: Фазы 1–2, затем User Story 1.
- Разработчик B: После завершения US1 занимается User Story 2.
- Разработчик C: Параллельно с B реализует User Story 3 (после T004–T012).

## Notes

- Тесты отмечены только там, где необходим unit-тест для санитайзера.
- Убедитесь, что новые файлы включены в lint/test pipeline.
- После завершения задач обновите `/specs/002-sanitize-logs/tasks.md` статусами.
