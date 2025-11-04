# Настройка Google OAuth 2.0 для invoices.comoon.io

## Пошаговая инструкция по созданию OAuth 2.0 Client ID в Google Cloud Console

### Шаг 1: Создание проекта в Google Cloud Console

1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/)
2. Войдите в свой Google аккаунт
3. Создайте новый проект или выберите существующий:
   - Нажмите на выпадающий список проектов вверху
   - Нажмите "New Project"
   - Введите название: `Comoon Invoices Integration` (или любое другое)
   - Нажмите "Create"

### Шаг 2: Включение Google+ API

1. В меню слева выберите **APIs & Services** → **Library**
2. Найдите "Google+ API" или "Google Identity API"
3. Нажмите "Enable"

### Шаг 3: Настройка OAuth Consent Screen

1. В меню слева выберите **APIs & Services** → **OAuth consent screen**
2. Выберите **External** (для корпоративного использования)
3. Заполните обязательные поля:
   - **App name**: `Comoon Invoices`
   - **User support email**: ваш email (например, admin@comoon.io)
   - **Developer contact information**: ваш email
4. Нажмите "Save and Continue"
5. На странице "Scopes" нажмите "Save and Continue" (используются стандартные scopes)
6. На странице "Test users" добавьте тестовых пользователей (если нужно) или нажмите "Save and Continue"
7. На странице "Summary" проверьте информацию и нажмите "Back to Dashboard"

### Шаг 4: Создание OAuth 2.0 Client ID

1. В меню слева выберите **APIs & Services** → **Credentials**
2. Нажмите **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Выберите **Application type**: **Web application**
4. Введите **Name**: `Comoon Invoices OAuth Client`
5. **Authorized JavaScript origins** (добавьте следующие URL):
   ```
   https://invoices.comoon.io
   https://www.invoices.comoon.io
   ```
   Если тестируете локально, добавьте:
   ```
   http://localhost:3000
   ```

6. **Authorized redirect URIs** (добавьте следующие URL):
   ```
   https://invoices.comoon.io/auth/google/callback
   https://www.invoices.comoon.io/auth/google/callback
   ```
   Если тестируете локально, добавьте:
   ```
   http://localhost:3000/auth/google/callback
   ```

7. Нажмите **Create**
8. **Скопируйте Client ID и Client Secret** - они понадобятся для настройки

### Шаг 5: Настройка переменных окружения

1. Откройте файл `.env` в корне проекта
2. Добавьте следующие переменные:

```env
# Google OAuth 2.0 Configuration
GOOGLE_CLIENT_ID=ваш_client_id_из_google
GOOGLE_CLIENT_SECRET=ваш_client_secret_из_google
GOOGLE_CALLBACK_URL=/auth/google/callback

# Session Secret (используйте случайную строку)
SESSION_SECRET=ваша-случайная-строка-для-сессии
```

**Важно:**
- `SESSION_SECRET` должен быть длинной случайной строкой (минимум 32 символа)
- Можно сгенерировать случайную строку командой: `openssl rand -base64 32`

### Шаг 6: Проверка работы

1. Запустите сервер: `npm start`
2. Откройте браузер и перейдите на `https://invoices.comoon.io`
3. Должна появиться страница авторизации Google
4. Войдите с аккаунтом, имеющим домен `@comoon.io`
5. После успешной авторизации вы должны быть перенаправлены на главную страницу

## Требования Google для Production

### OAuth Consent Screen

Для production использования необходимо:

1. **Проверить приложение** (OAuth consent screen):
   - Все поля должны быть заполнены
   - Приложение должно быть опубликовано (если нужно)
   - Для корпоративного использования может потребоваться верификация

2. **Ограничения доступа**:
   - Приложение автоматически проверяет, что email пользователя принадлежит домену `@comoon.io`
   - Пользователи с другими доменами не смогут получить доступ

### Безопасность

1. **Никогда не коммитьте** `.env` файл в Git
2. **Используйте сильные секреты** для `SESSION_SECRET`
3. **В production** убедитесь, что используется HTTPS
4. **Регулярно обновляйте** зависимости для безопасности

## Устранение неполадок

### Ошибка: "redirect_uri_mismatch"

**Причина:** Redirect URI в Google Console не совпадает с URL в приложении

**Решение:**
1. Проверьте, что в Google Console указан правильный redirect URI:
   - `https://invoices.comoon.io/auth/google/callback`
2. Убедитесь, что домен `invoices.comoon.io` правильно настроен в Render

### Ошибка: "Access denied. Only @comoon.io domain is allowed"

**Причина:** Пользователь пытается войти с email другого домена

**Решение:**
- Это нормальное поведение - доступ разрешен только для пользователей с доменом `@comoon.io`
- Убедитесь, что вы используете Google аккаунт с доменом `@comoon.io`

### Ошибка: "Session not found" или проблемы с сессией

**Причина:** Проблемы с настройкой сессии или SESSION_SECRET

**Решение:**
1. Убедитесь, что `SESSION_SECRET` установлен в `.env`
2. Проверьте, что в production используется HTTPS (для secure cookies)
3. Перезапустите сервер после изменения `.env`

## Дополнительная информация

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Passport.js Google Strategy](http://www.passportjs.org/packages/passport-google-oauth20/)
- [Render Custom Domains](https://render.com/docs/custom-domains)

