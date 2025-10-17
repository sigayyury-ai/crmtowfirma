const logger = require('../utils/logger');
const WfirmaClient = require('./wfirma');
const NodeCache = require('node-cache');

/**
 * Сервис для управления продуктами в wFirma
 * Обеспечивает поиск существующих продуктов и создание новых
 */
class ProductManagementService {
  constructor() {
    this.wfirmaClient = new WfirmaClient();
    // Кэш для продуктов на 1 час
    this.productCache = new NodeCache({ stdTTL: 3600 });
    
    // Настройки по умолчанию для продуктов
    this.DEFAULT_UNIT = 'szt.';
    this.DEFAULT_TYPE = 'service'; // Тип продукта - услуга (без НДС)
    
    logger.info('ProductManagementService initialized', {
      defaultUnit: this.DEFAULT_UNIT,
      defaultType: this.DEFAULT_TYPE
    });
  }

  /**
   * Поиск или создание продукта в wFirma
   * @param {string} productName - Название продукта
   * @param {number} price - Цена продукта
   * @param {string} unit - Единица измерения (опционально)
   * @returns {Promise<Object>} - Результат с данными продукта
   */
  async findOrCreateProduct(productName, price, unit = null) {
    try {
      logger.info('Finding or creating product in wFirma', {
        productName: productName,
        price: price,
        unit: unit || this.DEFAULT_UNIT
      });

      // Сначала ищем существующий продукт
      const existingProduct = await this.findProductByName(productName);
      
      if (existingProduct.success && existingProduct.product) {
        logger.info('Product found in wFirma', {
          productId: existingProduct.product.id,
          productName: existingProduct.product.name
        });
        
        return {
          success: true,
          product: existingProduct.product,
          created: false
        };
      }

      // Если продукт не найден, пытаемся создать новый
      logger.info('Product not found, creating new product in wFirma');
      const newProduct = await this.createProduct(productName, price, unit);
      
      if (newProduct.success) {
        return {
          success: true,
          product: newProduct.product,
          created: true
        };
      } else {
        // Если создание не удалось (например, нет прав), используем заглушку
        logger.warn('Failed to create product, using fallback product', { 
          error: newProduct.error,
          productName: productName 
        });
        
        const fallbackProduct = {
          id: null, // Без ID - будет создан в составе инвойса
          name: productName,
          price: price,
          unit: unit || this.DEFAULT_UNIT,
          type: this.DEFAULT_TYPE,
          isFallback: true
        };
        
        return {
          success: true,
          product: fallbackProduct,
          created: false,
          fallback: true
        };
      }

    } catch (error) {
      logger.error('Error in findOrCreateProduct:', error);
      return {
        success: false,
        error: `Failed to find or create product: ${error.message}`
      };
    }
  }

  /**
   * Поиск продукта по названию
   * @param {string} productName - Название продукта
   * @returns {Promise<Object>} - Результат поиска
   */
  async findProductByName(productName) {
    try {
      // Проверяем кэш
      const cacheKey = `product_${productName.toLowerCase().replace(/\s+/g, '_')}`;
      const cachedProduct = this.productCache.get(cacheKey);
      
      if (cachedProduct) {
        logger.info('Product found in cache', { productName: productName });
        return {
          success: true,
          product: cachedProduct
        };
      }

      logger.info('Searching for product in wFirma', { productName: productName });

      // Ищем продукт через API wFirma
      const response = await this.wfirmaClient.getProducts();

      if (response.success && response.data) {
        let products = [];
        
        // response.data - это XML строка, нужно её парсить
        if (typeof response.data === 'string') {
          // Извлекаем все <good>...</good> блоки из XML
          const goodMatches = response.data.match(/<good>[\s\S]*?<\/good>/g);
          
          if (goodMatches) {
            products = goodMatches.map(goodXml => {
              const idMatch = goodXml.match(/<id>(\d+)<\/id>/);
              const nameMatch = goodXml.match(/<name>([^<]+)<\/name>/);
              const nettoMatch = goodXml.match(/<netto>([^<]+)<\/netto>/);
              const unitMatch = goodXml.match(/<unit>([^<]+)<\/unit>/);
              const typeMatch = goodXml.match(/<type>([^<]+)<\/type>/);
              
              return {
                id: idMatch ? idMatch[1] : null,
                name: nameMatch ? nameMatch[1] : null,
                netto: nettoMatch ? parseFloat(nettoMatch[1]) : 0,
                unit: unitMatch ? unitMatch[1] : 'szt.',
                type: typeMatch ? typeMatch[1] : 'service'
              };
            });
          }
        } else {
          // Fallback для объектов (если API изменится)
          if (Array.isArray(response.data)) {
            products = response.data;
          } else if (response.data.goods && Array.isArray(response.data.goods)) {
            products = response.data.goods;
          } else if (response.data.good) {
            products = Array.isArray(response.data.good) ? response.data.good : [response.data.good];
          }
        }

        // Ищем продукт по названию (нечувствительно к регистру)
        const foundProduct = products.find(product => 
          product.name && product.name.toLowerCase() === productName.toLowerCase()
        );

        if (foundProduct) {
          // Кэшируем найденный продукт
          this.productCache.set(cacheKey, foundProduct);
          
          logger.info('Product found by name', {
            productId: foundProduct.id,
            productName: foundProduct.name
          });

          return {
            success: true,
            product: foundProduct
          };
        } else {
          logger.info('Product not found by name', { productName: productName });
          return {
            success: true,
            product: null
          };
        }
      } else {
        logger.warn('Failed to fetch products from wFirma', { 
          error: response.error,
          productName: productName 
        });
        return {
          success: false,
          error: response.error || 'Failed to fetch products'
        };
      }

    } catch (error) {
      logger.error('Error searching for product:', error);
      return {
        success: false,
        error: `Failed to search for product: ${error.message}`
      };
    }
  }

