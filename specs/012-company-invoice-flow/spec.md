# Feature Specification: B2B Invoice Processing

**Feature Branch**: `012-company-invoice-flow`  
**Created**: 2025-11-17  
**Status**: Draft  
**Input**: "Обработать сделки, где плательщик — компания. Вместо проформ создаём полноценные инвойсы во wFirma, подтягиваем название организации и её NIP из сущности Organization в Pipedrive, сохраняем в отчёты и запускаем тот же платёжный и коммуникационный флоу, что уже работает для B2C."

## Overview

Существующий процессор проформ покрывает только B2C клиентов (контактные лица). Для B2B сделок, где в Pipedrive заполнена организация, нужно создавать сразу финальные инвойсы в wFirma, дополняя их юридическим названием и NIP компании. При этом сохраняются все текущие механики: связка со сделкой, расчёт платежей, публикация в отчёты, отправка уведомлений в SendPulse/Telegram и аудиторские логи. Новая логика должна автоматически выбирать тип документа «Invoice» вместо «Proforma» и корректно прокидывать реквизиты юридического лица во все downstream-сервисы.

## Trigger & Data Exchange Fields (СМК)

| Поле в СМК/CRM | Source | Назначение | Куда сохраняем |
| --- | --- | --- | --- |
| `smk_trigger_name` | Deal custom field | Имя триггера (например, `wfirma_company_invoice`), по которому оркестратор запускает процессор | ProcessorRun log (`trigger_name`) |
| `invoice_type` | Deal custom field | Значение `company` переводит сделку в B2B поток, `person` оставляет стандартные проформы | `payments.invoice_type`, `documents.document_type` |
| `organization_id` | Deal system field | Связывает сделку с записью Organization via `https://comoon.pipedrive.com/organization/{id}`; если поле пустое или =0, работа идёт по стандартному маршруту проформ | Processor context, `payments.organization_id` |
| `deal_id` | Deal system field | Основной идентификатор в ПД и ссылочный ключ в БД | `payments.deal_id`, `documents.deal_id`, `reports` |
| `company_name` | Organization `name` | Покупатель в инвойсе | wFirma payload `buyer_name`, `documents.metadata` |
| `company_nip` | Organization `nip`/`vat_number` | Налоговый номер для инвойса | wFirma payload `buyer_tax_id`, `documents.metadata` |
| `company_country` | Organization address (`address.country` или `address_country` поле) | Определяет необходимость начислять VAT (Poland vs Rest) | Processor payload, `documents.metadata.country`, влияет на расчёт |
| `sendpulse_campaign_id` | Deal custom field | Канал коммуникации | `notifications.sendpulse_campaign_id` |
| `telegram_chat_id` | Deal/Person custom field | Chat ID для алертов | `notifications.telegram_chat_id` |
| `document_url` | Persisted after creation | Ссылка на PDF из wFirma | `documents.url`, передаётся в СМК в ответ |
| `invoice_number` | CRM custom field | Синхронизируется с `fullnumber` | CRM update (spec 009), `documents.fullnumber` |

> СМК видит полный жизненный цикл документа: триггер → процессор → wfirma → отчёты → обратная запись в CRM. Каждое поле должно быть доступно в payload-е события и в ответе процессора, чтобы оркестратор мог завершить задачу или создать ретрай.

## User Scenarios & Testing

### Scenario 1 — Автоматическое создание инвойса для сделки компании (P1)
1. **Предусловия**: В Pipedrive есть сделка с привязанной организацией, заполнены поля «Invoice type = Company», название компании и NIP в карточке Organization.
2. **Действия**: Планировщик запускает процессор; тот распознаёт, что сделка относится к организации, подтягивает данные из Organization, собирает payload и вызывает wFirma API для создания инвойса.
3. **Ожидаемый результат**: В wFirma появляется инвойс с юридическим названием и NIP, документ получает номер `CO-INV …`, запись связывается со сделкой, а в БД сохраняются ссылки на документ.
4. **Тест**: Запустить обработку тестовой сделки с организацией и убедиться, что созданный документ в wFirma содержит корректные реквизиты и что поле `invoice_type` в нашей БД = `company_invoice`.

### Scenario 2 — Репликация данных в отчёты и платежные расчёты (P1)
1. **Предусловия**: Создан хотя бы один B2B инвойс, база отчётов поддерживает записи проформ.
2. **Действия**: Финансовый аналитик строит месячный или продуктовый отчёт (веб-вкладки «Monthly report», «Product report» и выгрузки).
3. **Ожидаемый результат**: Инвойсы компаний попадают в те же агрегаты, что и проформы, суммы и статусы оплаты участвуют в расчётах маржи, «deleted proforma» журнал также фиксирует отменённые инвойсы.
4. **Тест**: Сравнить суммы по сделке в отчёте и в wFirma; разница не превышает 1 PLN, инвойс отображается под своим номером и признаётся в KPI.

