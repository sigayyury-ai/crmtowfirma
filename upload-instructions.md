# Инструкция по загрузке OAuth Callback файла

## 🚀 Рекомендуемый способ: FileZilla

Согласно [инструкции Namecheap](https://www.namecheap.com/support/knowledgebase/article.aspx/9961/2285/easywp-how-to-access-your-wordpress-website-folders-and-files-via-sftp-video/), используйте FileZilla:

### Настройки FileZilla:
- **Host/Server:** `fs-bonde.easywp.com`
- **Port:** `22`
- **Protocol:** `SFTP`
- **Logon Type:** `Normal`
- **User:** `comoon-106697f`
- **Password:** `QC069VJNgS1TCfglTb8a`

### Шаги:
1. Скачайте и установите [FileZilla](https://filezilla-project.org/)
2. Откройте FileZilla
3. Введите данные подключения выше
4. Нажмите "Quickconnect"
5. Перейдите в папку `public_html`
6. Создайте папку `oauth` (если не существует)
7. Загрузите файл `oauth-callback-simple.html` как `index.html`

## 📁 Файлы для загрузки

### Вариант 1: HTML файл (рекомендуется)
- **Файл:** `oauth-callback-simple.html`
- **Загрузить как:** `index.html`
- **Путь:** `public_html/oauth/index.html`
- **URL:** `https://comoon.io/oauth/callback/`

### Вариант 2: PHP файл
- **Файл:** `oauth-callback.php`
- **Загрузить как:** `index.php`
- **Путь:** `public_html/oauth/index.php`
- **URL:** `https://comoon.io/oauth/callback/`

## 🧪 Тестирование

После загрузки файла:

1. **Проверьте доступность:**
   ```bash
   curl -I https://comoon.io/oauth/callback/
   ```

2. **Протестируйте OAuth авторизацию:**
   ```
   https://api2.wfirma.pl/oauth/authorize?client_id=0a749723fca35677bf7a6f931646385e&response_type=code&scope=read write&redirect_uri=https://comoon.io/oauth/callback/
   ```

## 🔧 Альтернативные способы

### Через WP File Manager (если доступен)
1. Войдите в WordPress Dashboard
2. Установите плагин "File Manager"
3. Перейдите в WP File Manager
4. Создайте папку `oauth` в корне сайта
5. Загрузите файл через интерфейс

### Через cPanel File Manager (если доступен)
1. Войдите в cPanel
2. Откройте File Manager
3. Перейдите в `public_html`
4. Создайте папку `oauth`
5. Загрузите файл

## ✅ После загрузки

1. Callback URL будет работать
2. OAuth авторизация пройдет успешно
3. Получим access token для тестирования API
4. Сможем перейти к разработке модуля управления пользователями

## 📞 Если проблемы с доступом

Если у вас нет доступа к FileZilla или веб-интерфейсу, обратитесь в поддержку Namecheap для:
- Сброса SFTP пароля
- Предоставления доступа к File Manager
- Помощи с загрузкой файлов






