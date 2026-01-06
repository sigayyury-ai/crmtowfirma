const logger = require('../../../../src/utils/logger');
const PipedriveClient = require('../../../../src/services/pipedrive');
const StripeRepository = require('../../../../src/services/stripe/repository');
const { getStripeClient } = require('../../../../src/services/stripe/client');

/**
 * CleanupHelpers
 * 
 * Helper функции для очистки тестовых данных после выполнения тестов.
 */
class CleanupHelpers {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
    this.repository = options.repository || new StripeRepository();
    this.stripe = options.stripe || getStripeClient();
    this.testPrefix = options.testPrefix || 'TEST_AUTO_';
  }

  /**
   * Очистить тестовые сделки из Pipedrive
   * 
   * @param {Array<string>} dealIds - Массив ID сделок для удаления
   * @returns {Promise<Object>} - Результат очистки
   */
  async cleanupTestDeals(dealIds) {
    if (!dealIds || dealIds.length === 0) {
      return { success: true, deleted: 0 };
    }

    this.logger.info('Cleaning up test deals', { count: dealIds.length });

    let deleted = 0;
    const errors = [];

    for (const dealId of dealIds) {
      try {
        await this.pipedriveClient.deleteDeal(dealId);
        deleted++;
      } catch (error) {
        this.logger.warn('Failed to delete test deal', {
          dealId,
          error: error.message
        });
        errors.push({ dealId, error: error.message });
      }
    }

    return {
      success: errors.length === 0,
      deleted,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Очистить тестовые платежи из базы данных
   * 
   * @param {Array<string>} paymentIds - Массив ID платежей для удаления
   * @returns {Promise<Object>} - Результат очистки
   */
  async cleanupTestPayments(paymentIds) {
    if (!paymentIds || paymentIds.length === 0) {
      return { success: true, deleted: 0 };
    }

    this.logger.info('Cleaning up test payments', { count: paymentIds.length });

    let deleted = 0;
    const errors = [];

    for (const paymentId of paymentIds) {
      try {
        // TODO: Implement payment deletion in repository
        // await this.repository.deletePayment(paymentId);
        deleted++;
      } catch (error) {
        this.logger.warn('Failed to delete test payment', {
          paymentId,
          error: error.message
        });
        errors.push({ paymentId, error: error.message });
      }
    }

    return {
      success: errors.length === 0,
      deleted,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Очистить тестовые Stripe сессии
   * 
   * @param {Array<string>} sessionIds - Массив ID сессий для удаления
   * @returns {Promise<Object>} - Результат очистки
   */
  async cleanupTestStripeSessions(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) {
      return { success: true, deleted: 0 };
    }

    this.logger.info('Cleaning up test Stripe sessions', { count: sessionIds.length });

    let deleted = 0;
    const errors = [];

    for (const sessionId of sessionIds) {
      try {
        // Stripe sessions cannot be deleted, but we can expire them
        await this.stripe.checkout.sessions.expire(sessionId);
        deleted++;
      } catch (error) {
        this.logger.warn('Failed to expire test Stripe session', {
          sessionId,
          error: error.message
        });
        errors.push({ sessionId, error: error.message });
      }
    }

    return {
      success: errors.length === 0,
      deleted,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Очистить тестовые задачи из Pipedrive
   * 
   * @param {Array<string>} dealIds - Массив ID сделок, для которых нужно удалить задачи
   * @returns {Promise<Object>} - Результат очистки
   */
  async cleanupTestTasks(dealIds) {
    if (!dealIds || dealIds.length === 0) {
      return { success: true, deleted: 0 };
    }

    this.logger.info('Cleaning up test tasks', { dealCount: dealIds.length });

    let deleted = 0;
    const errors = [];

    // Get all tasks for test deals
    for (const dealId of dealIds) {
      try {
        const activitiesResult = await this.pipedriveClient.getDealActivities(dealId, 'task');
        if (activitiesResult.success && activitiesResult.activities) {
          for (const task of activitiesResult.activities) {
            try {
              // Check if task subject or note contains test prefix
              const subject = task.subject || '';
              const note = task.note || task.public_description || '';
              if (subject.includes(this.testPrefix) || note.includes(this.testPrefix)) {
                const deleteResult = await this.pipedriveClient.deleteActivity(task.id);
                if (deleteResult.success) {
                  deleted++;
                } else {
                  errors.push({ taskId: task.id, dealId, error: deleteResult.error });
                }
              }
            } catch (error) {
              this.logger.warn('Failed to delete test task', {
                taskId: task.id,
                dealId,
                error: error.message
              });
              errors.push({ taskId: task.id, dealId, error: error.message });
            }
          }
        }
      } catch (error) {
        this.logger.warn('Failed to get tasks for deal', {
          dealId,
          error: error.message
        });
        errors.push({ dealId, error: error.message });
      }
    }

    return {
      success: errors.length === 0,
      deleted,
      errors: errors.length > 0 ? errors : null
    };
  }

  /**
   * Полная очистка всех тестовых данных для конкретного тестового запуска
   * 
   * @param {Object} testData - Данные теста (deals, payments, sessions, tasks)
   * @returns {Promise<Object>} - Результат полной очистки
   */
  async cleanupAllTestData(testData = {}) {
    const { deals = [], payments = [], sessions = [] } = testData;

    this.logger.info('Cleaning up all test data', {
      deals: deals.length,
      payments: payments.length,
      sessions: sessions.length
    });

    // Delete tasks first (before deals, as tasks are linked to deals)
    const tasksResult = await this.cleanupTestTasks(deals);

    const results = {
      tasks: tasksResult,
      deals: await this.cleanupTestDeals(deals),
      payments: await this.cleanupTestPayments(payments),
      sessions: await this.cleanupTestStripeSessions(sessions)
    };

    const allSuccess = results.tasks.success &&
                       results.deals.success && 
                       results.payments.success && 
                       results.sessions.success;

    return {
      success: allSuccess,
      results
    };
  }
}

module.exports = CleanupHelpers;

