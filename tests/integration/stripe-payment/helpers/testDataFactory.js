const logger = require('../../../../src/utils/logger');

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
}

module.exports = TestDataFactory;

