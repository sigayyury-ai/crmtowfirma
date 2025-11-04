const express = require('express');
const router = express.Router();
const { passport, requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /auth/google
 * Начало OAuth авторизации через Google
 */
router.get('/google', (req, res, next) => {
  const config = require('../config/googleOAuth');
  
  // Логируем callback URL перед редиректом
  logger.info('Initiating Google OAuth:', {
    callbackURL: config.googleOAuth.callbackURL,
    clientID: config.googleOAuth.clientID ? 'SET' : 'NOT SET',
    requestedURL: req.originalUrl,
    host: req.get('host'),
    protocol: req.protocol
  });
  
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account' // Показывать выбор аккаунта
  })(req, res, next);
});

/**
 * GET /auth/google/callback
 * Callback после авторизации через Google
 */
router.get('/google/callback',
  (req, res, next) => {
    const config = require('../config/googleOAuth');
    
    // Логируем callback URL при получении callback
    logger.info('Google OAuth callback received:', {
      callbackURL: config.googleOAuth.callbackURL,
      query: req.query,
      error: req.query.error,
      error_description: req.query.error_description
    });
    
    if (req.query.error === 'redirect_uri_mismatch') {
      logger.error('Redirect URI mismatch detected!', {
        expectedCallbackURL: config.googleOAuth.callbackURL,
        error: req.query.error,
        error_description: req.query.error_description
      });
      
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Configuration Error</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: #f5f5f5;
            }
            .error-container {
              text-align: left;
              background: white;
              padding: 40px;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              max-width: 600px;
            }
            h1 { color: #d32f2f; }
            code {
              background: #f5f5f5;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: monospace;
            }
            .info-box {
              background: #e3f2fd;
              padding: 15px;
              border-radius: 4px;
              margin: 15px 0;
            }
          </style>
        </head>
        <body>
          <div class="error-container">
            <h1>❌ OAuth Configuration Error</h1>
            <p><strong>Error:</strong> redirect_uri_mismatch</p>
            <div class="info-box">
              <p><strong>Expected callback URL:</strong></p>
              <code>${config.googleOAuth.callbackURL}</code>
              <p style="margin-top: 15px;"><strong>This URL must match exactly in Google Cloud Console:</strong></p>
              <p>1. Go to <a href="https://console.cloud.google.com/apis/credentials" target="_blank">Google Cloud Console → Credentials</a></p>
              <p>2. Find your OAuth 2.0 Client ID</p>
              <p>3. Check "Authorized redirect URIs"</p>
              <p>4. Make sure it contains exactly:</p>
              <code>https://invoices.comoon.io/auth/google/callback</code>
            </div>
          </div>
        </body>
        </html>
      `);
    }
    
    passport.authenticate('google', {
      failureRedirect: '/auth/error',
      failureFlash: false
    })(req, res, next);
  },
  (req, res) => {
    try {
      // Успешная авторизация
      logger.info('User successfully authenticated', {
        email: req.user.email,
        name: req.user.name
      });
      
      // Перенаправляем на главную страницу
      res.redirect('/');
    } catch (error) {
      logger.error('Error after Google OAuth callback', error);
      res.redirect('/auth/error');
    }
  }
);

/**
 * GET /auth/logout
 * Выход из системы
 */
router.get('/logout', (req, res) => {
  const userEmail = req.user?.email;
  
  req.logout((err) => {
    if (err) {
      logger.error('Error during logout', err);
      return res.status(500).json({
        success: false,
        error: 'Logout failed'
      });
    }
    
    req.session.destroy((err) => {
      if (err) {
        logger.error('Error destroying session', err);
      }
      
      logger.info('User logged out', { email: userEmail });
      res.redirect('/');
    });
  });
});

/**
 * GET /auth/status
 * Проверка статуса авторизации (для API)
 */
router.get('/status', requireAuth, (req, res) => {
  res.json({
    success: true,
    authenticated: true,
    user: {
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture
    }
  });
});

/**
 * GET /auth/error
 * Страница ошибки авторизации
 */
router.get('/error', (req, res) => {
  res.status(401).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Access Denied</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background: #f5f5f5;
        }
        .error-container {
          text-align: center;
          background: white;
          padding: 40px;
          border-radius: 8px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { color: #d32f2f; }
        p { color: #666; }
        a {
          color: #1976d2;
          text-decoration: none;
        }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>❌ Access Denied</h1>
        <p>Only users with @comoon.io email domain are allowed to access this application.</p>
        <p><a href="/auth/google">Try again</a> | <a href="/">Go to homepage</a></p>
      </div>
    </body>
    </html>
  `);
});

module.exports = router;

