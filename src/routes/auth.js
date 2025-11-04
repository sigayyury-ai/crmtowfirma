const express = require('express');
const router = express.Router();
const { passport, requireAuth } = require('../middleware/auth');
const logger = require('../utils/logger');

/**
 * GET /auth/google
 * Начало OAuth авторизации через Google
 */
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  prompt: 'select_account' // Показывать выбор аккаунта
}));

/**
 * GET /auth/google/callback
 * Callback после авторизации через Google
 */
router.get('/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/auth/error',
    failureFlash: false
  }),
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

