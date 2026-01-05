const logger = require('../../utils/logger');

/**
 * PaymentScheduleService
 * 
 * Унифицированный сервис для определения графика платежей на основе expected_close_date.
 * Заменяет дублирующуюся логику в processor.js, pipedriveWebhook.js, secondPaymentSchedulerService.js
 * 
 * @see docs/stripe-payment-logic-code-review.md - раздел "Дублирование логики определения графика платежей"
 */
class PaymentScheduleService {
  /**
   * Определить график платежей на основе expected_close_date
   * 
   * Правило:
   * - Если до expected_close_date >= 30 дней → график 50/50 (два платежа)
   * - Если до expected_close_date < 30 дней → график 100% (один платеж)
   * - Если expected_close_date отсутствует → график 100% (по умолчанию)
   * 
   * @param {Date|string|null} expectedCloseDate - Дата начала лагеря (expected_close_date или close_date)
   * @param {Date} referenceDate - Дата для расчета (по умолчанию сегодня)
   * @param {Object} options - Дополнительные опции
   * @param {string} options.dealId - ID сделки для логирования (опционально)
   * @returns {Object} - { schedule: '50/50'|'100%', secondPaymentDate: Date|null, daysDiff: number|null }
   */
  static determineSchedule(expectedCloseDate, referenceDate = new Date(), options = {}) {
    const { dealId } = options;
    
    // Если дата отсутствует, возвращаем 100% график
    if (!expectedCloseDate) {
      logger.debug('No close date provided, defaulting to 100% schedule', { dealId });
      return { 
        schedule: '100%', 
        secondPaymentDate: null, 
        daysDiff: null 
      };
    }

    try {
      const closeDate = new Date(expectedCloseDate);
      const today = new Date(referenceDate);
      
      // Проверка валидности даты
      if (isNaN(closeDate.getTime())) {
        logger.warn('Invalid close date format, defaulting to 100% schedule', {
          dealId,
          expectedCloseDate,
          error: 'Invalid date'
        });
        return { 
          schedule: '100%', 
          secondPaymentDate: null, 
          daysDiff: null 
        };
      }

      // Расчет разницы в днях (округление вверх)
      const daysDiff = Math.ceil((closeDate - today) / (1000 * 60 * 60 * 24));

      // Если >= 30 дней, используем график 50/50
      if (daysDiff >= 30) {
        // Дата второго платежа = expected_close_date - 1 месяц
        const secondPaymentDate = new Date(closeDate);
        secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
        
        logger.debug('Using 50/50 payment schedule', {
          dealId,
          daysDiff,
          closeDate: closeDate.toISOString(),
          secondPaymentDate: secondPaymentDate.toISOString()
        });
        
        return { 
          schedule: '50/50', 
          secondPaymentDate, 
          daysDiff 
        };
      }

      // Если < 30 дней, используем график 100%
      logger.debug('Using 100% payment schedule', {
        dealId,
        daysDiff,
        closeDate: closeDate.toISOString()
      });
      
      return { 
        schedule: '100%', 
        secondPaymentDate: null, 
        daysDiff 
      };
    } catch (error) {
      logger.warn('Failed to determine payment schedule', {
        dealId,
        expectedCloseDate,
        error: error.message
      });
      
      // В случае ошибки возвращаем безопасное значение по умолчанию
      return { 
        schedule: '100%', 
        secondPaymentDate: null, 
        daysDiff: null 
      };
    }
  }

  /**
   * Определить график платежей из объекта deal
   * 
   * Удобный метод для работы с объектами сделок из Pipedrive
   * 
   * @param {Object} deal - Объект сделки из Pipedrive
   * @param {Date} referenceDate - Дата для расчета (по умолчанию сегодня)
   * @returns {Object} - { schedule: '50/50'|'100%', secondPaymentDate: Date|null, daysDiff: number|null }
   */
  static determineScheduleFromDeal(deal, referenceDate = new Date()) {
    if (!deal) {
      logger.warn('Deal is null or undefined, defaulting to 100% schedule');
      return { 
        schedule: '100%', 
        secondPaymentDate: null, 
        daysDiff: null 
      };
    }

    // Приоритет: expected_close_date → close_date
    const closeDate = deal.expected_close_date || 
                     deal['expected_close_date'] || 
                     deal.close_date || 
                     deal['close_date'] || 
                     null;

    return this.determineSchedule(closeDate, referenceDate, { dealId: deal.id });
  }

  /**
   * Вычислить дату второго платежа для графика 50/50
   * 
   * Правило: второй платеж = expected_close_date - 1 месяц
   * 
   * @param {Date|string} expectedCloseDate - Дата начала лагеря
   * @returns {Date|null} - Дата второго платежа или null если дата невалидна
   */
  static calculateSecondPaymentDate(expectedCloseDate) {
    if (!expectedCloseDate) {
      return null;
    }

    try {
      const closeDate = new Date(expectedCloseDate);
      if (isNaN(closeDate.getTime())) {
        return null;
      }

      const secondPaymentDate = new Date(closeDate);
      secondPaymentDate.setMonth(secondPaymentDate.getMonth() - 1);
      
      return secondPaymentDate;
    } catch (error) {
      logger.warn('Failed to calculate second payment date', {
        expectedCloseDate,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Проверить, наступила ли дата второго платежа
   * 
   * @param {Date|string} secondPaymentDate - Дата второго платежа
   * @param {Date} referenceDate - Дата для сравнения (по умолчанию сегодня)
   * @returns {boolean} - true если дата наступила или прошла
   */
  static isSecondPaymentDateReached(secondPaymentDate, referenceDate = new Date()) {
    if (!secondPaymentDate) {
      return false;
    }

    try {
      const paymentDate = new Date(secondPaymentDate);
      const today = new Date(referenceDate);
      
      if (isNaN(paymentDate.getTime())) {
        return false;
      }

      // Сравниваем только даты (без времени)
      const paymentDateOnly = new Date(paymentDate.getFullYear(), paymentDate.getMonth(), paymentDate.getDate());
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      
      return paymentDateOnly <= todayOnly;
    } catch (error) {
      logger.warn('Failed to check if second payment date is reached', {
        secondPaymentDate,
        error: error.message
      });
      return false;
    }
  }
}

module.exports = PaymentScheduleService;

