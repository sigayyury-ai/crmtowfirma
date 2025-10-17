# OAuth Callback для wFirma

## 📁 Файлы для загрузки

Созданы два файла для обработки OAuth callback:

1. **`oauth-callback.php`** - PHP версия (рекомендуется)
2. **`oauth-callback.html`** - HTML версия с JavaScript

## 🚀 Инструкция по загрузке

### Вариант 1: PHP (рекомендуется)

1. **Загрузите файл** `oauth-callback.php` на ваш сервер
2. **Разместите по пути:** `https://comoon.io/oauth/callback.php`
3. **Убедитесь, что PHP включен** на сервере
4. **Проверьте права доступа** к файлу (644)

### Вариант 2: HTML + JavaScript

1. **Загрузите файл** `oauth-callback.html` на ваш сервер
2. **Разместите по пути:** `https://comoon.io/oauth/callback.html`
3. **Переименуйте в** `index.html` в папке `/oauth/callback/`

## 🔧 Настройка

### Для PHP версии:
- Файл автоматически обработает OAuth callback
- Логи будут сохраняться в `/tmp/wfirma_oauth.log`
- Вернет JSON с access token

### Для HTML версии:
- Покажет красивый интерфейс
- Автоматически скопирует токены
- Предоставит инструкции по настройке

## 🧪 Тестирование

После загрузки файла:

1. **Откройте URL авторизации:**
   ```
   https://api2.wfirma.pl/oauth/authorize?client_id=0a749723fca35677bf7a6f931646385e&response_type=code&scope=read write&redirect_uri=https://comoon.io/oauth/callback
   ```

2. **Авторизуйтесь в wFirma**

3. **Получите access token** через callback

4. **Скопируйте токен** в `.env` файл

## 📋 Переменные окружения

После успешной авторизации добавьте в `.env`:

```bash
WFIRMA_ACCESS_TOKEN=your_access_token_here
WFIRMA_REFRESH_TOKEN=your_refresh_token_here
```

## 🔍 Логи

PHP версия создает логи в `/tmp/wfirma_oauth.log` для отладки.

## ⚠️ Важные замечания

- Убедитесь, что callback URL точно соответствует настройкам в wFirma
- Проверьте, что сервер может выполнять PHP скрипты
- Убедитесь, что есть права на запись в папку для логов






