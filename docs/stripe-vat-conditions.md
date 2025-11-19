# Условия применения VAT (НДС) для Stripe платежей

## Обзор

Система автоматически определяет необходимость применения VAT (НДС) для Stripe платежей на основе типа клиента (B2B/B2C) и страны компании/клиента.

---

## Логика определения VAT

### Определение типа клиента (B2B/B2C)

**B2B (Business-to-Business):**
- Клиент считается B2B, если у сделки есть связанная организация (`org_id` в Pipedrive)
- `isB2B = Boolean(organization)` - определяется наличием организации в CRM
- `customerType = 'organization'`

**B2C (Business-to-Consumer):**
- Клиент считается B2C, если у сделки нет связанной организации (только персона)
- `isB2B = false`
- `customerType = 'person'`

### Метод `shouldApplyVat()`

```javascript
shouldApplyVat({ customerType, companyCountry, sessionCountry }) {
  // B2B (organization)
  if (customerType === 'organization') {
    if (!companyCountry) return false;
    return companyCountry.toUpperCase() === 'PL'; // Только для Польши
  }

  // B2C (person) — всегда рассчитываем VAT
  if (sessionCountry) return true;
  return true;
}
```

### Условия применения VAT

#### Для B2B клиентов (организации):
- ✅ **VAT применяется:** Только если страна компании = **Польша (PL)**
- ❌ **VAT не применяется:** Если страна компании не Польша или не указана

#### Для B2C клиентов (физические лица):
- ✅ **VAT применяется:** Всегда (если указана страна сессии)
- ✅ **VAT применяется:** По умолчанию `true` (даже если страна не указана)

---

## Определение страны

### Источники данных для определения страны:

1. **Для B2B:**
   - `companyCountry` - страна организации из CRM (Pipedrive)
   - Извлекается из адреса организации через `extractCountryCode()`

2. **Для B2C:**
   - `sessionCountry` - страна из адреса клиента в Stripe Checkout Session
   - Извлекается из `participant.address.country`

### Методы извлечения адреса:

- `extractAddressParts(crmContext)` - извлекает части адреса из CRM контекста
- `extractCountryCode(addressParts)` - нормализует код страны в ISO формат (PL, DE, FR, и т.д.)

---

## Проверка адреса для VAT

### Метод `ensureAddress()`

Если VAT должен применяться (`shouldApplyVat = true`), система проверяет наличие адреса:

**Требования к адресу:**
- Для Stripe: `customerAddress.line1` и `customerAddress.country` должны быть заполнены
- Для CRM: `crmAddressParts` должны содержать необходимые данные

**Если адрес отсутствует:**
- Создается задача в Pipedrive для менеджера с требованием заполнить адрес
- Платеж сохраняется со статусом `pending_metadata` до заполнения адреса

---

## Применение VAT в Stripe

### Tax Rate для Польши

Если `shouldApplyVat = true` и `countryCode === 'PL'`:
- Добавляется Tax Rate 23% (стандартная ставка НДС в Польше)
- Tax Rate ID получается через `ensurePolandTaxRate()`
- Tax Rate добавляется к `line_item.tax_rates`

### Для B2B компаний из Польши:

- Включается `tax_id_collection` для сбора налогового номера компании
- Создается Customer объект в Stripe (не только `customer_email`)
- Включается `invoice_creation` для автоматического создания инвойсов
- В метаданных сохраняются: `company_name`, `company_tax_id`, `company_address`

### Для B2C клиентов:

- Используется только `customer_email` (без Customer объекта)
- Инвойсы не создаются автоматически (Stripe отправляет receipt автоматически)
- VAT применяется через Tax Rate, если страна = PL

---

## Примеры применения

### Пример 1: B2B компания из Польши
```
customerType: 'organization'
companyCountry: 'PL'
shouldApplyVat: true ✅
→ VAT 23% применяется
→ Tax Rate добавляется к платежу
→ tax_id_collection включен
→ Invoice создается автоматически
```

### Пример 2: B2B компания из Германии
```
customerType: 'organization'
companyCountry: 'DE'
shouldApplyVat: false ❌
→ VAT не применяется
→ Invoice не создается
```

### Пример 3: B2C клиент из Польши
```
customerType: 'person'
sessionCountry: 'PL'
shouldApplyVat: true ✅
→ VAT 23% применяется
→ Tax Rate добавляется к платежу
→ Receipt отправляется автоматически
```

### Пример 4: B2C клиент из Германии
```
customerType: 'person'
sessionCountry: 'DE'
shouldApplyVat: true ✅
→ VAT применяется (но не через Tax Rate для PL)
→ Receipt отправляется автоматически
```

---

## Сохранение данных о VAT

В базе данных сохраняются следующие поля:

- `expected_vat` - должен ли применяться VAT (boolean)
- `customer_type` - тип клиента ('organization' или 'person')
- `company_country` - страна компании (для B2B)
- `customer_country` - страна клиента (из Stripe)
- `address_validated` - валидирован ли адрес
- `address_validation_reason` - причина, если адрес не валиден
- `tax_behavior` - поведение налога ('inclusive' или 'exclusive')
- `tax_rate_id` - ID Tax Rate в Stripe (если применен)
- `amount_tax` - сумма налога
- `amount_tax_pln` - сумма налога в PLN

---

## Важные замечания

1. **Для Proforma инвойсов в wFirma:**
   - VAT всегда = 0% (`vat_code_id=230`, reason `nie podl.`)
   - Это правило применяется независимо от Stripe логики

2. **Для Stripe платежей:**
   - VAT применяется только для платежей через Stripe
   - Логика VAT не влияет на создание Proforma инвойсов

3. **Проверка адреса:**
   - Адрес обязателен только если `shouldApplyVat = true`
   - Если адрес отсутствует, создается задача в CRM

4. **Кэширование:**
   - CRM контекст кэшируется для оптимизации (`crmCache`)
   - Адреса проверяются при каждом создании Checkout Session

---

## Код определения VAT

**Файл:** `src/services/stripe/processor.js`

**Методы:**
- `shouldApplyVat({ customerType, companyCountry, sessionCountry })` - определяет необходимость VAT
- `getCrmContext(dealId)` - получает контекст CRM (B2B/B2C, адреса, страна)
- `ensureAddress({ dealId, shouldApplyVat, participant, crmContext })` - проверяет адрес
- `extractAddressParts(crmContext)` - извлекает части адреса
- `extractCountryCode(addressParts)` - нормализует код страны

---

**Дата создания:** 2025-11-19  
**Последнее обновление:** 2025-11-19

