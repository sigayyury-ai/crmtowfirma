require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const logger = require('./utils/logger');
const googleOAuthConfig = require('./config/googleOAuth');

// Диагностическое логирование для рендера (только при старте)
logger.info('🚀 Starting application...', {
  NODE_ENV: process.env.NODE_ENV || 'not set',
  PORT: process.env.PORT || 'not set',
  hasPipedriveToken: !!process.env.PIPEDRIVE_API_TOKEN,
  hasWfirmaAppKey: !!process.env.WFIRMA_APP_KEY,
  hasWfirmaCompanyId: !!process.env.WFIRMA_COMPANY_ID,
  hasWfirmaAccessKey: !!process.env.WFIRMA_ACCESS_KEY,
  hasWfirmaSecretKey: !!process.env.WFIRMA_SECRET_KEY
});

// Импортируем роуты и сервисы
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const pipedriveWebhookRoutes = require('./routes/pipedriveWebhook');
const { requireAuth } = require('./middleware/auth');
const { getScheduler } = require('./services/scheduler');

const app = express();
// Доверяем цепочке прокси (Cloudflare → Render), чтобы secure-cookie сессии корректно работал в production.
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;

// Создаем/получаем singleton планировщика
console.log('📋 Initializing scheduler...');
const scheduler = getScheduler();
console.log('✅ Scheduler initialized successfully');

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

// Middleware для запрета индексации поисковыми системами
app.use((req, res, next) => {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
  next();
});

// Webhook роуты ДО express.json() - они используют express.raw() для raw body
// Pipedrive webhook (должен быть доступен без авторизации для Pipedrive)
app.use('/api', pipedriveWebhookRoutes);

// Stripe webhook (должен быть доступен без авторизации для Stripe)
const stripeWebhookRoutes = require('./routes/stripeWebhook');
app.use('/api', stripeWebhookRoutes);

// JSON body parser применяется ПОСЛЕ webhook роутов
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Маршрут для VAT Margin страницы
app.get('/vat-margin.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/vat-margin.html'));
});

app.get('/vat-margin-product.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/vat-margin-product.html'));
});

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
  const urlHelper = require('./utils/urlHelper');
  
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Use urlHelper for consistent URL determination
  const baseUrl = urlHelper.getBaseUrl();
  
  logger.info(`Frontend available at: ${baseUrl}`);
  logger.info(`API available at: ${baseUrl}/api`);
  
  // Логируем Google OAuth настройки для отладки
  const googleOAuthConfig = require('./config/googleOAuth');
  logger.info('Google OAuth Callback URL:', {
    callbackURL: googleOAuthConfig.googleOAuth.callbackURL,
    NODE_ENV: process.env.NODE_ENV,
    GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL || 'not set'
  });
  
  logger.info('Invoice processing scheduler is configured for automatic hourly runs', {
    timezone: scheduler.timezone,
    cronExpression: scheduler.cronExpression
  });
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



