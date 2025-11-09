# Implementation Plan: VAT маржа — сопоставление платежей

**Branch**: `003-vat-margin-tracker` | **Date**: 2025-10-26 | **Spec**: `specs/003-vat-margin-tracker/spec.md`
**Input**: Feature specification from `/specs/003-vat-margin-tracker/spec.md`

**Note**: This template is filled in manually to guide subsequent phases.

## Summary

Создать прототип и рабочий функционал страницы «VAT маржа», где финансовая команда загружает CSV‑выписку банка, система автоматически сопоставляет платежи с проформами из wFirma, агрегирует результаты по продуктам и месяцам, а также выводит очередь ручной обработки для проблемных операций. На первом этапе требуется HTML‑прототип с тестовыми данными (`test.csv`), затем реализация загрузки, обработки и отчётности.

## Technical Context

**Language/Version**: JavaScript (Node.js 18+, Express), HTML/CSS/Vanilla JS на клиенте  
**Primary Dependencies**: `express`, `multer` (или аналог) для загрузки файлов, `papaparse` или `csv-parse` для CSV, существующие `axios` клиенты; для прототипа — чистый HTML/CSS  
**Storage**: БД не требуется; временные данные в памяти или в файлах, возможное расширение позже  
**Testing**: Jest + supertest для API, unit‑тесты CSV‑парсинга; визуальная проверка прототипа  
**Target Platform**: Web (SPA/страница админки), backend Node.js, хостинг Render  
**Project Type**: Web приложение (backend + frontend страница)
  
**Performance Goals**: Обработка CSV до 5 тыс. строк < 3 минут; UI прототип отвечает мгновенно на переключение вкладок/фильтров  
**Constraints**: Соблюдать лимиты по памяти при чтении CSV; не хранить секреты; соответствие конституции по логированию/безопасности  
**Scale/Scope**: Одна административная страница с тремя зонами (загрузка, агрегированный отчёт, ручная обработка); аудитория — финансовая команда

## Constitution Check

| Принцип / Ограничение | Соответствие | Комментарий |
|-----------------------|--------------|-------------|
| Invoice Data Fidelity | ✅ | Сопоставление базируется на номере проформы и данных wFirma; результат фиксируем, не меняем бизнес-логику существующих сервисов |
| Secure Credential Stewardship | ✅ | Используем существующие сервисы с `.env`; доступ к API только на защищённой странице с авторизацией (предусмотреть в задачах) |
| Reliable Automation Flow | ✅ | Планировщик не нужен; ручные триггеры и прототип не нарушают автоматизацию |
| Transparent Observability | ⚠️ | Необходимо обеспечить безопасное логирование загрузок/ошибок без персональных данных → отдельная задача |
| Spec-Driven Delivery Discipline | ✅ | Следуем циклу Spec → Plan → Tasks → Implement |

**Gate**: Требуется предусмотреть безопасное логирование (без утечки CSV‑данных) и авторизацию доступа к странице — добавить в задачи.

## Project Structure

### Documentation (this feature)

```text
specs/003-vat-margin-tracker/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
├── tasks.md
├── test.csv
└── prototype/
    ├── index.html
    ├── styles.css
    └── sample-data.json (опционально)
```

### Source Code (repository root)

```text
frontend/
├── vat-margin/
│   ├── index.html        # Прототип/финальная страница (папка вида admin UI)
│   ├── styles.css
│   └── script.js
└── ...                  

src/
├── routes/
│   └── vatMargin.js      # Новый маршрут для загрузки/отчёта
├── services/
│   ├── vatMargin/
│   │   ├── csvParser.js
│   │   ├── wfirmaLookup.js
│   │   ├── aggregation.js
│   │   └── manualQueue.js
│   └── ...
└── utils/
    └── security.js (rate limiting / auth helpers)

logs/
└── vat-margin.log (если используем отдельный канал)
```

**Structure Decision**: Выделяем отдельный UI в `frontend/vat-margin`, backend-логику размещаем в `src/services/vatMargin` + новый route. Тесты добавим в `tests/unit/vatMargin` и `tests/integration/vatMargin`.

## Complexity Tracking

(Пока нарушений нет; добавим, если появятся.)

