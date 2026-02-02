const logger = require('../../utils/logger');

/**
 * BaseMicroservice
 * 
 * Базовый класс для всех микросервисов в системе.
 * Предоставляет общие методы для логирования и обработки ошибок.
 */
class BaseMicroservice {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.name = this.constructor.name;
  }

  /**
   * Логирование с контекстом сервиса
   * @param {string} level - Уровень логирования (info, warn, error, debug)
   * @param {string} message - Сообщение для логирования
   * @param {Object} context - Дополнительный контекст
   */
  log(level, message, context = {}) {
    this.logger[level](`[${this.name}] ${message}`, {
      service: this.name,
      ...context
    });
  }

  /**
   * Обработка ошибок с логированием
   * @param {Error} error - Ошибка для обработки
   * @param {Object} context - Дополнительный контекст
   * @throws {Error} - Пробрасывает ошибку дальше
   */
  async handleError(error, context = {}) {
    this.log('error', 'Service error', {
      error: error.message,
      stack: error.stack,
      ...context
    });
    throw error;
  }
}

module.exports = BaseMicroservice;
