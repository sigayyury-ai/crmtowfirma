# Implementation Plan: Безопасное логирование без чувствительных данных

**Branch**: `002-sanitize-logs` | **Date**: 2025-10-26 | **Spec**: `specs/002-sanitize-logs/spec.md`  
**Input**: Feature specification from `specs/002-sanitize-logs/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Замаскировать чувствительные данные (PII, номера проформ, суммы, токены) в браузерной консоли, сохранив диагностическую ценность для разработчиков. Ввести единый санитайзер логов, счётчик инцидентов и экспорт отчёта о замаскированных полях. Обеспечить соответствие конституции (принципы Observability и Secure Credential Stewardship) и подготовить документацию для операторов.

## Technical Context

**Language/Version**: Node.js 18.x (выполнение фронтовых скриптов через сборку, сервер — Express)  
**Primary Dependencies**: Winston (логгер), собственные helper-утилиты; потребуется новый модуль `sanitizeLogger`  
**Storage**: N/A (инциденты хранятся в памяти/экспорте)  
**Testing**: Jest/добавить минимальный набор unit-тестов для санитайзера; ручные smoke-тесты в браузере  
**Target Platform**: Web (Render-хостинг + браузер операторов)  
**Project Type**: single/web  
**Performance Goals**: Санитайзер ≤ 5 мс на сообщение; отчёт ≤ 1 с на 10k записей  
**Constraints**: Нельзя выводить PII/token; необходимо соблюдать правила логирования конституции; логам нужен correlation id  
**Scale/Scope**: ~20 активных пользователей (операторы/разработчики); до 10k логов за сессию

## Constitution Check

- **Invoice Data Fidelity**: Не затрагивается, но санитайзер не должен искажать бизнес-данные в фоне. ✅
- **Reliable Automation Flow**: Логирование не ломает пайплайн; санитайзер должен быть idempotent. ✅
- **Transparent Observability**: Требуется обновить logger для структурированных логов с маскированием. ⚠️ (решается созданием санитайзера)
- **Secure Credential Stewardship**: Маскирование токенов обеспечивает соответствие. ✅
- **Spec-Driven Delivery Discipline**: Текущий план/спека соблюдаются. ✅

Гейты пройдены при условии внедрения санитайзера и обновления документации по логированию.

## Project Structure

### Documentation (this feature)

```text
specs/002-sanitize-logs/
├── plan.md              # Этот файл
├── research.md          # Свод правил маскировки, список шаблонов PII
├── data-model.md        # Структуры LogEntry, SanitizedField, IncidentReport
├── quickstart.md        # Инструкция по проверке логов и экспорта отчёта
├── contracts/           # Нет внешних API, можно опустить; оставить место для описания CLI отчёта
└── tasks.md             # Будет создано через /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── logger.js                # Обновить: подключить санитайзер
│   └── logSanitizer.js          # Новый модуль для маскировки
├── services/
│   └── invoiceProcessing.js     # Проверить и заменить прямые console.log (если есть)
├── scripts/
│   └── check-apis.js            # Убедиться, что вывод обезличен
└── frontend/
    └── script.js                # Обновить клиентские логи (если применимо)

tests/
└── unit/
    └── logSanitizer.test.js     # Unit-тесты санитайзера
```

**Structure Decision**: Добавляем модуль `src/utils/logSanitizer.js`, обновляем существующий `logger.js`, при необходимости корректируем фронтовые скрипты и сервисы, чтобы исключить прямой вывод PII.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Н/Д | Н/Д | Н/Д |
