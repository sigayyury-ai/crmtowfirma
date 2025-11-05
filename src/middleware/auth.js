const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const config = require('../config/googleOAuth');
const logger = require('../utils/logger');

/**
 * Настройка Google OAuth 2.0 стратегии
 */
// Логируем конфигурацию для отладки
logger.info('Google OAuth Configuration:', {
  clientID: config.googleOAuth.clientID ? 'SET' : 'NOT SET',
  clientSecret: config.googleOAuth.clientSecret ? 'SET' : 'NOT SET',
  callbackURL: config.googleOAuth.callbackURL,
  allowedDomains: config.googleOAuth.allowedDomains
});

// Создаем стратегию только если clientID установлен
if (config.googleOAuth.clientID && config.googleOAuth.clientSecret) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleOAuth.clientID,
        clientSecret: config.googleOAuth.clientSecret,
        callbackURL: config.googleOAuth.callbackURL
      },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Проверяем, что email принадлежит разрешенному домену
        const email = profile.emails?.[0]?.value;
        
        if (!email) {
          logger.warn('Google OAuth: No email found in profile', { profile });
          return done(null, false, { message: 'Email not found in Google profile' });
        }
        
        // Извлекаем домен из email
        const emailDomain = email.split('@')[1];
        
        // Проверяем, что домен разрешен
        if (!config.googleOAuth.allowedDomains.includes(emailDomain)) {
          logger.warn('Google OAuth: Unauthorized domain', {
            email,
            emailDomain,
            allowedDomains: config.googleOAuth.allowedDomains
          });
          return done(null, false, {
            message: `Access denied. Only ${config.ALLOWED_DOMAIN} domain is allowed.`
          });
        }
        
        // Сохраняем информацию о пользователе
        const user = {
          id: profile.id,
          email: email,
          name: profile.displayName,
          picture: profile.photos?.[0]?.value,
          domain: emailDomain
        };
        
        logger.info('Google OAuth: User authenticated successfully', {
          email: user.email,
          domain: user.domain
        });
        
        return done(null, user);
      } catch (error) {
        logger.error('Google OAuth: Error during authentication', error);
        return done(error, null);
      }
    }
  )
  );
} else {
  logger.warn('Google OAuth credentials not set. OAuth authentication will not work.');
}

/**
 * Сериализация пользователя для сессии
 */
passport.serializeUser((user, done) => {
  done(null, user);
});

/**
 * Десериализация пользователя из сессии
 */
passport.deserializeUser((user, done) => {
  done(null, user);
});

/**
 * Middleware для проверки авторизации
 * Пользователь должен быть авторизован и иметь email с доменом @comoon.io
 * В development режиме авторизация не требуется
 */
const requireAuth = (req, res, next) => {
  // В development режиме пропускаем авторизацию
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user;
    
    // Проверяем, что пользователь имеет правильный домен
    if (user && user.domain === config.ALLOWED_DOMAIN) {
      return next();
    }
    
    logger.warn('Access denied: User domain mismatch', {
      userEmail: user?.email,
      userDomain: user?.domain,
      requiredDomain: config.ALLOWED_DOMAIN
    });
    
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: `Only ${config.ALLOWED_DOMAIN} domain users are allowed`
    });
  }
  
  // Если пользователь не авторизован, перенаправляем на Google авторизацию
  logger.info('User not authenticated, redirecting to Google OAuth');
  return res.redirect('/auth/google');
};

/**
 * Middleware для проверки авторизации с JSON ответом (для API)
 * В development режиме авторизация не требуется
 */
const requireAuthJSON = (req, res, next) => {
  // В development режиме пропускаем авторизацию
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }
  
  if (req.isAuthenticated && req.isAuthenticated()) {
    const user = req.user;
    
    if (user && user.domain === config.ALLOWED_DOMAIN) {
      return next();
    }
    
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      message: `Only ${config.ALLOWED_DOMAIN} domain users are allowed`
    });
  }
  
  return res.status(401).json({
    success: false,
    error: 'Unauthorized',
    message: 'Please authenticate with Google'
  });
};

module.exports = {
  passport,
  requireAuth,
  requireAuthJSON
};

