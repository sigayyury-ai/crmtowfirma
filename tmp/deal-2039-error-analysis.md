# Анализ ошибок для сделки 2039

## Дата анализа: 2026-01-07

## Найденные проблемы

### 1. Ошибка с Product Link (критическая)
**Описание**: При создании Stripe сессии для сделки 2039 возникает ошибка при попытке создать/обновить product link.

**Ошибка в логах**:
```
error: Failed to insert product link
error: {
  code: "23505",
  details: "Key (crm_product_id)=(48) already exists.",
  hint: null,
  message: "duplicate key value violates unique constraint \"product_links_crm_product_id_key\""
}
```

**Причина**:
- В таблице `product_links` уже существует запись с `crm_product_id=48`
- Код пытается использовать `upsert` с `onConflict: 'crm_product_id,stripe_product_id'`
- Если уникальный индекс существует только на `crm_product_id`, то `onConflict` не срабатывает
- Код пытается сделать простой `insert`, что приводит к ошибке дублирования

**Расположение**: `src/services/stripe/repository.js:27-84`

**Решение**:
1. Исправить логику `upsertProductLink` для правильной обработки случая, когда `crm_product_id` уже существует
2. Использовать правильный `onConflict` или сначала проверять существование записи

### 2. Ошибка SendPulse (некритическая)
**Описание**: При попытке обновить кастомные поля контакта в SendPulse возникает ошибка 404.

**Ошибка в логах**:
```
error: SendPulse API Response Error: Request failed with status code 404
error: {
  error_code: 404,
  message: "Not Found"
}
error: Error updating SendPulse contact custom fields
```

**Причина**:
- Контакт с ID `6696bb7634b1fb3970097721` не найден в SendPulse
- Возможно, контакт был удален или ID неверный

**Расположение**: `src/services/stripe/processor.js` (в методе отправки уведомлений)

**Решение**:
- Добавить проверку существования контакта перед обновлением
- Обработать ошибку 404 как некритическую (контакт может не существовать)

### 3. Предупреждение о Stripe продукте (информационное)
**Описание**: Продукт Stripe не найден, создается новый.

**Предупреждение в логах**:
```
warn: Stripe product from link not found, searching by CRM ID
error: "No such product: 'prod_TRQGAV3os6NKSz'"
info: Creating new Stripe product
```

**Причина**:
- В `product_links` есть ссылка на продукт `prod_TRQGAV3os6NKSz`, но он не существует в Stripe
- Система автоматически создает новый продукт

**Решение**:
- Это нормальное поведение, но можно добавить логирование для отслеживания таких случаев

## Результат

Несмотря на ошибки, **Stripe Checkout Session была успешно создана**:
- Session ID: `cs_live_a1QQcBCOVxElOIWTET9fXWOBuaC9Htsy2d4LWx7NV7L6ds8Do0C1uL7tCa`
- Amount: 1 EUR
- Customer: sigayyury@gmail.com

## Рекомендации

1. **Исправить логику upsertProductLink** - это критическая ошибка, которая может привести к проблемам при создании сессий
2. **Улучшить обработку ошибок SendPulse** - сделать ошибку 404 некритической
3. **Добавить мониторинг** для отслеживания случаев, когда продукты не найдены в Stripe


