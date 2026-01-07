const axios = require('axios');
const logger = require('../utils/logger');

class SendPulseClient {
  constructor() {
    this.clientId = process.env.SENDPULSE_ID?.trim();
    this.clientSecret = process.env.SENDPULSE_SECRET?.trim();
    // messenger_id не нужен - SendPulse определяет мессенджер автоматически по contact_id
    
    if (!this.clientId || !this.clientSecret) {
      throw new Error('SENDPULSE_ID and SENDPULSE_SECRET must be set in environment variables');
    }
    
    this.baseURL = 'https://api.sendpulse.com';
    this.tokenURL = `${this.baseURL}/oauth/access_token`;
    this.accessToken = null;
    this.tokenExpiry = null;
    
    // Создаем axios клиент
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Pipedrive-wFirma-Integration/1.0'
      },
      timeout: 30000
    });

    // Добавляем interceptor для логирования
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('SendPulse API Request:', {
          method: config.method,
          url: config.url
        });
        return config;
      },
      (error) => {
        logger.error('SendPulse API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('SendPulse API Response:', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        logger.error('SendPulse API Response Error:', {
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
   * Получить access token через OAuth 2.0
   * @returns {Promise<string>} - Access token
   */
  async getAccessToken() {
    // Если токен еще валиден, возвращаем его
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await axios.post(this.tokenURL, {
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      // SendPulse API возвращает access_token напрямую в response.data
      const accessToken = response.data?.access_token || response.data?.accessToken;
      
      if (accessToken) {
        this.accessToken = accessToken;
        // Токен обычно валиден 3600 секунд (1 час)
        const expiresIn = response.data.expires_in || 3600;
        this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000; // Вычитаем 60 секунд для запаса
        logger.info('SendPulse access token obtained successfully');
        return this.accessToken;
      } else {
        throw new Error('Failed to get access token: invalid response');
      }
    } catch (error) {
      logger.error('Error getting SendPulse access token:', error);
      throw new Error(`Failed to get SendPulse access token: ${error.message}`);
    }
  }

  /**
   * Отправить сообщение в Telegram через SendPulse
   * @param {string} sendpulseId - ID контакта в SendPulse
   * @param {string} message - Текст сообщения
   * @param {Buffer|string} file - Файл для прикрепления (опционально)
   * @param {string} fileName - Имя файла (опционально)
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendTelegramMessage(sendpulseId, message, file = null, fileName = null) {
    let payload = null; // Объявляем payload вне try блока для использования в catch
    try {
      // Валидация входных параметров
      if (!sendpulseId) {
        throw new Error('sendpulseId is required');
      }
      
      // Проверяем, что message не пустой (если нет файла)
      if (!file && (!message || typeof message !== 'string' || message.trim().length === 0)) {
        throw new Error('Message text cannot be empty when no file is attached');
      }
      
      logger.info('Preparing to send Telegram message:', {
        sendpulseId,
        messageLength: message?.length || 0,
        hasClientId: !!this.clientId,
        hasClientSecret: !!this.clientSecret
      });
      
      const accessToken = await this.getAccessToken();
      
      logger.info('SendPulse access token obtained:', {
        hasToken: !!accessToken,
        tokenLength: accessToken?.length || 0
      });

      // Формируем URL для отправки сообщения
      // SendPulse API для отправки сообщений через мессенджер (Telegram)
                  // Правильный endpoint для Telegram: POST /telegram/contacts/send
                  const url = `${this.baseURL}/telegram/contacts/send`;

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      };

      // Формат payload согласно документации SendPulse:
      // { "contact_id": "...", "message": { "type": "text", "text": "...", "parse_mode": "Markdown" } }
      // contact_id должен быть строкой согласно API (ошибка: "The contact id must be a string")
      // Используем Markdown для форматирования (жирный текст, ссылки)
      
      // Нормализуем message: если есть файл, но нет текста, используем дефолтное сообщение
      const messageText = (message && message.trim()) || (file ? '📎 Файл' : '');
      
      payload = {
        contact_id: String(sendpulseId),
        message: {
          type: 'text',
          text: messageText,
          parse_mode: 'Markdown' // Включаем Markdown форматирование для Telegram
        }
      };

      // Если есть файл, добавляем его в payload
      if (file) {
        // SendPulse API может требовать специальный формат для файлов
        // Это зависит от конкретной версии API
        payload.message.attachment = {
          type: 'file',
          file: file,
          filename: fileName || 'proforma.pdf'
        };
      }

      const response = await axios.post(url, payload, { headers });

      // Проверяем успешный ответ (может быть 200/201 с данными или без)
      if (response.status === 200 || response.status === 201) {
        const messageId = response.data?.id || response.data?.message_id || response.data?.result?.id;
        logger.info('SendPulse Telegram message sent successfully', {
          sendpulseId,
          messageId: messageId || 'N/A',
          status: response.status,
          data: response.data
        });
        return {
          success: true,
          messageId: messageId || null
        };
      } else {
        throw new Error(`Failed to send message: unexpected status ${response.status}`);
      }
    } catch (error) {
      logger.error('Error sending SendPulse Telegram message:', error);
      const errorDetails = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        message: error.message,
        payload: payload // Добавляем payload для отладки
      };
      logger.error('SendPulse API error details:', JSON.stringify(errorDetails, null, 2));
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        details: errorDetails
      };
    }
  }

  /**
   * Отправить SMS сообщение через SendPulse
   * @param {string} phoneNumber - Номер телефона получателя (в формате +1234567890)
   * @param {string} message - Текст сообщения
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendSMS(phoneNumber, message) {
    try {
      logger.info('Preparing to send SMS message:', {
        phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***${phoneNumber.substring(phoneNumber.length - 2)}` : 'N/A',
        messageLength: message?.length || 0
      });
      
      const accessToken = await this.getAccessToken();
      
      // SendPulse API для отправки SMS: POST /sms/send
      const url = `${this.baseURL}/sms/send`;
      
      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      };
      
      // Формат payload согласно документации SendPulse SMS API
      const payload = {
        phones: [phoneNumber], // Массив номеров телефонов
        message: message,
        // Опционально: sender - имя отправителя (если настроено в SendPulse)
        // Опционально: transliterate - транслитерация (0 или 1)
      };
      
      const response = await axios.post(url, payload, { headers });
      
      if (response.status === 200 || response.status === 201) {
        const messageId = response.data?.id || response.data?.message_id || response.data?.result?.id;
        logger.info('SendPulse SMS message sent successfully', {
          phoneNumber: phoneNumber ? `${phoneNumber.substring(0, 3)}***${phoneNumber.substring(phoneNumber.length - 2)}` : 'N/A',
          messageId: messageId || 'N/A',
          status: response.status
        });
        return {
          success: true,
          messageId: messageId || null
        };
      } else {
        throw new Error(`Failed to send SMS: unexpected status ${response.status}`);
      }
    } catch (error) {
      logger.error('Error sending SendPulse SMS message:', error);
      const errorDetails = {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url,
        message: error.message
      };
      logger.error('SendPulse SMS API error details:', JSON.stringify(errorDetails, null, 2));
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        details: errorDetails
      };
    }
  }

  /**
   * Обновить кастомное поле контакта в SendPulse
   * @param {string} contactId - ID контакта в SendPulse
   * @param {Object} customFields - Объект с кастомными полями { field_name: value }
   * @returns {Promise<Object>} - Результат обновления
   */
  async updateContactCustomField(contactId, customFields) {
    try {
      if (!contactId) {
        throw new Error('contactId is required');
      }

      if (!customFields || typeof customFields !== 'object' || Object.keys(customFields).length === 0) {
        throw new Error('customFields must be a non-empty object');
      }

      logger.info('Updating SendPulse contact custom fields', {
        contactId,
        customFields
      });

      const accessToken = await this.getAccessToken();

      // SendPulse API для обновления контакта: PUT /contacts/{contact_id}
      // Или PATCH /contacts/{contact_id} для частичного обновления
      const url = `${this.baseURL}/contacts/${contactId}`;

      const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      };

      // Формат payload для обновления кастомных полей
      // SendPulse использует структуру custom_fields или variables
      const payload = {
        custom_fields: customFields
      };

      const response = await this.client.patch(url, payload, { headers });

      if (response.status === 200 || response.status === 204) {
        logger.info('SendPulse contact custom fields updated successfully', {
          contactId,
          customFields
        });
        return {
          success: true,
          contactId
        };
      } else {
        throw new Error(`Failed to update contact: unexpected status ${response.status}`);
      }
    } catch (error) {
      const status = error.response?.status;
      const isNotFound = status === 404;
      
      // 404 (Not Found) is not critical - contact may not exist in SendPulse
      if (isNotFound) {
        logger.warn('SendPulse contact not found (404) - skipping custom fields update', {
          contactId,
          customFields,
          note: 'Contact may not exist in SendPulse, this is not critical'
        });
        return {
          success: false,
          error: 'Contact not found in SendPulse',
          notFound: true
        };
      }
      
      // Other errors are logged as errors
      logger.error('Error updating SendPulse contact custom fields', {
        contactId,
        customFields,
        error: error.message,
        status,
        data: error.response?.data
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message
      };
    }
  }

  /**
   * Тест подключения к SendPulse API
   * @returns {Promise<Object>} - Результат теста
   */
  async testConnection() {
    try {
      const accessToken = await this.getAccessToken();
      return {
        success: true,
        message: 'Connection to SendPulse API successful'
      };
    } catch (error) {
      logger.error('Error testing SendPulse connection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = SendPulseClient;

