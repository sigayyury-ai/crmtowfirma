# Настройка Google OAuth в Render

## Шаг 1: Проверка настроек в Google Cloud Console

Перед добавлением ключей в Render, убедитесь, что в Google Cloud Console правильно настроены:

### Authorized JavaScript origins:
```
https://invoices.comoon.io
```

### Authorized redirect URIs:
```
https://invoices.comoon.io/auth/google/callback
```

⚠️ **Важно:** URL должны быть точно такими же, включая протокол `https://` и без слеша в конце (кроме `/callback`)

## Шаг 2: Добавление переменных окружения в Render

### 1. Откройте Render Dashboard
   - Перейдите на [render.com](https://render.com)
   - Войдите в свой аккаунт
   - Найдите ваш сервис `crm-to-wfirma` (или другое название)

### 2. Перейдите в Environment
   - Откройте ваш сервис
   - Перейдите в раздел **Environment** в левом меню
   - Или нажмите на вкладку **Environment** вверху

### 3. Добавьте следующие переменные:

#### Google OAuth 2.0:
```
GOOGLE_CLIENT_ID=ваш_client_id_из_google_cloud_console
GOOGLE_CLIENT_SECRET=ваш_client_secret_из_google_cloud_console
```

#### Session Secret:
```
SESSION_SECRET=случайная_строка_для_сессии
```

**Важно:** SESSION_SECRET должен быть длинной случайной строкой (минимум 32 символа)

#### Убедитесь, что NODE_ENV установлен:
```
NODE_ENV=production
```

### 4. Сохраните изменения
   - Нажмите **Save Changes**
   - Render автоматически перезапустит сервис

## Шаг 3: Проверка работы

После добавления переменных и перезапуска сервиса:

1. Откройте `https://invoices.comoon.io` в браузере
2. Должна появиться страница авторизации Google
3. Войдите с аккаунтом `@comoon.io`
4. После успешной авторизации вы должны быть перенаправлены на главную страницу

## Шаг 4: Проверка логов (если что-то не работает)

1. В Render Dashboard перейдите в **Logs**
2. Проверьте, нет ли ошибок связанных с:
   - `GOOGLE_CLIENT_ID` или `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET`
   - Ошибки OAuth callback

## Частые проблемы

### Ошибка: "redirect_uri_mismatch"

**Причина:** Redirect URI в Google Console не совпадает с URL в Render

**Решение:**
1. Проверьте в Google Cloud Console → Credentials → OAuth 2.0 Client ID
2. Убедитесь, что в "Authorized redirect URIs" указано:
   ```
   https://invoices.comoon.io/auth/google/callback
   ```
3. Убедитесь, что домен `invoices.comoon.io` правильно настроен в Render (Custom Domains)

### Ошибка: "Missing credentials"

**Причина:** Переменные окружения не добавлены в Render

**Решение:**
1. Проверьте, что все переменные добавлены в Render Environment
2. Убедитесь, что значения скопированы правильно (без лишних пробелов)
3. Перезапустите сервис после добавления переменных

### Ошибка: "Access denied. Only @comoon.io domain is allowed"

**Причина:** Пользователь пытается войти с email другого домена

**Решение:**
- Это нормальное поведение - доступ разрешен только для `@comoon.io`
- Убедитесь, что вы используете Google аккаунт с доменом `@comoon.io`

## Безопасность

⚠️ **Важно:**
- Никогда не коммитьте `.env` файл в Git
- Не делитесь `GOOGLE_CLIENT_SECRET` и `SESSION_SECRET`
- Используйте разные `SESSION_SECRET` для каждого окружения
- Регулярно обновляйте зависимости для безопасности

