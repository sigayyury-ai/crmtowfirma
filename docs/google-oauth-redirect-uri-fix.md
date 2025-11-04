# Исправление ошибки redirect_uri_mismatch

## Проблема
Ошибка `redirect_uri_mismatch` возникает, когда redirect URI в коде не совпадает с настройками в Google Cloud Console.

## Решение

### Шаг 1: Проверьте настройки в Google Cloud Console

1. Откройте [Google Cloud Console](https://console.cloud.google.com/)
2. Перейдите в **APIs & Services** → **Credentials**
3. Найдите ваш **OAuth 2.0 Client ID**
4. Нажмите на него для редактирования
5. Проверьте раздел **"Authorized redirect URIs"**

**Должно быть указано ТОЧНО:**
```
https://invoices.comoon.io/auth/google/callback
```

⚠️ **Важно:**
- Должен быть протокол `https://` (не `http://`)
- Должен быть домен `invoices.comoon.io` (не `www.invoices.comoon.io`)
- Не должно быть слеша в конце (не `/auth/google/callback/`)
- Регистр букв важен (должно быть `callback`, а не `Callback`)

### Шаг 2: Добавьте переменную в Render

1. Откройте Render Dashboard
2. Перейдите в ваш сервис → **Environment**
3. Добавьте переменную:
   ```
   GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback
   ```
4. Сохраните изменения

### Шаг 3: Проверьте другие переменные

Убедитесь, что все переменные установлены:
- `GOOGLE_CLIENT_ID` - ваш Client ID из Google
- `GOOGLE_CLIENT_SECRET` - ваш Client Secret из Google
- `GOOGLE_CALLBACK_URL` - `https://invoices.comoon.io/auth/google/callback`
- `SESSION_SECRET` - случайная строка
- `NODE_ENV` - `production`

### Шаг 4: Перезапустите сервис

После добавления переменной `GOOGLE_CALLBACK_URL`:
1. Render автоматически перезапустит сервис
2. Дождитесь завершения деплоя
3. Попробуйте снова зайти на `https://invoices.comoon.io`

## Проверка

После настройки:
1. Откройте `https://invoices.comoon.io`
2. Должен произойти редирект на Google авторизацию
3. После входа с `@comoon.io` вы должны быть перенаправлены обратно на сайт

## Если проблема сохраняется

1. Проверьте логи в Render Dashboard → Logs
2. Убедитесь, что в логах видно правильный callback URL:
   ```
   Google OAuth Configuration: { callbackURL: 'https://invoices.comoon.io/auth/google/callback' }
   ```
3. Убедитесь, что домен `invoices.comoon.io` правильно настроен в Render (Custom Domains)

