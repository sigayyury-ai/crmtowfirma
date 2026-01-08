const logger = require('../utils/logger');

/**
 * Сервис для мониторинга лимитов Pipedrive API
 * Отслеживает количество запросов и предупреждает о приближении к лимитам
 */
class PipedriveRateLimitMonitor {
  constructor() {
    // Лимиты Pipedrive API (по умолчанию)
    // 100 запросов в 10 секунд (rolling window)
    // 10,000 запросов в день
    this.limits = {
      per10Seconds: parseInt(process.env.PIPEDRIVE_RATE_LIMIT_PER_10S || '100', 10),
      perDay: parseInt(process.env.PIPEDRIVE_RATE_LIMIT_PER_DAY || '10000', 10)
    };

    // Пороги предупреждений (в процентах)
    this.warningThresholds = {
      per10Seconds: 0.8, // 80% от лимита
      perDay: 0.9 // 90% от лимита
    };

    // История запросов (rolling window для 10 секунд)
    this.requestHistory = [];
    
    // Счетчики за день
    this.dailyCounters = {
      total: 0,
      resetAt: this.getNextDayResetTime()
    };

    // Статистика по cron задачам
    this.cronTaskStats = new Map();
  }

  /**
   * Получить время следующего сброса дневного счетчика (полночь UTC)
   */
  getNextDayResetTime() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }

  /**
   * Очистить старые записи из истории (старше 10 секунд)
   */
  cleanupHistory() {
    const now = Date.now();
    const tenSecondsAgo = now - 10000;
    this.requestHistory = this.requestHistory.filter(timestamp => timestamp > tenSecondsAgo);
  }

  /**
   * Проверить и сбросить дневной счетчик если нужно
   */
  checkDailyReset() {
    const now = Date.now();
    if (now >= this.dailyCounters.resetAt) {
      const oldTotal = this.dailyCounters.total;
      this.dailyCounters.total = 0;
      this.dailyCounters.resetAt = this.getNextDayResetTime();
      
      if (oldTotal > 0) {
        logger.info('Pipedrive API daily counter reset', {
          previousTotal: oldTotal,
          resetAt: new Date(this.dailyCounters.resetAt).toISOString()
        });
      }
    }
  }

  /**
   * Зарегистрировать запрос к API
   * @param {string} taskName - Название задачи (например, 'cron_second_payment')
   * @returns {Object} - Статус лимитов и предупреждения
   */
  recordRequest(taskName = 'unknown') {
    const now = Date.now();
    
    // Очищаем старую историю
    this.cleanupHistory();
    
    // Проверяем сброс дневного счетчика
    this.checkDailyReset();

    // Добавляем запрос в историю
    this.requestHistory.push(now);
    this.dailyCounters.total++;

    // Обновляем статистику по задаче
    if (!this.cronTaskStats.has(taskName)) {
      this.cronTaskStats.set(taskName, {
        count: 0,
        lastRequestAt: null,
        firstRequestAt: null
      });
    }
    const taskStats = this.cronTaskStats.get(taskName);
    taskStats.count++;
    taskStats.lastRequestAt = now;
    if (!taskStats.firstRequestAt) {
      taskStats.firstRequestAt = now;
    }

    // Проверяем лимиты
    return this.checkLimits(taskName);
  }

  /**
   * Проверить текущее состояние лимитов
   * @param {string} taskName - Название задачи
   * @returns {Object} - Статус лимитов
   */
  checkLimits(taskName = 'unknown') {
    this.cleanupHistory();
    this.checkDailyReset();

    const requestsLast10s = this.requestHistory.length;
    const requestsToday = this.dailyCounters.total;

    const per10sLimit = this.limits.per10Seconds;
    const perDayLimit = this.limits.perDay;

    const per10sUsage = requestsLast10s / per10sLimit;
    const perDayUsage = requestsToday / perDayLimit;

    const per10sWarning = per10sUsage >= this.warningThresholds.per10Seconds;
    const perDayWarning = perDayUsage >= this.warningThresholds.perDay;

    const per10sExceeded = requestsLast10s >= per10sLimit;
    const perDayExceeded = requestsToday >= perDayLimit;

    const status = {
      per10Seconds: {
        current: requestsLast10s,
        limit: per10sLimit,
        usage: per10sUsage,
        warning: per10sWarning,
        exceeded: per10sExceeded
      },
      perDay: {
        current: requestsToday,
        limit: perDayLimit,
        usage: perDayUsage,
        warning: perDayWarning,
        exceeded: perDayExceeded
      },
      taskName,
      canProceed: !per10sExceeded && !perDayExceeded
    };

    // Логируем предупреждения
    if (per10sExceeded || perDayExceeded) {
      logger.error('Pipedrive API rate limit EXCEEDED', {
        taskName,
        per10Seconds: {
          current: requestsLast10s,
          limit: per10sLimit,
          exceeded: per10sExceeded
        },
        perDay: {
          current: requestsToday,
          limit: perDayLimit,
          exceeded: perDayExceeded
        }
      });
    } else if (per10sWarning || perDayWarning) {
      logger.warn('Pipedrive API rate limit WARNING', {
        taskName,
        per10Seconds: {
          current: requestsLast10s,
          limit: per10sLimit,
          usagePercent: Math.round(per10sUsage * 100)
        },
        perDay: {
          current: requestsToday,
          limit: perDayLimit,
          usagePercent: Math.round(perDayUsage * 100)
        }
      });
    }

    return status;
  }

  /**
   * Получить статистику по всем cron задачам
   * @returns {Object} - Статистика
   */
  getCronTaskStats() {
    const stats = {};
    for (const [taskName, taskData] of this.cronTaskStats.entries()) {
      stats[taskName] = {
        requests: taskData.count,
        lastRequestAt: taskData.lastRequestAt ? new Date(taskData.lastRequestAt).toISOString() : null,
        firstRequestAt: taskData.firstRequestAt ? new Date(taskData.firstRequestAt).toISOString() : null
      };
    }
    return stats;
  }

  /**
   * Получить текущий статус лимитов
   * @returns {Object} - Полный статус
   */
  getStatus() {
    this.cleanupHistory();
    this.checkDailyReset();

    return {
      limits: { ...this.limits },
      current: {
        per10Seconds: this.requestHistory.length,
        perDay: this.dailyCounters.total
      },
      usage: {
        per10Seconds: this.requestHistory.length / this.limits.per10Seconds,
        perDay: this.dailyCounters.total / this.limits.perDay
      },
      nextDailyReset: new Date(this.dailyCounters.resetAt).toISOString(),
      cronTaskStats: this.getCronTaskStats()
    };
  }

  /**
   * Оценить количество запросов, которые может сделать задача
   * @param {string} taskName - Название задачи
   * @param {number} estimatedRequests - Ожидаемое количество запросов
   * @returns {Object} - Оценка безопасности
   */
  estimateTaskSafety(taskName, estimatedRequests) {
    this.cleanupHistory();
    this.checkDailyReset();

    const requestsLast10s = this.requestHistory.length;
    const requestsToday = this.dailyCounters.total;

    const per10sAvailable = this.limits.per10Seconds - requestsLast10s;
    const perDayAvailable = this.limits.perDay - requestsToday;

    const canRunIn10s = estimatedRequests <= per10sAvailable;
    const canRunToday = estimatedRequests <= perDayAvailable;

    const safety = {
      taskName,
      estimatedRequests,
      canRun: canRunIn10s && canRunToday,
      per10Seconds: {
        available: per10sAvailable,
        needed: estimatedRequests,
        safe: canRunIn10s
      },
      perDay: {
        available: perDayAvailable,
        needed: estimatedRequests,
        safe: canRunToday
      },
      recommendation: canRunIn10s && canRunToday
        ? 'safe'
        : !canRunIn10s
        ? 'wait_10s'
        : 'wait_daily_reset'
    };

    if (!safety.canRun) {
      logger.warn('Pipedrive API rate limit check: task may exceed limits', safety);
    }

    return safety;
  }

  /**
   * Сбросить статистику задачи (для тестирования)
   */
  resetTaskStats(taskName) {
    this.cronTaskStats.delete(taskName);
  }

  /**
   * Полный сброс (для тестирования)
   */
  reset() {
    this.requestHistory = [];
    this.dailyCounters = {
      total: 0,
      resetAt: this.getNextDayResetTime()
    };
    this.cronTaskStats.clear();
  }
}

// Singleton instance
let sharedMonitor = null;

function getMonitor() {
  if (!sharedMonitor) {
    sharedMonitor = new PipedriveRateLimitMonitor();
  }
  return sharedMonitor;
}

module.exports = PipedriveRateLimitMonitor;
module.exports.getMonitor = getMonitor;


