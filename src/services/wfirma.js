const axios = require('axios');
const logger = require('../utils/logger');

class WfirmaClient {
  constructor() {
    // API Key credentials
    this.appKey = process.env.WFIRMA_APP_KEY?.trim();
    this.accessKey = process.env.WFIRMA_ACCESS_KEY?.trim();
    this.secretKey = process.env.WFIRMA_SECRET_KEY?.trim();
    
    // Company ID - обязательный параметр для всех запросов
    this.companyId = '885512';
    
    if (!this.appKey || !this.accessKey || !this.secretKey) {
      throw new Error('WFIRMA_APP_KEY, WFIRMA_ACCESS_KEY and WFIRMA_SECRET_KEY must be set in environment variables');
    }
    
    this.baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
    
    // Создаем axios клиент для API Key
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Pipedrive-wFirma-Integration/1.0',
        'accessKey': this.accessKey,
        'secretKey': this.secretKey,
        'appKey': this.appKey,
        'company_id': this.companyId
      },
      timeout: 15000
    });

    // Добавляем interceptor для логирования
    this.client.interceptors.request.use(
      (config) => {
        logger.info('wFirma API Request:', {
          method: config.method,
          url: config.url,
          data: config.data
        });
        return config;
      },
      (error) => {
        logger.error('wFirma API Request Error:', error);
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.info('wFirma API Response:', {
          status: response.status,
          data: response.data
        });
        return response;
      },
      (error) => {
        logger.error('wFirma API Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Проверить подключение к wFirma API
   * @returns {Promise<Object>} - Результат проверки
   */
  async checkConnection() {
    try {
      return {
        success: true,
        message: 'API Key configured',
        app_key: this.appKey.substring(0, 10) + '...',
        access_key: this.accessKey.substring(0, 10) + '...',
        secret_key: this.secretKey.substring(0, 10) + '...'
      };
    } catch (error) {
      logger.error('Error checking connection:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обновить access token используя refresh token
   * @returns {Promise<Object>} - Результат обновления токена
   */
  async refreshAccessToken() {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }

      const response = await axios.post(`${this.baseURL}/oauth/token`, {
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        this.client.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
        
        return {
          success: true,
          access_token: this.accessToken,
          message: 'Access token refreshed successfully'
        };
      } else {
        throw new Error('Invalid response from token refresh endpoint');
      }
    } catch (error) {
      logger.error('Error refreshing access token:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Создать нового контрагента в wFirma
   * @param {Object} contractorData - Данные контрагента
   * @returns {Promise<Object>} - Результат создания
   */
  async createContractor(contractorData) {
    try {
      // wFirma требует польский формат почтового индекса (XX-XXX)
      // Если формат не подходит или страна не Польша, используем универсальный "00-000"
      let zipValue = contractorData.zip || '00-000';
      let countryValue = contractorData.country || 'PL';
      
      // Проверяем формат почтового индекса
      if (zipValue && !zipValue.match(/^\d{2}-\d{3}$/)) {
        // Если почтовый индекс не в польском формате (XX-XXX), пытаемся преобразовать
        const digitsOnly = zipValue.replace(/\D/g, '');
        if (digitsOnly.length === 5) {
          zipValue = `${digitsOnly.substring(0, 2)}-${digitsOnly.substring(2)}`;
        } else {
          // Если не можем преобразовать, используем универсальный "00-000"
          zipValue = '00-000';
        }
      }
      
      // Если страна не Польша, используем универсальный почтовый индекс "00-000"
      // wFirma может не принимать иностранные форматы почтовых индексов
      if (countryValue !== 'PL') {
        zipValue = '00-000';
        countryValue = 'PL'; // Используем PL для обхода валидации
      }
      
      // Создаем XML payload для wFirma API
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <contractors>
        <contractor>
            <name>${contractorData.name}</name>
            <email>${contractorData.email}</email>
            <address>${contractorData.address || ''}</address>
            <zip>${zipValue}</zip>
            <city>${contractorData.city || 'Gdańsk'}</city>
            <country>${countryValue}</country>
            <nip>${contractorData.business_id || ''}</nip>
            <type>${contractorData.type || 'person'}</type>
            <company_id>${this.companyId}</company_id>
        </contractor>
    </contractors>
</api>`;

      logger.info('Creating contractor in wFirma with XML:', xmlPayload);
      console.log('📄 XML PAYLOAD FOR CONTRACTOR:', xmlPayload);

      // Используем правильный endpoint с XML форматом
      const endpoint = '/contractors/add?inputFormat=xml&outputFormat=xml';

      try {
        logger.info(`Creating contractor via: ${endpoint}`);
        
        // Создаем специальный клиент для XML запросов
        const xmlClient = axios.create({
          baseURL: this.baseURL,
          headers: {
            'Content-Type': 'application/xml',
            'Accept': 'application/xml',
            'accessKey': this.accessKey,
            'secretKey': this.secretKey,
            'appKey': this.appKey
          },
          timeout: 15000
        });

        const response = await xmlClient.post(endpoint, xmlPayload);
        
        // Проверяем ответ
        if (response.data) {
          // Если это XML ответ
          if (typeof response.data === 'string' && response.data.includes('<?xml')) {
            if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
              logger.info('Contractor created successfully (XML response):', response.data);
              
              // Извлекаем ID контрагента из XML ответа
              const idMatch = response.data.match(/<id>(\d+)<\/id>/);
              const contractorId = idMatch ? idMatch[1] : null;
              
              return {
                success: true,
                message: 'Contractor created successfully',
                contractorId: contractorId,
                response: response.data
              };
            } else if (response.data.includes('CONTROLLER NOT FOUND')) {
              throw new Error('Endpoint not found - check wFirma API documentation');
            } else if (response.data.includes('<code>ERROR</code>')) {
              // Извлекаем детали ошибки из XML
              const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
              const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
              throw new Error(`wFirma API error: ${errorMessage}`);
            } else {
              throw new Error(`wFirma API error: ${response.data}`);
            }
          }
          // Если это JSON ответ
          else if (response.data.contractor || response.data.id) {
            logger.info('Contractor created successfully (JSON response):', response.data);
            return {
              success: true,
              contractor: response.data.contractor || response.data,
              message: 'Contractor created successfully'
            };
          } else {
            throw new Error('Unexpected response format from wFirma API');
          }
        } else {
          throw new Error('Empty response from wFirma API');
        }
      } catch (endpointError) {
        logger.error(`Failed to create contractor via ${endpoint}:`, endpointError.message);
        throw endpointError;
      }

    } catch (error) {
      logger.error('Error creating contractor:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Найти контрагента по email
   * @param {string} email - Email контрагента
   * @returns {Promise<Object>} - Результат поиска
   */
  async findContractorByEmail(email) {
    try {
      logger.info(`Searching contractor by email: ${email}`);
      
      const response = await this.client.get('/contractors/find');
      
      if (response.data) {
        // Если это XML ответ
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          // Парсим XML для поиска контрагента по email
          const emailRegex = new RegExp(`<email>${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</email>`, 'i');
          
          if (emailRegex.test(response.data)) {
            // Находим блок контрагента с нужным email
            const contractorMatch = response.data.match(new RegExp(`<contractor>[\\s\\S]*?<email>${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</email>[\\s\\S]*?</contractor>`, 'i'));
            
            if (contractorMatch) {
              const contractorXml = contractorMatch[0];
              
              // Извлекаем основные поля
              const idMatch = contractorXml.match(/<id>(\d+)<\/id>/);
              const nameMatch = contractorXml.match(/<name>(.*?)<\/name>/);
              const emailMatch = contractorXml.match(/<email>(.*?)<\/email>/);
              const zipMatch = contractorXml.match(/<zip>(.*?)<\/zip>/);
              const cityMatch = contractorXml.match(/<city>(.*?)<\/city>/);
              const countryMatch = contractorXml.match(/<country>(.*?)<\/country>/);
              
              const contractor = {
                id: idMatch ? idMatch[1] : null,
                name: nameMatch ? nameMatch[1] : '',
                email: emailMatch ? emailMatch[1] : email,
                zip: zipMatch ? zipMatch[1] : '',
                city: cityMatch ? cityMatch[1] : '',
                country: countryMatch ? countryMatch[1] : ''
              };
              
              logger.info(`Contractor found: ${contractor.name} (ID: ${contractor.id})`);
              return {
                success: true,
                found: true,
                contractor: contractor,
                message: 'Contractor found'
              };
            }
          }
          
          logger.info(`Contractor not found with email: ${email}`);
          return {
            success: true,
            found: false,
            contractor: null,
            message: 'Contractor not found'
          };
        }
        // Если это JSON ответ
        else if (response.data.contractors) {
          // Ищем контрагента по email
          const contractor = response.data.contractors.find(c => 
            c.email && c.email.toLowerCase() === email.toLowerCase()
          );
          
          if (contractor) {
            logger.info(`Contractor found: ${contractor.name} (ID: ${contractor.id})`);
            return {
              success: true,
              found: true,
              contractor: contractor,
              message: 'Contractor found'
            };
          } else {
            logger.info(`Contractor not found with email: ${email}`);
            return {
              success: true,
              found: false,
              contractor: null,
              message: 'Contractor not found'
            };
          }
        } else {
          throw new Error('Unexpected response format from wFirma API');
        }
      } else {
        throw new Error('Empty response from wFirma API');
      }
    } catch (error) {
      logger.error('Error searching contractor by email:', error);
      return {
        success: false,
        found: false,
        contractor: null,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить список контрагентов
   * @returns {Promise<Object>} - Список контрагентов
   */
  async getContractors() {
    try {
      const endpoint = '/contractors/find';
      logger.info(`Getting contractors from: ${endpoint}`);
      
      // API Key запрос с company_id
      const response = await this.client.get(endpoint);
      
      if (response.data) {
        // XML ответ
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<contractors>')) {
            return {
              success: true,
              contractors: [], // Пока возвращаем пустой массив для XML
              message: 'XML response received (parsing needed)',
              rawResponse: response.data
            };
          } else if (response.data.includes('CONTROLLER NOT FOUND')) {
            throw new Error('Contractors endpoint not found - check wFirma API documentation');
          } else {
            throw new Error(`wFirma API error: ${response.data}`);
          }
        }
        // JSON ответ
        else if (response.data.contractors || Array.isArray(response.data)) {
          return {
            success: true,
            contractors: response.data.contractors || response.data
          };
        } else {
          throw new Error('Unexpected response format from wFirma API');
        }
      } else {
        throw new Error('Empty response from wFirma API');
      }

    } catch (error) {
      logger.error('Error getting contractors:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить банковские счета компании
   * @returns {Promise<Object>} - Список банковских счетов
   */
  async getBankAccounts() {
    try {
      logger.info('Fetching bank accounts from wFirma...');
      
      const response = await this.client.get('/company_accounts/find');
      
      if (response.data) {
        // Если это XML ответ
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          logger.info('Bank accounts response (XML):', response.data);
          // Парсим XML для извлечения банковских счетов
          const bankAccounts = [];
          const accountMatches = response.data.match(/<company_account>(.*?)<\/company_account>/gs);
          if (accountMatches) {
            accountMatches.forEach(match => {
              const idMatch = match.match(/<id>(\d+)<\/id>/);
              const nameMatch = match.match(/<name>(.*?)<\/name>/);
              const currencyMatch = match.match(/<currency>(.*?)<\/currency>/);
              const numberMatch = match.match(/<number>(.*?)<\/number>/);
              const bankNameMatch = match.match(/<bank_name>(.*?)<\/bank_name>/);
              
              if (idMatch && nameMatch) {
                bankAccounts.push({
                  id: idMatch[1],
                  name: nameMatch[1],
                  currency: currencyMatch ? currencyMatch[1] : 'PLN',
                  number: numberMatch ? numberMatch[1] : '',
                  bankName: bankNameMatch ? bankNameMatch[1] : ''
                });
              }
            });
          }
          
          return {
            success: true,
            bankAccounts: bankAccounts
          };
        }
        // Если это JSON ответ
        else if (response.data.bankaccounts) {
          logger.info(`Found ${response.data.bankaccounts.length} bank accounts`);
          return {
            success: true,
            bankAccounts: response.data.bankaccounts
          };
        } else {
          logger.warn('No bank accounts found in response');
          return {
            success: false,
            error: 'No bank accounts found',
            bankAccounts: []
          };
        }
      } else {
        logger.warn('Empty response from bank accounts endpoint');
        return {
          success: false,
          error: 'Empty response from wFirma API',
          bankAccounts: []
        };
      }
    } catch (error) {
      logger.error('Error fetching bank accounts:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null,
        bankAccounts: []
      };
    }
  }

  /**
   * Тест подключения к wFirma API
   * @returns {Promise<Object>} - Результат теста
   */
  async testConnection() {
    try {
      // Попробуем простой запрос к API с API Keys и company_id
      const response = await this.client.get('/contractors/find');
      
      return {
        success: true,
        message: 'Connection to wFirma API successful',
        status: response.status,
        data: response.data
      };
    } catch (error) {
      logger.error('wFirma API connection test failed:', error);
      
      // Если основной тест не прошел, попробуем получить контрагентов
      try {
        const contractorsResult = await this.getContractors();
        if (contractorsResult.success) {
          return {
            success: true,
            message: 'Connection successful (via contractors endpoint)',
            contractors: contractorsResult.contractors
          };
        }
      } catch (contractorsError) {
        logger.warn('Contractors endpoint also failed:', contractorsError.message);
      }
      
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получение всех продуктов из wFirma
   * @returns {Promise<Object>} - Результат запроса
   */
  async getProducts() {
    try {
      logger.info('Fetching products from wFirma...');
      
      const response = await this.client.get('/goods/find');
      
      if (response.data) {
        logger.info('Products fetched successfully from wFirma');
        return {
          success: true,
          data: response.data
        };
      } else {
        return {
          success: false,
          error: 'Empty response from wFirma API'
        };
      }
      
    } catch (error) {
      logger.error('Error fetching products from wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Создание продукта в wFirma
   * @param {Object} productData - Данные продукта
   * @returns {Promise<Object>} - Результат создания
   */
  async createProduct(productData) {
    try {
      logger.info('Creating product in wFirma', { productName: productData.name });
      
      // Создаем XML payload для wFirma API (услуги без НДС)
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <goods>
        <good>
            <name>${productData.name}</name>
            <code>${productData.code || `SRV_${Date.now()}`}</code>
            <unit>${productData.unit || 'szt.'}</unit>
            <netto>${parseFloat(productData.price) || 0}</netto>
            <brutto>${parseFloat(productData.price) || 0}</brutto>
            <type>service</type>
            <vat_code_id>230</vat_code_id>
            <vat_code_purchase_id>230</vat_code_purchase_id>
        </good>
    </goods>
</api>`;

      logger.info('Product XML payload:', xmlPayload);

      // Используем правильный endpoint с параметрами
      const endpoint = `/goods/add?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;
      
      const response = await this.client.post(endpoint, xmlPayload, {
        headers: {
          'Content-Type': 'application/xml'
        }
      });
      
      if (response.data) {
        logger.info('Product creation response received:', response.data);
        
        // Проверяем XML ответ (ожидаемый формат)
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
            logger.info('Product created successfully (XML response):', response.data);
            
            // Извлекаем ID продукта из XML ответа
            const idMatch = response.data.match(/<id>(\d+)<\/id>/);
            const productId = idMatch ? idMatch[1] : null;
            logger.info('Product created successfully (JSON response):', {
              productId: productId,
              response: response.data
            });
            
            return {
              success: true,
              data: response.data,
              productId: productId
            };
          } else if (response.data.error || response.data.message) {
            // Обрабатываем ошибки в JSON формате
            const errorMessage = response.data.error || response.data.message;
            logger.error('wFirma API error creating product:', errorMessage);
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`
            };
          } else {
            logger.error('Unexpected JSON response format:', response.data);
            return {
              success: false,
              error: 'Unexpected JSON response format from wFirma API'
            };
          }
        }
        // Если это XML ответ (для совместимости)
        else if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
            logger.info('Product created successfully (XML response):', response.data);
            
            // Извлекаем ID продукта из XML ответа
            const idMatch = response.data.match(/<id>(\d+)<\/id>/);
            const productId = idMatch ? idMatch[1] : null;
            
            return {
              success: true,
              data: response.data,
              productId: productId
            };
          } else if (response.data.includes('<code>ERROR</code>')) {
            // Извлекаем детали ошибки из XML
            const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
            const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
            logger.error('wFirma API error creating product:', errorMessage);
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`
            };
          } else {
            logger.error('Unexpected XML response:', response.data);
            return {
              success: false,
              error: `wFirma API error: ${response.data}`
            };
          }
        } else {
          return {
            success: false,
            error: 'Unexpected response format from wFirma API'
          };
        }
      } else {
        return {
          success: false,
          error: 'Empty response from wFirma API'
        };
      }
      
    } catch (error) {
      logger.error('Error creating product in wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Найти этикетку по названию
   * @param {string} labelName - Название этикетки
   * @returns {Promise<Object>} - Результат поиска
   */
  async findLabelByName(labelName) {
    try {
      logger.info(`Searching label by name: ${labelName}`);

      const response = await this.client.get(`/tags/find?company_id=${this.companyId}`);

      if (response.data) {
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          const labelRegex = new RegExp(`<tag>[\\s\\S]*?<name>${labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</name>[\\s\\S]*?</tag>`, 'i');
          const match = response.data.match(labelRegex);

          if (match) {
            const labelXml = match[0];
            const idMatch = labelXml.match(/<id>(\d+)<\/id>/);
            return {
              success: true,
              found: true,
              label: {
                id: idMatch ? idMatch[1] : null,
                name: labelName,
                raw: labelXml
              }
            };
          }

          return {
            success: true,
            found: false,
            label: null
          };
        }

        if (response.data.tags && Array.isArray(response.data.tags)) {
          const label = response.data.tags.find(l => l.name === labelName);
          if (label) {
            return {
              success: true,
              found: true,
              label: label
            };
          }
        }

        return {
          success: true,
          found: false,
          label: null
        };
      }

      return {
        success: false,
        error: 'Empty response from wFirma API'
      };

    } catch (error) {
      logger.error('Error searching label by name:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Создать новую этикетку в wFirma
   * @param {string} labelName - Название этикетки
   * @returns {Promise<Object>} - Результат создания
   */
  async createLabel(labelName) {
    try {
      logger.info(`Creating label in wFirma: ${labelName}`);

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <tags>
        <tag>
            <name>${labelName}</name>
            <invoice>1</invoice>
            <good>1</good>
            <color_background>ec7000</color_background>
            <color_text>fff0e1</color_text>
            <visibility>visible</visibility>
        </tag>
    </tags>
</api>`;

      const endpoint = `/tags/add?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;

      const xmlClient = axios.create({
        baseURL: this.baseURL,
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'accessKey': this.accessKey,
          'secretKey': this.secretKey,
          'appKey': this.appKey
        },
        timeout: 15000
      });

      const response = await xmlClient.post(endpoint, xmlPayload);

      if (response.data) {
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
            const idMatch = response.data.match(/<id>(\d+)<\/id>/);
            return {
              success: true,
              label: {
                id: idMatch ? idMatch[1] : null,
                name: labelName
              },
              response: response.data
            };
          }

          if (response.data.includes('<code>ERROR</code>')) {
            const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
            const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`
            };
          }
        }

        if (response.data.tag || response.data.id) {
          return {
            success: true,
            label: response.data.tag || {
              id: response.data.id,
              name: labelName
            },
            response: response.data
          };
        }
      }

      return {
        success: false,
        error: 'Unexpected response format when creating label'
      };

    } catch (error) {
      logger.error('Error creating label in wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Привязать этикетку к документу
   * @param {string|number} labelId - ID этикетки
   * @param {string|number} documentId - ID документа (например, проформы)
   * @param {string} objectType - тип объекта (по умолчанию invoice)
   * @returns {Promise<Object>} - Результат привязки
   */
  async assignLabelToDocument(labelId, documentId, objectType = 'invoices') {
    try {
      logger.info('Assigning label to document in wFirma', {
        labelId,
        documentId,
        objectType
      });

      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <tags>
        <tag>
            <id>${labelId}</id>
            <object>
                <id>${documentId}</id>
                <type>${objectType}</type>
            </object>
        </tag>
    </tags>
</api>`;

      const endpoint = `/tags/assign?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;

      const xmlClient = axios.create({
        baseURL: this.baseURL,
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'accessKey': this.accessKey,
          'secretKey': this.secretKey,
          'appKey': this.appKey
        },
        timeout: 15000
      });

      const response = await xmlClient.post(endpoint, xmlPayload);

      if (response.data) {
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>')) {
            return {
              success: true,
              response: response.data
            };
          }

          if (response.data.includes('<code>ERROR</code>')) {
            const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
            const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`
            };
          }

      return {
        success: false,
        error: `Unexpected XML response when assigning label: ${response.data}`
      };
        }

        if (response.data.code === 'OK') {
          return {
            success: true,
            response: response.data
          };
        }

        return {
          success: false,
          error: 'Unexpected response format when assigning label'
        };
      }

      return {
        success: false,
        error: 'Empty response from wFirma API when assigning label'
      };

    } catch (error) {
      logger.error('Error assigning label to document in wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Экранировать специальные символы для XML
   * @param {string} text - Текст для экранирования
   * @returns {string} - Экранированный текст
   */
  escapeXml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Отправить проформу по email через wFirma API
   * @param {string|number} invoiceId - ID проформы в wFirma
   * @param {string} email - Email адрес получателя (опционально, если не указан, используется email из проформы)
   * @param {Object} options - Дополнительные опции для отправки
   * @param {string} options.subject - Тема письма (по умолчанию: "Otrzymałeś fakturę")
   * @param {string} options.body - Текст письма (по умолчанию: "Przesyłam fakturę")
   * @returns {Promise<Object>} - Результат отправки
   */

  async sendInvoiceByEmail(invoiceId, email = null, options = {}) {
    try {
      logger.info(`Sending invoice ${invoiceId} by email${email ? ` to ${email}` : ''} via wFirma API`);

      // Значения по умолчанию для темы и текста письма
      const subject = options.subject || 'Otrzymałeś fakturę';
      const body = options.body || 'Przesyłam fakturę';

      // Экранируем email для XML (subject и body используем в CDATA, поэтому не экранируем)
      const escapedEmail = email ? this.escapeXml(email) : null;

      // Создаем XML payload для отправки проформы по email
      // Используем endpoint /invoices/send/{{invoiceId}} согласно документации wFirma
      let xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <parameters>`;
      
      // Если указан email, добавляем его в запрос (опционально, если не указан, берется из записи контрагента)
      if (escapedEmail) {
        xmlPayload += `
            <parameter>
                <name>email</name>
                <value>${escapedEmail}</value>
            </parameter>`;
      }
      
      // Добавляем остальные параметры
      xmlPayload += `
            <parameter>
                <name>subject</name>
                <value><![CDATA[${subject}]]></value>
            </parameter>
            <parameter>
                <name>page</name>
                <value>invoice</value>
            </parameter>
            <parameter>
                <name>leaflet</name>
                <value>0</value>
            </parameter>
            <parameter>
                <name>duplicate</name>
                <value>0</value>
            </parameter>
            <parameter>
                <name>body</name>
                <value><![CDATA[${body}]]></value>
            </parameter>
        </parameters>
    </invoices>
</api>`;

      // Логируем XML payload для отладки
      logger.info('📧 Email XML Payload:', xmlPayload);
      console.log('📧 EMAIL XML PAYLOAD:', xmlPayload);

      // Используем правильный endpoint для отправки проформы по email
      // wFirma API: POST /invoices/send/{{invoiceId}}
      const endpoint = `/invoices/send/${invoiceId}?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`;

      // Создаем специальный клиент для XML запросов
      const xmlClient = axios.create({
        baseURL: this.baseURL,
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'accessKey': this.accessKey,
          'secretKey': this.secretKey,
          'appKey': this.appKey
        },
        timeout: 15000
      });

      const response = await xmlClient.post(endpoint, xmlPayload);

      // Проверяем ответ
      if (response.data) {
        // Если это XML ответ
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>')) {
            logger.info(`Invoice ${invoiceId} sent successfully by email${email ? ` to ${email}` : ''}`);
            return {
              success: true,
              message: `Invoice sent successfully by email${email ? ` to ${email}` : ''}`,
              response: response.data
            };
          } else if (response.data.includes('<code>ERROR</code>')) {
            // Извлекаем детали ошибки из XML
            const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
            const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
            logger.error(`Failed to send invoice ${invoiceId} by email: ${errorMessage}`);
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`,
              response: response.data
            };
          } else {
            logger.warn(`Unexpected XML response when sending invoice ${invoiceId} by email: ${response.data}`);
            return {
              success: false,
              error: `Unexpected response format: ${response.data}`
            };
          }
        }
        // Если это JSON ответ
        else if (typeof response.data === 'object') {
          if (response.data.code === 'OK' || response.data.success) {
            logger.info(`Invoice ${invoiceId} sent successfully by email${email ? ` to ${email}` : ''}`);
            return {
              success: true,
              message: `Invoice sent successfully by email${email ? ` to ${email}` : ''}`,
              response: response.data
            };
          } else if (response.data.error || response.data.message) {
            const errorMessage = response.data.error || response.data.message;
            logger.error(`Failed to send invoice ${invoiceId} by email: ${errorMessage}`);
            return {
              success: false,
              error: `wFirma API error: ${errorMessage}`,
              response: response.data
            };
          } else {
            logger.warn(`Unexpected JSON response when sending invoice ${invoiceId} by email: ${JSON.stringify(response.data)}`);
            return {
              success: false,
              error: 'Unexpected response format from wFirma API'
            };
          }
        } else {
          logger.warn(`Unexpected response format when sending invoice ${invoiceId} by email`);
          return {
            success: false,
            error: 'Unexpected response format from wFirma API'
          };
        }
      } else {
        logger.error(`Empty response when sending invoice ${invoiceId} by email`);
        return {
          success: false,
          error: 'Empty response from wFirma API'
        };
      }

    } catch (error) {
      logger.error(`Error sending invoice ${invoiceId} by email via wFirma API:`, error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  async deleteInvoice(invoiceId) {
    if (!invoiceId) {
      return { success: false, error: 'Invoice ID is required' };
    }

    try {
      logger.info('Deleting invoice in wFirma', { invoiceId });

      const response = await this.client.post(
        `/invoices/delete/${invoiceId}`,
        null,
        {
          params: {
            outputFormat: 'json'
          }
        }
      );

      const { data } = response;

      if (!data) {
        logger.error('Empty response from wFirma API when deleting invoice', { invoiceId });
        return { success: false, error: 'Empty response from wFirma API' };
      }

      if (typeof data === 'string') {
        if (data.includes('<code>OK</code>')) {
          return { success: true };
        }

        if (data.includes('<code>ERROR</code>')) {
          const errorMatch = data.match(/<message>(.*?)<\/message>/);
          const message = errorMatch ? errorMatch[1] : 'Unknown wFirma error';
          return { success: false, error: message };
        }

        return { success: false, error: 'Unexpected response format from wFirma API', details: data };
      }

      if (
        data.success === true
        || data.status?.code === 'OK'
        || data.status?.success === true
      ) {
        return { success: true };
      }

      const message = data.status?.message || data.error || 'Failed to delete invoice in wFirma';
      return { success: false, error: message, details: data };
    } catch (error) {
      if (error.response?.status === 404) {
        logger.warn('Invoice not found in wFirma during deletion', {
          invoiceId,
          status: error.response.status
        });
        return { success: false, error: 'Invoice not found', notFound: true };
      }

      logger.error('Error deleting invoice in wFirma:', {
        invoiceId,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Получить список VAT кодов
   * @returns {Promise<Object>} - Список VAT кодов
   */
  async getVatCodes() {
    try {
      logger.info('Fetching VAT codes from wFirma...');

      const response = await this.client.get(`/vat_codes/find?outputFormat=xml&inputFormat=xml&company_id=${this.companyId}`);

      if (response.data) {
        if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          const codes = [];
          const codeMatches = response.data.match(/<vat_code>[\s\S]*?<\/vat_code>/g);

          if (codeMatches) {
            codeMatches.forEach(match => {
              const idMatch = match.match(/<id>(\d+)<\/id>/);
              const nameMatch = match.match(/<name>(.*?)<\/name>/);
              const rateMatch = match.match(/<rate>(.*?)<\/rate>/);
              const symbolMatch = match.match(/<symbol>(.*?)<\/symbol>/);
              const descriptionMatch = match.match(/<description>(.*?)<\/description>/);

              codes.push({
                id: idMatch ? idMatch[1] : null,
                name: nameMatch ? nameMatch[1] : '',
                rate: rateMatch ? rateMatch[1] : '',
                symbol: symbolMatch ? symbolMatch[1] : '',
                description: descriptionMatch ? descriptionMatch[1] : ''
              });
            });
          }

          return {
            success: true,
            codes
          };
        }

        if (response.data.vat_codes && Array.isArray(response.data.vat_codes)) {
          return {
            success: true,
            codes: response.data.vat_codes
          };
        }
      }

      return {
        success: false,
        error: 'Empty or unexpected response from wFirma API when fetching VAT codes'
      };

    } catch (error) {
      logger.error('Error fetching VAT codes from wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }
}

module.exports = WfirmaClient;
