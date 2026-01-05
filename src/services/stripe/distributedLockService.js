const logger = require('../../utils/logger');
const supabase = require('../supabaseClient');

/**
 * DistributedLockService
 * 
 * Сервис для предотвращения race conditions при создании платежей.
 * Использует Supabase для хранения locks между процессами/инстансами.
 * 
 * @see docs/stripe-payment-logic-code-review.md - раздел "Race conditions при создании сессий"
 */
class DistributedLockService {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.supabase = options.supabase || supabase;
    this.defaultTimeout = options.defaultTimeout || 30000; // 30 seconds
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    
    // Start cleanup task
    this._startCleanupTask();
  }

  /**
   * Получить lock для сделки
   * 
   * @param {string} dealId - ID сделки
   * @param {string} lockType - Тип lock ('payment_creation', 'webhook_processing', etc.)
   * @param {number} timeout - Таймаут в миллисекундах (default: 30s)
   * @returns {Promise<Object>} - { acquired: boolean, lockId: string | null }
   */
  async acquireLock(dealId, lockType = 'payment_creation', timeout = this.defaultTimeout) {
    const lockKey = `${dealId}_${lockType}`;
    const expiresAt = new Date(Date.now() + timeout);
    const lockId = `${lockKey}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Try to insert lock (will fail if lock already exists)
      const { data, error } = await this.supabase
        .from('stripe_payment_locks')
        .insert({
          lock_key: lockKey,
          lock_id: lockId,
          deal_id: String(dealId),
          lock_type: lockType,
          expires_at: expiresAt.toISOString(),
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        // Check if error is due to existing lock (unique constraint violation)
        if (error.code === '23505' || error.message?.includes('duplicate') || error.message?.includes('unique')) {
          // Lock already exists, check if it's expired
          const existingLock = await this._checkExistingLock(lockKey);
          
          if (existingLock && new Date(existingLock.expires_at) > new Date()) {
            // Lock is still valid
            this.logger.debug('Lock already acquired by another process', {
              dealId,
              lockType,
              lockKey,
              existingLockId: existingLock.lock_id
            });
            return { acquired: false, lockId: null };
          } else if (existingLock) {
            // Lock expired, try to delete and acquire new one
            await this._releaseLock(lockKey, existingLock.lock_id);
            // Retry once
            return this.acquireLock(dealId, lockType, timeout);
          }
        }
        
        this.logger.warn('Failed to acquire lock', {
          dealId,
          lockType,
          error: error.message
        });
        return { acquired: false, lockId: null };
      }

      this.logger.debug('Lock acquired successfully', {
        dealId,
        lockType,
        lockId,
        expiresAt: expiresAt.toISOString()
      });

      return { acquired: true, lockId };
    } catch (error) {
      this.logger.error('Error acquiring lock', {
        dealId,
        lockType,
        error: error.message
      });
      return { acquired: false, lockId: null };
    }
  }

  /**
   * Освободить lock
   * 
   * @param {string} dealId - ID сделки
   * @param {string} lockType - Тип lock
   * @param {string} lockId - ID lock для проверки владельца
   * @returns {Promise<boolean>} - true если lock освобожден
   */
  async releaseLock(dealId, lockType, lockId) {
    const lockKey = `${dealId}_${lockType}`;
    return this._releaseLock(lockKey, lockId);
  }

  /**
   * Освободить lock по ключу
   * 
   * @private
   */
  async _releaseLock(lockKey, lockId) {
    try {
      const { error } = await this.supabase
        .from('stripe_payment_locks')
        .delete()
        .eq('lock_key', lockKey)
        .eq('lock_id', lockId);

      if (error) {
        this.logger.warn('Failed to release lock', {
          lockKey,
          lockId,
          error: error.message
        });
        return false;
      }

      this.logger.debug('Lock released successfully', {
        lockKey,
        lockId
      });

      return true;
    } catch (error) {
      this.logger.error('Error releasing lock', {
        lockKey,
        lockId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Проверить существующий lock
   * 
   * @private
   */
  async _checkExistingLock(lockKey) {
    try {
      const { data, error } = await this.supabase
        .from('stripe_payment_locks')
        .select('*')
        .eq('lock_key', lockKey)
        .single();

      if (error || !data) {
        return null;
      }

      return data;
    } catch (error) {
      this.logger.warn('Error checking existing lock', {
        lockKey,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Выполнить функцию с lock
   * 
   * @param {string} dealId - ID сделки
   * @param {Function} fn - Функция для выполнения
   * @param {Object} options - Опции
   * @param {string} options.lockType - Тип lock
   * @param {number} options.timeout - Таймаут lock
   * @param {number} options.maxRetries - Максимальное количество попыток
   * @param {number} options.retryDelay - Задержка между попытками
   * @returns {Promise<*>} - Результат выполнения функции
   */
  async withLock(dealId, fn, options = {}) {
    const {
      lockType = 'payment_creation',
      timeout = this.defaultTimeout,
      maxRetries = 3,
      retryDelay = 1000
    } = options;

    let lockId = null;
    let retries = 0;

    while (retries < maxRetries) {
      const lockResult = await this.acquireLock(dealId, lockType, timeout);
      
      if (!lockResult.acquired) {
        retries++;
        if (retries < maxRetries) {
          this.logger.debug('Lock not acquired, retrying', {
            dealId,
            lockType,
            retry: retries,
            maxRetries
          });
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        } else {
          throw new Error(`Failed to acquire lock after ${maxRetries} attempts`);
        }
      }

      lockId = lockResult.lockId;
      break;
    }

    try {
      // Execute function with lock
      const result = await fn();
      return result;
    } finally {
      // Always release lock
      if (lockId) {
        await this.releaseLock(dealId, lockType, lockId);
      }
    }
  }

  /**
   * Очистить истекшие locks
   * 
   * @private
   */
  async _cleanupExpiredLocks() {
    try {
      const { error } = await this.supabase
        .from('stripe_payment_locks')
        .delete()
        .lt('expires_at', new Date().toISOString());

      if (error) {
        this.logger.warn('Failed to cleanup expired locks', {
          error: error.message
        });
      } else {
        this.logger.debug('Expired locks cleaned up');
      }
    } catch (error) {
      this.logger.error('Error cleaning up expired locks', {
        error: error.message
      });
    }
  }

  /**
   * Запустить задачу очистки истекших locks
   * 
   * @private
   */
  _startCleanupTask() {
    if (this._cleanupIntervalId) {
      return; // Already started
    }

    this._cleanupIntervalId = setInterval(() => {
      this._cleanupExpiredLocks();
    }, this.cleanupInterval);

    this.logger.info('Distributed lock cleanup task started', {
      interval: this.cleanupInterval
    });
  }

  /**
   * Остановить задачу очистки
   */
  stopCleanupTask() {
    if (this._cleanupIntervalId) {
      clearInterval(this._cleanupIntervalId);
      this._cleanupIntervalId = null;
      this.logger.info('Distributed lock cleanup task stopped');
    }
  }
}

module.exports = DistributedLockService;

