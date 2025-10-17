const WfirmaClient = require('./wfirma');
const logger = require('../utils/logger');

class UserManagementService {
  constructor() {
    this.wfirmaClient = new WfirmaClient();
    this.cache = new Map(); // Простое кэширование в памяти
    this.cacheTimeout = 5 * 60 * 1000; // 5 минут
  }

  /**
   * Найти или создать контрагента по email
   * @param {Object} userData - Данные пользователя
   * @param {string} userData.email - Email пользователя
   * @param {string} userData.name - Имя пользователя
   * @param {string} userData.address - Адрес пользователя
   * @param {string} userData.zip - Почтовый индекс
   * @param {string} userData.city - Город
   * @param {string} userData.country - Страна
   * @param {string} userData.business_id - Налоговый номер
   * @param {string} userData.type - Тип (person/company)
   * @returns {Promise<Object>} - Результат операции
   */
  async findOrCreateContractor(userData) {
    try {
      logger.info(`Finding or creating contractor for email: ${userData.email}`);

      // Проверяем кэш
      const cacheKey = `contractor_${userData.email.toLowerCase()}`;
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        logger.info(`Contractor found in cache: ${userData.email}`);
        return {
          success: true,
          fromCache: true,
          contractor: cached.contractor,
          message: 'Contractor found in cache'
        };
      }

      // Ищем контрагента по email
      const searchResult = await this.wfirmaClient.findContractorByEmail(userData.email);
      
      if (!searchResult.success) {
        logger.error('Error searching contractor:', searchResult.error);
        return {
          success: false,
          error: searchResult.error,
          message: 'Failed to search contractor'
        };
      }

      if (searchResult.found) {
        // Контрагент найден
        logger.info(`Contractor found: ${searchResult.contractor.name} (ID: ${searchResult.contractor.id})`);
        
        // Сохраняем в кэш
        this.cache.set(cacheKey, {
          contractor: searchResult.contractor,
          timestamp: Date.now()
        });

        return {
          success: true,
          found: true,
          contractor: searchResult.contractor,
          message: 'Contractor found'
        };
      } else {
        // Контрагент не найден, создаем нового
        logger.info(`Contractor not found, creating new one for: ${userData.email}`);
        
        const createResult = await this.wfirmaClient.createContractor(userData);
        
        if (!createResult.success) {
          logger.error('Error creating contractor:', createResult.error);
          return {
            success: false,
            error: createResult.error,
            message: 'Failed to create contractor'
          };
        }

        // Используем данные созданного контрагента
        const newContractor = {
          id: createResult.contractorId,
          name: userData.name,
          email: userData.email,
          address: userData.address,
          zip: userData.zip,
          city: userData.city,
          country: userData.country,
          business_id: userData.business_id,
          type: userData.type
        };
        
        logger.info(`New contractor created: ${newContractor.name} (ID: ${newContractor.id})`);
        
        // Сохраняем в кэш
        this.cache.set(cacheKey, {
          contractor: newContractor,
          timestamp: Date.now()
        });

        return {
          success: true,
          found: false,
          created: true,
          contractor: newContractor,
          message: 'Contractor created successfully'
        };
      }
    } catch (error) {
      logger.error('Error in findOrCreateContractor:', error);
      return {
        success: false,
        error: error.message,
        message: 'Unexpected error in user management'
      };
    }
  }

  /**
   * Очистить кэш
   */
  clearCache() {
    this.cache.clear();
    logger.info('User management cache cleared');
  }

  /**
   * Получить статистику кэша
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      timeout: this.cacheTimeout,
      entries: Array.from(this.cache.keys())
    };
  }
}

module.exports = UserManagementService;
