# Исправление ошибки redirect_uri_mismatch на продакшене

## Проблема

Ошибка `redirect_uri_mismatch` возникает, когда redirect URI в запросе OAuth не совпадает с тем, что зарегистрирован в Google Cloud Console.

## Причина

После изменения переменных на продакшене возможно:
1. Не установлен правильный `GOOGLE_CALLBACK_URL`
2. Или не установлен `NODE_ENV=production`
3. Или в Google Cloud Console не зарегистрирован правильный redirect URI для продакшенного Client ID

## Решение

### Шаг 1: Проверьте переменные окружения на продакшене (Render)

1. Откройте [Render Dashboard](https://dashboard.render.com)
2. Найдите ваш сервис
3. Перейдите в раздел **Environment**
4. Проверьте следующие переменные:

**Обязательные переменные для продакшена:**
```
NODE_ENV=production
GOOGLE_CLIENT_ID=728085463649-... (ваш Client ID)
GOOGLE_CLIENT_SECRET=GOCSPX-... (ваш Client Secret)
GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback
```

**Важно:**
- `NODE_ENV` должен быть `production`
- `GOOGLE_CALLBACK_URL` должен быть **полным URL** с `https://`
- Если `GOOGLE_CALLBACK_URL` не установлен, код автоматически использует `https://invoices.comoon.io/auth/google/callback` при `NODE_ENV=production`

### Шаг 2: Проверьте Google Cloud Console

1. Откройте [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)

2. Найдите ваш OAuth 2.0 Client ID (тот, который используется на продакшене)

3. Нажмите на Client ID для редактирования

4. В разделе **"Authorized redirect URIs"** убедитесь, что добавлен:
   ```
   https://invoices.comoon.io/auth/google/callback
   ```

5. Если этого URI нет:
   - Нажмите **"Add URI"**
   - Введите: `https://invoices.comoon.io/auth/google/callback`
   - Нажмите **"Save"**

6. Подождите 1-2 минуты для применения изменений

### Шаг 3: Проверьте Authorized JavaScript origins

В том же окне редактирования Client ID проверьте раздел **"Authorized JavaScript origins"**:

Должен быть добавлен:
```
https://invoices.comoon.io
```

### Шаг 4: Перезапустите приложение на Render

1. В Render Dashboard перейдите в ваш сервис
2. Нажмите **"Manual Deploy"** → **"Deploy latest commit"**
   - Или просто сохраните изменения в Environment (Render автоматически перезапустит)

### Шаг 5: Проверьте логи

После перезапуска проверьте логи:

```bash
node scripts/fetch-render-logs.js --tail --text="OAuth"
```

Ищите сообщения:
- `Initiating Google OAuth:` - должно показывать правильный `callbackURL`
- Ошибки `redirect_uri_mismatch` больше не должно быть

## Диагностика

Если проблема сохраняется, запустите диагностический скрипт локально с продакшенными переменными:

```bash
# Установите продакшенные переменные (временно)
export NODE_ENV=production
export GOOGLE_CLIENT_ID="ваш_продакшенный_client_id"
export GOOGLE_CLIENT_SECRET="ваш_продакшенный_client_secret"
export GOOGLE_CALLBACK_URL="https://invoices.comoon.io/auth/google/callback"

# Запустите диагностику
node scripts/diagnose-oauth-redirect-uri.js
```

Скрипт покажет:
- Какой callback URL используется в коде
- Какие redirect URIs должны быть зарегистрированы в Google Cloud Console

## Частые ошибки

### ❌ Неправильно:
```
GOOGLE_CALLBACK_URL=/auth/google/callback  # Относительный путь
NODE_ENV=development  # Не production
```

### ✅ Правильно:
```
GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback
NODE_ENV=production
```

## Проверка после исправления

1. Откройте в браузере: `https://invoices.comoon.io/auth/google`
2. Должна начаться авторизация через Google
3. После авторизации вы должны быть перенаправлены обратно на сайт
4. Ошибка `redirect_uri_mismatch` больше не должна появляться

## Если используете разные Client ID для development и production

Если у вас разные Client ID для локальной разработки и продакшена:

**Development (локально):**
- Client ID: `728085463649-m33ju7ellb9ik4lo76vcnjjn0udbqhtd.apps.googleusercontent.com`
- Redirect URI в Google Cloud Console: `http://localhost:3000/auth/google/callback`

**Production (Render):**
- Client ID: `728085463649-e9p16svl3m3nveun69ooqjsn77kuefda.apps.googleusercontent.com` (или другой)
- Redirect URI в Google Cloud Console: `https://invoices.comoon.io/auth/google/callback`

**Важно:** Каждый Client ID должен иметь свои собственные redirect URIs в Google Cloud Console!