### Scenario 3 — Обновление CRM и подготовка к коммуникациям (P2, временно без авторассылки)
1. **Предусловия**: Инвойс создан, CRM-обновления доступны, но автоматические уведомления отключены для тестовой фазы.
2. **Действия**: После создания инвойса процессор заполняет поле `Invoice number`, сохраняет ссылку на PDF и кладёт данные в очередь/таблицу для последующей ручной или отложенной отправки.
3. **Ожидаемый результат**: CRM отражает номер документа, в логе есть запись о подготовке сообщения, но фактическая отправка email/SendPulse/Telegram не выполняется автоматически.
4. **Тест**: Проверить карточку сделки и запись в таблице `notifications_queue` (или аналогичной) — данные готовы к ручной отправке.

## Functional Requirements

1. **Определение типа сделки**
   - Новое условие: если у сделки заполнено поле `organization_id` (не `0`/`null`) и `invoice_type = company` (или аналогичный флаг), процессор выбирает B2B маршрут.
   - Фолбек: сделки без организации продолжают обрабатываться в B2C потоке (прежние проформы).

2. **Загрузка реквизитов из Pipedrive**
   - Читаем сущность Organization по `organization_id` из API `https://comoon.pipedrive.com/organization/{id}` (стандартные REST/GraphQL эндпоинты CRM).
   - Минимальные поля: `name`, `nip` (или `vat_number`), юридический адрес, включая страну (берём из `address.country` / `address_country`).
   - При отсутствии NIP процессор помечает сделку ошибкой «Missing company tax id» и не создаёт документ, уведомляя оператора.

3. **Формирование инвойса wFirma**
   - Используем API `invoices` вместо `proformas`.
   - Поля `buyer_name` = юридическое название, `buyer_tax_id` = NIP, `buyer_type` = company.
   - Линии документов и расчёт сумм полностью совпадают с B2C (с учётом ставок VAT, скидок, валюта PLN).
   - Если `organization.country = Poland/PL`, выставляем стандартный VAT (23% или ставка продукта); если страна отлична от Польши, инвойс формируется без VAT (0% или reverse charge) и это отражается в отчётах.
   - Возвращённые поля `id`, `fullnumber`, `status` сохраняются в `documents`/`payments`.

4. **Связь с CRM и базой**
   - В таблицах `payments`, `document_activity`, `reports` добавляется флаг `source = invoice_company`.
   - Поле «Invoice number» в сделке заполняется номером инвойса (идентично механике спецификации `009-crm-invoice-sync`).
   - ProcessorRun логирует факт создания инвойса и сохраняет payload без NIP (PII защита) либо маскирует его.

5. **Отчёты и аналитика**
   - Месячный и продуктовый отчёты агрегируют B2B инвойсы вместе с проформами; фильтр по типу документа остаётся.
   - Удалённые/отменённые инвойсы попадают в `deleted proforma report` с новым типом «Invoice».
   - Экспорт CSV/HTML должен содержать колонку `Company name`, `NIP`, `Document type`.

6. **Коммуникации (отложено)**
   - На этом этапе мы только готовим payload (шаблон «Invoice», номер, ссылка) и складываем его в `notifications_queue` / таблицу `notifications` с признаком `document_kind = invoice`.
   - Автоматическая отправка email/SendPulse/Telegram отключена; операторы могут запускать её вручную или через отдельный батч позднее.
   - В СМК/логах фиксируем статус `pending_manual_send`, чтобы при релизе авторассылки легко включить флаг.

7. **Ошибки и повторы**
   - При исключении (нет организации, пустой NIP, ошибка в wFirma) делаем до 3 ретраев, затем записываем в `failed_tasks`.
   - Повторная обработка сделки должна распознать уже созданный инвойс и не создавать дубль; при необходимости обновляет CRM и отчёты.

8. **Расширение процессора проформ**
   - Существующий процессор (`proformaProcessor` / `invoiceProcessing`) получает новый модуль `documentTypeStrategy`, который выбирает `proforma` или `invoice` в зависимости от `invoice_type`.
   - Все стадии пайплайна (fetch deal, build payload, create document, persist, notify) должны использовать абстракцию `documentKind`, чтобы не дублировать код.
   - При миграции включить фича-флаг `enable_company_invoices`; в логах указывать старый/новый код.

