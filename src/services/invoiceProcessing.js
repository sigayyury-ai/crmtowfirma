const PipedriveClient = require('./pipedrive');
const WfirmaClient = require('./wfirma');
const UserManagementService = require('./userManagement');
const logger = require('../utils/logger');
const bankAccountConfig = require('../../config/bank-accounts');

const escapeXml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

class InvoiceProcessingService {
  constructor() {
    this.pipedriveClient = new PipedriveClient();
    this.wfirmaClient = new WfirmaClient();
    this.userManagement = new UserManagementService();
    
    // Конфигурация
    this.ADVANCE_PERCENT = 50; // 50% предоплата
    this.PAYMENT_TERMS_DAYS = 3; // Срок оплаты 3 дня
    this.DEFAULT_LANGUAGE = 'en';
    this.DEFAULT_DESCRIPTION = '';
    this.VAT_RATE = 0; // Proforma без VAT (0%)
    this.PAYMENT_METHOD = 'transfer'; // Всегда банковский перевод
    
    // Кастомное поле Invoice type в Pipedrive
    this.INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Типы фактур с ID опций из Pipedrive (пока только Pro forma)
    this.INVOICE_TYPES = {
      PROFORMA: 70  // ID опции "Proforma" в Pipedrive
      // PREPAYMENT: 71,  // ID опции "Prepayment" в Pipedrive
      // FINAL_PAYMENT: 72  // ID опции "Final payment" в Pipedrive
    };
    this.INVOICE_DONE_VALUE = 73; // ID опции "Done"
    
    // Банковские счета (получаем динамически из wFirma API)
    this.bankAccounts = null;
    
    // Конфигурация банковских счетов по валютам (из конфигурационного файла)
    this.BANK_ACCOUNT_CONFIG = bankAccountConfig.BANK_ACCOUNT_CONFIG;
    this.SUPPORTED_CURRENCIES = bankAccountConfig.SUPPORTED_CURRENCIES;
    
    logger.info('InvoiceProcessingService initialized', {
      paymentMethod: this.PAYMENT_METHOD,
      paymentTermsDays: this.PAYMENT_TERMS_DAYS,
      language: this.DEFAULT_LANGUAGE,
      vatRate: this.VAT_RATE,
      invoiceTypes: Object.keys(this.INVOICE_TYPES)
    });
  }

