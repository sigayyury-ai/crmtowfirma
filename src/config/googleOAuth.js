/**
 * Google OAuth 2.0 Configuration
 * 
 * Требования Google для создания OAuth 2.0 Client ID:
 * 1. Перейти в Google Cloud Console: https://console.cloud.google.com/
 * 2. Создать новый проект или выбрать существующий
 * 3. Включить Google+ API
 * 4. Перейти в "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"
 * 5. Выбрать "Web application"
 * 6. Указать Authorized JavaScript origins:
 *    - https://invoices.comoon.io
 *    - https://invoices.comoon.io (для production)
 * 7. Указать Authorized redirect URIs:
 *    - https://invoices.comoon.io/auth/google/callback
 * 8. Сохранить Client ID и Client Secret
 * 9. Добавить их в .env файл:
 *    GOOGLE_CLIENT_ID=your_client_id
 *    GOOGLE_CLIENT_SECRET=your_client_secret
 */

// Определяем callback URL для OAuth
const getCallbackURL = () => {
  // Если указана переменная окружения, используем её (приоритет)
  if (process.env.GOOGLE_CALLBACK_URL) {
    const callbackUrl = process.env.GOOGLE_CALLBACK_URL.trim();
    // Если это полный URL, возвращаем как есть
    if (callbackUrl.startsWith('http://') || callbackUrl.startsWith('https://')) {
      return callbackUrl;
    }
    // Если относительный путь, преобразуем в полный URL
    const baseUrl = process.env.BASE_URL || 
      (process.env.NODE_ENV === 'production' 
        ? 'https://invoices.comoon.io' 
        : 'http://localhost:3000');
    return `${baseUrl}${callbackUrl.startsWith('/') ? callbackUrl : '/' + callbackUrl}`;
  }
  
  // В production ВСЕГДА используем кастомный домен (не Render subdomain)
  if (process.env.NODE_ENV === 'production') {
    return 'https://invoices.comoon.io/auth/google/callback';
  }
  
  // В development используем полный URL с localhost
  // Passport.js требует полный URL, а не относительный путь
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/auth/google/callback`;
};

module.exports = {
  // Разрешенный домен для доступа
  ALLOWED_DOMAIN: 'comoon.io',
  
  // Google OAuth 2.0 настройки
  googleOAuth: {
    // Client ID и Secret будут браться из process.env
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    
    // Callback URL для OAuth
    // В production должен быть полный URL (https://invoices.comoon.io/auth/google/callback)
    // В development можно использовать относительный путь (/auth/google/callback)
    // Можно переопределить через переменную окружения GOOGLE_CALLBACK_URL
    callbackURL: getCallbackURL(),
    
    // Разрешенные домены для авторизации
    allowedDomains: ['comoon.io'],
    
    // Scope для получения email и профиля
    scope: ['profile', 'email']
  },
  
  // Session настройки
  session: {
    secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS только в production
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
  }
};

