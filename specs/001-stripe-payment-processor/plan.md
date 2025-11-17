# Implementation Plan: Stripe Payment Processor

**Branch**: `001-stripe-payment-processor` | **Date**: 2025-11-17 | **Spec**: [`/specs/001-stripe-payment-processor/spec.md`](spec.md)
**Input**: Feature specification from `/specs/[###-feature-name]/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Построить Stripe-процессор платежей, который повторяет архитектуру ProForm/wFirma: один триггер, единые таблицы и отчёты, поддержка частичных оплат и автоматическое обновление стадий сделок (stage_id=18 → 32 → 27) в зависимости от `close_date`. Интеграция должна импортировать Stripe Checkout Sessions, связывать их с CRM через metadata, конвертировать суммы в PLN, логировать возвраты в раздел «Удалённые проформы» и предоставлять данные фронтенд-отчётам. Дополнительно реализуем B2B-поток: при наличии организации подтягиваем название, адрес и NIP, сохраняем их в платёжной записи и используем при формировании Checkout Session. Для резидентов Польши включаем Stripe Tax в режиме «collect but not remit», чтобы рассчитывать VAT, но не позволять Stripe автоматически перечислять налог.

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: Node.js 18+ (Render prod)/22.x локально  
**Primary Dependencies**: Express.js, Stripe Node SDK, Supabase client, Pipedrive REST API, open.er-api.com (exchange rates), Winston logger  
**Storage**: Supabase Postgres (таблицы proformas/payments/documents), Stripe (источник платежей), Render logs  
**Testing**: Smoke-скрипты + ручной интеграционный сценарий «две сделки/два платежа» + мониторинг логов (см. research.md)  
**Target Platform**: Render Linux контейнер + статический фронтенд (VAT Margin UI)  
**Project Type**: Web backend + static frontend  
**Performance Goals**: Обработать ≥500 Checkout Sessions за один запуск <5 минут, обновление отчётов <10 секунд  
**Constraints**: Жёсткое правило графика платежей (>30 дней = 2 платежа, ≤30 = 1), VAT рассчитывается Stripe Tax только для сделок из Польши (collect/no remit), единое банковское округление, обязательное логирование без PII  
**Scale/Scope**: До нескольких тысяч платежей в месяц, две параллельные пайплайны (кемп, коливинг)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

1. **Invoice Data Fidelity** — План повторяет все поля ProForm, валюты и формат округления; Stripe записи не меняют существующие маппинги. ✅  
2. **Reliable Automation Flow** — Stripe-процессор будет подключён к тому же scheduler'у и использует идемпотентные ключи + повторные попытки. ✅  
3. **Transparent Observability** — Каждая интеграция (Stripe, Pipedrive, Supabase) обязана логировать запрос/ответ через общий logger. ✅  
4. **Secure Credential Stewardship** — Новый Stripe секрет и пр. добавляются только через env/Render secrets, без попадания в репозиторий. ✅  
5. **Spec-Driven Delivery Discipline** — Спецификация утверждена; план следует стандартному пути `spec → plan`. ✅  
6. **Operational Constraints** — Правило >30/≤30 дней, VAT logic («collect but not remit» для PL), проверка адреса и B2B реквизитов задокументированы и будут отражены в логике. ✅

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── routes/
├── middleware/
├── services/
│   ├── invoiceProcessing/     # существующий ProForm pipeline
│   ├── stripe/                # новый Stripe клиент, обмен курсами, процессор
│   └── utils/                 # currency, logging
├── repositories/
└── index.js

frontend/
├── vat-margin.html / .js      # основная страница отчётов
├── stripe-event-report/       # детализация мероприятий
└── style.css

specs/
└── 001-stripe-payment-processor/  # текущая документация
```

**Structure Decision**: Используем существующий Node backend (`src/`) и statics (`frontend/`). Новый код ложится в `src/services/stripe/` и подключается через текущие роуты/репозитории.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |

## Phase 0 — Research Summary

- See `research.md` for detailed findings (testing strategy, Stripe metadata conventions, Pipedrive stage automation, refund policy, idempotency keys).  
- Все неизвестные закрыты: тестирование теперь описано в Technical Context; зависимостей без best-practice заметок не осталось.  
- Constitution re-check: требования по данным/автоматизации/безопасности продолжают выполняться (никаких новых нарушений).

## Phase 1 — Design Outputs

- `data-model.md`: описывает сущности StripePayment, PaymentProcessorRun, ParticipantPaymentPlan, StripeDocument и журнал возвратов.  
- `contracts/stripe-processor.yaml`: OpenAPI контракты для ручного запуска процессора и отчётных API.  
- `quickstart.md`: шаги по настройке окружения, прогону процессора и проверке отчётов.  
- Agent context обновлён через `.specify/scripts/bash/update-agent-context.sh cursor-agent`.
