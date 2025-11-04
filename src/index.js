require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const logger = require('./utils/logger');
const googleOAuthConfig = require('./config/googleOAuth');

// Импортируем роуты и сервисы
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const SchedulerService = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Создаем экземпляр планировщика
const scheduler = new SchedulerService();

// Настройка session
app.use(session(googleOAuthConfig.session));

// Инициализация Passport
app.use(passport.initialize());
app.use(passport.session());

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://invoices.comoon.io', 'https://www.invoices.comoon.io']
    : true,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware для запрета индексации поисковыми системами
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Auth роуты (должны быть доступны без авторизации)
app.use('/auth', authRoutes);

// robots.txt to disallow indexing (доступен без авторизации)
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.send('User-agent: *\nDisallow: /\n\n# Sitemap не используется\n');
});

// Middleware для защиты всех остальных маршрутов
// Все маршруты ниже требуют авторизации через Google
app.use(requireAuth);

// Статические файлы (frontend) - защищены авторизацией
app.use(express.static(path.join(__dirname, '../frontend')));

// API роуты - защищены авторизацией
app.use('/api', apiRoutes);

// Главная страница - защищена авторизацией
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Обработка ошибок
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Запуск сервера
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Frontend available at: http://localhost:${PORT}`);
  logger.info(`API available at: http://localhost:${PORT}/api`);
  
  // Автоматически запускаем планировщик обработки счетов
  try {
    scheduler.start();
    logger.info('Invoice processing scheduler started automatically');
  } catch (error) {
    logger.error('Failed to start invoice processing scheduler:', error);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  scheduler.stop();
  process.exit(0);
});

module.exports = app;



