require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const logger = require('./utils/logger');

// Диагностическое логирование для рендера
console.log('🚀 Starting application...');
console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('PORT:', process.env.PORT || 'not set');
console.log('PIPEDRIVE_API_TOKEN:', process.env.PIPEDRIVE_API_TOKEN ? 'SET' : 'NOT SET');
console.log('WFIRMA_APP_KEY:', process.env.WFIRMA_APP_KEY ? 'SET' : 'NOT SET');
console.log('WFIRMA_COMPANY_ID:', process.env.WFIRMA_COMPANY_ID ? 'SET' : 'NOT SET');
console.log('WFIRMA_ACCESS_KEY:', process.env.WFIRMA_ACCESS_KEY ? 'SET' : 'NOT SET');
console.log('WFIRMA_SECRET_KEY:', process.env.WFIRMA_SECRET_KEY ? 'SET' : 'NOT SET');

// Импортируем роуты и сервисы
const apiRoutes = require('./routes/api');
const SchedulerService = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Создаем экземпляр планировщика
console.log('📋 Initializing scheduler...');
const scheduler = new SchedulerService();
console.log('✅ Scheduler initialized successfully');

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Статические файлы (frontend)
app.use(express.static(path.join(__dirname, '../frontend')));

// robots.txt to disallow indexing
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send('User-agent: *\nDisallow: /');
});

// API роуты
app.use('/api', apiRoutes);

// Главная страница
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
  console.log('🔄 Starting invoice processing scheduler...');
  try {
    scheduler.start();
    console.log('✅ Invoice processing scheduler started successfully');
    logger.info('Invoice processing scheduler started automatically');
  } catch (error) {
    console.log('❌ Failed to start invoice processing scheduler:', error.message);
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



