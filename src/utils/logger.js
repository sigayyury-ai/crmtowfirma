const winston = require('winston');
const {
  sanitizeInfo,
  getIncidentStats,
  hasWarningLevel
} = require('./logSanitizer');

const ENABLE_SANITIZER = process.env.LOG_SANITIZER_DISABLED !== 'true';

// Определяем, работаем ли мы на Render
// Render автоматически собирает логи из stdout/stderr, поэтому файловое логирование не нужно
const IS_RENDER = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID !== undefined;
const ENABLE_FILE_LOGGING = process.env.ENABLE_FILE_LOGGING === 'true' && !IS_RENDER;

const sanitizeFormat = winston.format((info) => {
  if (!ENABLE_SANITIZER) return info;
  return sanitizeInfo(info);
});

// Базовые транспорты (начинаем с пустого массива, добавляем по условию)
const transports = [];

// Файловое логирование только если явно включено и не на Render
if (ENABLE_FILE_LOGGING) {
  transports.push(
    // Записываем в файл только ошибки
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Записываем все логи
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  );
}

// Консольный вывод - всегда включен (для Render LCI и локальной разработки)
// Render автоматически собирает логи из stdout/stderr
transports.push(
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
);

// Создаем logger с конфигурацией
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'pipedrive-wfirma-integration' },
  transports: transports
});

module.exports = logger;

module.exports.getLogSanitizerStats = getIncidentStats;
module.exports.isLogSanitizerInWarningState = hasWarningLevel;