  /**
   * Получить банковские счета из wFirma API с кэшированием
   * @returns {Promise<Object>} - Результат получения банковских счетов
   */
  async getBankAccounts() {
    try {
      // Если уже есть кэшированные данные, возвращаем их
      if (this.bankAccounts) {
        return { success: true, bankAccounts: this.bankAccounts };
      }

      logger.info('Fetching bank accounts from wFirma API...');
      const result = await this.wfirmaClient.getBankAccounts();
      
      if (result.success) {
        this.bankAccounts = result.bankAccounts;
        logger.info(`Bank accounts cached: ${result.bankAccounts.length} accounts`);
        return result;
      } else {
        logger.error('Failed to fetch bank accounts:', result.error);
        return result;
      }
    } catch (error) {
      logger.error('Error in getBankAccounts:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Получить банковский счет по валюте
   * @param {string} currency - Валюта (PLN, EUR, USD)
   * @returns {Promise<Object>} - Результат с данными банковского счета
   */
  async getBankAccountByCurrency(currency) {
    try {
      // Получаем банковские счета
      const bankAccountsResult = await this.getBankAccounts();
      if (!bankAccountsResult.success) {
        return { success: false, error: 'Failed to fetch bank accounts' };
      }

      const config = this.BANK_ACCOUNT_CONFIG[currency];
      if (!config) {
        return { success: false, error: `No bank account configuration for currency: ${currency}` };
      }

      // Ищем счет по названию (точное совпадение в первую очередь)
      let bankAccount = bankAccountsResult.bankAccounts.find(acc => 
        acc.name === config.name
      );

      // Если не нашли по точному названию, ищем по частичному совпадению
      if (!bankAccount) {
        bankAccount = bankAccountsResult.bankAccounts.find(acc => 
          acc.name.includes(config.name.split(' ')[0])
        );
      }

      // Если не нашли по названию, ищем по валюте среди accepted счетов
      if (!bankAccount) {
        bankAccount = bankAccountsResult.bankAccounts.find(acc => 
          acc.currency === currency && acc.status === 'accepted'
        );
      }

      // Последний fallback - любой счет с такой валютой
      if (!bankAccount) {
        bankAccount = bankAccountsResult.bankAccounts.find(acc => acc.currency === currency);
      }

      if (bankAccount) {
        logger.info(`Found bank account for ${currency}: ${bankAccount.name} (ID: ${bankAccount.id})`);
        return { 
          success: true, 
          bankAccount: {
            id: bankAccount.id,
            name: bankAccount.name,
            currency: bankAccount.currency,
            number: bankAccount.number,
            bankName: bankAccount.bankName
          }
        };
      } else {
        logger.warn(`No bank account found for currency ${currency}, using fallback: ${config.fallback}`);
        return { 
          success: true, 
          bankAccount: {
            name: config.fallback,
            currency: currency,
            fallback: true
          }
        };
      }
    } catch (error) {
      logger.error(`Error getting bank account for currency ${currency}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Основной метод обработки сделок с измененным полем Invoice type
   * @returns {Promise<Object>} - Результат обработки
   */
  async processPendingInvoices() {
    try {
      logger.info('Starting invoice processing for pending deals...');
      
      // 1. Получаем все сделки с измененным полем Invoice type
      const pendingDeals = await this.getPendingInvoiceDeals();
      
      if (!pendingDeals.success) {
        return pendingDeals;
      }
      
      logger.info(`Found ${pendingDeals.deals.length} deals with pending invoices`);
      
      const results = [];
      
      // 2. Обрабатываем каждую сделку
      for (const deal of pendingDeals.deals) {
        try {
          const result = await this.processDealInvoice(deal);
          results.push({
            dealId: deal.id,
            success: result.success,
            message: result.message,
            invoiceType: result.invoiceType,
            error: result.error
          });
        } catch (error) {
          logger.error(`Error processing deal ${deal.id}:`, error);
          results.push({
            dealId: deal.id,
            success: false,
            error: error.message
          });
        }
      }
      
      const successCount = results.filter(r => r.success).length;
      const errorCount = results.filter(r => !r.success).length;
      
      logger.info(`Invoice processing completed: ${successCount} successful, ${errorCount} errors`);
      
      return {
        success: true,
        message: `Processed ${pendingDeals.deals.length} deals`,
        results: results,
        summary: {
          total: pendingDeals.deals.length,
          successful: successCount,
          errors: errorCount
        }
      };
      
    } catch (error) {
      logger.error('Error in processPendingInvoices:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получить сделки с измененным полем Invoice type
   * @returns {Promise<Object>} - Список сделок для обработки
   */
  async getPendingInvoiceDeals() {
    try {
      // Получаем все активные сделки
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'open' // Только открытые сделки
      });
      
      if (!dealsResult.success) {
        return dealsResult;
      }
      
      // Фильтруем сделки с установленным полем Invoice type
      const pendingDeals = dealsResult.deals.filter(deal => {
        const invoiceTypeValue = deal[this.INVOICE_TYPE_FIELD_KEY];
        
        // Проверяем, что поле Invoice type заполнено
        if (!invoiceTypeValue || invoiceTypeValue === '' || invoiceTypeValue === null) {
          return false;
        }
        
        // Конвертируем в число для сравнения (Pipedrive может возвращать строку)
        const invoiceTypeId = parseInt(invoiceTypeValue);
        
        // Проверяем, что значение соответствует одному из наших типов
        const validTypes = Object.values(this.INVOICE_TYPES);
        return validTypes.includes(invoiceTypeId);
      });
      
      logger.info(`Found ${pendingDeals.length} deals with invoice type field set`);
      
      return {
        success: true,
        deals: pendingDeals
      };
      
    } catch (error) {
      logger.error('Error getting pending invoice deals:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обработать конкретную сделку для создания счета
   * @param {Object} deal - Данные сделки из Pipedrive
   * @returns {Promise<Object>} - Результат обработки
   */
  async processDealInvoice(deal, person = null, organization = null) {
    try {
      logger.info(`Processing invoice for deal ${deal.id}: ${deal.title}`);
      
      // 1. Получаем полные данные сделки с связанными объектами (если не переданы)
      let fullDeal, fullPerson, fullOrganization;
      
      if (person === null || organization === null) {
        const fullDealResult = await this.pipedriveClient.getDealWithRelatedData(deal.id);
        
        if (!fullDealResult.success) {
          return {
            success: false,
            error: `Failed to get deal data: ${fullDealResult.error}`
          };
        }
        
        fullDeal = fullDealResult.deal;
        fullPerson = fullDealResult.person;
        fullOrganization = fullDealResult.organization;
      } else {
        fullDeal = deal;
        fullPerson = person;
        fullOrganization = organization;
      }
      
      // 2. Валидация данных сделки
      const validationResult = await this.validateDealForInvoice(fullDeal, fullPerson, fullOrganization);
      
      if (!validationResult.success) {
        return validationResult;
      }
      
      // 3. Определяем тип счета из кастомного поля
      const invoiceType = this.getInvoiceTypeFromDeal(fullDeal);
      
      if (!invoiceType) {
        return {
          success: false,
          error: 'No invoice type specified in deal'
        };
      }
      
      // 4. Извлекаем email клиента
      const email = this.getCustomerEmail(fullPerson, fullOrganization);
      if (!email) {
        return {
          success: false,
          error: 'Customer email is required for invoice creation'
        };
      }
      
      // 5. Подготавливаем данные контрагента
      const contractorData = this.prepareContractorData(fullPerson, fullOrganization, email);

      // 6. Ищем или создаем контрагента в wFirma
      const contractorResult = await this.userManagement.findOrCreateContractor(contractorData);
      if (!contractorResult.success) {
        return {
          success: false,
          error: `Failed to find or create contractor: ${contractorResult.error}`
        };
      }

      const contractor = contractorResult.contractor;
      logger.info(`Using contractor: ${contractor.name} (ID: ${contractor.id})`);

      // 7. Получаем продукты из сделки Pipedrive
      const dealProducts = await this.getDealProducts(fullDeal.id);
      let product;
      const defaultProductName = fullDeal.title || 'Camp / Tourist service';
      const totalAmount = parseFloat(fullDeal.value) || 0;

      if (dealProducts.length > 0) {
        const dealProduct = dealProducts[0];
        const quantity = parseFloat(dealProduct.quantity) || 1;
        const itemPrice = typeof dealProduct.item_price === 'number'
          ? dealProduct.item_price
          : parseFloat(dealProduct.item_price);
        const sumPrice = typeof dealProduct.sum === 'number'
          ? dealProduct.sum
          : parseFloat(dealProduct.sum);
        const productPrice = itemPrice || sumPrice || totalAmount;
        const productName = dealProduct.name
          || dealProduct.product?.name
          || defaultProductName;
        const productUnit = dealProduct.unit
          || dealProduct.product?.unit
          || 'szt.';

        product = {
          id: null,
          name: productName,
          price: productPrice,
          unit: productUnit,
          type: 'service',
          quantity
        };

        logger.info('Using product details from Pipedrive deal', {
          productName: product.name,
          productPrice: product.price,
          quantity: product.quantity
        });
      } else {
        const amountResult = await this.calculateInvoiceAmount(totalAmount, invoiceType, fullDeal);

        if (!amountResult.success) {
          return amountResult;
        }

        product = {
          id: null,
          name: defaultProductName,
          price: amountResult.amount,
          unit: 'szt.',
          type: 'service',
          quantity: 1
        };

        logger.info('No products in Pipedrive deal, using fallback product data', {
          productName: product.name,
          productPrice: product.price
        });
      }

      // 8. Создаем документ в wFirma с существующим контрагентом и продуктом
      const invoiceResult = await this.createInvoiceInWfirma(
        fullDeal,
        contractor,
        product,
        invoiceType
      );
      
      if (!invoiceResult.success) {
        return invoiceResult;
      }
      
      // Проверяем, что проформа действительно создана (invoiceId существует)
      if (!invoiceResult.invoiceId) {
        logger.error(`Invoice creation returned success but invoiceId is missing for deal ${fullDeal.id}`);
        return {
          success: false,
          error: 'Invoice creation failed: invoiceId is missing'
        };
      }
      
      logger.info(`Invoice successfully created in wFirma: ${invoiceResult.invoiceId} for deal ${fullDeal.id}`);
      
      // 7. Отправляем документ по email через wFirma API
      // Используем email клиента, если он доступен, иначе wFirma использует email из проформы
      const customerEmail = this.getCustomerEmail(fullPerson, fullOrganization);
      
      // Используем номер проформы (PRO-...) вместо ID, если он доступен
      const invoiceNumberForEmail = invoiceResult.invoiceNumber || invoiceResult.invoiceId;
      
      const emailResult = await this.sendInvoiceByEmail(
        invoiceResult.invoiceId,
        customerEmail,
        {
          subject: 'COMOON /  INVOICE  / Комьюнити для удаленщиков',
          body: `Привет. Внимательно посмотри, пожалуйста, сроки оплаты и график платежей. А также обязательно в назначении платежа укажи номер инвойса - ${invoiceNumberForEmail}.`
        }
      );
      
      if (!emailResult.success) {
        logger.warn(`Invoice created but email sending failed: ${emailResult.error}`);
        // Не считаем это критической ошибкой - проформа уже создана
      } else {
        logger.info(`Invoice ${invoiceResult.invoiceId} sent successfully by email${customerEmail ? ` to ${customerEmail}` : ''}`);
      }

      // 9. Создаем (если нужно) этикетку по названию сделки без дублирования
      const labelResult = await this.ensureLabelForDeal(fullDeal, product);
      if (!labelResult.success) {
        logger.info('Label creation skipped or failed', {
          dealId: fullDeal.id,
          invoiceId: invoiceResult.invoiceId,
          error: labelResult.error
        });
      } else {
        logger.info('Label ensured for deal', {
          dealId: fullDeal.id,
          labelId: labelResult.labelId,
          labelCreated: labelResult.created
        });
      }
      
      const result = {
        success: true,
        message: `Invoice ${invoiceType} created and sent successfully`,
        invoiceType: invoiceType,
        invoiceId: invoiceResult.invoiceId,
        contractorName: contractorData.name
      };

      // КРИТИЧНО: Снимаем триггер в CRM ТОЛЬКО после успешного создания проформы в wFirma
      // Проверяем еще раз, что invoiceId существует перед установкой "Done"
      if (invoiceResult.invoiceId) {
        logger.info(`Setting invoice type to "Done" for deal ${fullDeal.id} after successful invoice creation (ID: ${invoiceResult.invoiceId})`);
        const clearTriggerResult = await this.clearInvoiceTrigger(fullDeal.id);
        if (!clearTriggerResult.success) {
          logger.warn('Failed to clear invoice trigger in Pipedrive', {
            dealId: fullDeal.id,
            invoiceId: invoiceResult.invoiceId,
            error: clearTriggerResult.error
          });
          // Не считаем это критической ошибкой - проформа уже создана
        } else {
          logger.info(`Invoice trigger cleared successfully for deal ${fullDeal.id} (invoice ID: ${invoiceResult.invoiceId})`);
        }
      } else {
        logger.error(`Cannot clear invoice trigger: invoiceId is missing for deal ${fullDeal.id}`);
        // Не устанавливаем "Done", так как проформа не создана
      }

      return result;
      
    } catch (error) {
      logger.error(`Error processing deal ${deal.id}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создать (если нужно) и привязать этикетку с названием кемпа
   * @param {Object} deal - Данные сделки
   * @param {string|number} invoiceId - ID созданной проформы
   * @returns {Promise<Object>} - Результат операции
   */
  async ensureLabelForDeal(deal, product) {
    try {
      if (!deal || !deal.title) {
        return {
          success: false,
          error: 'Deal title is required to create label'
        };
      }

      const labelSource = product?.name || deal.title;
      const labelName = labelSource.trim().slice(0, 16);

      if (labelName.length === 0) {
        return {
          success: false,
          error: 'Deal title is empty'
        };
      }

      // 1. Ищем существующую этикетку
      const existingLabel = await this.wfirmaClient.findLabelByName(labelName);

      let labelId = null;
      let created = false;

      if (existingLabel.success && existingLabel.found) {
        labelId = existingLabel.label?.id;
      } else if (existingLabel.success && !existingLabel.found) {
        const createLabelResult = await this.wfirmaClient.createLabel(labelName);

        if (!createLabelResult.success) {
          return {
            success: false,
            error: createLabelResult.error || 'Failed to create label'
          };
        }

        labelId = createLabelResult.label?.id;
        created = true;
      } else {
        return {
          success: false,
          error: existingLabel.error || 'Failed to search for label'
        };
      }

      if (!labelId) {
        return {
          success: false,
          error: 'Label ID is missing after creation/search'
        };
      }

      return {
        success: true,
        labelId,
        created
      };

    } catch (error) {
      logger.error('Error creating or assigning label:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Сбросить поле Invoice type после обработки
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Результат обновления
   */
  async clearInvoiceTrigger(dealId) {
    try {
      const updateResult = await this.pipedriveClient.updateDeal(dealId, {
        [`${this.INVOICE_TYPE_FIELD_KEY}`]: this.INVOICE_DONE_VALUE
      });

      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error || 'Failed to update deal in Pipedrive'
        };
      }

      logger.info(`Invoice trigger cleared for deal ${dealId}`);
      return {
        success: true,
        deal: updateResult.deal
      };
    } catch (error) {
      logger.error('Error clearing invoice trigger:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Валидация данных сделки для создания счета
   * @param {Object} deal - Данные сделки
   * @param {Object} person - Данные персоны
   * @param {Object} organization - Данные организации
   * @returns {Promise<Object>} - Результат валидации
   */
  async validateDealForInvoice(deal, person, organization) {
    try {
      // 1. Проверяем наличие email
      const email = this.getCustomerEmail(person, organization);
      if (!email) {
        return {
          success: false,
          error: 'Customer email is required for invoice creation'
        };
      }
      
      // 2. Проверяем валюту
      const currency = deal.currency;
      if (!currency || !this.SUPPORTED_CURRENCIES.includes(currency)) {
        return {
          success: false,
          error: `Invalid currency: ${currency}. Supported currencies: ${this.SUPPORTED_CURRENCIES.join(', ')}`
        };
      }
      
      // 3. Проверяем сумму
      const amount = parseFloat(deal.value);
      if (!amount || amount <= 0) {
        return {
          success: false,
          error: `Invalid deal amount: ${amount}`
        };
      }
      
      // 4. Проверяем наличие банковского счета для валюты
      if (!this.BANK_ACCOUNT_CONFIG[currency]) {
        return {
          success: false,
          error: `Bank account for currency ${currency} is not configured`
        };
      }
      
      return {
        success: true,
        validatedData: {
          email,
          currency,
          amount,
          bankAccountName: this.BANK_ACCOUNT_CONFIG[currency].name
        }
      };
      
    } catch (error) {
      logger.error('Error validating deal:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получить тип счета из кастомного поля сделки
   * @param {Object} deal - Данные сделки
   * @returns {string|null} - Тип счета или null
   */
  getInvoiceTypeFromDeal(deal) {
    try {
      const invoiceTypeValue = deal[this.INVOICE_TYPE_FIELD_KEY];
      
      if (!invoiceTypeValue || invoiceTypeValue === '' || invoiceTypeValue === null) {
        logger.warn(`Deal ${deal.id} has no invoice type set`);
        return null;
      }
      
      // Конвертируем в число для сравнения (Pipedrive может возвращать строку)
      const invoiceTypeId = parseInt(invoiceTypeValue);
      
      // Проверяем, что значение соответствует одному из наших типов
      const validTypes = Object.values(this.INVOICE_TYPES);
      if (!validTypes.includes(invoiceTypeId)) {
        logger.warn(`Deal ${deal.id} has invalid invoice type: ${invoiceTypeValue} (ID: ${invoiceTypeId})`);
        return null;
      }
      
      // Возвращаем строковое название типа для дальнейшей обработки
      const typeName = Object.keys(this.INVOICE_TYPES).find(key => this.INVOICE_TYPES[key] === invoiceTypeId);
      logger.info(`Deal ${deal.id} invoice type: ${typeName} (ID: ${invoiceTypeId})`);
      return typeName;
      
    } catch (error) {
      logger.error(`Error getting invoice type from deal ${deal.id}:`, error);
      return null;
    }
  }

  /**
   * Получить email клиента из персоны или организации
   * @param {Object} person - Данные персоны
   * @param {Object} organization - Данные организации
   * @returns {string|null} - Email или null
   */
  getCustomerEmail(person, organization) {
    // Приоритет: Person email > Organization email
    if (person && person.email && person.email.length > 0) {
      return person.email[0].value;
    }
    
    if (person && person.primary_email) {
      return person.primary_email;
    }
    
    if (organization && organization.email && organization.email.length > 0) {
      return organization.email[0].value;
    }
    
    if (organization && organization.primary_email) {
      return organization.primary_email;
    }
    
    return null;
  }

  /**
   * Получить или создать контрагента в wFirma
   * @param {Object} person - Данные персоны
   * @param {Object} organization - Данные организации
   * @returns {Promise<Object>} - Результат с контрагентом
   */
  async getOrCreateContractor(person, organization) {
    try {
      const email = this.getCustomerEmail(person, organization);
      
      if (!email) {
        return {
          success: false,
          error: 'Customer email is required'
        };
      }
      
      // Подготавливаем данные контрагента
      const contractorData = this.prepareContractorData(person, organization, email);
      
      // Используем User Management Module
      const result = await this.userManagement.findOrCreateContractor(contractorData);
      
      return result;
      
    } catch (error) {
      logger.error('Error getting or creating contractor:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Нормализовать код страны для wFirma
   * @param {string} country - Код или название страны
   * @returns {string} - Двухбуквенный ISO код страны
   */
  normalizeCountryCode(country) {
    if (!country) return 'PL';
    
    const countryMap = {
      // Польские названия из wFirma -> ISO коды
      'Polska': 'PL',
      'Niemcy': 'DE',
      'Francja': 'FR',
      'Wielka Brytania': 'GB',
      'Stany Zjednoczone': 'US',
      'Czechy': 'CZ',
      'Litwa': 'LT',
      'Łotwa': 'LV',
      'Estonia': 'EE',
      
      // Английские названия из CRM -> ISO коды
      'Poland': 'PL',
      'Germany': 'DE',
      'Deutschland': 'DE',
      'France': 'FR',
      'United Kingdom': 'GB',
      'UK': 'GB',
      'United States': 'US',
      'USA': 'US',
      'Czech Republic': 'CZ',
      'Lithuania': 'LT',
      'Latvia': 'LV',
      'Estonia': 'EE',
      'Portugal': 'PT',
      'Spain': 'ES',
      'Italy': 'IT',
      'Netherlands': 'NL',
      'Belgium': 'BE',
      'Austria': 'AT',
      'Switzerland': 'CH',
      'Sweden': 'SE',
      'Norway': 'NO',
      'Denmark': 'DK',
      'Finland': 'FI',
      'Ukraine': 'UA',
      'Україна': 'UA',
      'Ukraina': 'UA'
    };
    
    // Если уже двухбуквенный код
    if (country.length === 2) {
      return country.toUpperCase();
    }
    
    // Ищем в мапе
    const normalized = countryMap[country];
    if (normalized) {
      return normalized;
    }
    
    // По умолчанию PL
    return 'PL';
  }

  /**
   * Подготовить данные контрагента из Pipedrive
   * @param {Object} person - Данные персоны
   * @param {Object} organization - Данные организации
   * @param {string} email - Email клиента
   * @returns {Object} - Данные контрагента для wFirma
   */
  prepareContractorData(person, organization, email) {
    // Приоритет: Organization > Person
    if (organization) {
      return {
        name: organization.name,
        email: email,
        address: organization.address || '',
        zip: organization.zip || '80-000',
        city: organization.city || 'Gdańsk',
        country: this.normalizeCountryCode(organization.country),
        business_id: organization.business_id || '',
        type: organization.business_id ? 'company' : 'person'
      };
    }
    
    if (person) {
      // Определяем страну из данных персоны
      const country = this.normalizeCountryCode(person.postal_address_country);
      
      // Используем данные адреса из Pipedrive
      // postal_address может содержать полный адрес или только улицу
      const address = person.postal_address || person.postal_address_route || '';
      let zip = person.postal_address_postal_code || '';
      const city = person.postal_address_locality || '';
      
      // Если адрес пустой, используем дефолтные значения только для Польши
      let defaultZip = '00-000';
      let defaultCity = 'Gdańsk';
      
      // wFirma требует польский формат почтового индекса (XX-XXX)
      // Если формат не подходит, используем универсальный "00-000"
      if (zip && !zip.match(/^\d{2}-\d{3}$/)) {
        // Если почтовый индекс не в польском формате (XX-XXX), пытаемся преобразовать
        const digitsOnly = zip.replace(/\D/g, '');
        if (digitsOnly.length === 5) {
          zip = `${digitsOnly.substring(0, 2)}-${digitsOnly.substring(2)}`;
        } else {
          // Если не можем преобразовать, используем универсальный "00-000"
          zip = '00-000';
        }
      }
      
      // Для не-польских стран используем универсальный почтовый индекс "00-000"
      if (country !== 'PL') {
        defaultZip = '00-000';
        defaultCity = '';
      }
      
      // Логируем данные адреса для отладки
      logger.info('Preparing contractor data from person:', {
        personId: person.id,
        name: person.name,
        address: address,
        zip: zip || defaultZip,
        city: city || defaultCity,
        country: country,
        postal_address: person.postal_address,
        postal_address_route: person.postal_address_route,
        postal_address_locality: person.postal_address_locality,
        postal_address_postal_code: person.postal_address_postal_code,
        postal_address_country: person.postal_address_country
      });
      
      return {
        name: person.name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
        email: email,
        address: address,
        zip: zip || defaultZip,
        city: city || defaultCity,
        country: country,
        business_id: '',
        type: 'person'
      };
    }
    
    // Fallback данные
    return {
      name: 'Unknown Customer',
      email: email,
      address: '',
      zip: '00-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '',
      type: 'person'
    };
  }

  /**
   * Рассчитать сумму для типа фактуры
   * @param {number} totalAmount - Общая сумма сделки
   * @param {string} invoiceType - Тип фактуры
   * @param {Object} deal - Данные сделки (для проверки существующих фактур)
   * @returns {Promise<Object>} - Результат с суммой и валидацией
   */
  async calculateInvoiceAmount(totalAmount, invoiceType, deal) {
    try {
      let invoiceAmount = 0;
      let validationMessage = '';

      switch (invoiceType) {
        case 'PROFORMA':
          // Proforma - всегда на полную сумму
          // Если сумма 0, используем 1 для тестирования
          invoiceAmount = totalAmount > 0 ? totalAmount : 1;
          validationMessage = totalAmount > 0 ? 'Proforma invoice for full amount' : 'Proforma invoice for test amount (1)';
          break;

        default:
          return {
            success: false,
            error: `Unsupported invoice type: ${invoiceType}. Only Proforma is supported currently.`
          };
      }

      return {
        success: true,
        amount: invoiceAmount,
        message: validationMessage
      };

    } catch (error) {
      logger.error('Error calculating invoice amount:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создать документ в wFirma
   * @param {Object} deal - Данные сделки
   * @param {Object} contractorData - Данные контрагента
   * @param {string} invoiceType - Тип счета
   * @returns {Promise<Object>} - Результат создания
   */
  async createInvoiceInWfirma(deal, contractorData, product, invoiceType) {
    try {
      // Рассчитываем сумму для типа фактуры
      const amountResult = await this.calculateInvoiceAmount(deal.value, invoiceType, deal);
      
      if (!amountResult.success) {
        return amountResult;
      }

      logger.info(`Creating ${invoiceType} invoice for contractor ${contractorData.name}`);
      logger.info(`Amount: ${amountResult.amount} ${deal.currency}`);
      logger.info(`VAT Rate: ${this.VAT_RATE}% (no VAT)`);
      logger.info(`Message: ${amountResult.message}`);

      // Логируем продукт перед созданием Proforma
      logger.info('Product data before Proforma creation:', {
        productId: product.id,
        productName: product.name,
        productPrice: product.price,
        productUnit: product.unit,
        productType: product.type
      });

      // Создаем Proforma фактуру в wFirma
      const invoiceResult = await this.createProformaInWfirma(
        deal, 
        contractorData, 
        product,
        amountResult.amount
      );
      
      if (!invoiceResult.success) {
        return invoiceResult;
      }
      
      return {
        success: true,
        invoiceId: invoiceResult.invoiceId,
        invoiceNumber: invoiceResult.invoiceNumber,
        amount: amountResult.amount,
        currency: deal.currency,
        vatRate: this.VAT_RATE,
        message: `Proforma invoice created successfully for ${amountResult.amount} ${deal.currency} (no VAT)`
      };
      
    } catch (error) {
      logger.error('Error creating invoice in wFirma:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Создать Proforma фактуру в wFirma
   * @param {Object} deal - Данные сделки
   * @param {Object} contractor - Данные контрагента (с ID)
   * @param {number} amount - Сумма фактуры
   * @returns {Promise<Object>} - Результат создания
   */
  async createProformaInWfirma(deal, contractor, product, amount) {
    try {
      logger.info(`Creating Proforma invoice in wFirma for contractor ${contractor.name} (ID: ${contractor.id})`);
      
      // Подготавливаем даты
      const issueDate = new Date();
      const issueDateStr = issueDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const paymentDate = new Date(issueDate);
      paymentDate.setDate(paymentDate.getDate() + this.PAYMENT_TERMS_DAYS);
      const paymentDateStr = paymentDate.toISOString().split('T')[0];

      const totalAmount = parseFloat(amount);
      const depositAmount = Math.round((totalAmount * this.ADVANCE_PERCENT / 100) * 100) / 100;
      const balanceAmount = Math.round((totalAmount - depositAmount) * 100) / 100;
      const formatAmount = (value) => value.toFixed(2);

      let secondPaymentDateStr = paymentDateStr;
      if (deal.expected_close_date) {
        try {
          const expectedCloseDate = new Date(deal.expected_close_date);
          const balanceDueDate = new Date(expectedCloseDate);
          balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);

          const today = new Date(issueDateStr);
          if (balanceDueDate > today) {
            secondPaymentDateStr = balanceDueDate.toISOString().split('T')[0];
          }
        } catch (error) {
          logger.warn('Failed to calculate second payment date from expected close date', {
            dealId: deal.id,
            expectedCloseDate: deal.expected_close_date,
            error: error.message
          });
        }
      }

      let scheduleDescription;
      if (secondPaymentDateStr && secondPaymentDateStr !== paymentDateStr) {
        scheduleDescription = `График платежей: 50% предоплата (${formatAmount(depositAmount)} ${deal.currency}) оплачивается сейчас; 50% остаток (${formatAmount(balanceAmount)} ${deal.currency}) до ${secondPaymentDateStr}.`;
      } else {
        scheduleDescription = `График платежей: 100% оплата (${formatAmount(totalAmount)} ${deal.currency}) до ${paymentDateStr}.`;
      }

      const invoiceDescription = this.DEFAULT_DESCRIPTION
        ? `${this.DEFAULT_DESCRIPTION.trim()} ${scheduleDescription}`.trim()
        : scheduleDescription;
      
      // Получаем банковский счет по валюте
      const bankAccountResult = await this.getBankAccountByCurrency(deal.currency);
      if (!bankAccountResult.success) {
        return {
          success: false,
          error: `Failed to get bank account for currency ${deal.currency}: ${bankAccountResult.error}`
        };
      }
      
      const bankAccount = bankAccountResult.bankAccount;
      
      // Логируем данные продукта для XML
      logger.info('Product data for XML generation:', {
        productId: product.id,
        productName: product.name,
        productUnit: product.unit,
        productType: product.type,
        hasId: !!product.id
      });

      // Логируем банковский счет
      logger.info('Using bank account for Proforma:', {
        bankAccountId: bankAccount.id,
        bankAccountName: bankAccount.name,
        currency: deal.currency
      });

      // 🎯 ПОЛНЫЕ ДАННЫЕ ДЛЯ СОЗДАНИЯ INVOICE В JSON ФОРМАТЕ
      const invoiceData = {
        deal: {
          id: deal.id,
          title: deal.title,
          currency: deal.currency,
          value: deal.value
        },
        contractor: {
          id: contractor.id,
          name: contractor.name,
          email: contractor.email,
          address: contractor.address
        },
        product: {
          id: product.id,
          name: product.name,
          unit: product.unit,
          type: product.type,
          netto: product.netto,
          quantity: product.quantity
        },
        bankAccount: {
          id: bankAccount.id,
          name: bankAccount.name,
          currency: bankAccount.currency,
          number: bankAccount.number
        },
        amounts: {
          originalAmount: deal.value,
          calculatedAmount: amount,
          vatRate: this.VAT_RATE,
          paymentMethod: this.PAYMENT_METHOD
        },
        dates: {
          issueDate: issueDate,
          dueDate: paymentDateStr,
          paymentTermsDays: this.PAYMENT_TERMS_DAYS
        },
        settings: {
          language: this.DEFAULT_LANGUAGE,
          description: this.DEFAULT_DESCRIPTION,
          companyId: this.wfirmaClient.companyId
        }
      };

      logger.info('📋 COMPLETE INVOICE DATA FOR XML GENERATION:');
      logger.info('JSON DATA:', JSON.stringify(invoiceData, null, 2));

      // Создаем XML payload для wFirma API (Proforma) - РАБОТАЮЩИЙ ВАРИАНТ!
      const xmlPayload = `<?xml version="1.0" encoding="UTF-8"?>
<api>
    <invoices>
        <invoice>
            <type>proforma</type>
            <issue_date>${issueDateStr}</issue_date>
            <payment_date>${paymentDateStr}</payment_date>
            <payment_type>${this.PAYMENT_METHOD}</payment_type>
            <language>${this.DEFAULT_LANGUAGE}</language>
            <currency>${deal.currency}</currency>
            <company_account_id>${bankAccount.id}</company_account_id>
            <description>${escapeXml(invoiceDescription)}</description>
            <vat_exemption_reason>nie podl.</vat_exemption_reason>
            <contractor>
                <id>${contractor.id}</id>
            </contractor>
            <invoicecontents>
                <invoicecontent>
                    <name>${product.name}</name>
                    <count>${product.quantity || 1}</count>
                    <unit_count>${product.quantity || 1}</unit_count>
                    <price>${parseFloat(amount)}</price>
                    <is_net>false</is_net>
                    <brutto>${parseFloat(amount)}</brutto>
                    <unit>${product.unit || 'szt.'}</unit>
                    <vat_code_id>230</vat_code_id>
                    <vat_rate>0</vat_rate>
                </invoicecontent>
            </invoicecontents>
        </invoice>
    </invoices>
</api>`;

      logger.info('🔍 DETAILED XML ENTRY ANALYSIS:');
      logger.info('Product Name in XML:', `"${product.name}"`);
      logger.info('Product Name Length:', product.name?.length || 0);
      logger.info('Product Name Type:', typeof product.name);
      logger.info('Product Price in XML:', parseFloat(amount));
      logger.info('Product Unit in XML:', product.unit || 'szt.');
      logger.info('Product ID in XML:', product.id || 'НЕТ ID');
      
      // Логируем весь XML
      logger.info('📄 FULL XML PAYLOAD:');
      console.log('XML PAYLOAD:\n' + xmlPayload);

      // Используем правильный XML endpoint для Proforma
      const endpoint = `/invoices/add?outputFormat=xml&inputFormat=xml&company_id=${this.wfirmaClient.companyId}`;

      // Создаем специальный клиент для XML запросов
      const xmlClient = require('axios').create({
        baseURL: this.wfirmaClient.baseURL,
        headers: {
          'Content-Type': 'application/xml',
          'Accept': 'application/xml',
          'accessKey': this.wfirmaClient.accessKey,
          'secretKey': this.wfirmaClient.secretKey,
          'appKey': this.wfirmaClient.appKey
        },
        timeout: 15000
      });

      const response = await xmlClient.post(endpoint, xmlPayload);
      
      // Проверяем ответ
      if (response.data) {
        logger.info('Proforma invoice response received:', response.data);
        
        // Если это JSON ответ (ожидаемый формат)
        if (typeof response.data === 'object') {
          // Проверяем успешное создание
          if (response.data.invoice || response.data.id) {
            const invoiceId = response.data.invoice?.id || response.data.id;
            const invoiceNumber = response.data.invoice?.number || response.data.number || null;
            
            logger.info('Proforma invoice created successfully (JSON response):', {
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber,
              response: response.data
            });
            
            return {
              success: true,
              invoice: response.data.invoice || response.data,
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber,
              message: 'Proforma invoice created successfully'
            };
          } else if (response.data.error || response.data.message) {
            // Обрабатываем ошибки в JSON формате
            const errorMessage = response.data.error || response.data.message;
            throw new Error(`wFirma API error: ${errorMessage}`);
          } else {
            throw new Error('Unexpected JSON response format from wFirma API');
          }
        }
        // Если это XML ответ (для совместимости)
        else if (typeof response.data === 'string' && response.data.includes('<?xml')) {
          if (response.data.includes('<code>OK</code>') || response.data.includes('<id>')) {
            logger.info('Proforma invoice created successfully (XML response):', response.data);
            
            // Извлекаем ID фактуры из XML ответа
            const idMatch = response.data.match(/<id>(\d+)<\/id>/);
            const invoiceId = idMatch ? idMatch[1] : null;
            
            // Извлекаем номер проформы (number) из XML ответа
            // Пробуем разные варианты: <number>, <fullnumber>, <invoice_number>
            let numberMatch = response.data.match(/<fullnumber>(.*?)<\/fullnumber>/);
            if (!numberMatch) {
              numberMatch = response.data.match(/<invoice_number>(.*?)<\/invoice_number>/);
            }
            if (!numberMatch) {
              numberMatch = response.data.match(/<number>(.*?)<\/number>/);
            }
            const invoiceNumber = numberMatch ? numberMatch[1] : null;
            
            logger.info('Proforma invoice details:', {
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber
            });
            
            return {
              success: true,
              message: 'Proforma invoice created successfully',
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber,
              response: response.data
            };
          } else if (response.data.includes('<code>ERROR</code>')) {
            // Извлекаем детали ошибки из XML
            const errorMatch = response.data.match(/<message>(.*?)<\/message>/);
            const errorMessage = errorMatch ? errorMatch[1] : 'Unknown error';
            throw new Error(`wFirma API error: ${errorMessage}`);
          } else {
            throw new Error(`wFirma API error: ${response.data}`);
          }
        } else {
          throw new Error('Unexpected response format from wFirma API');
        }
      } else {
        throw new Error('Empty response from wFirma API');
      }
      
    } catch (error) {
      logger.error('Error creating Proforma invoice in wFirma:', error);
      return {
        success: false,
        error: error.message,
        details: error.response?.data || null
      };
    }
  }

  /**
   * Отправить документ по email через wFirma
   * @param {string|number} invoiceId - ID документа в wFirma
   * @param {string} email - Email адрес получателя (опционально, если не указан, используется email из проформы)
   * @param {Object} options - Дополнительные опции для отправки
   * @param {string} options.subject - Тема письма (по умолчанию: "Otrzymałeś fakturę")
   * @param {string} options.body - Текст письма (по умолчанию: "Przesyłam fakturę")
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendInvoiceByEmail(invoiceId, email = null, options = {}) {
    try {
      logger.info(`Sending invoice ${invoiceId} by email${email ? ` to ${email}` : ''} via wFirma API`);
      
      // Используем метод из wFirma клиента для отправки проформы по email
      const result = await this.wfirmaClient.sendInvoiceByEmail(invoiceId, email, options);
      
      if (result.success) {
        logger.info(`Invoice ${invoiceId} sent successfully by email${email ? ` to ${email}` : ''}`);
      } else {
        logger.error(`Failed to send invoice ${invoiceId} by email: ${result.error}`);
      }
      
      return result;
      
    } catch (error) {
      logger.error('Error sending invoice by email:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Обработать конкретную сделку по ID (для ручного запуска)
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Результат обработки
   */
  async processDealById(dealId) {
    try {
      logger.info(`Processing deal ${dealId} manually...`);
      
      // Получаем данные сделки с связанными данными
      const dealResult = await this.pipedriveClient.getDealWithRelatedData(dealId);
      
      if (!dealResult.success) {
        return dealResult;
      }
      
      // Обрабатываем сделку
      const result = await this.processDealInvoice(dealResult.deal, dealResult.person, dealResult.organization);
      
      return result;
      
    } catch (error) {
      logger.error(`Error processing deal ${dealId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Получение продуктов из сделки Pipedrive
   * @param {number} dealId - ID сделки
   * @returns {Promise<Array>} - Массив продуктов
   */
  async getDealProducts(dealId) {
    try {
      logger.info('Fetching products for deal', { dealId: dealId });
      
      // Используем прямой вызов axios клиента
      const response = await this.pipedriveClient.client.get(`/deals/${dealId}/products`, {
        params: {
          api_token: this.pipedriveClient.apiToken
        }
      });
      
      if (response.data?.success && response.data?.data && Array.isArray(response.data.data)) {
        logger.info(`Found ${response.data.data.length} products for deal ${dealId}`);
        return response.data.data;
      } else {
        logger.info(`No products found for deal ${dealId}`);
        return [];
      }
      
    } catch (error) {
      logger.error('Error fetching deal products:', error);
      return [];
    }
  }
}

module.exports = InvoiceProcessingService;
