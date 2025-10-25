const winston = require('winston');
const {
  sanitizeInfo,
  getIncidentStats,
  hasWarningLevel
} = require('./logSanitizer');

const ENABLE_SANITIZER = process.env.LOG_SANITIZER_DISABLED !== 'true';
const DEV_VERBOSE_OVERRIDE = /true/i.test(process.env.LOG_SANITIZER_DEV_VERBOSE || 'false');

const sanitizeFormat = winston.format((info) => {
  if (!ENABLE_SANITIZER) return info;
  const originalVerbose = process.env.LOG_SANITIZER_DEV_VERBOSE;
  if (DEV_VERBOSE_OVERRIDE) {
    process.env.LOG_SANITIZER_DEV_VERBOSE = 'true';
  }
  const result = sanitizeInfo(info);
  if (DEV_VERBOSE_OVERRIDE) {
    process.env.LOG_SANITIZER_DEV_VERBOSE = originalVerbose;
  }
  return result;
});

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
  transports: [
    // Записываем в файл
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Если не в production, также выводим в консоль
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

module.exports = logger;

module.exports.getLogSanitizerStats = getIncidentStats;
module.exports.isLogSanitizerInWarningState = hasWarningLevel;












