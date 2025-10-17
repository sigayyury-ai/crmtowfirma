# Pipedrive to wFirma Integration

Интеграция между Pipedrive CRM и wFirma системой учета для автоматического создания счетов.

## Основные функции

- Автоматическое создание Proforma счетов в wFirma на основе сделок Pipedrive
- Поиск/создание контрагентов в wFirma по email
- Использование данных продукта из Pipedrive (название, цена, количество)
- Расчёт графика платежей (50/50 или 100%) и вставка в описание счета
- Назначение тегов (этикеток) в wFirma по названию продукта (ограничено 16 символами)
- Динамический выбор банковского счета по валюте
- Возможность запуска вручную (CLI / REST) и через планировщик

Полную архитектуру и бизнес-требования см. в `docs/architecture.md` и `docs/business-requirements.md`.

## Маппинг стран

Система поддерживает нормализацию кодов стран из различных источников в стандартные ISO коды:

### Поддерживаемые форматы

**Польские названия (из wFirma):**
- `Polska` → `PL`
- `Niemcy` → `DE`
- `Francja` → `FR`
- `Wielka Brytania` → `GB`
- `Stany Zjednoczone` → `US`
- `Czechy` → `CZ`
- `Litwa` → `LT`
- `Łotwa` → `LV`
- `Estonia` → `EE`

**Английские названия (из CRM):**
- `Poland` → `PL`
- `Germany` → `DE`
- `France` → `FR`
- `United Kingdom` → `GB`
- `United States` → `US`
- `Czech Republic` → `CZ`
- `Lithuania` → `LT`
- `Latvia` → `LV`
- `Estonia` → `EE`

**ISO коды (пропускаются без изменений):**
- `PL`, `DE`, `FR`, `GB`, `US`, `CZ`, `LT`, `LV`, `EE`

### Использование

Функция `normalizeCountryCode()` автоматически вызывается при создании контрагентов в wFirma для обеспечения корректного формата кода страны.

## Конфигурация

### Переменные окружения

Создайте файл `.env` на основе `env.example`:

```bash
# Pipedrive API Configuration
PIPEDRIVE_API_TOKEN=your_pipedrive_token
PIPEDRIVE_BASE_URL=https://api.pipedrive.com/v1

# wFirma API Configuration
WFIRMA_APP_KEY=your_app_key
WFIRMA_ACCESS_KEY=your_access_key
WFIRMA_SECRET_KEY=your_secret_key
WFIRMA_BASE_URL=https://api2.wfirma.pl

# Server Configuration
PORT=3000
NODE_ENV=development
```

### Банковские счета

Настройте банковские счета в `config/bank-accounts.js`:

```javascript
const BANK_ACCOUNT_CONFIG = {
  PLN: {
    name: 'PL / konto firmowe - 2693',
    fallback: 'M bank zl'
  },
  EUR: {
    name: 'EUR / konto firmowe - 2801',
    fallback: 'M Bank EUR'
  }
};
```

## Запуск

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run dev

# Запуск продакшн сервера
npm start
```

## Тестирование

```bash
# Тест маппинга стран
node test-country-mapping.js

# Тест новой логики контрагентов
node test-new-contractor-logic.js

# Тест создания Proforma
node test-proforma-with-dynamic-banks.js
```

## API Endpoints

- `GET /api/status` - Статус системы
- `POST /api/invoice-processing/run` - Ручной запуск обработки
- `POST /api/invoice-processing/deal/:id` - Обработка конкретной сделки
- `GET /api/invoice-processing/pending` - Список ожидающих сделок

## Фронтенд

Откройте `frontend/index.html` в браузере для тестирования через веб-интерфейс.