  /**
   * Создание нового продукта в wFirma
   * @param {string} productName - Название продукта
   * @param {number} price - Цена продукта
   * @param {string} unit - Единица измерения
   * @returns {Promise<Object>} - Результат создания
   */
  async createProduct(productName, price, unit = null) {
    try {
      logger.info('Creating new product in wFirma', {
        productName: productName,
        price: price,
        unit: unit || this.DEFAULT_UNIT
      });

      // Подготавливаем данные продукта
      const productData = {
        name: productName,
        price: parseFloat(price),
        unit: unit || this.DEFAULT_UNIT,
        code: `SRV_${Date.now()}`, // Генерируем уникальный код
        type: 'service'
      };

      logger.info('Product creation payload:', JSON.stringify(productData, null, 2));

      // Отправляем запрос на создание
      const response = await this.wfirmaClient.createProduct(productData);

      if (response.success) {
        const productId = response.productId;
        
        if (productId) {
          // Создаем объект продукта
          const createdProduct = {
            id: productId,
            name: productName,
            price: price,
            unit: unit || this.DEFAULT_UNIT,
            type: this.DEFAULT_TYPE // Услуга без НДС
          };

          // Кэшируем созданный продукт
          const cacheKey = `product_${productName.toLowerCase().replace(/\s+/g, '_')}`;
          this.productCache.set(cacheKey, createdProduct);

          logger.info('Product created successfully', {
            productId: productId,
            productName: productName
          });

          return {
            success: true,
            product: createdProduct
          };
        } else {
          logger.error('No product ID returned from wFirma API', { response: response });
          return {
            success: false,
            error: 'No product ID returned from wFirma API'
          };
        }
      } else {
        logger.error('Failed to create product in wFirma', { 
          error: response.error,
          productName: productName 
        });
        return {
          success: false,
          error: response.error || 'Failed to create product'
        };
      }

    } catch (error) {
      logger.error('Error creating product:', error);
      return {
        success: false,
        error: `Failed to create product: ${error.message}`
      };
    }
  }

  /**
   * Получение всех продуктов из wFirma
   * @returns {Promise<Object>} - Список продуктов
   */
  async getAllProducts() {
    try {
      logger.info('Fetching all products from wFirma');

      const response = await this.wfirmaClient.getProducts();

      if (response.success && response.data) {
        let products = [];
        
        // Обрабатываем ответ
        if (Array.isArray(response.data)) {
          products = response.data;
        } else if (response.data.goods && Array.isArray(response.data.goods)) {
          products = response.data.goods;
        } else if (response.data.good) {
          products = Array.isArray(response.data.good) ? response.data.good : [response.data.good];
        }

        logger.info(`Found ${products.length} products in wFirma`);

        return {
          success: true,
          products: products,
          count: products.length
        };
      } else {
        return {
          success: false,
          error: response.error || 'Failed to fetch products'
        };
      }

    } catch (error) {
      logger.error('Error fetching all products:', error);
      return {
        success: false,
        error: `Failed to fetch products: ${error.message}`
      };
    }
  }

  /**
   * Очистка кэша продуктов
   */
  clearCache() {
    this.productCache.flushAll();
    logger.info('Product cache cleared');
  }
}

module.exports = ProductManagementService;
