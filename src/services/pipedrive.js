const axios = require('axios');
const logger = require('../utils/logger');

class PipedriveClient {
  constructor() {
    this.apiToken = process.env.PIPEDRIVE_API_TOKEN?.trim();
    this.baseURL = process.env.PIPEDRIVE_BASE_URL || 'https://api.pipedrive.com/v1';
    
    if (!this.apiToken) {
      throw new Error('PIPEDRIVE_API_TOKEN must be set in environment variables');
    }
    
    // Создаем axios клиент для Pipedrive API
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 15000
    });

    // Добавляем interceptor для логирования
    this.client.interceptors.request.use(
      (config) => {
        logger.info('Pipedrive API Request:', {
          method: config.method,
          url: config.url,
          params: config.params
        });
        return config;
      },
      (error) => {
        logger.error('Pipedrive API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info('Pipedrive API Response:', {
          status: response.status,
          url: response.config.url,
          success: response.data?.success
        });
        return response;
      },
      (error) => {
        logger.error('Pipedrive API Response Error:', {
          status: error.response?.status,
          url: error.config?.url,
          message: error.message,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Получить информацию о текущем пользователе
   * @returns {Promise<Object>} - Информация о пользователе
   */
  async getUserInfo() {
    try {
      const response = await this.client.get('/users/me', {
        params: { api_token: this.apiToken }
      });
      
      if (response.data.success) {
        return {
          success: true,
          user: response.data.data,
          message: 'User info retrieved successfully'
        };
      } else {
        throw new Error('Failed to get user info');
      }
    } catch (error) {
      logger.error('Error getting user info:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить сделку по ID
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Данные сделки
   */
  async getDeal(dealId) {
    try {
      const response = await this.client.get(`/deals/${dealId}`, {
        params: { api_token: this.apiToken }
      });
      
      if (response.data.success) {
        return {
          success: true,
          deal: response.data.data,
          message: 'Deal retrieved successfully'
        };
      } else {
        throw new Error('Failed to get deal');
      }
    } catch (error) {
      logger.error('Error getting deal:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить список сделок
   * @param {Object} options - Опции для фильтрации
   * @returns {Promise<Object>} - Список сделок
   */
  async getDeals(options = {}) {
    try {
      const params = {
        api_token: this.apiToken,
        limit: options.limit || 20,
        start: options.start || 0
      };

      if (options.stage_id) {
        params.stage_id = options.stage_id;
      }
      if (options.status) {
        params.status = options.status;
      }

      const response = await this.client.get('/deals', { params });
      
      if (response.data.success) {
        return {
          success: true,
          deals: response.data.data,
          pagination: response.data.additional_data?.pagination,
          message: 'Deals retrieved successfully'
        };
      } else {
        throw new Error('Failed to get deals');
      }
    } catch (error) {
      logger.error('Error getting deals:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить организацию по ID
   * @param {number} orgId - ID организации
   * @returns {Promise<Object>} - Данные организации
   */
  async getOrganization(orgId) {
    try {
      const response = await this.client.get(`/organizations/${orgId}`, {
        params: { api_token: this.apiToken }
      });
      
      if (response.data.success) {
        return {
          success: true,
          organization: response.data.data,
          message: 'Organization retrieved successfully'
        };
      } else {
        throw new Error('Failed to get organization');
      }
    } catch (error) {
      logger.error('Error getting organization:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить контакт по ID
   * @param {number} personId - ID контакта
   * @returns {Promise<Object>} - Данные контакта
   */
  async getPerson(personId) {
    try {
      const response = await this.client.get(`/persons/${personId}`, {
        params: { api_token: this.apiToken }
      });
      
      if (response.data.success) {
        return {
          success: true,
          person: response.data.data,
          message: 'Person retrieved successfully'
        };
      } else {
        throw new Error('Failed to get person');
      }
    } catch (error) {
      logger.error('Error getting person:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Обновить сделку
   * @param {number} dealId - ID сделки
    * @param {Object} data - Поля для обновления
    * @returns {Promise<Object>} - Результат обновления
    */
  async updateDeal(dealId, data = {}) {
    try {
      const response = await this.client.put(`/deals/${dealId}`, data, {
        params: { api_token: this.apiToken }
      });

      if (response.data.success) {
        return {
          success: true,
          deal: response.data.data,
          message: 'Deal updated successfully'
        };
      }

      throw new Error('Failed to update deal');
    } catch (error) {
      logger.error('Error updating deal:', {
        dealId,
        error: error.message,
        details: error.response?.data || null
      });
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить полную информацию о сделке (включая связанные данные)
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Полные данные сделки
   */
  async getDealWithRelatedData(dealId) {
    try {
      // Получаем основную информацию о сделке
      const dealResult = await this.getDeal(dealId);
      if (!dealResult.success) {
        return dealResult;
      }

      const deal = dealResult.deal;
      const relatedData = {};

      // Получаем данные организации, если есть
      if (deal.org_id) {
        const orgResult = await this.getOrganization(deal.org_id.value);
        if (orgResult.success) {
          relatedData.organization = orgResult.organization;
        }
      }

      // Получаем данные контакта, если есть
      if (deal.person_id) {
        const personResult = await this.getPerson(deal.person_id.value);
        if (personResult.success) {
          relatedData.person = personResult.person;
        }
      }

      return {
        success: true,
        deal: deal,
        person: relatedData.person || null,
        organization: relatedData.organization || null,
        message: 'Deal with related data retrieved successfully'
      };
    } catch (error) {
      logger.error('Error getting deal with related data:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Тест подключения к Pipedrive API
   * @returns {Promise<Object>} - Результат теста
   */
  async testConnection() {
    try {
      const result = await this.getUserInfo();
      
      if (result.success) {
        return {
          success: true,
          message: 'Connection to Pipedrive API successful',
          user: result.user
        };
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      logger.error('Error testing Pipedrive connection:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }
}

module.exports = PipedriveClient;