9. **Документация wFirma**
   - Обновить внутреннее описание API: для инвойсов используем endpoint `/invoices`, тип `invoice` вместо `proforma`.
   - Зафиксировать различия: допустимые статусы (`issued`, `paid`, `cancelled`), другая нумерация (`CO-INV`), обязательные поля (NIP).
   - Обмен с wFirma должен учитывать дополнительные вебхуки (оплаты/аннулирования), отличные от проформ.

## Data Mapping

| Source | Field | Destination | Notes |
| --- | --- | --- | --- |
| Pipedrive Deal | `id` | DB `payments.deal_id`, wFirma metadata | существующая логика |
| Pipedrive Deal | `organization_id` | Processor context | определяет B2B маршрут |
| Pipedrive Organization | `name` | wFirma `buyer_name` | обязательное поле |
| Pipedrive Organization | `nip` / `vat_number` | wFirma `buyer_tax_id` | обязательное поле |
| wFirma Invoice response | `fullnumber` | CRM field «Invoice number», reports | позже попадает в сообщения |
| wFirma Invoice response | `id`, `url` | DB `documents`, SendPulse payload | сохраняем для PDF |

## Database Model & Relations

- `payments` — центральная таблица, связывает `deal_id`, `organization_id`, `document_id`, `payment_status`, `invoice_type`. FK на `documents`.
- `documents` — хранит все созданные документы (проформы и инвойсы) с полями `document_type`, `fullnumber`, `wfirma_id`, `url`, `buyer_name`, `buyer_tax_id`. FK на `deals`.
- `document_activity` — события жизненного цикла (создан, отправлен, оплачен, отменён) с указанием `document_type` и `processor_run_id`.
- `reports_monthly` и `reports_product` — агрегаты: агрегируют `payments.amount_pln`/`vat`, фильтруют по `document_type`.
- `deleted_proformas` (теперь `deleted_documents`) — журнал отменённых проформ/инвойсов. Требуется колонка `document_type` и ссылка на `documents.id`.
- `processor_runs` — фиксирует запуск задачи (smk_trigger_name, время старта/окончания, статус, payload).

Связи:
1. `deals (CRM snapshot)` 1→N `payments`.
2. `payments` 1→1 `documents`.
3. `documents` 1→N `document_activity` и 1→N `reports_*`.
4. `processor_runs` 1→N `document_activity` (по run_id) и 1→N `failed_tasks`.

## Success Criteria

- **SC-001**: 99% сделок с признаком «company invoice» получают созданный инвойс с корректными реквизитами в течение 5 минут после запуска процессора.
- **SC-002**: Ежемесячные и продуктовые отчёты отражают суммы по B2B инвойсам, расхождение с выгрузкой wFirma ≤1%.
- **SC-003**: Поле «Invoice number» в Pipedrive заполняется, а данные для рассылки попадают в очередь `notifications` менее чем через 2 минуты; фактическая отправка выполняется вручную.
- **SC-004**: Все ошибки отсутствия NIP или доступа к Organization логируются и видны в мониторинге в течение 1 минуты.

## Assumptions

- Поля Organization (название, NIP, адрес) уже доступны через текущий Pipedrive токен.
- wFirma API настроен на создание стандартных инвойсов и использует ту же нумерацию, что и ручной процесс.
- База данных поддерживает хранение документального типа и доп. колонок без миграции структуры (или миграция предусмотрена в рамках задачи).
- Шаблоны коммуникаций поддерживают подстановку нового набора переменных (название организации, NIP).
- СМК предоставляет payload с полями триггера/обмена данных, описанными выше; формат событий не меняется.
- Автоматическая отправка уведомлений выключена конфигурацией; включение произойдёт отдельной задачей после тестовой фазы.

## Out of Scope

- Генерация проформ для B2B клиентов (они полностью переключаются на инвойсы).
- Модификация UI в CRM или фронтендах, кроме отображения новых данных в отчётах.
- Автоматическая валидация NIP в государственных сервисах (пока принимаем значение из CRM «как есть»).
- Авторассылка email/SendPulse/Telegram в рамках первого релиза B2B инвойсов.

## Open Questions

 1. Требуется ли хранить юридический адрес и контактное лицо из Organization в документе/БД?
 2. Нужно ли обновлять статус сделки на конкретную стадию после оплаты инвойса или достаточно текущего поведения?
 3. Есть ли отдельные шаблоны уведомлений для международных компаний (EN vs PL)?
 4. Нужно ли расширить `reports` отдельной вкладкой только для инвойсов компаний или достаточно общего фильтра?
5. Когда планируется повторное включение авторассылки и нужен ли для этого отдельный фича-флаг?
