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

module.exports = {
  // Разрешенный домен для доступа
  ALLOWED_DOMAIN: 'comoon.io',
  
  // Google OAuth 2.0 настройки
  googleOAuth: {
    // Client ID и Secret будут браться из process.env
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    
    // Callback URL для OAuth
    // В production используем полный URL, в development - относительный
    callbackURL: process.env.NODE_ENV === 'production' 
      ? 'https://invoices.comoon.io/auth/google/callback'
      : (process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'),
    
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

