# Запрос в поддержку wFirma - Проблема с API авторизацией

## Описание проблемы

Здравствуйте!

У нас возникла проблема с авторизацией в wFirma API. Мы создали API Keys, но при попытке использовать их получаем ошибку "AUTH" (401 Unauthorized).

## Детали API Keys

**Текущие API Keys:**
- **Access Key:** `61d2eee61d9104b2c9e5e1766af27633`
- **Secret Key:** `d096f54b74c3f4adeb2fd4ab362cd085`
- **Название:** API COMOON 2

**Предыдущие API Keys (также не работали):**
- **Access Key:** `0a749723fca35677bf7a6f931646385e`
- **Secret Key:** `c5b3bc3058a60caaf13b4e57cd4d5c15`

## Что мы пробовали

Мы попробовали множество различных форматов авторизации:

### 1. GET запросы с параметрами в URL
```bash
curl "https://api2.wfirma.pl/contractors/find?access_key=61d2eee61d9104b2c9e5e1766af27633&secret_key=d096f54b74c3f4adeb2fd4ab362cd085"
```

### 2. POST запросы с JSON в теле
```bash
curl -X POST "https://api2.wfirma.pl/contractors/find" \
  -H "Content-Type: application/json" \
  -d '{"access_key":"61d2eee61d9104b2c9e5e1766af27633","secret_key":"d096f54b74c3f4adeb2fd4ab362cd085"}'
```

### 3. POST запросы с form-data
```bash
curl -X POST "https://api2.wfirma.pl/contractors/find" \
  -d "access_key=61d2eee61d9104b2c9e5e1766af27633&secret_key=d096f54b74c3f4adeb2fd4ab362cd085"
```

### 4. POST запросы с XML в теле
```bash
curl -X POST "https://api2.wfirma.pl/contractors/find" \
  -H "Content-Type: application/xml" \
  -d '<?xml version="1.0" encoding="UTF-8"?><api><access_key>61d2eee61d9104b2c9e5e1766af27633</access_key><secret_key>d096f54b74c3f4adeb2fd4ab362cd085</secret_key></api>'
```

### 5. Различные заголовки
```bash
curl -H "X-Access-Key: 61d2eee61d9104b2c9e5e1766af27633" \
     -H "X-Secret-Key: d096f54b74c3f4adeb2fd4ab362cd085" \
     "https://api2.wfirma.pl/contractors/find"
```

### 6. Различные endpoints
- `/contractors/find`
- `/contractors`
- `/invoices`
- `/api/contractors/find`

### 7. Различные base URLs
- `https://api2.wfirma.pl`
- `https://api.wfirma.pl`

## Результат всех попыток

Все запросы возвращают одинаковый ответ:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<api>
    <status>
        <code>AUTH</code>
    </status>
</api>
```

## Что мы проверили

1. ✅ API Keys созданы в админке wFirma
2. ✅ API Keys выглядят активными
3. ✅ Пробовали разные форматы авторизации
4. ✅ Пробовали разные endpoints
5. ✅ Пробовали разные base URLs

## Вопросы к поддержке

1. **Правильный ли формат авторизации** мы используем?
2. **Есть ли ограничения по IP** для наших API Keys?
3. **Есть ли ограничения по домену** для наших API Keys?
4. **Какие права доступа** должны быть у API Keys для работы с contractors?
5. **Есть ли технические проблемы** на стороне wFirma?
6. **Нужны ли дополнительные настройки** для работы с API?

## Наша цель

Мы разрабатываем интеграцию между Pipedrive и wFirma для автоматического создания контрагентов и счетов. Нам нужно:

1. Получать список контрагентов
2. Создавать новых контрагентов
3. Создавать счета
4. Отправлять счета по email

## Контактная информация

- **Email:** [ваш email]
- **Компания:** COMOON
- **Проект:** Pipedrive ↔ wFirma Integration

## Дополнительная информация

Мы используем Node.js + Express.js для разработки интеграции. Все запросы логируются, и мы можем предоставить дополнительные детали при необходимости.

---

**Спасибо за помощь!**

С уважением,
Команда разработки COMOON






