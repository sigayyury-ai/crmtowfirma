# ✅ Исправление ошибки redirect_uri_mismatch

## Проблема

Ошибка `400: redirect_uri_mismatch` возникала потому, что Passport.js отправлял **относительный путь** `/auth/google/callback` вместо **полного URL** `http://localhost:3000/auth/google/callback` в запросе к Google OAuth.

Google требует полный URL в параметре `redirect_uri`, иначе возникает ошибка `redirect_uri_mismatch`.

## Исправление

### Изменения в коде

**Файл:** `src/config/googleOAuth.js`

Исправлена функция `getCallbackURL()`:
- Теперь всегда возвращает **полный URL**, даже в development режиме
- В development автоматически использует `http://localhost:3000/auth/google/callback`
- В production использует `https://invoices.comoon.io/auth/google/callback`
- Поддерживает переменную `BASE_URL` для кастомных конфигураций

### До исправления:
```javascript
// В development использовался относительный путь
return '/auth/google/callback';  // ❌ Неправильно
```

### После исправления:
```javascript
// В development используется полный URL
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
return `${baseUrl}/auth/google/callback`;  // ✅ Правильно
```

## Результат тестирования

### До исправления:
```
✅ Фактический redirect_uri в запросе к Google:
   /auth/google/callback

⚠️  Redirect URI является относительным путем (может вызвать проблемы)
```

### После исправления:
```
✅ Фактический redirect_uri в запросе к Google:
   http://localhost:3000/auth/google/callback

✅ Redirect URI является полным URL (правильно)
```

## Что нужно сделать дальше

### Для локальной разработки:

1. **Убедитесь, что в Google Cloud Console для вашего локального Client ID зарегистрирован:**
   ```
   http://localhost:3000/auth/google/callback
   ```

2. **Или установите в `.env`:**
   ```
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   ```

### Для продакшена (Render):

1. **Убедитесь, что переменные окружения установлены:**
   ```
   NODE_ENV=production
   GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback
   ```
   (или не устанавливайте `GOOGLE_CALLBACK_URL` - код автоматически использует правильный URL)

2. **Убедитесь, что в Google Cloud Console для продакшенного Client ID зарегистрирован:**
   ```
   https://invoices.comoon.io/auth/google/callback
   ```

## Проверка

После исправления проверьте:

1. **Локально:**
   ```bash
   node scripts/test-oauth-redirect-uri.js
   ```
   Должен показать полный URL: `http://localhost:3000/auth/google/callback`

2. **В браузере:**
   Откройте: `http://localhost:3000/auth/google`
   Должна начаться авторизация без ошибки `redirect_uri_mismatch`

3. **В логах сервера:**
   Должно быть: `"callbackURL":"http://localhost:3000/auth/google/callback"`

## Созданные файлы

1. `scripts/diagnose-oauth-redirect-uri.js` - диагностический скрипт
2. `scripts/test-oauth-redirect-uri.js` - тестовый скрипт для проверки redirect URI
3. `OAUTH_REDIRECT_URI_FIX.md` - подробная инструкция по исправлению
4. `QUICK_FIX_REDIRECT_URI.md` - краткая инструкция

## Статус

✅ **Исправлено** - код теперь всегда использует полный URL для redirect_uri

⚠️ **Требуется действие** - убедитесь, что правильные redirect URIs зарегистрированы в Google Cloud Console
