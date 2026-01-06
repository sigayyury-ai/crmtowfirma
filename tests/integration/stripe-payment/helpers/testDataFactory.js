const logger = require('../../../../src/utils/logger');
const PipedriveClient = require('../../../../src/services/pipedrive');

/**
 * TestDataFactory
 * 
 * Factory для создания тестовых данных (deals, products, persons)
 * для Stripe payment автотестов.
 */
class TestDataFactory {
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.testPrefix = options.testPrefix || 'TEST_AUTO_';
    this.pipedriveClient = options.pipedriveClient || new PipedriveClient();
  }

  /**
   * Создать тестовую сделку для автотестов
   * 
   * @param {Object} options - Опции для создания сделки
   * @param {string} options.title - Название сделки
   * @param {number} options.value - Сумма сделки
   * @param {string} options.currency - Валюта (default: 'PLN')
   * @param {Date} options.expectedCloseDate - Ожидаемая дата закрытия
   * @param {string} options.personEmail - Email персоны
   * @param {string} options.personName - Имя персоны
   * @returns {Object} - Тестовая сделка
   */
  createTestDeal(options = {}) {
    const {
      title = `${this.testPrefix}Test Deal`,
      value = 1000,
      currency = 'PLN',
      expectedCloseDate = null,
      personEmail = `test_${Date.now()}@example.com`,
      personName = 'Test Person'
    } = options;

    return {
      title: `${this.testPrefix}${title}`,
      value: String(value),
      currency,
      expected_close_date: expectedCloseDate ? expectedCloseDate.toISOString().split('T')[0] : null,
      person: {
        email: [{ value: personEmail }],
        name: personName
      }
    };
  }

  /**
   * Создать тестовый продукт
   * 
   * @param {Object} options - Опции для создания продукта
   * @returns {Object} - Тестовый продукт
   */
  createTestProduct(options = {}) {
    const {
      name = `${this.testPrefix}Test Product`,
      price = 1000,
      currency = 'PLN'
    } = options;

    return {
      name: `${this.testPrefix}${name}`,
      price: String(price),
      currency
    };
  }

  /**
   * Создать тестовую персону
   * 
   * @param {Object} options - Опции для создания персоны
   * @returns {Object} - Тестовая персона
   */
  createTestPerson(options = {}) {
    const {
      email = `test_${Date.now()}@example.com`,
      name = 'Test Person',
      phone = null
    } = options;

    return {
      email: [{ value: email }],
      name,
      phone: phone ? [{ value: phone }] : []
    };
  }

  /**
   * Создать тестовую персону с email и адресом
   * 
   * @param {Object} options - Опции персоны
   * @param {string} options.email - Email персоны
   * @param {string} options.name - Имя персоны
   * @param {Object} options.address - Адрес персоны (для VAT)
   * @returns {Promise<Object>} - Результат создания персоны
   */
  async createTestPerson(options = {}) {
    const {
      email = `test_${Date.now()}@example.com`,
      name = 'Test Person',
      address = {
        street: 'Test Street 123',
        city: 'Warsaw',
        postal_code: '00-001',
        country: 'PL'
      }
    } = options;

    try {
      // Создаем персону через Pipedrive API с email
      // Pipedrive API v1 использует простой формат для email
      const personData = {
        name: `${this.testPrefix}${name}`,
        email: email  // Просто строка email, не массив
      };

      const response = await this.pipedriveClient.client.post('/persons', personData, {
        params: { api_token: this.pipedriveClient.apiToken }
      });

      if (response.data?.success && response.data?.data) {
        const personId = response.data.data.id;
        
        // Update person with address if provided (for VAT validation)
        if (address) {
          try {
            await this.pipedriveClient.client.put(`/persons/${personId}`, {
              postal_address: `${address.street || ''}, ${address.city || ''}, ${address.postal_code || ''}`,
              postal_address_route: address.street || null,
              postal_address_postal_code: address.postal_code || null,
              postal_address_locality: address.city || null,
              postal_address_country: address.country || null
            }, {
              params: { api_token: this.pipedriveClient.apiToken }
            });
            this.logger.info('Address added to test person', { personId });
          } catch (error) {
            this.logger.warn('Failed to add address to person, continuing', {
              personId,
              error: error.message
            });
          }
        }
        
        this.logger.info('Test person created', {
          personId,
          email,
          hasAddress: !!address
        });
        return {
          success: true,
          person: response.data.data,
          personId
        };
      }

      throw new Error('Failed to create person');
    } catch (error) {
      this.logger.error('Error creating test person', {
        error: error.message,
        details: error.response?.data
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Добавить продукт в тестовую сделку
   * 
   * @param {number} dealId - ID сделки
   * @param {Object} options - Опции продукта
   * @param {number} options.price - Цена продукта
   * @param {string} options.currency - Валюта
   * @returns {Promise<Object>} - Результат добавления продукта
   */
  async addProductToTestDeal(dealId, options = {}) {
    const {
      price = 1000,
      currency = 'PLN'
    } = options;

    try {
      // Проверяем, есть ли уже продукты в сделке
      const existingProducts = await this.pipedriveClient.getDealProducts(dealId);
      
      if (existingProducts.success && existingProducts.products && existingProducts.products.length > 0) {
        this.logger.info('Deal already has products', {
          dealId,
          productsCount: existingProducts.products.length
        });
        return {
          success: true,
          message: 'Deal already has products',
          products: existingProducts.products
        };
      }

      // Создаем тестовый продукт
      const productResult = await this.pipedriveClient.createProduct({
        name: `${this.testPrefix}Test Product`,
        price: price,
        currency: currency
      });

      if (!productResult.success || !productResult.product) {
        throw new Error(`Failed to create test product: ${productResult.error}`);
      }

      const productId = productResult.product.id;
      this.logger.info('Test product created', { productId, price, currency });

      // Добавляем продукт в сделку
      const addProductResult = await this.pipedriveClient.addProductToDeal(dealId, {
        product_id: productId,
        item_price: price,
        quantity: 1
      });

      if (!addProductResult.success) {
        throw new Error(`Failed to add product to deal: ${addProductResult.error}`);
      }

      this.logger.info('Product added to test deal', { dealId, productId });

      return {
        success: true,
        productId,
        dealProduct: addProductResult.item
      };
    } catch (error) {
      this.logger.error('Error adding product to test deal', {
        dealId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = TestDataFactory;

