# 🚀 Быстрое исправление redirect_uri_mismatch

## Проблема
Ошибка `400: redirect_uri_mismatch` при авторизации через Google OAuth.

## Быстрое решение (3 шага)

### 1️⃣ Проверьте переменные на Render

В Render Dashboard → Environment → проверьте:

```
NODE_ENV=production
GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback
```

**Если `GOOGLE_CALLBACK_URL` не установлен** - это нормально, код автоматически использует правильный URL при `NODE_ENV=production`.

### 2️⃣ Добавьте redirect URI в Google Cloud Console

1. Откройте: https://console.cloud.google.com/apis/credentials
2. Найдите ваш OAuth 2.0 Client ID (который используется на продакшене)
3. Нажмите на Client ID → редактирование
4. В разделе **"Authorized redirect URIs"** добавьте:
   ```
   https://invoices.comoon.io/auth/google/callback
   ```
5. Сохраните (Save)

### 3️⃣ Перезапустите приложение

В Render Dashboard → Manual Deploy → Deploy latest commit

## Проверка

Откройте: `https://invoices.comoon.io/auth/google`

Должна начаться авторизация без ошибки `redirect_uri_mismatch`.

## Если не помогло

Запустите диагностику:
```bash
export NODE_ENV=production
export GOOGLE_CLIENT_ID="ваш_продакшенный_client_id"
node scripts/diagnose-oauth-redirect-uri.js
```

См. подробную инструкцию: `OAUTH_REDIRECT_URI_FIX.md`
