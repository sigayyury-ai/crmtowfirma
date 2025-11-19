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

      // Передаем кастомные поля как параметры запроса для фильтрации
      // Pipedrive API позволяет фильтровать по кастомным полям через параметры с ключом поля
      Object.keys(options).forEach(key => {
        // Пропускаем стандартные параметры и передаем только кастомные поля
        if (!['limit', 'start', 'stage_id', 'status'].includes(key)) {
          params[key] = options[key];
        }
      });

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
   * Получить продукты, привязанные к сделке
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Результат с массивом продуктов
   */
  async getDealProducts(dealId) {
    try {
      const response = await this.client.get(`/deals/${dealId}/products`, {
        params: {
          api_token: this.apiToken
        }
      });

      if (response.data?.success && Array.isArray(response.data?.data)) {
        return {
          success: true,
          products: response.data.data,
          additionalData: response.data.additional_data || null
        };
      }

      return {
        success: true,
        products: [],
        additionalData: response.data?.additional_data || null
      };
    } catch (error) {
      logger.error('Error getting deal products:', {
        dealId,
        error: error.message,
        details: error.response?.data || null
      });
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        products: []
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
   * Создать задачу в сделке
   * @param {Object} taskData - Данные задачи
   * @param {number} taskData.deal_id - ID сделки
   * @param {string} taskData.subject - Название задачи
   * @param {string} taskData.due_date - Срок выполнения (YYYY-MM-DD)
   * @param {string} [taskData.note] - Описание задачи
   * @param {string} [taskData.type] - Тип задачи (по умолчанию 'task')
   * @param {number} [taskData.assigned_to_user_id] - Ответственный пользователь
   * @returns {Promise<Object>} - Результат создания задачи
   */
  async createTask(taskData = {}) {
    try {
      logger.info('Creating task in Pipedrive:', {
        dealId: taskData.deal_id,
        subject: taskData.subject,
        dueDate: taskData.due_date,
        type: taskData.type,
        assignedUser: taskData.assigned_to_user_id,
        personId: taskData.person_id || null
      });

      const bodyData = {
        deal_id: taskData.deal_id,
        subject: taskData.subject,
        type: taskData.type || 'task',
        due_date: taskData.due_date
      };

      if (taskData.note) {
        bodyData.note = taskData.note;
      }

      if (taskData.assigned_to_user_id) {
        bodyData.assigned_to_user_id = taskData.assigned_to_user_id;
      }

      if (taskData.person_id) {
        bodyData.person_id = taskData.person_id;
      }

      if (taskData.public_description) {
        bodyData.public_description = taskData.public_description;
      }

      const response = await this.client.post('/activities', bodyData, {
        params: { api_token: this.apiToken }
      });

      if (response.data.success) {
        return {
          success: true,
          task: response.data.data,
          message: 'Task created successfully'
        };
      }

      throw new Error('Failed to create task');
    } catch (error) {
      logger.error('Error creating task in Pipedrive:', {
        dealId: taskData.deal_id,
        subject: taskData.subject,
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
    logger.info('PipedriveClient.testConnection() called', {
      hasApiToken: !!this.apiToken,
      timestamp: new Date().toISOString()
    });

    try {
      // Check if API token is available
      if (!this.apiToken) {
        logger.warn('PipedriveClient.testConnection() - API token not set', {
          timestamp: new Date().toISOString()
        });
        return {
          success: false,
          error: 'PIPEDRIVE_API_TOKEN is not set',
          message: 'PIPEDRIVE_API_TOKEN must be configured in environment variables'
        };
      }

      logger.debug('Calling getUserInfo() to test connection');
      const result = await this.getUserInfo();

      if (result.success) {
        logger.info('Pipedrive connection test successful', {
          userId: result.user?.id,
          userName: result.user?.name,
          timestamp: new Date().toISOString()
        });
        return {
          success: true,
          message: 'Connection to Pipedrive API successful',
          user: result.user
        };
      } else {
        logger.error('Pipedrive connection test failed - getUserInfo() returned error', {
          error: result.error,
          details: result.details,
          timestamp: new Date().toISOString()
        });
        return {
          success: false,
          error: result.error || 'Failed to connect to Pipedrive API',
          details: result.details || null,
          message: result.error || 'Failed to retrieve user info from Pipedrive'
        };
      }
    } catch (error) {
      logger.error('Error testing Pipedrive connection - exception caught', {
        error: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        timestamp: new Date().toISOString()
      });

      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        details: error.response?.data || null,
        status: error.response?.status || null,
        message: error.response?.data?.error || error.message || 'Failed to connect to Pipedrive API'
      };
    }
  }

  async updateDealStage(dealId, stageId) {
    if (!dealId || !stageId) {
      throw new Error('dealId and stageId are required to update stage');
    }

    const response = await this.client.put(`/deals/${dealId}`, {
      stage_id: stageId
    }, {
      params: { api_token: this.apiToken }
    });

    if (!response?.data?.success) {
      throw new Error(`Failed to update deal stage: ${JSON.stringify(response?.data)}`);
    }

    return response.data;
  }

  /**
   * Add a note to a deal
   * @param {number} dealId - Deal ID
   * @param {string} content - Note content
   * @returns {Promise<Object>} - Result of adding note
   */
  async getDealNotes(dealId) {
    try {
      const response = await this.client.get(`/notes`, {
        params: {
          api_token: this.apiToken,
          deal_id: dealId,
          limit: 500 // Get all notes for the deal
        }
      });

      if (response.data && response.data.success !== false) {
        return {
          success: true,
          notes: response.data.data || []
        };
      }

      return {
        success: false,
        error: response.data?.error || 'Unknown error',
        notes: []
      };
    } catch (error) {
      logger.error('Failed to get deal notes', {
        dealId,
        error: error.message,
        response: error.response?.data
      });
      return {
        success: false,
        error: error.message,
        notes: []
      };
    }
  }

  async addNoteToDeal(dealId, content) {
    if (!dealId || !content) {
      throw new Error('dealId and content are required to add note');
    }

    try {
      const response = await this.client.post('/notes', {
        content,
        deal_id: dealId
      }, {
        params: { api_token: this.apiToken }
      });

      if (response.data?.success) {
        return {
          success: true,
          note: response.data.data,
          message: 'Note added successfully'
        };
      }

      throw new Error('Failed to add note');
    } catch (error) {
      logger.error('Error adding note to deal:', {
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
   * Get activities (tasks, calls, etc.) for a deal
   * @param {number} dealId - Deal ID
   * @param {string} type - Activity type filter (optional, e.g., 'task', 'call')
   * @returns {Promise<Object>} - Activities data
   */
  async getDealActivities(dealId, type = null) {
    try {
      const params = {
        api_token: this.apiToken,
        deal_id: dealId,
        limit: 500
      };
      
      if (type) {
        params.type = type;
      }

      const response = await this.client.get('/activities', { params });

      if (response.data?.success !== false) {
        return {
          success: true,
          activities: response.data.data || []
        };
      }

      return {
        success: false,
        error: response.data?.error || 'Unknown error',
        activities: []
      };
    } catch (error) {
      logger.error('Failed to get deal activities', {
        dealId,
        type,
        error: error.message,
        response: error.response?.data
      });
      return {
        success: false,
        error: error.message,
        activities: []
      };
    }
  }

  /**
   * Update an activity (task, call, etc.)
   * @param {number} activityId - Activity ID
   * @param {Object} updateData - Data to update (e.g., { done: 1, done_date: '2025-01-01' })
   * @returns {Promise<Object>} - Updated activity data
   */
  async updateActivity(activityId, updateData) {
    try {
      const response = await this.client.put(`/activities/${activityId}`, updateData, {
        params: { api_token: this.apiToken }
      });

      if (response.data?.success) {
        return {
          success: true,
          activity: response.data.data,
          message: 'Activity updated successfully'
        };
      }

      throw new Error('Failed to update activity');
    } catch (error) {
      logger.error('Error updating activity:', {
        activityId,
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
}

module.exports = PipedriveClient;
