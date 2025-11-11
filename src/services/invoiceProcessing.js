const PipedriveClient = require('./pipedrive');
const WfirmaClient = require('./wfirma');
const UserManagementService = require('./userManagement');
const SendPulseClient = require('./sendpulse');
const ProformaRepository = require('./proformaRepository');
const { WfirmaLookup } = require('./vatMargin/wfirmaLookup');
const logger = require('../utils/logger');
const bankAccountConfig = require('../../config/bank-accounts');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    this.proformaRepository = new ProformaRepository();
    try {
      this.wfirmaLookup = new WfirmaLookup();
    } catch (error) {
      logger.warn('Failed to initialize WfirmaLookup for Supabase sync:', error.message);
      this.wfirmaLookup = null;
    }
    
    // Инициализируем SendPulse клиент (может быть не настроен, поэтому не критично)
    try {
      const hasSendpulseId = !!process.env.SENDPULSE_ID?.trim();
      const hasSendpulseSecret = !!process.env.SENDPULSE_SECRET?.trim();
      
      logger.info('SendPulse initialization check:', {
        hasSendpulseId,
        hasSendpulseSecret,
        sendpulseIdLength: process.env.SENDPULSE_ID?.trim()?.length || 0,
        sendpulseSecretLength: process.env.SENDPULSE_SECRET?.trim()?.length || 0
      });
      
      this.sendpulseClient = new SendPulseClient();
      logger.info('SendPulse client initialized successfully');
    } catch (error) {
      logger.error('SendPulse client not initialized (credentials missing or invalid):', {
        error: error.message,
        stack: error.stack,
        hasSendpulseId: !!process.env.SENDPULSE_ID?.trim(),
        hasSendpulseSecret: !!process.env.SENDPULSE_SECRET?.trim()
      });
      this.sendpulseClient = null;
    }
    
    // Конфигурация
    this.ADVANCE_PERCENT = 50; // 50% предоплата
    this.PAYMENT_TERMS_DAYS = 3; // Срок оплаты 3 дня
    this.DEFAULT_LANGUAGE = 'en';
    this.DEFAULT_DESCRIPTION = '';
    this.VAT_RATE = 0; // Proforma без VAT (0%)
    this.PAYMENT_METHOD = 'transfer'; // Всегда банковский перевод
    
    // Кастомное поле Invoice type в Pipedrive
    this.INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Кастомное поле Sendpulse ID в Pipedrive
    // Ключ поля: "Sendpulse ID" (статический, одинаковый для всех пользователей)
    this.SENDPULSE_ID_FIELD_KEY = 'ff1aa263ac9f0e54e2ae7bec6d7215d027bf1b8c';

    this.WFIRMA_INVOICE_ID_FIELD_KEY = 'd89358b2be5826fc748a0600a9db7bcdf8d924c7';
    this.INVOICE_NUMBER_FIELD_KEY = '0598d1168fe79005061aa3710ec45c3e03dbe8a3';
    this.DELETE_TRIGGER_FIELD_KEY = this.INVOICE_TYPE_FIELD_KEY;
    this.DELETE_TRIGGER_VALUES = new Set(['delete', '74']);
    
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
      invoiceTypes: Object.keys(this.INVOICE_TYPES),
      invoiceTypeFieldKey: this.INVOICE_TYPE_FIELD_KEY,
      invoiceNumberFieldKey: this.INVOICE_NUMBER_FIELD_KEY
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

      const deletionResult = await this.processDeletionRequests();
      if (!deletionResult.success) {
        logger.warn('Deletion trigger processing finished with errors', {
          error: deletionResult.error,
          details: deletionResult.details
        });
      } else if (deletionResult.total > 0) {
        logger.info('Deletion trigger processing summary', {
          processed: deletionResult.processed,
          errors: deletionResult.errors,
          total: deletionResult.total
        });
      }
      
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

  async processDeletionRequests() {
    try {
      if (!this.DELETE_TRIGGER_FIELD_KEY) {
        logger.debug('Delete trigger field key is not configured, skipping deletion checks');
        return { success: true, total: 0, processed: 0, errors: 0, results: [] };
      }

      const dealsResult = await this.getDealsMarkedForDeletion();
      if (!dealsResult.success) {
        return dealsResult;
      }

      if (!dealsResult.deals.length) {
        logger.info('No deals marked for deletion found');
        return { success: true, total: 0, processed: 0, errors: 0, results: [] };
      }

      logger.info(`Found ${dealsResult.deals.length} deals marked for proforma deletion`);

      const results = [];
      for (const deal of dealsResult.deals) {
        try {
          const result = await this.handleDealDeletion(deal);
          results.push({
            dealId: deal.id,
            success: result.success,
            processed: result.processed || 0,
            error: result.error || null
          });
        } catch (error) {
          logger.error(`Error while handling delete trigger for deal ${deal.id}:`, error);
          results.push({
            dealId: deal.id,
            success: false,
            processed: 0,
            error: error.message
          });
        }
      }

      const processed = results.filter((item) => item.success).reduce((acc, item) => acc + (item.processed || 0), 0);
      const errors = results.filter((item) => !item.success).length;

      return {
        success: true,
        total: dealsResult.deals.length,
        processed,
        errors,
        results
      };
    } catch (error) {
      logger.error('Error while processing deletion requests:', error);
      return {
        success: false,
        error: error.message,
        details: error.stack
      };
    }
  }

  async getDealsMarkedForDeletion() {
    try {
      const dealsResult = await this.pipedriveClient.getDeals({
        limit: 500,
        start: 0,
        status: 'open'
      });

      if (!dealsResult.success) {
        return dealsResult;
      }

      const sourceDeals = Array.isArray(dealsResult.deals) ? dealsResult.deals : [];

      const deletionDeals = sourceDeals.filter((deal) => {
        const rawValue = deal[this.DELETE_TRIGGER_FIELD_KEY];
        if (rawValue === undefined || rawValue === null) {
          return false;
        }
        const normalized = String(rawValue).trim().toLowerCase();
        return this.DELETE_TRIGGER_VALUES.has(normalized);
      });

      return {
        success: true,
        deals: deletionDeals
      };
    } catch (error) {
      logger.error('Error getting deals marked for deletion:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async handleDealDeletion(deal) {
    const dealId = deal?.id;
    if (!dealId) {
      return { success: false, error: 'Deal id is missing' };
    }

    const originalInvoiceFieldValue = this.INVOICE_NUMBER_FIELD_KEY ? deal?.[this.INVOICE_NUMBER_FIELD_KEY] : null;
    const expectedNumbers = this.parseInvoiceNumbers(
      this.INVOICE_NUMBER_FIELD_KEY ? deal?.[this.INVOICE_NUMBER_FIELD_KEY] : null
    );

    const proformaMap = new Map();
    try {
      const linkedProformas = await this.proformaRepository.findByDealId(dealId);
      (linkedProformas || []).forEach((item) => {
        proformaMap.set(String(item.id), item);
      });
    } catch (error) {
      logger.error('Error fetching proformas by deal id:', {
        dealId,
        error: error.message
      });
    }

    const additionalIds = [];
    if (this.WFIRMA_INVOICE_ID_FIELD_KEY) {
      const rawInvoiceIds = deal[this.WFIRMA_INVOICE_ID_FIELD_KEY];
      if (rawInvoiceIds) {
        String(rawInvoiceIds)
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .forEach((value) => {
            const numericId = value.replace(/\D/g, '');
            if (!numericId.length) {
              return;
            }

            if (!proformaMap.has(numericId)) {
              additionalIds.push(numericId);
            }
          });
      }
    }

    if (additionalIds.length) {
      try {
        const extraProformas = await this.proformaRepository.findByIds(additionalIds);
        (extraProformas || []).forEach((item) => {
          proformaMap.set(String(item.id), item);
        });
        additionalIds.forEach((id) => {
          if (!proformaMap.has(id)) {
            proformaMap.set(id, { id });
          }
        });
      } catch (error) {
        logger.error('Error fetching proformas by explicit ids:', {
          dealId,
          ids: additionalIds,
          error: error.message
        });
      }
    }

    if (proformaMap.size === 0) {
      logger.warn('No proformas linked to deal for deletion', { dealId });
      await this.proformaRepository.recordDeletionLog({
        proformaId: null,
        dealId,
        status: 'not-found',
        wfirmaStatus: null,
        supabaseStatus: null,
        message: 'No linked proformas found'
      });
      return { success: false, error: 'No linked proformas found' };
    }

    let candidates = Array.from(proformaMap.values());

    if (expectedNumbers.size > 0) {
      candidates = candidates.filter((proforma) => {
        const normalizedNumber = this.normalizeInvoiceNumber(proforma?.fullnumber || proforma?.number);
        if (normalizedNumber && expectedNumbers.has(normalizedNumber)) {
          return true;
        }

        const normalizedId = this.normalizeInvoiceNumber(proforma?.id);
        return normalizedId && expectedNumbers.has(normalizedId);
      });

      if (!candidates.length) {
        logger.warn('No proformas matched expected invoice numbers for deletion', {
          dealId,
          expectedNumbers: Array.from(expectedNumbers)
        });
        await this.proformaRepository.recordDeletionLog({
          proformaId: null,
          dealId,
          status: 'number-mismatch',
          wfirmaStatus: null,
          supabaseStatus: null,
          message: 'No proformas matched expected invoice numbers',
          metadata: {
            expectedNumbers: Array.from(expectedNumbers)
          }
        });
        return { success: false, error: 'No matching proformas found for requested number' };
      }
    }

    const candidateMap = new Map();
    candidates.forEach((proforma) => {
      candidateMap.set(String(proforma.id), proforma);
    });

    const expectedNumberList = Array.from(expectedNumbers);
    const removedNumbers = new Set();
    let allSuccess = true;
    let processed = 0;

    for (const proforma of candidateMap.values()) {
      const proformaId = String(proforma.id);
      const snapshot = this.buildDeletionSnapshot(proforma);

      try {
        const deleteResult = await this.wfirmaClient.deleteInvoice(proformaId);

        if (!deleteResult.success) {
          allSuccess = false;
          await this.proformaRepository.recordDeletionLog({
            proformaId,
            dealId,
            status: 'wfirma-error',
            wfirmaStatus: deleteResult.error || 'unknown',
            snapshot,
            metadata: {
              expectedNumbers: expectedNumberList,
              snapshot
            }
          });
          logger.error('Failed to delete proforma in wFirma', {
            dealId,
            proformaId,
            error: deleteResult.error
          });
          continue;
        }

        const supabaseResult = await this.proformaRepository.markProformaDeleted(proformaId, {
          deletedAt: new Date()
        });
        if (!supabaseResult.success) {
          allSuccess = false;
          await this.proformaRepository.recordDeletionLog({
            proformaId,
            dealId,
            status: 'supabase-error',
            wfirmaStatus: 'deleted',
            snapshot,
            supabaseStatus: supabaseResult.error || supabaseResult.stage || 'unknown',
            metadata: {
              expectedNumbers: expectedNumberList,
              snapshot
            }
          });
          logger.error('Failed to delete proforma from Supabase', {
            dealId,
            proformaId,
            error: supabaseResult.error,
            stage: supabaseResult.stage
          });
          continue;
        }

        processed += 1;

        const normalizedNumber = this.normalizeInvoiceNumber(proforma?.fullnumber || proforma?.number);
        if (normalizedNumber) {
          removedNumbers.add(normalizedNumber);
        }
        const normalizedId = this.normalizeInvoiceNumber(proforma?.id);
        if (normalizedId) {
          removedNumbers.add(normalizedId);
        }

        await this.proformaRepository.recordDeletionLog({
          proformaId,
          dealId,
          status: 'deleted',
          wfirmaStatus: 'deleted',
          supabaseStatus: 'deleted',
          snapshot,
          metadata: {
            expectedNumbers: expectedNumberList,
            snapshot,
            removedNumbers: Array.from(removedNumbers)
          }
        });

        logger.info('Proforma deleted successfully', {
          dealId,
          proformaId,
          fullnumber: proforma.fullnumber || null
        });
      } catch (error) {
        allSuccess = false;
        logger.error('Unexpected error while deleting proforma linked to deal', {
          dealId,
          proformaId: proforma.id,
          error: error.message
        });
        await this.proformaRepository.recordDeletionLog({
          proformaId: proforma.id,
          dealId,
          status: 'unexpected-error',
          wfirmaStatus: 'unknown',
          supabaseStatus: 'unknown',
          snapshot,
          message: error.message,
          metadata: {
            expectedNumbers: expectedNumberList,
            snapshot,
            error: error.message
          }
        });
      }
    }

    let invoiceFieldUpdatePayload = {};
    if (this.INVOICE_NUMBER_FIELD_KEY) {
      const { changed, value } = this.computeRemainingInvoiceNumbers(originalInvoiceFieldValue, removedNumbers);
      if (changed) {
        invoiceFieldUpdatePayload[this.INVOICE_NUMBER_FIELD_KEY] = value;
      }
    }

    if (allSuccess) {
      const clearResult = await this.clearDeleteTrigger(dealId, invoiceFieldUpdatePayload);
      if (!clearResult.success) {
        allSuccess = false;
        await this.proformaRepository.recordDeletionLog({
          proformaId: null,
          dealId,
          status: 'pipedrive-error',
          wfirmaStatus: 'deleted',
          supabaseStatus: 'deleted',
          message: clearResult.error
        });
        logger.error('Failed to clear delete trigger in Pipedrive', {
          dealId,
          error: clearResult.error
        });
      } else {
        logger.info('Delete trigger cleared in Pipedrive', { dealId });
      }
    }

    return { success: allSuccess, processed, error: allSuccess ? null : 'One or more deletions failed' };
  }

  normalizeInvoiceNumber(value) {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = String(value).trim();
    if (!trimmed.length) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  parseInvoiceNumbers(rawValue) {
    const numbers = new Set();

    if (Array.isArray(rawValue)) {
      rawValue.forEach((item) => {
        const normalized = this.normalizeInvoiceNumber(item);
        if (normalized) {
          numbers.add(normalized);
        }
      });
      return numbers;
    }

    if (!rawValue && rawValue !== 0) {
      return numbers;
    }

    String(rawValue)
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .forEach((value) => {
        const normalized = this.normalizeInvoiceNumber(value);
        if (normalized) {
          numbers.add(normalized);
        }
      });

    return numbers;
  }

  extractFieldValues(rawValue) {
    if (rawValue === undefined || rawValue === null) {
      return [];
    }

    if (Array.isArray(rawValue)) {
      return rawValue
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0);
    }

    return String(rawValue)
      .split(/[\n,;]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  async findExistingProformaForDeal(deal) {
    if (!deal || !deal.id) {
      return { found: false };
    }

    const result = {
      found: false,
      invoiceId: null,
      invoiceNumber: null,
      source: null
    };

    const invoiceIdCandidates = this.WFIRMA_INVOICE_ID_FIELD_KEY
      ? this.extractFieldValues(deal[this.WFIRMA_INVOICE_ID_FIELD_KEY])
      : [];
    const invoiceNumberCandidates = this.INVOICE_NUMBER_FIELD_KEY
      ? this.extractFieldValues(deal[this.INVOICE_NUMBER_FIELD_KEY])
      : [];

    if (invoiceIdCandidates.length > 0) {
      result.invoiceId = invoiceIdCandidates[invoiceIdCandidates.length - 1];
      result.found = true;
      result.source = 'pipedrive_field';
    }

    let repositoryProformas = null;

    if (this.proformaRepository && this.proformaRepository.isEnabled()) {
      try {
        repositoryProformas = await this.proformaRepository.findByDealId(deal.id);
      } catch (error) {
        logger.error('Failed to fetch proformas while checking for duplicates', {
          dealId: deal.id,
          error: error.message
        });
      }
    }

    if (Array.isArray(repositoryProformas) && repositoryProformas.length > 0) {
      const normalizedInvoiceId = result.invoiceId ? String(result.invoiceId) : null;
      const matchById = normalizedInvoiceId
        ? repositoryProformas.find((item) => String(item.id) === normalizedInvoiceId)
        : null;

      const activeProforma = matchById
        || repositoryProformas.find((item) => (item?.status || 'active') !== 'deleted');

      if (activeProforma) {
        if (activeProforma.id !== undefined && activeProforma.id !== null) {
          result.invoiceId = String(activeProforma.id);
        }

        const rawNumber = activeProforma.fullnumber ?? activeProforma.number ?? null;
        if (rawNumber !== null && rawNumber !== undefined) {
          const normalizedNumber = typeof rawNumber === 'string'
            ? rawNumber.trim()
            : String(rawNumber).trim();
          if (normalizedNumber.length > 0) {
            result.invoiceNumber = normalizedNumber;
          }
        }

        result.found = true;
        result.source = result.source || 'repository';
      }
    }

    if (!result.invoiceNumber && invoiceNumberCandidates.length > 0) {
      const candidate = invoiceNumberCandidates[invoiceNumberCandidates.length - 1];
      if (candidate) {
        result.invoiceNumber = candidate;
        if (!result.found) {
          result.found = true;
          result.source = result.source || 'pipedrive_field';
        }
      }
    }

    if (result.found && result.invoiceId && !result.invoiceNumber && this.wfirmaLookup) {
      try {
        const wfirmaProforma = await this.wfirmaLookup.getFullProformaById(result.invoiceId);
        const fetchedNumber = typeof wfirmaProforma?.fullnumber === 'string'
          ? wfirmaProforma.fullnumber.trim()
          : null;

        if (fetchedNumber) {
          result.invoiceNumber = fetchedNumber;
          result.source = result.source || 'wfirma_lookup';
        }
      } catch (error) {
        logger.warn('Failed to fetch proforma from wFirma while checking duplicates', {
          dealId: deal.id,
          invoiceId: result.invoiceId,
          error: error.message
        });
      }
    }

    return result;
  }

  buildDeletionSnapshot(proforma = {}) {
    const toNumber = (value) => {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const num = Number(value);
      return Number.isFinite(num) ? num : null;
    };

    const issuedAt = proforma.issued_at || proforma.issuedAt || null;

    return {
      proformaNumber: proforma.fullnumber || proforma.number || null,
      currency: proforma.currency || null,
      total: toNumber(proforma.total),
      issuedAt,
      issuedMonth: typeof issuedAt === 'string' ? issuedAt.slice(0, 7) : null,
      buyer: {
        name: proforma.buyer_name || null,
        email: proforma.buyer_email || null,
        country: proforma.buyer_country || null,
        city: proforma.buyer_city || null,
        phone: proforma.buyer_phone || null
      },
      payments: {
        total: toNumber(proforma.payments_total),
        totalPln: toNumber(proforma.payments_total_pln),
        currencyExchange: toNumber(proforma.payments_currency_exchange),
        count: toNumber(proforma.payments_count)
      }
    };
  }

  computeRemainingInvoiceNumbers(rawValue, removedSet = new Set()) {
    if (!this.INVOICE_NUMBER_FIELD_KEY || rawValue === undefined) {
      return { changed: false, value: rawValue ?? null };
    }

    const normalizeValues = (list) =>
      list
        .map((value) => String(value).trim())
        .filter((value) => value.length > 0);

    if (Array.isArray(rawValue)) {
      const normalizedInput = normalizeValues(rawValue);
      const remaining = normalizedInput.filter((value) => !removedSet.has(this.normalizeInvoiceNumber(value)));
      const changed = remaining.length !== normalizedInput.length;
      return {
        changed,
        value: changed ? (remaining.length ? remaining : null) : rawValue
      };
    }

    if (rawValue === null) {
      return { changed: false, value: null };
    }

    const normalizedInput = normalizeValues(String(rawValue).split(/[\n,;]+/));
    const remaining = normalizedInput.filter((value) => !removedSet.has(this.normalizeInvoiceNumber(value)));

    if (remaining.length === normalizedInput.length) {
      return { changed: false, value: rawValue };
    }

    if (!remaining.length) {
      return { changed: true, value: null };
    }

    return {
      changed: true,
      value: remaining.join('\n')
    };
  }

  async clearDeleteTrigger(dealId, extraPayload = {}) {
    if (!this.DELETE_TRIGGER_FIELD_KEY && (!extraPayload || Object.keys(extraPayload).length === 0)) {
      return { success: true };
    }

    if (!dealId) {
      return { success: false, error: 'Deal id is required' };
    }

    const payload = {
      ...extraPayload
    };

    if (this.DELETE_TRIGGER_FIELD_KEY) {
      payload[`${this.DELETE_TRIGGER_FIELD_KEY}`] = null;
    }

    const payloadKeys = Object.keys(payload);
    if (payloadKeys.length === 0) {
      return { success: true };
    }

    const sanitizedPayload = payloadKeys.reduce((acc, key) => {
      if (payload[key] !== undefined) {
        acc[key] = payload[key];
      }
      return acc;
    }, {});

    if (Object.keys(sanitizedPayload).length === 0) {
      logger.warn('Attempted to clear delete trigger with empty payload', { dealId });
      return { success: true };
    }

    try {
      const updateResult = await this.pipedriveClient.updateDeal(dealId, sanitizedPayload);
      if (!updateResult.success) {
        return updateResult;
      }

      return { success: true };
    } catch (error) {
      logger.error('Failed to clear delete trigger in Pipedrive', {
        dealId,
        error: error.message
      });
      return { success: false, error: error.message };
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

        if (invoiceTypeValue === undefined || invoiceTypeValue === null) {
          return false;
        }

        const normalizedValue = String(invoiceTypeValue).trim().toLowerCase();

        // Пропускаем сделки, помеченные триггером на удаление
        if (this.DELETE_TRIGGER_VALUES.has(normalizedValue)) {
          return false;
        }

        if (normalizedValue.length === 0) {
          return false;
        }

        const invoiceTypeId = parseInt(normalizedValue, 10);

        if (Number.isNaN(invoiceTypeId)) {
          logger.warn(`Deal ${deal.id} has non-numeric invoice type value: ${invoiceTypeValue}`);
          return false;
        }

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
      
      // 2. Определяем тип счета из кастомного поля
      const invoiceType = this.getInvoiceTypeFromDeal(fullDeal);
      
      if (!invoiceType) {
        return {
          success: false,
          error: 'No invoice type specified in deal'
        };
      }
      
      // 3. Проверяем, что проформа еще не создана для этой сделки
      const existingProforma = await this.findExistingProformaForDeal(fullDeal);
      if (existingProforma?.found) {
        logger.warn('Proforma already exists for deal, skipping duplicate creation', {
          dealId: fullDeal.id,
          invoiceId: existingProforma.invoiceId || null,
          invoiceNumber: existingProforma.invoiceNumber || null,
          source: existingProforma.source || null
        });

        if (existingProforma.invoiceNumber) {
          await this.ensureInvoiceNumber(fullDeal, existingProforma.invoiceNumber, {
            attempts: 1,
            backoffBaseMs: 200
          });
        }

        const clearResult = await this.clearInvoiceTrigger(
          fullDeal.id,
          existingProforma.invoiceId || null
        );
        if (!clearResult.success) {
          logger.warn('Failed to clear invoice trigger while skipping duplicate creation', {
            dealId: fullDeal.id,
            invoiceId: existingProforma.invoiceId || null,
            error: clearResult.error
          });
        }

        return {
          success: true,
          skipped: true,
          invoiceType,
          invoiceId: existingProforma.invoiceId || null,
          invoiceNumber: existingProforma.invoiceNumber || null,
          message: 'Proforma already exists for this deal, skipping duplicate creation'
        };
      }
      
      // 4. Валидация данных сделки
      const validationResult = await this.validateDealForInvoice(fullDeal, fullPerson, fullOrganization);
      
      if (!validationResult.success) {
        return validationResult;
      }
      
      // 5. Извлекаем email клиента
      const email = this.getCustomerEmail(fullPerson, fullOrganization);
      if (!email) {
        return {
          success: false,
          error: 'Customer email is required for invoice creation'
        };
      }
      
      // 6. Подготавливаем данные контрагента
      const contractorData = this.prepareContractorData(fullPerson, fullOrganization, email);

      // 7. Ищем или создаем контрагента в wFirma
      const contractorResult = await this.userManagement.findOrCreateContractor(contractorData);
      if (!contractorResult.success) {
        return {
          success: false,
          error: `Failed to find or create contractor: ${contractorResult.error}`
        };
      }

      const contractor = contractorResult.contractor;
      logger.info(`Using contractor: ${contractor.name} (ID: ${contractor.id})`);

      // 8. Получаем продукты из сделки Pipedrive
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

      // 9. Создаем документ в wFirma с существующим контрагентом и продуктом
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
      
      const fallbackBuyerData = this.buildBuyerFallback(fullPerson, fullOrganization, contractor);
      logger.info('Prepared fallback buyer data for persistence', {
        dealId: fullDeal.id,
        invoiceId: invoiceResult.invoiceId,
        fallbackBuyer: fallbackBuyerData
      });

      await this.persistProformaToDatabase(invoiceResult.invoiceId, {
        invoiceNumber: invoiceResult.invoiceNumber,
        issueDate: new Date(),
        currency: deal.currency,
        totalAmount: invoiceResult.amount || parseFloat(deal.value) || 0,
        fallbackProduct: {
          name: product.name,
          price: product.price,
          count: product.quantity || product.count || 1,
          goodId: product.id || product.goodId || null
        },
        fallbackBuyer: fallbackBuyerData,
        dealId: fullDeal.id
      });

      const invoiceNumberForCrm = await this.determineInvoiceNumber(invoiceResult);
      if (invoiceNumberForCrm) {
        const syncResult = await this.ensureInvoiceNumber(fullDeal, invoiceNumberForCrm);
        if (!syncResult?.success && !syncResult?.skipped) {
          logger.error('Failed to sync invoice number to Pipedrive', {
            dealId: fullDeal.id,
            invoiceNumber: invoiceNumberForCrm,
            error: syncResult?.error || 'unknown error'
          });
        }
      } else {
        logger.warn('Unable to determine invoice number for CRM sync', {
          dealId: fullDeal.id,
          invoiceId: invoiceResult.invoiceId
        });
      }
      
      // 10. Отправляем Telegram уведомление через SendPulse (если SendPulse ID есть)
      let telegramResult = null;
      try {
        logger.info('Checking Telegram notification requirements:', {
          dealId: fullDeal.id,
          hasSendpulseClient: !!this.sendpulseClient,
          personId: fullPerson?.id
        });
        
        const sendpulseId = this.getSendpulseId(fullPerson);
        logger.info('SendPulse ID check result:', {
          dealId: fullDeal.id,
          sendpulseId: sendpulseId || 'NOT FOUND',
          personId: fullPerson?.id,
          personFields: fullPerson ? Object.keys(fullPerson) : []
        });
        
        if (sendpulseId) {
          const invoiceNumberForTelegram = invoiceResult.invoiceNumber || invoiceResult.invoiceId;
          
          // Получаем банковский счет для IBAN
          const bankAccountResult = await this.getBankAccountByCurrency(deal.currency);
          const bankAccount = bankAccountResult.success ? bankAccountResult.bankAccount : null;
          
          telegramResult = await this.sendTelegramNotification(
            sendpulseId,
            invoiceResult.invoiceId,
            invoiceNumberForTelegram,
            invoiceResult.paymentSchedule,
            bankAccount
          );
          
          if (!telegramResult.success) {
            logger.error('Telegram notification failed (non-critical):', {
              dealId: fullDeal.id,
              invoiceId: invoiceResult.invoiceId,
              error: telegramResult.error,
              details: telegramResult.details
            });
          } else {
            logger.info('Telegram notification sent successfully:', {
              dealId: fullDeal.id,
              invoiceId: invoiceResult.invoiceId,
              messageId: telegramResult.messageId
            });
          }
        } else {
          logger.info('Telegram Message ID not found in person, skipping Telegram notification', {
            dealId: fullDeal.id,
            personId: fullPerson?.id
          });
        }
      } catch (error) {
        logger.error('Error sending Telegram notification (non-critical):', {
          dealId: fullDeal.id,
          invoiceId: invoiceResult.invoiceId,
          error: error.message,
          stack: error.stack
        });
        // Не критичная ошибка - продолжаем процесс
      }
      
      // 11. Создаем задачи в Pipedrive для проверки платежей (если есть график платежей)
      let tasksResult = null;
      try {
        logger.info('Checking task creation requirements:', {
          dealId: fullDeal.id,
          hasPaymentSchedule: !!invoiceResult.paymentSchedule,
          paymentScheduleType: invoiceResult.paymentSchedule?.type,
          invoiceId: invoiceResult.invoiceId
        });
        
        if (invoiceResult.paymentSchedule) {
          const invoiceNumberForTasks = invoiceResult.invoiceNumber || invoiceResult.invoiceId;
          tasksResult = await this.createPaymentVerificationTasks(
            invoiceResult.paymentSchedule,
            invoiceNumberForTasks,
            fullDeal.id
          );
          
          if (!tasksResult.success || tasksResult.tasksFailed > 0) {
            logger.error('Payment verification tasks creation failed or partially failed (non-critical):', {
              dealId: fullDeal.id,
              invoiceId: invoiceResult.invoiceId,
              tasksCreated: tasksResult.tasksCreated,
              tasksFailed: tasksResult.tasksFailed,
              error: tasksResult.error,
              tasks: tasksResult.tasks
            });
          } else {
            logger.info('Payment verification tasks created successfully', {
              dealId: fullDeal.id,
              invoiceId: invoiceResult.invoiceId,
              tasksCreated: tasksResult.tasksCreated,
              tasks: tasksResult.tasks
            });
          }
        } else {
          logger.warn('Payment schedule not found in invoice result, skipping task creation', {
            dealId: fullDeal.id,
            invoiceId: invoiceResult.invoiceId,
            invoiceResultKeys: Object.keys(invoiceResult)
          });
        }
      } catch (error) {
        logger.error('Error creating payment verification tasks (non-critical):', {
          dealId: fullDeal.id,
          invoiceId: invoiceResult.invoiceId,
          error: error.message,
          stack: error.stack
        });
        // Не критичная ошибка - продолжаем процесс
      }
      
      // 12. Отправляем документ по email через wFirma API
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

      // 11. Создаем (если нужно) этикетку по названию сделки без дублирования
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
        invoiceNumber: invoiceResult.invoiceNumber,
        amount: invoiceResult.amount || fullDeal.value,
        currency: invoiceResult.currency || fullDeal.currency,
        contractorName: contractorData.name,
        dealId: fullDeal.id,
        tasks: tasksResult,
        telegramNotification: telegramResult,
        emailSent: emailResult?.success || false
      };

      // КРИТИЧНО: Снимаем триггер в CRM ТОЛЬКО после успешного создания проформы в wFirma
      // Проверяем еще раз, что invoiceId существует перед установкой "Done"
      if (invoiceResult.invoiceId) {
        logger.info(`Setting invoice type to "Done" for deal ${fullDeal.id} after successful invoice creation (ID: ${invoiceResult.invoiceId})`);
        const clearTriggerResult = await this.clearInvoiceTrigger(fullDeal.id, invoiceResult.invoiceId);
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

      // Создаем задачи на проверку оплат
      const activityResult = await this.createPaymentCheckActivity(fullDeal, contractor);
      if (!activityResult.success) {
        logger.warn('Failed to create payment check activity', {
          dealId: fullDeal.id,
          error: activityResult.error
        });
      }

      if (activityResult.success && activityResult.schedule?.secondPaymentDate) {
        const secondActivityResult = await this.createPaymentCheckActivity(
          fullDeal,
          contractor,
          activityResult.schedule.secondPaymentDate,
          'second'
        );

        if (!secondActivityResult.success) {
          logger.warn('Failed to create second payment check activity', {
            dealId: fullDeal.id,
            error: secondActivityResult.error
          });
        }
      }

      if (activityResult.success && activityResult.schedule?.secondPaymentDate) {
        const secondActivityResult = await this.createPaymentCheckActivity(
          fullDeal,
          contractor,
          activityResult.schedule.secondPaymentDate,
          'second'
        );

        if (!secondActivityResult.success) {
          logger.warn('Failed to create second payment check activity', {
            dealId: fullDeal.id,
            error: secondActivityResult.error
          });
        }
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
   * Создать активность на проверку оплаты
   * @param {Object} deal - Данные сделки
   * @param {Object} contractor - Контрагент wFirma
   * @returns {Promise<Object>} - Результат создания активности
   */
  async createPaymentCheckActivity(deal, contractor, customDueDate = null, activitySuffix = 'first') {
    try {
      if (!deal || !deal.id) {
        return { success: false, error: 'Deal data missing' };
      }

      const personId = deal.person_id?.value || deal.person_id || null;
      const contractorName = contractor?.name || deal.person_name || 'Контрагент';

      const dueDate = customDueDate
        ? new Date(customDueDate)
        : new Date();

      if (!customDueDate) {
        dueDate.setDate(dueDate.getDate() + this.PAYMENT_TERMS_DAYS);
      }

      const dueDateStr = dueDate.toISOString().split('T')[0];

      let secondPaymentDateStr = null;
      if (activitySuffix === 'first' && !customDueDate && deal.expected_close_date) {
        try {
          const expectedCloseDate = new Date(deal.expected_close_date);
          const balanceDueDate = new Date(expectedCloseDate);
          balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);

          if (balanceDueDate > dueDate) {
            secondPaymentDateStr = balanceDueDate.toISOString().split('T')[0];
          }
        } catch (error) {
          logger.warn('Failed to compute second payment date for activity', {
            dealId: deal.id,
            expectedCloseDate: deal.expected_close_date,
            error: error.message
          });
        }
      }

      const subject = activitySuffix === 'second'
        ? `Проверить вторую оплату ${contractorName}`
        : `Проверить оплату ${contractorName}`;

      const activityData = {
        subject,
        type: 'task',
        deal_id: deal.id,
        person_id: personId,
        due_date: dueDateStr,
        public_description: 'Проверить поступление оплаты по созданной проформе',
        note: activitySuffix === 'second'
          ? `Второй платеж по проформе. Проверить поступление оплаты до ${dueDateStr}.`
          : `Проформа: ${deal.title || ''}. Проверить поступление оплаты до ${dueDateStr}.`
      };

      const result = await this.pipedriveClient.createActivity(activityData);

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to create activity in Pipedrive'
        };
      }

      const logLabel = activitySuffix === 'second' ? 'Second payment check activity created' : 'Payment check activity created';
      logger.info(logLabel, {
        dealId: deal.id,
        activityId: result.activity?.id,
        dueDate: dueDateStr,
        type: activitySuffix,
        secondPaymentDate: secondPaymentDateStr || null
      });

      return {
        success: true,
        activity: result.activity,
        schedule: activitySuffix === 'first'
          ? {
              dueDate: dueDateStr,
              secondPaymentDate: secondPaymentDateStr
            }
          : undefined
      };
    } catch (error) {
      logger.error('Error creating payment check activity:', error);
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
  async clearInvoiceTrigger(dealId, invoiceId = null) {
    try {
      const payload = {
        [`${this.INVOICE_TYPE_FIELD_KEY}`]: this.INVOICE_DONE_VALUE
      };

      if (this.WFIRMA_INVOICE_ID_FIELD_KEY && invoiceId) {
        payload[this.WFIRMA_INVOICE_ID_FIELD_KEY] = String(invoiceId);
      }

      const updateResult = await this.pipedriveClient.updateDeal(dealId, payload);

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

  async determineInvoiceNumber(invoiceResult) {
    if (!invoiceResult) {
      return null;
    }

    const directNumber = typeof invoiceResult.invoiceNumber === 'string'
      ? invoiceResult.invoiceNumber.trim()
      : null;

    if (directNumber && directNumber.length > 0) {
      return directNumber;
    }

    const invoiceId = invoiceResult.invoiceId;
    if (!invoiceId) {
      return null;
    }

    if (!this.wfirmaLookup) {
      logger.warn('Cannot fetch proforma fullnumber from wFirma: lookup service is not available.', {
        invoiceId
      });
      return null;
    }

    try {
      const fullProforma = await this.wfirmaLookup.getFullProformaById(invoiceId);
      const fetchedNumber = typeof fullProforma?.fullnumber === 'string'
        ? fullProforma.fullnumber.trim()
        : null;

      if (!fetchedNumber) {
        logger.warn('Full proforma fetched but fullnumber is missing', { invoiceId });
      }

      return fetchedNumber;
    } catch (error) {
      logger.warn('Failed to fetch proforma from wFirma while resolving invoice number', {
        invoiceId,
        error: error.message
      });
      return null;
    }
  }

  async ensureInvoiceNumber(deal, invoiceNumber, options = {}) {
    if (!deal || !deal.id) {
      logger.warn('Cannot sync invoice number: deal information is missing.', {
        invoiceNumber
      });
      return { success: false, skipped: true, reason: 'missing_deal' };
    }

    const normalizedInvoiceNumber = typeof invoiceNumber === 'string'
      ? invoiceNumber.trim()
      : '';

    if (!normalizedInvoiceNumber) {
      logger.warn('Cannot sync invoice number: value is empty.', {
        dealId: deal.id
      });
      return { success: false, skipped: true, reason: 'empty_invoice_number' };
    }

    try {
      const result = await this.syncInvoiceNumber(
        deal.id,
        normalizedInvoiceNumber,
        deal[this.INVOICE_NUMBER_FIELD_KEY],
        options
      );

      if (result.success && !result.skipped) {
        deal[this.INVOICE_NUMBER_FIELD_KEY] = normalizedInvoiceNumber;
      }

      return result;
    } catch (error) {
      logger.error('Failed to sync invoice number in Pipedrive', {
        dealId: deal.id,
        invoiceNumber: normalizedInvoiceNumber,
        error: error.message
      });
      return { success: false, skipped: false, error: error.message };
    }
  }

  async syncInvoiceNumber(dealId, invoiceNumber, currentValue = null, options = {}) {
    if (!dealId) {
      logger.warn('Cannot sync invoice number: dealId is missing.', {
        invoiceNumber
      });
      return { success: false, skipped: true, reason: 'missing_deal_id' };
    }

    const normalizedInvoiceNumber = typeof invoiceNumber === 'string'
      ? invoiceNumber.trim()
      : '';

    if (!normalizedInvoiceNumber) {
      logger.warn('Cannot sync invoice number: value is empty.', {
        dealId
      });
      return { success: false, skipped: true, reason: 'empty_invoice_number' };
    }

    const currentNormalized = typeof currentValue === 'string'
      ? currentValue.trim()
      : null;

    if (currentNormalized && currentNormalized === normalizedInvoiceNumber) {
      logger.info('Invoice number already synchronized in Pipedrive', {
        dealId,
        invoiceNumber: normalizedInvoiceNumber
      });
      return { success: true, skipped: true, reason: 'already_synced' };
    }

    const attempts = Number.isFinite(options.attempts)
      ? Math.max(1, Number(options.attempts))
      : 3;
    const backoffBaseMs = Number.isFinite(options.backoffBaseMs)
      ? Math.max(50, Number(options.backoffBaseMs))
      : 300;

    const payload = {
      [this.INVOICE_NUMBER_FIELD_KEY]: normalizedInvoiceNumber.slice(0, 255)
    };

    let attempt = 0;
    let lastError = null;

    while (attempt < attempts) {
      attempt += 1;
      try {
        const result = await this.pipedriveClient.updateDeal(dealId, payload);
        if (!result.success) {
          throw new Error(result.error || 'Pipedrive update failed');
        }

        logger.info('Invoice number synced to Pipedrive', {
          dealId,
          invoiceNumber: normalizedInvoiceNumber,
          attempts: attempt
        });

        return { success: true, skipped: false };
      } catch (error) {
        lastError = error;
        logger.warn('Attempt to sync invoice number in Pipedrive failed', {
          dealId,
          invoiceNumber: normalizedInvoiceNumber,
          attempt,
          attempts,
          error: error.message
        });

        if (attempt < attempts) {
          const delay = backoffBaseMs * attempt;
          await sleep(delay);
        }
      }
    }

    logger.error('Failed to sync invoice number to Pipedrive after retries', {
      dealId,
      invoiceNumber: normalizedInvoiceNumber,
      attempts,
      error: lastError?.message
    });

    throw lastError || new Error('Failed to sync invoice number to Pipedrive');
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
   * Получить SendPulse ID из персоны
   * @param {Object} person - Данные персоны
   * @returns {string|null} - SendPulse ID или null
   */
  getSendpulseId(person) {
    if (!person) {
      return null;
    }

    const sendpulseId = person[this.SENDPULSE_ID_FIELD_KEY];
    
    if (!sendpulseId || String(sendpulseId).trim() === '') {
      return null;
    }

    return String(sendpulseId).trim();
  }

  /**
   * Определить количество задач для создания на основе графика платежей
   * @param {Object} paymentSchedule - График платежей
   * @returns {number} - Количество задач (1 или 2)
   */
  determineTaskCount(paymentSchedule) {
    if (!paymentSchedule || !paymentSchedule.type) {
      return 0;
    }

    // Если график 50/50, всегда создаем 2 задачи
    if (paymentSchedule.type === '50/50' && paymentSchedule.secondPaymentDate) {
      logger.info('Determining task count for 50/50 schedule', {
        firstPaymentDate: paymentSchedule.firstPaymentDate,
        secondPaymentDate: paymentSchedule.secondPaymentDate,
        type: paymentSchedule.type
      });
      return 2;
    }

    // Для графика 100% создаем 1 задачу
    return 1;
  }

  /**
   * Сгенерировать параметры задач на основе графика платежей
   * @param {Object} paymentSchedule - График платежей
   * @param {string} invoiceNumber - Номер проформы
   * @param {number} dealId - ID сделки
   * @returns {Array<Object>} - Массив параметров задач
   */
  generateTaskParams(paymentSchedule, invoiceNumber, dealId) {
    const tasks = [];
    const taskCount = this.determineTaskCount(paymentSchedule);

    if (taskCount === 0) {
      return tasks;
    }

    if (taskCount === 2 && paymentSchedule.type === '50/50') {
      // Создаем две задачи для графика 50/50
      const formatAmount = (amount) => amount.toFixed(2);
      
      // Первая задача: проверка предоплаты (50%)
      // firstPaymentDate уже содержит paymentDateStr (issueDate + 3 дня), поэтому используем его напрямую
      // Добавляем еще PAYMENT_TERMS_DAYS дней для проверки предоплаты
      const firstPaymentCheckDate = new Date(paymentSchedule.firstPaymentDate);
      firstPaymentCheckDate.setDate(firstPaymentCheckDate.getDate() + this.PAYMENT_TERMS_DAYS);
      const firstPaymentCheckDateStr = firstPaymentCheckDate.toISOString().split('T')[0];
      
      tasks.push({
        deal_id: dealId,
        subject: 'Проверка предоплаты',
        note: `Проверьте получение предоплаты 50% (${formatAmount(paymentSchedule.firstPaymentAmount)} ${paymentSchedule.currency}) по инвойсу ${invoiceNumber}.`,
        due_date: firstPaymentCheckDateStr,
        type: 'task'
      });

      // Вторая задача: проверка остатка (50%)
      tasks.push({
        deal_id: dealId,
        subject: 'Проверка остатка',
        note: `Проверьте получение остатка 50% (${formatAmount(paymentSchedule.secondPaymentAmount)} ${paymentSchedule.currency}) по инвойсу ${invoiceNumber}.`,
        due_date: paymentSchedule.secondPaymentDate,
        type: 'task'
      });
    } else {
      // Создаем одну задачу для графика 100%
      const formatAmount = (amount) => amount.toFixed(2);
      const paymentDate = paymentSchedule.singlePaymentDate || paymentSchedule.firstPaymentDate;
      const paymentAmount = paymentSchedule.singlePaymentAmount || paymentSchedule.totalAmount;
      
      tasks.push({
        deal_id: dealId,
        subject: 'Проверка платежа',
        note: `Проверьте получение полной оплаты (${formatAmount(paymentAmount)} ${paymentSchedule.currency}) по инвойсу ${invoiceNumber}.`,
        due_date: paymentDate,
        type: 'task'
      });
    }

    return tasks;
  }

  /**
   * Создать задачи в Pipedrive для проверки платежей
   * @param {Object} paymentSchedule - График платежей
   * @param {string} invoiceNumber - Номер проформы
   * @param {number} dealId - ID сделки
   * @returns {Promise<Object>} - Результат создания задач
   */
  async createPaymentVerificationTasks(paymentSchedule, invoiceNumber, dealId) {
    if (!paymentSchedule || !invoiceNumber || !dealId) {
      logger.warn('Cannot create payment verification tasks: missing required parameters', {
        hasPaymentSchedule: !!paymentSchedule,
        hasInvoiceNumber: !!invoiceNumber,
        hasDealId: !!dealId
      });
      return {
        success: false,
        error: 'Missing required parameters for task creation'
      };
    }

    try {
      const taskParams = this.generateTaskParams(paymentSchedule, invoiceNumber, dealId);
      
      if (taskParams.length === 0) {
        logger.info('No tasks to create for payment verification', {
          dealId,
          invoiceNumber,
          paymentScheduleType: paymentSchedule.type
        });
        return {
          success: true,
          tasksCreated: 0,
          message: 'No tasks to create'
        };
      }

      const results = [];
      for (const taskParam of taskParams) {
        const result = await this.pipedriveClient.createTask(taskParam);
        if (result.success) {
          results.push({
            success: true,
            taskId: result.task.id,
            subject: taskParam.subject,
            dueDate: taskParam.due_date
          });
          logger.info('Payment verification task created successfully', {
            dealId,
            invoiceNumber,
            taskId: result.task.id,
            subject: taskParam.subject,
            dueDate: taskParam.due_date
          });
        } else {
          results.push({
            success: false,
            error: result.error,
            subject: taskParam.subject
          });
          logger.warn('Failed to create payment verification task', {
            dealId,
            invoiceNumber,
            subject: taskParam.subject,
            error: result.error
          });
        }
      }

      const successfulTasks = results.filter(r => r.success).length;
      const failedTasks = results.filter(r => !r.success).length;

      return {
        success: successfulTasks > 0,
        tasksCreated: successfulTasks,
        tasksFailed: failedTasks,
        tasks: results,
        message: `Created ${successfulTasks} of ${taskParams.length} tasks`
      };
    } catch (error) {
      logger.error('Error creating payment verification tasks', {
        dealId,
        invoiceNumber,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Отправить Telegram уведомление через SendPulse
   * @param {string} sendpulseId - SendPulse ID контакта
   * @param {string} invoiceId - ID проформы в wFirma
   * @param {string} invoiceNumber - Номер проформы (PRO-...)
   * @param {Object} paymentSchedule - График платежей
   * @param {Object} bankAccount - Банковский счет с IBAN
   * @returns {Promise<Object>} - Результат отправки
   */
  async sendTelegramNotification(sendpulseId, invoiceId, invoiceNumber, paymentSchedule, bankAccount) {
    if (!this.sendpulseClient) {
      logger.warn('SendPulse client not initialized, skipping Telegram notification');
      return {
        success: false,
        error: 'SendPulse client not initialized'
      };
    }

    if (!sendpulseId) {
      logger.warn('SendPulse ID is missing, skipping Telegram notification');
      return {
        success: false,
        error: 'SendPulse ID is missing'
      };
    }

    try {
      const invoiceNumberForMessage = invoiceNumber || invoiceId;

      // Базовая часть сообщения
      let message = `Привет! Тебе был отправлен инвойс на почту.\n\n` +
                    `Обязательно укажи номер инвойса в назначении платежа: ${invoiceNumberForMessage}\n\n`;

      message += 'Твой график платежей:\n';
      
      // Добавляем график платежей
      if (paymentSchedule && paymentSchedule.type) {
        message += '\n';
        
        const formatAmount = (amount) => parseFloat(amount).toFixed(2);
        const formatDate = (dateStr) => {
          if (!dateStr) return '';
          const date = new Date(dateStr);
          return date.toISOString().split('T')[0];
        };
        
        if (paymentSchedule.type === '50/50') {
          // График 50/50
          message += `• Предоплата 50%: ${formatAmount(paymentSchedule.firstPaymentAmount)} ${paymentSchedule.currency} до ${formatDate(paymentSchedule.firstPaymentDate)}\n`;
          if (paymentSchedule.secondPaymentDate && paymentSchedule.secondPaymentAmount) {
            message += `• Остаток 50%: ${formatAmount(paymentSchedule.secondPaymentAmount)} ${paymentSchedule.currency} до ${formatDate(paymentSchedule.secondPaymentDate)}\n`;
          }
        } else {
          // График 100%
          const paymentDate = paymentSchedule.singlePaymentDate || paymentSchedule.firstPaymentDate;
          const paymentAmount = paymentSchedule.singlePaymentAmount || paymentSchedule.totalAmount;
          message += `• Полная оплата: ${formatAmount(paymentAmount)} ${paymentSchedule.currency} до ${formatDate(paymentDate)}\n`;
        }
        
        message += `Итого: ${formatAmount(paymentSchedule.totalAmount)} ${paymentSchedule.currency}\n`;
      } else {
        message += '\n• Детали графика в письме с инвойсом.\n';
      }
      
      // Добавляем IBAN
      if (bankAccount && bankAccount.number) {
        message += `\nРеквизиты для оплаты:\n\n` +
                   `${bankAccount.number}`;
      }
      
      const result = await this.sendpulseClient.sendTelegramMessage(sendpulseId, message);

      if (result.success) {
        logger.info('SendPulse Telegram notification sent successfully', {
          sendpulseId,
          invoiceId,
          invoiceNumber,
          messageId: result.messageId
        });
      } else {
        logger.warn('Failed to send SendPulse Telegram notification', {
          sendpulseId,
          invoiceId,
          error: result.error
        });
      }

      return result;
    } catch (error) {
      logger.error('Error sending SendPulse Telegram notification', {
        sendpulseId,
        invoiceId,
        error: error.message
      });
      return {
        success: false,
        error: error.message
      };
    }
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

  buildBuyerFallback(person, organization, contractor) {
    const normalizeString = (value) => {
      if (!value) return null;
      const trimmed = String(value).trim();
      return trimmed.length ? trimmed : null;
    };

    const pickEmail = () => {
      if (person?.primary_email) {
        return normalizeString(person.primary_email);
      }
      const personEmail = person?.email?.[0]?.value;
      if (personEmail) {
        return normalizeString(personEmail);
      }
      if (organization?.primary_email) {
        return normalizeString(organization.primary_email);
      }
      const orgEmail = organization?.email?.[0]?.value;
      if (orgEmail) {
        return normalizeString(orgEmail);
      }
      return normalizeString(contractor?.email);
    };

    const pickPhone = () => {
      const personPhone = person?.phone?.[0]?.value;
      if (personPhone) {
        return normalizeString(personPhone);
      }
      const orgPhone = organization?.phone?.[0]?.value;
      if (orgPhone) {
        return normalizeString(orgPhone);
      }
      return normalizeString(contractor?.phone);
    };

    const pickName = () => {
      if (organization?.name) {
        return normalizeString(organization.name);
      }
      if (person?.name) {
        return normalizeString(person.name);
      }
      if (person?.first_name || person?.last_name) {
        return normalizeString(`${person.first_name || ''} ${person.last_name || ''}`.trim());
      }
      return normalizeString(contractor?.name);
    };

    const street = normalizeString(
      organization?.address ||
      person?.postal_address ||
      person?.postal_address_route
    );

    const zip = normalizeString(
      organization?.postal_code ||
      person?.postal_address_postal_code
    );

    const city = normalizeString(
      organization?.city ||
      person?.postal_address_locality
    );

    const countryRaw = normalizeString(
      organization?.country ||
      person?.postal_address_country ||
      contractor?.country
    );

    const country = countryRaw ? this.normalizeCountryCode(countryRaw) : null;

    const taxId = normalizeString(
      organization?.value?.tax_id ||
      organization?.tax_id ||
      contractor?.taxId
    );

    const result = {
      name: pickName(),
      altName: normalizeString(contractor?.name),
      email: pickEmail(),
      phone: pickPhone(),
      street,
      zip,
      city,
      country,
      taxId
    };

    // Remove null/undefined to keep payload compact
    return Object.fromEntries(
      Object.entries(result).filter(([, value]) => value !== null && value !== undefined)
    );
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
        paymentSchedule: invoiceResult.paymentSchedule,
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

      // Определяем график платежей на основе разницы между сегодняшней датой и expected_close_date
      let secondPaymentDateStr = paymentDateStr;
      let use50_50Schedule = false;
      
      if (deal.expected_close_date) {
        try {
          logger.info('Processing expected_close_date for payment schedule', {
            dealId: deal.id,
            expectedCloseDate: deal.expected_close_date,
            issueDateStr: issueDateStr
          });
          
          const expectedCloseDate = new Date(deal.expected_close_date);
          const today = new Date(issueDateStr);
          
          // Рассчитываем разницу в днях между сегодняшней датой и expected_close_date
          const daysDiff = Math.ceil((expectedCloseDate - today) / (1000 * 60 * 60 * 24));
          
          logger.info('Payment schedule calculation', {
            dealId: deal.id,
            expectedCloseDate: expectedCloseDate.toISOString().split('T')[0],
            today: today.toISOString().split('T')[0],
            daysDiff: daysDiff,
            use50_50Schedule: daysDiff >= 30
          });
          
          // Если разница >= 30 дней (месяц), используем график 50/50
          if (daysDiff >= 30) {
            use50_50Schedule = true;
            // Вторая дата платежа - за 1 месяц до expected_close_date
            const balanceDueDate = new Date(expectedCloseDate);
            balanceDueDate.setMonth(balanceDueDate.getMonth() - 1);
            secondPaymentDateStr = balanceDueDate.toISOString().split('T')[0];
            
            logger.info('Using 50/50 payment schedule', {
              dealId: deal.id,
              daysDiff: daysDiff,
              secondPaymentDateStr: secondPaymentDateStr,
              paymentDateStr: paymentDateStr
            });
          } else {
            // Если разница < 30 дней, используем график 100%
            logger.info('Using 100% payment schedule (daysDiff < 30)', {
              dealId: deal.id,
              daysDiff: daysDiff
            });
          }
        } catch (error) {
          logger.warn('Failed to calculate payment schedule from expected close date', {
            dealId: deal.id,
            expectedCloseDate: deal.expected_close_date,
            error: error.message
          });
        }
      } else {
        logger.info('No expected_close_date in deal, using 100% payment schedule', {
          dealId: deal.id
        });
      }

      let scheduleDescription;
      if (use50_50Schedule && secondPaymentDateStr && secondPaymentDateStr !== paymentDateStr) {
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
      logger.debug('XML payload prepared for wFirma');

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
            
            // Подготавливаем информацию о графике платежей
            const paymentSchedule = {
              type: use50_50Schedule ? '50/50' : '100%',
              currency: deal.currency,
              totalAmount: totalAmount,
              // Для графика 50/50 первый платеж должен быть на paymentDateStr (issueDate + 3 дня)
              // Для графика 100% используем paymentDateStr как singlePaymentDate
              firstPaymentDate: use50_50Schedule ? paymentDateStr : issueDateStr,
              firstPaymentAmount: use50_50Schedule ? depositAmount : totalAmount,
              secondPaymentDate: use50_50Schedule ? secondPaymentDateStr : null,
              secondPaymentAmount: use50_50Schedule ? balanceAmount : null,
              singlePaymentDate: use50_50Schedule ? null : paymentDateStr,
              singlePaymentAmount: use50_50Schedule ? null : totalAmount
            };
            
            return {
              success: true,
              invoice: response.data.invoice || response.data,
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber,
              paymentSchedule: paymentSchedule,
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
            
            // Подготавливаем информацию о графике платежей
            const paymentSchedule = {
              type: use50_50Schedule ? '50/50' : '100%',
              currency: deal.currency,
              totalAmount: totalAmount,
              // Для графика 50/50 первый платеж должен быть на paymentDateStr (issueDate + 3 дня)
              // Для графика 100% используем paymentDateStr как singlePaymentDate
              firstPaymentDate: use50_50Schedule ? paymentDateStr : issueDateStr,
              firstPaymentAmount: use50_50Schedule ? depositAmount : totalAmount,
              secondPaymentDate: use50_50Schedule ? secondPaymentDateStr : null,
              secondPaymentAmount: use50_50Schedule ? balanceAmount : null,
              singlePaymentDate: use50_50Schedule ? null : paymentDateStr,
              singlePaymentAmount: use50_50Schedule ? null : totalAmount
            };
            
            return {
              success: true,
              message: 'Proforma invoice created successfully',
              invoiceId: invoiceId,
              invoiceNumber: invoiceNumber,
              paymentSchedule: paymentSchedule,
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

  async persistProformaToDatabase(invoiceId, options = {}) {
    if (!this.proformaRepository || !this.proformaRepository.isEnabled()) {
      logger.debug('Supabase not configured, skipping proforma persistence');
      return;
    }

    if (!invoiceId) {
      logger.warn('Cannot persist proforma without invoiceId');
      return;
    }

    const {
      invoiceNumber = null,
      issueDate = new Date(),
      currency = 'PLN',
      totalAmount = null,
      fallbackProduct = null,
      fallbackBuyer = null,
      dealId = null
    } = options;

    let proforma = null;

    if (this.wfirmaLookup) {
      for (let attempt = 1; attempt <= 3 && !proforma; attempt++) {
        try {
          proforma = await this.wfirmaLookup.getFullProformaById(invoiceId);
        } catch (error) {
          logger.warn(`Attempt ${attempt} to fetch proforma ${invoiceId} failed: ${error.message}`);
        }

        if (!proforma) {
          await sleep(300 * attempt);
        }
      }
    } else {
      logger.warn('WfirmaLookup not available, using fallback data for proforma persistence');
    }

    if (!proforma) {
      logger.warn(`Falling back to local data for proforma ${invoiceId}`);
      proforma = {
        id: invoiceId,
        fullnumber: invoiceNumber,
        date: issueDate,
        currency,
        total: totalAmount,
        currencyExchange: null,
        paymentsTotal: 0,
        paymentsTotalPln: 0,
        paymentsCurrencyExchange: null,
        paymentsCount: 0,
        products: [],
        buyer: fallbackBuyer || null
      };
    }

    const fallbackName = fallbackProduct?.name && String(fallbackProduct.name).trim().length
      ? String(fallbackProduct.name).trim()
      : 'Без названия';

    let products = Array.isArray(proforma.products) ? proforma.products : [];

    if (!products.length && fallbackProduct) {
      products = [fallbackProduct];
    }

    const parseNumber = (value) => {
      if (!this.proformaRepository) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return this.proformaRepository.toNumber(value);
    };

    const sanitizedProducts = products.map((product, index) => {
      const rawName = product?.name && String(product.name).trim().length > 0
        ? String(product.name).trim()
        : fallbackName;
      const sanitizedName = rawName && rawName.length > 0 ? rawName : `Без названия ${index + 1}`;

      const quantityValue = parseNumber(product.count ?? product.quantity ?? 0);
      const quantity = Number.isFinite(quantityValue) && quantityValue !== 0 ? quantityValue : 1;

      const unitPriceValue = parseNumber(product.price ?? product.unit_price);
      const unitPrice = Number.isFinite(unitPriceValue) ? unitPriceValue : 0;

      const lineTotalValue = parseNumber(product.line_total);
      const lineTotal = Number.isFinite(lineTotalValue) ? lineTotalValue : unitPrice * quantity;

      return {
        name: sanitizedName,
        price: unitPrice,
        unit_price: unitPrice,
        count: quantity,
        quantity,
        line_total: lineTotal,
        goodId: product.goodId || product.good_id || null,
        productId: product.productId || product.id || null
      };
    });

    const effectiveDealId = dealId ?? proforma.pipedriveDealId ?? proforma.dealId ?? proforma.pipedrive_deal_id ?? null;

    const toCleanString = (value) => {
      if (value === null || value === undefined) {
        return null;
      }

      if (typeof value === 'string' || typeof value === 'number') {
        const trimmed = String(value).trim();
        return trimmed.length ? trimmed : null;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          const candidate = toCleanString(item);
          if (candidate) {
            return candidate;
          }
        }
        return null;
      }

      if (typeof value === 'object') {
        const preferredKeys = ['value', 'text', '_text', '#text', '$'];
        for (const key of preferredKeys) {
          if (key in value) {
            const candidate = toCleanString(value[key]);
            if (candidate) {
              return candidate;
            }
          }
        }

        // some wFirma responses use { name: '...', value: '...' }
        if (Object.keys(value).length === 1 && 'name' in value) {
          return toCleanString(value.name);
        }
      }

      return null;
    };

    const extractBuyerFields = (source) => {
      if (!source || typeof source !== 'object') {
        return {};
      }

      const result = {};

      const trySet = (targetKey, ...candidateKeys) => {
        for (const candidateKey of candidateKeys) {
          if (candidateKey in source) {
            const value = toCleanString(source[candidateKey]);
            if (value) {
              result[targetKey] = targetKey === 'country'
                ? this.normalizeCountryCode(value)
                : value;
              return;
            }
          }
        }
      };

      trySet('name', 'name', 'fullName', 'full_name', 'buyer_name');
      trySet('altName', 'altName', 'alt_name', 'buyer_alt_name');
      trySet('email', 'email', 'buyer_email');
      trySet('phone', 'phone', 'telephone', 'mobile', 'mobile_phone', 'buyer_phone');
      trySet('street', 'street', 'address', 'address_line', 'address_line1', 'address_line_1', 'buyer_street', 'postal_address');
      trySet('zip', 'zip', 'postal_code', 'postcode', 'postalCode', 'buyer_zip', 'postal_address_postal_code');
      trySet('city', 'city', 'locality', 'town', 'buyer_city', 'postal_address_locality');
      trySet('country', 'country', 'country_code', 'buyer_country', 'postal_address_country');
      trySet('taxId', 'taxId', 'tax_id', 'nip', 'buyer_tax_id');

      if (!result.street) {
        const fallbackStreet = toCleanString(source.postal_address || source.billing_address || source.address1);
        if (fallbackStreet) {
          result.street = fallbackStreet;
        }
      }

      if (!result.zip) {
        const fallbackZip = toCleanString(source.zip_code || source.postcode || source.postal);
        if (fallbackZip) {
          result.zip = fallbackZip;
        }
      }

      if (!result.city) {
        const fallbackCity = toCleanString(source.postal_address_city || source.city_name);
        if (fallbackCity) {
          result.city = fallbackCity;
        }
      }

      if (!result.country && source.country) {
        const countryValue = toCleanString(source.country);
        if (countryValue) {
          result.country = this.normalizeCountryCode(countryValue);
        }
      }

      return result;
    };

    const buyerFromProforma = extractBuyerFields(
      proforma.buyer && typeof proforma.buyer === 'object'
        ? proforma.buyer
        : {}
    );

    const fallbackBuyerSanitized = extractBuyerFields(
      fallbackBuyer && typeof fallbackBuyer === 'object'
        ? fallbackBuyer
        : {}
    );

    const mergedBuyer = { ...fallbackBuyerSanitized };

    for (const [key, value] of Object.entries(buyerFromProforma)) {
      if (value && (typeof value !== 'string' || value.trim().length > 0)) {
        mergedBuyer[key] = value;
      }
    }

    const finalBuyer = Object.keys(mergedBuyer).length ? mergedBuyer : null;

    const repositoryPayload = {
      id: proforma.id || invoiceId,
      fullnumber: proforma.fullnumber || invoiceNumber || null,
      date: proforma.date || issueDate,
      currency: proforma.currency || currency || 'PLN',
      total: proforma.total ?? totalAmount ?? 0,
      currencyExchange: proforma.currencyExchange ?? null,
      paymentsTotal: proforma.paymentsTotal ?? proforma.payments_total ?? 0,
      paymentsTotalPln: proforma.paymentsTotalPln ?? proforma.payments_total_pln ?? null,
      paymentsCurrencyExchange: proforma.paymentsCurrencyExchange ?? proforma.payments_currency_exchange ?? null,
      paymentsCount: proforma.paymentsCount ?? proforma.payments_count ?? 0,
      products: sanitizedProducts,
      buyer: finalBuyer,
      pipedriveDealId: effectiveDealId !== null && effectiveDealId !== undefined
        ? String(effectiveDealId).trim()
        : undefined
    };

    try {
      await this.proformaRepository.upsertProforma(repositoryPayload);
    } catch (error) {
      logger.error('Failed to persist proforma into Supabase:', {
        invoiceId,
        error: error.message
      });
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