---

## Phase 0 – Research

**Goals**: Уточнить формат CSV, API wFirma для быстрого поиска проформ, требования к авторизации и логированию.

| Task | Owner | Notes |
|------|-------|-------|
| R1. Уточнить CSV формат и граничные случаи | Dev | Использовать `specs/003-vat-margin-tracker/test.csv`, подготовить описание полей |
| R2. Исследовать API wFirma: поиск проформ по номеру | Dev | Проверить, достаточно ли текущего клиента; нужны ли дополнительные endpoints |
| R3. Определить стратегию безопасного логирования | Dev/Ops | Логи без персональных данных; возможно, хранить только агрегированную статистику |
| R4. Уточнить требования к авторизации страницы | Product/Security | Решить, используем ли доменную Google-auth или API key |
| R5. Подобрать библиотеку для CSV (Papaparse vs csv-parse) | Dev | Оценить производительность и удобство |

**Deliverable**: `research.md` с ответами и выбранными решениями (CSV формат, библиотека, авторизация, wFirma API).

---

## Phase 1 – Design & Contracts

### Data Model (`data-model.md`)
- **BankTransaction**: поля из CSV + ссылка на проформу, статус сопоставления, комментарий.
- **ProformaMatch**: ID проформы, продукт, ожидаемая сумма, список платежей.
- **ProductAggregate**: продукт, месяц, ожидаемая сумма, фактическая сумма, разница, статус (OK/Partial/Over/No data).
- **ManualReviewItem**: ссылка на исходную запись, причина, назначенный продукт/примечание.

### API Contracts (`contracts/`)
- `POST /api/vat-margin/upload` — загрузка CSV, ответ с идентификатором обработки и первичной статистикой.
- `GET /api/vat-margin/report?jobId=` — агрегированный отчёт (группировка по продуктам/месяцам).
- `GET /api/vat-margin/manual?jobId=` — очередь ручной обработки.
- `POST /api/vat-margin/manual/:id` — обновить решение по конкретному элементу.
- `GET /api/vat-margin/sample` — выдаёт пример CSV и тестовые данные для прототипа.
- Защитные маршруты через middleware авторизации (решение из исследований).

### Quickstart (`quickstart.md`)
- Настройка `.env` ( wFirma, auth ).
- Как запустить страницу `frontend/vat-margin/index.html` (в dev-режиме или через express статический сервер).
- Как прогнать загрузку CSV и просмотреть отчёт.

### Prototype (`frontend/vat-margin/index.html`)
- Статика с тестовыми данными (разметка + таблицы + карточки).
- Возможность переключаться между вкладками «Загрузка», «Отчёт», «Ручная обработка».

### Observability & Security
- Middleware для авторизации (см. результаты R4).
- Middleware для ограничения скорости и размера файлов.
- Логгер с redaction (не выводить полные строки CSV, только статистику).

---

## Phase 2 – Implementation Outline (preview)

(Будет подробно в `tasks.md`, но сейчас ключевые шаги:) 
1. Реализовать прототип (HTML/CSS/JS) → согласовать.
2. Настроить backend: загрузка CSV, парсинг, кэширование данных jobID.
3. Интеграция с wFirma (поиск проформ, кеширование ответов).
4. Расчёт агрегатов и очередь ручной обработки.
5. Экспорт отчёта (CSV/Excel) и журнал обработки.
6. Тестирование, документация.

---

## Risks & Mitigations

- **Большой объём CSV**: использовать потоковый парсинг, лимиты размера файлов.
- **Неточность номеров проформ**: предусмотреть fuzzy-матчинг или чёткую валидацию (в ручную очередь).
- **API wFirma медленно отвечает**: кеш, батч-запросы, задержки/ретраи.
- **Безопасность**: страница только для авторизованных; редактирование логов; исключение персональных данных.
- **Прототип отрывается от реалити**: регулярно синхронизировать макет с разработкой, фиксировать изменения.

---

## Next Steps

1. Выполнить исследования (Phase 0).
2. Обновить `research.md`, затем `data-model.md`, `contracts`, `quickstart.md`.
3. Запустить `/speckit.tasks` после завершения вышеуказанных артефактов.

---
