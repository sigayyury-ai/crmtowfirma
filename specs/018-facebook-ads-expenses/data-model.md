# Data Model: Facebook Ads Expenses Integration

## Обзор

Модель данных для интеграции расходов Facebook Ads в систему отчетов по продуктам. Поддерживает накопительный учет расходов и маппинг рекламных кампаний на продукты.

## Таблицы

### 1. facebook_ads_campaign_mappings

Хранит маппинг названий рекламных кампаний Facebook Ads на продукты в системе.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Уникальный идентификатор маппинга |
| `campaign_name` | TEXT | NOT NULL | Оригинальное название кампании из CSV |
| `campaign_name_normalized` | TEXT | NOT NULL | Нормализованное название для поиска |
| `product_id` | BIGINT | NOT NULL, FK → products(id) | ID продукта, на который мапится кампания |
| `created_by` | VARCHAR(255) | NULL | Пользователь, создавший маппинг |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Дата создания маппинга |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Дата последнего обновления |

**Индексы:**
- `INDEX(campaign_name_normalized)` - для быстрого поиска при импорте
- `INDEX(product_id)` - для фильтрации по продукту
- `UNIQUE(campaign_name_normalized, product_id)` - предотвращает дубликаты маппингов (одна кампания может мапиться только на один продукт, но несколько кампаний могут мапиться на один продукт)

**Важно:** Убрали UNIQUE на `campaign_name_normalized`, т.к. несколько кампаний с одинаковым названием могут мапиться на разные продукты (или на один продукт, если это разные версии кампании).

**Нормализация названий:**
- Приведение к нижнему регистру
- Удаление лишних пробелов
- Удаление специальных символов (опционально)
- Примеры:
  - "Camp / NY2026" → "camp ny2026"
  - "Event / NY2026" → "event ny2026"
  - "poland lankova09" → "poland lankova09"
  - "France 2" → "france 2"

### 2. facebook_ads_expenses

Хранит накопительные расходы по рекламным кампаниям за периоды отчетности.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Уникальный идентификатор записи |
| `campaign_name` | TEXT | NOT NULL | Оригинальное название кампании из CSV |
| `campaign_name_normalized` | TEXT | NOT NULL | Нормализованное название для связи с маппингом |
| `product_id` | BIGINT | NULL, FK → products(id) | ID продукта (из маппинга, может быть NULL если маппинг не создан) |
| `report_start_date` | DATE | NOT NULL | Дата начала отчетности (YYYY-MM-DD) |
| `report_end_date` | DATE | NOT NULL | Дата окончания отчетности (YYYY-MM-DD) |
| `amount_pln` | NUMERIC(12, 2) | NOT NULL | Накопительная сумма расходов в PLN за весь период |
| `currency` | VARCHAR(3) | DEFAULT 'PLN' | Валюта расходов |
| `is_campaign_active` | BOOLEAN | DEFAULT TRUE | Флаг активности кампании (false если расходы не изменяются между импортами) |
| `import_batch_id` | UUID | NULL | ID батча импорта для группировки |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Дата создания записи |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Дата последнего обновления |

**Индексы:**
- `UNIQUE(campaign_name_normalized, report_start_date, report_end_date)` - предотвращает дубликаты по кампании и периоду
- `INDEX(campaign_name_normalized)` - для поиска по кампании
- `INDEX(product_id)` - для фильтрации по продукту
- `INDEX(report_start_date, report_end_date)` - для фильтрации по периоду

**Логика накопления:**
- CSV содержит накопительные суммы за весь период отчетности (от даты начала до даты окончания)
- При импорте проверяется существующая запись по комбинации (campaign_name_normalized + report_start_date + report_end_date)
- Если запись существует - обновляется сумма (`amount_pln`)
- Если запись не существует - создается новая запись
- Если сумма не изменилась между импортами - `is_campaign_active = false` (кампания остановлена)
- Обработка дубликатов названий кампаний: несколько записей с одним названием, но разными суммами/периодами обрабатываются как отдельные записи

### 3. facebook_ads_import_batches

Хранит информацию о батчах импорта для аудита и отката.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Уникальный идентификатор батча |
| `file_name` | TEXT | NOT NULL | Имя загруженного файла |
| `file_hash` | TEXT | NULL | SHA256 хеш файла для предотвращения повторного импорта |
| `total_rows` | INTEGER | DEFAULT 0 | Общее количество строк в CSV |
| `processed_rows` | INTEGER | DEFAULT 0 | Количество обработанных строк |
| `mapped_rows` | INTEGER | DEFAULT 0 | Количество строк с маппингом |
| `unmapped_rows` | INTEGER | DEFAULT 0 | Количество строк без маппинга |
| `errors` | JSONB | DEFAULT '[]' | Массив ошибок при обработке |
| `imported_by` | VARCHAR(255) | NULL | Пользователь, выполнивший импорт |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Дата импорта |

**Индексы:**
- `INDEX(file_hash)` - для проверки дубликатов
- `INDEX(created_at)` - для сортировки по дате

## Связь с существующими таблицами

### products
- `facebook_ads_campaign_mappings.product_id` → `products.id`
- `facebook_ads_expenses.product_id` → `products.id`

### payments (для отображения в отчете по продуктам)
Если решено создавать записи в таблице `payments` для отображения в отчете по продуктам:
- Создаются записи с `direction='out'`, `source='facebook_ads'`
- Связь через `payment_product_links`
- **ВАЖНО:** PNL отчет должен исключать расходы с `source='facebook_ads'` из расчетов, так как PNL использует только реальные банковские транзакции

### payment_product_links
- Если расходы создаются как записи в `payments`, то связь через `payment_product_links`
- Если расходы хранятся только в `facebook_ads_expenses`, то связь напрямую через `product_id`
- **Исключение из PNL:** Расходы Facebook Ads отображаются только в отчете по продуктам (VAT Margin), но НЕ попадают в PNL отчет

## Нормализация названий кампаний

Функция нормализации должна быть идентична функции нормализации названий продуктов для лучшего маппинга:

```javascript
function normalizeCampaignName(name) {
  if (!name) return null;
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s.\-_/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
```

## Примеры данных

### facebook_ads_campaign_mappings
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "campaign_name": "NY2026 - Awareness",
  "campaign_name_normalized": "ny2026 awareness",
  "product_id": 123,
  "created_by": "user@example.com",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

### facebook_ads_expenses
```json
{
  "id": "660e8400-e29b-41d4-a716-446655440001",
  "campaign_name": "Camp / NY2026",
  "campaign_name_normalized": "camp ny2026",
  "product_id": 123,
  "report_start_date": "2025-01-01",
  "report_end_date": "2025-12-31",
  "amount_pln": 3189.86,
  "currency": "PLN",
  "is_campaign_active": true,
  "import_batch_id": "770e8400-e29b-41d4-a716-446655440002",
  "created_at": "2025-01-15T10:05:00Z",
  "updated_at": "2025-01-15T10:05:00Z"
}
```

## Миграции

См. `scripts/migrations/020_create_facebook_ads_tables.sql`

