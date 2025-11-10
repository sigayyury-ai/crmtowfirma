# Data Model: Отчет по мероприятиям (Stripe)

Дата: 2025-11-10  
Основано на: `specs/001-stripe-event-report/spec.md`, `research.md`

## Обзор

Отчет строится на лету на основании успешных Stripe Checkout Sessions. Модель описывает сущности, необходимые для агрегирования данных, отображения таблицы участников и расчета итогов. Постоянное хранилище не требуется, однако структуры должны быть детерминированными и пригодными для сериализации в API и экспорт.

## Сущности

### EventReport

| Поле | Тип | Описание |
|------|-----|----------|
| `eventKey` | string | Ключ мероприятия (значение `line_item.description` либо нормализованная версия). |
| `eventLabel` | string | Человекочитаемое название мероприятия (то же, что `eventKey`, но без нормализации). |
| `currency` | string | ISO-код валюты (PLN/EUR/...). Если найдены разные валюты, значение `MULTI`. |
| `period` | object | { `from`: ISO8601, `to`: ISO8601 } — диапазон построения отчета (опционально). |
| `totalSessions` | number | Количество Checkout Sessions, включенных в отчет. |
| `totalLineItems` | number | Количество line items, соответствующих мероприятию. |
| `participants` | ParticipantSummary[] | Список участников, отсортированный по сумме (desc) или по имени. |
| `expenses` | ExpenseAllocation | Информация о введенных расходах и их распределении. |
| `totals` | ReportTotals | Итоговые суммы доходов, расходов, маржи, VAT. |
| `warnings` | string[] | Предупреждения (мультивалюта, отсутствующие данные). |
| `generatedAt` | string | ISO8601 timestamp формирования отчета. |

### ParticipantSummary

| Поле | Тип | Описание |
|------|-----|----------|
| `participantId` | string | Стабильный идентификатор: email или комбинация `customer_id` + индекс. |
| `displayName` | string | Имя участника (`customer_details.name`). |
| `email` | string | Email участника; может быть пустым, если не передан в Stripe. |
| `paymentsCount` | number | Количество успешных платежей участника в рамках мероприятия. |
| `totalAmount` | number | Сумма платежей после конвертации из integer-cent в основную валюту. |
| `averageAmount` | number | Средняя сумма = `totalAmount / paymentsCount`. |
| `expenseShare` | number | Распределенные расходы (в валюте отчета). |
| `margin` | number | `totalAmount - expenseShare`. |
| `vatRate` | number | Ставка VAT (фиксировано 0.23). |
| `vatDue` | number | `margin * vatRate`. |
| `currency` | string | Валюта, если отличается от валюты отчета (иначе совпадает). |
| `notes` | string[] | Набор комментариев/аномалий (например, «Нет email»). |

### ExpenseAllocation

| Поле | Тип | Описание |
|------|-----|----------|
| `inputAmount` | number | Сумма общих расходов, введенная аналитиком. |
| `perParticipant` | number | Расход на одного участника = `inputAmount / uniqueParticipants`. |
| `details` | object[] | Опционально: массив { `category`: string, `amount`: number } — если предоставлены детализированные расходы. |
| `currency` | string | Валюта расходов (ожидается совпадение с валютой отчета). |

### ReportTotals

| Поле | Тип | Описание |
|------|-----|----------|
| `grossRevenue` | number | Сумма всех `totalAmount` участников. |
| `expenses` | number | Сумма распределенных расходов (равна `inputAmount`). |
| `margin` | number | `grossRevenue - expenses`. |
| `vatRate` | number | Применяемая ставка VAT (23%). |
| `vatDue` | number | Суммарный VAT к оплате (`margin * vatRate`). |
| `participantsCount` | number | Количество уникальных участников. |
| `sessionsCount` | number | Количество Stripe Checkout Sessions. |

### StripeTransactionSnapshot

| Поле | Тип | Описание |
|------|-----|----------|
| `sessionId` | string | ID Checkout Session (`cs_...`). |
| `paymentIntentId` | string | ID Payment Intent (`pi_...`). |
| `status` | string | `paid`/`unpaid`/`refunded`. Для отчета используются только `paid`. |
| `lineItemId` | string | ID line item (`li_...`). |
| `description` | string | Значение `Checkout Line Item Summary`. |
| `amountTotal` | number | Сумма в минимальных единицах (например, grosz). |
| `currency` | string | ISO-код валюты. |
| `quantity` | number | Количество позиций (обычно 1). |
| `customerEmail` | string | Email из `customer_details`. |
| `customerName` | string | Имя плательщика. |
| `createdAt` | string | Дата/время платежа (ISO8601). |

Эта сущность используется временно при агрегации и не возвращается наружу целиком (кроме отладки).

### ReportExport (опционально)

| Поле | Тип | Описание |
|------|-----|----------|
| `format` | enum | `csv`, `xlsx`, `json`. |
| `generatedBy` | string | Идентификатор пользователя, запросившего экспорт. |
| `generatedAt` | string | Время генерации. |
| `payload` | object | Ссылки на файлы/буффер либо сериализованная версия `EventReport`. |

## Связи

- Один `EventReport` содержит множество `ParticipantSummary` записей и одну `ExpenseAllocation`.
- `ParticipantSummary` агрегирует несколько `StripeTransactionSnapshot`.
- `ReportTotals` производные от полей `ParticipantSummary` и `ExpenseAllocation`.

## Правила и ограничения

1. **Уникальность участника**: идентификатор формируется по email (в нижнем регистре). При отсутствии email → хэш имени + sessionId. Это гарантирует стабильное распределение расходов.
2. **Мультивалютность**: если в пределах одного мероприятия встречаются разные валюты, `EventReport.currency = 'MULTI'`, `ParticipantSummary.currency` отражает реальную валюту, а `totals` помечаются предупреждением (аналитик принимает решение вручную).
3. **Округления**: все суммы в числовых полях (кроме `amountTotal` в snapshot) хранятся в десятичном формате с точностью до 0.01. Округление — банковское (`round-half-to-even`).
4. **Расходы**: `ExpenseAllocation.perParticipant` пересчитывается при каждом изменении `inputAmount` или числа уникальных участников; значение может быть дробным — в UI показываем с двумя знаками.
5. **VAT**: ставка фиксирована 23%. Для будущих изменений допускается добавление поля `vatRateOverride` в `EventReport`.

## Дополнительные заметки

- Для кеширования можно сохранять сериализованный `EventReport` в памяти (Map по `eventKey` + `period`). Срок жизни — 15 минут.
- При экспорте формируется CSV со столбцами: `Name`, `Email`, `Total Amount`, `Expense Share`, `Margin`, `VAT Rate`, `VAT Due`. Итоги записываются отдельной строкой или в блоке «Totals».
- В Quickstart будет описано, как получить тестовые данные и построить отчёт с использованием этих структур.

