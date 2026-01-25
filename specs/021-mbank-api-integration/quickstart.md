# Quickstart: mBank API Integration

## Быстрый старт для клиентов mBank

### Paynow API (для онлайн платежей)

> ⚠️ **ВАЖНО:** Paynow API показывает **только платежи от клиентов, которые прошли через Paynow** (т.е. платежи, созданные через Paynow API). Он **НЕ показывает** полную банковскую историю транзакций (другие входящие/исходящие платежи). Для полной истории нужен PSD2 API.

#### Минимальные шаги:

1. **Войдите в mBank** → **"Mój biznes"** → **"Paynow"** → **"Ustawienia"**
2. **Активируйте Paynow** (следуйте инструкциям mBank)
3. **Добавьте магазин:** "Sklepy i punkty płatności" → "Dodaj sklep"
4. **Получите API ключи:** Settings → Shops and poses → Authentication
   - Скопируйте `Api-Key` и `Signature-Key`
5. **Настройте адрес уведомлений** в поле "Adres powiadomień"
6. **Протестируйте в Sandbox:**
   - URL: `https://api.sandbox.paynow.pl`
   - Test Api-Key: `97a55694-5478-43b5-b406-fb49ebfdd2b5`
   - Test Signature-Key: `b305b996-bca5-4404-a0b7-2ccea3d2b64b`

#### Пример создания платежа:

```bash
POST https://api.paynow.pl/v1/payments
Headers:
  Api-Key: your-api-key
  Signature: calculated-signature
  Content-Type: application/json

Body:
{
  "amount": 10000,  // в грошах (100.00 PLN)
  "externalId": "payment-123",
  "description": "Payment for invoice #123",
  "buyer": {
    "email": "customer@example.com"
  }
}
```

#### Документация:
- https://docs.paynow.pl/
- Поддержка: support@paynow.pl

---

### PSD2 API (для истории транзакций)

> ⚠️ **ВАЖНО:** Для получения истории транзакций через PSD2 API **обязательно нужны сертификаты QWAC и QSealC**, а также TPP статус. Без них доступ к истории транзакций невозможен.

#### Требования:
- ⚠️ **TPP статус** (лицензия от KNF) - обязателен
- ⚠️ **Сертификаты QWAC и QSealC** (от QTSP провайдера) - обязательны
- ⚠️ **Регистрация в developer portal** - обязательна

#### Что такое QWAC и QSealC?

**QWAC** - сертификат для TLS соединения (защита передачи данных)
**QSealC** - сертификат для подписи запросов (JWS-Signature)

**Где получить:**
- GlobalSign: https://www.globalsign.com/
- Entrust: https://www.entrust.com/
- LuxTrust: https://www.luxtrust.com/

**Процесс:**
1. Зарегистрируйтесь у QTSP провайдера
2. Заполните заявку (нужен PSP Identifier от KNF)
3. Пройдите верификацию (документы, нотариальное заверение)
4. Получите сертификаты (1-2 недели)

**Стоимость:** от €1-2/год (зависит от провайдера)

📖 Подробности: см. раздел "Сертификаты QWAC и QSealC" в research.md

#### Минимальные шаги:

1. **Получите TPP статус** от Polish Financial Supervision Authority
2. **Получите сертификаты** от QTSP (QWAC + QSealC)
3. **Зарегистрируйтесь:** https://developer.api.mbank.pl/portal/login
4. **Создайте приложение** с вашими сертификатами
5. **Протестируйте в Sandbox:**
   - Corporate: `https://sandbox.api.mbank.pl/bank-simulator-pl-corpo/`
   - Retail: `https://sandbox.api.mbank.pl/bank-simulator-pl-retail/`

#### Пример получения транзакций (AISP):

```bash
GET https://api.mbank.pl/v2/accounts/{accountId}/transactions
Headers:
  TPP-Request-ID: uuid-v1
  Client-ID: uuid
  JWS-Signature: signed-header
  Authorization: Bearer access-token
```

#### Ресурсы:
- Developer Portal: https://developer.api.mbank.pl/
- Postman коллекция: https://github.com/melements/mBank-PSD2-api-postman-collection

---

## Контакты

**mBank Corporate Support:**
- Телефон: 22 6 273 273 или 801 273 273
- Часы: Пн-Пт, 8:00-18:00
- Чат: через mBank CompanyNet

**Paynow Support:**
- Email: support@paynow.pl
