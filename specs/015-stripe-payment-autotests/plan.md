# Implementation Plan: Автотесты Stripe платежей

**Branch**: `015-stripe-payment-autotests` | **Date**: 2025-01-27 | **Spec**: `specs/015-stripe-payment-autotests/spec.md`
**Input**: Feature specification from `/specs/015-stripe-payment-autotests/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Реализация автоматизированных end-to-end тестов для полного флоу Stripe платежей: от получения webhook от Pipedrive до отправки уведомления через SendPulse. Тесты будут выполняться ежедневно через cron, покрывая все критические сценарии (deposit, rest, single платежи), обработку оплат, истекших сессий и возвратов. Все результаты логируются для мониторинга стабильности функционала.

**Дополнительная задача**: При отправке сообщения в SendPulse обновлять кастомное поле контакта с deal_id из CRM для связи SendPulse контакта с CRM сделкой.

## Technical Context

**Language/Version**: Node.js 18.x (Render)  
**Primary Dependencies**: Express, node-cron, Stripe SDK, Winston logger, Supabase client, SendPulse client  
**Storage**: Supabase (test data tracking), in-memory test results (during execution), Winston logs (persistent storage)  
**Testing**: Custom test runner (Node.js scripts), Jest for unit tests (optional), manual smoke tests  
**Target Platform**: Backend (Render container)  
**Project Type**: web (single repo: backend)  
**Performance Goals**: Test suite execution ≤ 10 minutes, individual test ≤ 2 minutes  
**Constraints**: Must use Stripe test mode keys, test data must be isolated from production, 100% cleanup after execution, no impact on production deals/notifications  
**Scale/Scope**: 6 test scenarios, 1 daily execution, ~18 test assertions per run, test data: 3-6 test deals, 3-6 test Stripe sessions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Invoice Data Fidelity**: Тесты используют тестовые данные и не влияют на production. Тестовые сделки помечаются специальным идентификатором. → ✅ при использовании тестовых ключей и изоляции данных.
- **Reliable Automation Flow**: Тесты выполняются через cron с логированием всех операций. Ошибки не блокируют production функционал. → ✅ при правильной обработке ошибок и изоляции.
- **Transparent Observability**: Все тесты логируют результаты через Winston с correlation identifiers. Логи содержат достаточно информации для диагностики. → ✅ при использовании существующего logger.
- **Secure Credential Stewardship**: Тесты используют тестовые API ключи из environment variables. Никакие секреты не попадают в логи. → ✅ при использовании STRIPE_MODE=test и тестовых ключей.
- **Spec-Driven Delivery Discipline**: Спецификация создана через `/speckit.specify`, план через `/speckit.plan`. → ✅ соответствует workflow.

**Status**: ✅ All gates passed

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

```text
src/
├── services/
│   ├── stripe/
│   │   ├── processor.js          # Existing: payment processing
│   │   ├── repository.js         # Existing: database operations
│   │   └── testRunner.js         # NEW: test execution service
│   ├── scheduler.js              # Existing: cron scheduler (will add test job)
│   └── sendpulse.js              # Existing: notification service
├── routes/
│   ├── stripeWebhook.js          # Existing: Stripe webhook handler
│   └── pipedriveWebhook.js       # Existing: Pipedrive webhook handler
└── utils/
    └── logger.js                 # Existing: Winston logger

tests/
├── integration/
│   └── stripe-payment-flow.test.js  # NEW: end-to-end test suite
└── scripts/
    └── runStripePaymentTests.js     # NEW: test runner script
```

**Structure Decision**: Используем существующую структуру проекта (single backend). Тесты размещаются в `tests/integration/`, тестовый runner как сервис в `src/services/stripe/testRunner.js`, cron задача добавляется в `src/services/scheduler.js`. Тестовый скрипт для ручного запуска в `tests/scripts/`.

## Additional Feature: SendPulse Contact Deal ID Sync

**Requirement**: При отправке сообщения в SendPulse обновлять кастомное поле контакта с deal_id из CRM для связи SendPulse контакта с CRM сделкой.

**Implementation Approach**:
1. Добавить метод `updateContactCustomField()` в `SendPulseClient` для обновления кастомных полей контакта через SendPulse API
2. Обновить все места отправки сообщений через SendPulse, чтобы после успешной отправки обновлять поле `deal_id` у контакта
3. Использовать SendPulse API endpoint для обновления контакта: `PUT /contacts/{contact_id}` или `PATCH /contacts/{contact_id}`
4. Обработать ошибки обновления gracefully (не блокировать отправку сообщения)

**Affected Files**:
- `src/services/sendpulse.js` - добавить метод `updateContactCustomField(contactId, customFields)`
- `src/services/stripe/processor.js` - обновить `sendPaymentNotificationForDeal()` для обновления deal_id после отправки
- `src/routes/pipedriveWebhook.js` - обновить места отправки уведомлений
- `scripts/create-session-for-deal.js` - обновить для обновления deal_id
- `scripts/recreate-expired-sessions.js` - обновить для обновления deal_id

**Configuration**:
- Environment variable: `SENDPULSE_DEAL_ID_FIELD_NAME` (default: 'deal_id' или название кастомного поля в SendPulse)
- Кастомное поле должно быть создано в SendPulse заранее через UI или API

**Testing**:
- Unit test для `updateContactCustomField()` метода
- Integration test для проверки обновления поля после отправки сообщения
- Проверка обработки ошибок (если поле не существует или контакт не найден)

## Complexity Tracking

No constitution violations identified. All gates passed. No complexity justification needed.
