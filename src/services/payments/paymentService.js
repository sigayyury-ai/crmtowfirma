const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const { parseBankStatement } = require('./bankStatementParser');
const ProformaRepository = require('../proformaRepository');
const { normalizeName, normalizeWhitespace } = require('../../utils/normalize');
const ExpenseCategoryMappingService = require('../pnl/expenseCategoryMappingService');
const CrmStatusAutomationService = require('../crm/statusAutomationService');
const paymentBackupService = require('./paymentBackupService');
const { getRate } = require('../stripe/exchangeRateService');
const { getEffectiveVatFlow } = require('../pnl/vatFlowHelper');

const AMOUNT_TOLERANCE = 5; // PLN/EUR tolerance
const MANUAL_STATUS_APPROVED = 'approved';
const MANUAL_STATUS_REJECTED = 'rejected';
const PAYMENT_SOURCE_BANK = 'bank_statement';

class PaymentService {
  constructor(options = {}) {
    this.proformaRepository = new ProformaRepository();
    this.expenseMappingService = new ExpenseCategoryMappingService();
    this.crmStatusAutomationService =
      options.crmStatusAutomationService || new CrmStatusAutomationService();
  }

  /**
   * Check if payment is an internal transfer (PRZELEW WŁASNY)
   * Internal transfers should be excluded from processing and matching
   * @param {Object} payment - Payment record with description and payer_name
   * @returns {boolean} - True if payment is an internal transfer
   */
  isInternalTransfer(payment) {
    const description = (payment.description || '').toUpperCase();
    const payerName = (payment.payer_name || payment.payer || '').toUpperCase();
    
    // Check for "PRZELEW WŁASNY" (own transfer) in description
    if (description.includes('PRZELEW WŁASNY') || description.includes('PRZELEW WLASNY')) {
      return true;
    }
    
    // Check if payer is our own company (internal transfer/conversion)
    if (payerName.includes('COMOON SPÓŁKA') || payerName.includes('COMOON SPOLKA')) {
      return true;
    }
    
    return false;
  }

  async updateProformaPaymentAggregates(proformaId) {
    if (!supabase || !proformaId) {
      return;
    }

    const targetId = String(proformaId);

    const { data: paymentRows, error: paymentsError } = await supabase
      .from('payments')
      .select('amount, currency')
      .eq('manual_status', MANUAL_STATUS_APPROVED)
      .eq('manual_proforma_id', targetId);

    if (paymentsError) {
      logger.error('Supabase error while aggregating proforma payments:', paymentsError);
      return;
    }

    const totalsByCurrency = {};
    let paymentsCount = 0;

    (paymentRows || []).forEach((row) => {
      const amount = Number(row.amount);
      if (!Number.isFinite(amount)) {
        return;
      }
      const currency = row.currency || 'PLN';
      totalsByCurrency[currency] = (totalsByCurrency[currency] || 0) + amount;
      paymentsCount += 1;
    });

    const { data: proforma, error: proformaError } = await supabase
      .from('proformas')
      .select('id, currency, currency_exchange, pipedrive_deal_id')
      .eq('id', targetId)
      .single();

    if (proformaError) {
      logger.error('Supabase error while fetching proforma for payment aggregate:', proformaError);
      return;
    }

    if (!proforma) {
      return;
    }

    const proformaCurrency = proforma.currency || 'PLN';
    const exchangeRate = Number(proforma.currency_exchange);

    let paymentsTotal = totalsByCurrency[proformaCurrency] || 0;
    let paymentsTotalPln = null;

    if (proformaCurrency === 'PLN') {
      paymentsTotalPln = paymentsTotal;
    } else if (Number.isFinite(exchangeRate) && exchangeRate > 0) {
      paymentsTotalPln = paymentsTotal * exchangeRate;
    }

    if (paymentsTotal === 0 && Number.isFinite(exchangeRate) && exchangeRate > 0 && totalsByCurrency.PLN) {
      paymentsTotal = totalsByCurrency.PLN / exchangeRate;
      if (!Number.isFinite(paymentsTotalPln)) {
        paymentsTotalPln = totalsByCurrency.PLN;
      }
    }

    if (paymentsTotalPln === null && totalsByCurrency.PLN) {
      paymentsTotalPln = totalsByCurrency.PLN;
    }

    const updatePayload = {
      payments_total: Number.isFinite(paymentsTotal) ? paymentsTotal : 0,
      payments_total_pln: Number.isFinite(paymentsTotalPln) ? paymentsTotalPln : null,
      payments_count: paymentsCount
    };

    const { error: updateError } = await supabase
      .from('proformas')
      .update(updatePayload)
      .eq('id', targetId);

    if (updateError) {
      logger.error('Supabase error while updating proforma payment totals:', updateError);
    }

    const dealId = proforma?.pipedrive_deal_id;
    if (dealId) {
      await this.triggerCrmStatusAutomation({
        dealIds: [dealId],
        reason: 'payments:update-aggregates'
      });
    }
  }

  resolvePaymentRecord(record) {
    if (!record) {
      logger.warn('resolvePaymentRecord called with null/undefined record');
      return null;
    }

    try {
      const manualStatus = record.manual_status || null;
      let status = record.match_status || 'unmatched';
      let matchedProformaId = record.proforma_id || null;
      let matchedProformaFullnumber = record.proforma_fullnumber || null;
      let origin = 'auto';
      const suggestedProformaId = record.auto_proforma_id || null;
      const suggestedProformaFullnumber = record.auto_proforma_fullnumber || null;

      if (manualStatus === MANUAL_STATUS_APPROVED) {
        status = 'matched';
        matchedProformaId = record.manual_proforma_id || matchedProformaId;
        matchedProformaFullnumber = record.manual_proforma_fullnumber || matchedProformaFullnumber;
        origin = 'manual';
      } else if (manualStatus === MANUAL_STATUS_REJECTED) {
        status = 'unmatched';
        matchedProformaId = null;
        matchedProformaFullnumber = null;
        origin = 'manual';
      }

      return {
        id: record.id,
        date: record.operation_date,
        operation_date: record.operation_date, // Keep original for compatibility
        description: record.description || null,
        amount: record.amount || 0,
        currency: record.currency || 'PLN',
        direction: record.direction || null,
        payer: record.payer_name || null,
        payer_name: record.payer_name || null, // Keep original for compatibility
        payer_normalized_name: record.payer_normalized_name || null,
        status,
        origin,
        confidence: record.match_confidence || 0,
        match_confidence: record.match_confidence || 0, // Keep original for compatibility
        reason: record.match_reason || null,
        matched_proforma: matchedProformaFullnumber,
        matched_proforma_id: matchedProformaId,
        manual_status: manualStatus,
        manual_comment: record.manual_comment || null,
        manual_user: record.manual_user || null,
        manual_updated_at: record.manual_updated_at || null,
        match_metadata: record.match_metadata || null,
        source: record.source || null,
        auto_proforma_id: suggestedProformaId,
        auto_proforma_fullnumber: suggestedProformaFullnumber,
        expense_category_id: record.expense_category_id || null, // Include expense category ID
        income_category_id: record.income_category_id || null, // Include income category ID (for refunds)
        amount_pln: record.amount_pln != null ? Number(record.amount_pln) : null,
        vat_flow_override: record.vat_flow_override || null
      };
    } catch (error) {
      logger.error('Error in resolvePaymentRecord', {
        paymentId: record?.id,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async listPayments({ direction = null, limit = 500, expenseCategoryId = undefined } = {}) {
    if (!supabase) {
      logger.warn('Supabase client is not configured for listPayments');
      return { payments: [], history: [] };
    }

    // Get "Возвраты" income category ID to exclude refunds from income payments list
    let refundsCategoryId = null;
    if (direction === 'in') {
      try {
        const IncomeCategoryService = require('../pnl/incomeCategoryService');
        const incomeCategoryService = new IncomeCategoryService();
        const categories = await incomeCategoryService.listCategories();
        const refundsCategory = categories.find(cat => cat.name === 'Возвраты');
        if (refundsCategory) {
          refundsCategoryId = refundsCategory.id;
          logger.debug('Found "Возвраты" category ID for filtering', { refundsCategoryId });
        }
      } catch (categoryError) {
        logger.warn('Failed to get "Возвраты" category for filtering', { error: categoryError.message });
        // Continue without filtering - better to show refunds than to fail
      }
    }

    let query = supabase
      .from('payments')
      .select(`
        id,
        operation_date,
        description,
        amount,
        currency,
        direction,
        payer_name,
        payer_normalized_name,
        proforma_id,
        proforma_fullnumber,
        auto_proforma_id,
        auto_proforma_fullnumber,
        match_status,
        match_confidence,
        match_reason,
        match_metadata,
        manual_status,
        manual_proforma_id,
        manual_proforma_fullnumber,
        manual_comment,
        manual_user,
        manual_updated_at,
        source,
        expense_category_id,
        income_category_id,
        amount_pln,
        vat_flow_override
      `)
      .is('deleted_at', null) // Фильтруем удаленные платежи
      .order('operation_date', { ascending: false });

    // Filter by direction if provided
    if (direction) {
      query = query.eq('direction', direction);
    }

    // For income payments (direction='in'), exclude refunds (payments with income_category_id = "Возвраты")
    if (direction === 'in' && refundsCategoryId !== null) {
      query = query.or(`income_category_id.is.null,income_category_id.neq.${refundsCategoryId}`);
      logger.debug('Filtering out refunds from income payments', { refundsCategoryId });
    }

    // Filter by expense_category_id if provided
    // expenseCategoryId === null means "uncategorized" (IS NULL)
    // expenseCategoryId === undefined means "all"
    if (expenseCategoryId === null) {
      query = query.is('expense_category_id', null);
    } else if (expenseCategoryId !== undefined) {
      query = query.eq('expense_category_id', expenseCategoryId);
    }

    query = query.limit(limit || 500);

    const { data: paymentsData, error: paymentsError } = await query;

    if (paymentsError) {
      logger.error('Supabase error while fetching payments:', paymentsError);
      throw paymentsError;
    }

    // Debug logging
    logger.info('listPayments query result', {
      direction,
      limit,
      expenseCategoryId,
      refundsCategoryId,
      paymentsCount: paymentsData?.length || 0,
      sampleIds: paymentsData?.slice(0, 5).map(p => ({ 
        id: p.id, 
        direction: p.direction, 
        expense_category_id: p.expense_category_id,
        income_category_id: p.income_category_id
      })) || []
    });

    const { data: historyData, error: historyError } = await supabase
      .from('payment_imports')
      .select('id, filename, uploaded_at, total_records, matched, needs_review, user_name')
      .order('uploaded_at', { ascending: false })
      .limit(10);

    if (historyError) {
      logger.error('Supabase error while fetching payment imports:', historyError);
      throw historyError;
    }

    // Filter out internal transfers (PRZELEW WŁASNY)
    const paymentsWithoutInternal = (paymentsData || []).filter(p => !this.isInternalTransfer(p));
    
    // For expenses (direction='out'), show ALL payments regardless of manual_status
    // For income (direction='in'), filter out approved payments (they are matched to proformas)
    // Note: Refunds are already filtered out in the SQL query above
    const pendingPayments = direction === 'out'
      ? paymentsWithoutInternal // Show all expenses (excluding internal transfers)
      : paymentsWithoutInternal.filter((item) => item.manual_status !== MANUAL_STATUS_APPROVED); // Filter approved income payments (excluding internal transfers)

    // Resolve payment records with error handling
    const payments = [];
    for (const item of pendingPayments) {
      try {
        const resolved = this.resolvePaymentRecord(item);
        if (resolved) {
          payments.push(resolved);
        }
      } catch (resolveError) {
        logger.error('Error resolving payment record', {
          paymentId: item?.id,
          error: resolveError.message,
          stack: resolveError.stack,
          item: {
            id: item?.id,
            direction: item?.direction,
            operation_date: item?.operation_date,
            amount: item?.amount
          }
        });
        // Skip this payment but continue processing others
        continue;
      }
    }

    // Enrich expense payments with effective_vat_flow (018)
    const expensePayments = payments.filter(p => p.direction === 'out');
    if (expensePayments.length > 0) {
      try {
        const expenseIds = expensePayments.map(p => p.id);
        const { data: linkRows } = await supabase
          .from('payment_product_links')
          .select('payment_id')
          .in('payment_id', expenseIds);
        const paymentIdsWithProductLink = new Set((linkRows || []).map(r => r.payment_id));
        const ExpenseCategoryService = require('../pnl/expenseCategoryService');
        const expenseCategoryService = new ExpenseCategoryService();
        const categories = await expenseCategoryService.listCategories();
        const categoryVatFlowById = new Map((categories || []).map(c => [c.id, c.vat_flow]));
        for (const p of expensePayments) {
          p.effective_vat_flow = getEffectiveVatFlow({
            vatFlowOverride: p.vat_flow_override || null,
            hasProductLink: paymentIdsWithProductLink.has(p.id),
            categoryVatFlow: p.expense_category_id ? categoryVatFlowById.get(p.expense_category_id) : null
          });
        }
      } catch (enrichErr) {
        logger.warn('Could not enrich effective_vat_flow for expenses', { error: enrichErr.message });
      }
    }

    const history = (historyData || []).map((item) => ({
      id: item.id,
      filename: item.filename,
      uploaded_at: item.uploaded_at,
      matched: item.matched || 0,
      needs_review: item.needs_review || 0,
      user: item.user_name || null
    }));

    return { payments, history };
  }

  async ingestCsv(buffer, { filename = 'bank.csv', uploadedBy = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const content = buffer.toString('utf-8');
    const records = parseBankStatement(content);

    if (!records.length) {
      return {
        total: 0,
        matched: 0,
        needs_review: 0,
        unmatched: 0,
        ignored: 0
      };
    }

    const prepared = records.filter((item) => item.direction === 'in');
    const ignored = records.length - prepared.length;

    const insertImportResult = await supabase
      .from('payment_imports')
      .insert({
        filename,
        total_records: records.length,
        user_name: uploadedBy,
        matched: 0,
        needs_review: 0
      })
      .select('id')
      .single();

    if (insertImportResult.error) {
      logger.error('Supabase error while creating payment import:', insertImportResult.error);
      throw insertImportResult.error;
    }

    const importId = insertImportResult.data?.id || null;

    const matchingContext = await this.buildMatchingContext(prepared);
    const enriched = this.applyMatching(prepared, matchingContext).map((item) => ({
      ...item,
      source: PAYMENT_SOURCE_BANK,
      import_id: importId
    }));

    const { data: upserted, error } = await supabase
      .from('payments')
      .upsert(enriched, { onConflict: 'operation_hash' })
      .select('id, match_status');

    if (error) {
      logger.error('Supabase error while upserting payments:', error);
      throw error;
    }

    const statusCounts = upserted.reduce((acc, item) => {
      const status = item.match_status || 'needs_review';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    if (importId) {
      const { error: updateImportError } = await supabase
        .from('payment_imports')
        .update({
          matched: statusCounts.matched || 0,
          needs_review: statusCounts.needs_review || 0
        })
        .eq('id', importId);

      if (updateImportError) {
        logger.error('Supabase error while updating payment import stats:', updateImportError);
        throw updateImportError;
      }
    }

    return {
      total: records.length,
      matched: statusCounts.matched || 0,
      needs_review: statusCounts.needs_review || 0,
      unmatched: statusCounts.unmatched || 0,
      ignored
    };
  }

  /**
   * Unified CSV import handler - processes both expenses and income
   * Automatically determines direction based on amount sign
   * - Expenses (direction='out'): categorizes by expense categories
   * - Income (direction='in'): matches to proformas
   * - Refunds: positive amounts with refund keywords, marked as refunds for PNL
   * 
   * @param {Buffer} buffer - CSV file buffer
   * @param {Object} options - Import options
   * @param {string} [options.filename='bank.csv'] - Filename
   * @param {string} [options.uploadedBy=null] - User who uploaded the file
   * @param {number} [options.autoMatchThreshold=100] - Minimum confidence threshold for automatic expense category assignment (0-100). Default: 100 (disabled)
   * @returns {Promise<Object>} Import statistics
   */
  async ingestCsvUnified(buffer, { filename = 'bank.csv', uploadedBy = null, autoMatchThreshold = 100 } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    let content;
    try {
      content = buffer.toString('utf-8');
    } catch (error) {
      logger.error('Failed to convert buffer to string', {
        error: error.message,
        stack: error.stack,
        filename
      });
      throw new Error(`Failed to read CSV file: ${error.message}`);
    }

    let records;
    try {
      records = parseBankStatement(content);
    } catch (error) {
      logger.error('Failed to parse CSV file', {
        error: error.message,
        stack: error.stack,
        filename,
        contentLength: content?.length
      });
      throw new Error(`Failed to parse CSV file: ${error.message}`);
    }

    logger.info('Parsed CSV file (unified import)', {
      filename,
      totalRecords: records.length,
      recordsByDirection: {
        in: records.filter(r => r.direction === 'in').length,
        out: records.filter(r => r.direction === 'out').length,
        unknown: records.filter(r => !r.direction || (r.direction !== 'in' && r.direction !== 'out')).length
      }
    });

    if (!records.length) {
      return {
        total: 0,
        expenses: { processed: 0, categorized: 0, uncategorized: 0 },
        income: { processed: 0, matched: 0, needs_review: 0, unmatched: 0 },
        refunds: { processed: 0 }
      };
    }

    // Separate records by type
    // Direction is automatically determined by amount sign (negative = out, positive = in)
    // Filter out internal transfers (PRZELEW WŁASNY - transfers between own accounts)
    const internalTransfers = records.filter(r => this.isInternalTransfer(r));
    if (internalTransfers.length > 0) {
      logger.info('Filtering out internal transfers (PRZELEW WŁASNY)', {
        count: internalTransfers.length,
        sample: internalTransfers.slice(0, 3).map(t => ({
          date: t.operation_date,
          amount: t.amount,
          currency: t.currency,
          payer: t.payer_name
        }))
      });
    }
    
    const nonInternalRecords = records.filter(r => !this.isInternalTransfer(r));
    const expenses = nonInternalRecords.filter(r => r.direction === 'out');
    const income = nonInternalRecords.filter(r => r.direction === 'in');
    
    // All income payments will be matched to proformas
    // Refunds can be manually marked via UI button "Отправить в PNL"
    const regularIncome = income;

    logger.info('CSV records separated', {
      totalRecords: records.length,
      internalTransfers: internalTransfers.length,
      expenses: expenses.length,
      income: regularIncome.length,
      processed: expenses.length + regularIncome.length
    });

    // Create import record
    const insertImportResult = await supabase
      .from('payment_imports')
      .insert({
        filename,
        total_records: records.length,
        user_name: uploadedBy,
        matched: 0,
        needs_review: 0
      })
      .select('id')
      .single();

    if (insertImportResult.error) {
      logger.error('Supabase error while creating payment import:', insertImportResult.error);
      throw insertImportResult.error;
    }

    const importId = insertImportResult.data?.id || null;
    const enrichedPayments = [];

    // БЭКАП: Создаем snapshot существующих платежей перед импортом
    // Бэкап автоматически удаляется через 24 часа
    const allOperationDates = records.map(r => r.operation_date).filter(Boolean);
    let backupInfo = null;
    try {
      backupInfo = await paymentBackupService.createPreImportBackup(importId, allOperationDates);
      if (backupInfo) {
        logger.info('PRE-IMPORT BACKUP CREATED', {
          backupId: backupInfo.id,
          paymentsCount: backupInfo.payments_count,
          expiresAt: backupInfo.expires_at,
          importId,
          note: 'Backup will be auto-deleted after 24 hours. Use backupService.restoreFromBackup(backupId) to restore if needed.'
        });
      }
    } catch (backupError) {
      logger.warn('Failed to create pre-import backup, continuing with import', { 
        error: backupError.message 
      });
    }

    // Process expenses (direction='out') - categorize
    // For now, use existing ingestExpensesCsv logic but filter only expenses
    let expenseStats = { processed: 0, categorized: 0, uncategorized: 0 };
    if (expenses.length > 0) {
      // Create temporary buffer with only expenses for existing method
      // This is a temporary solution - will refactor later
      const expenseResults = await this._processExpenses(expenses, importId, autoMatchThreshold);
      enrichedPayments.push(...expenseResults.enriched);
      expenseStats = expenseResults.stats || expenseStats;
    }

    // Process regular income (direction='in', not refunds) - match to proformas
    let incomeStats = { processed: 0, matched: 0, needs_review: 0, unmatched: 0 };
    if (regularIncome.length > 0) {
      const incomeResults = await this._processIncome(regularIncome, importId);
      enrichedPayments.push(...incomeResults.enriched);
      incomeStats = incomeResults.stats || incomeStats;
    }

    // Refunds are handled manually via UI button "Отправить в PNL"
    // No automatic detection - user marks them manually

    // Save all payments to database
    // ВАЖНО: Не восстанавливаем удаленные платежи при повторной загрузке CSV
    // ЗАЩИТА: Проверяем дубли по дате+сумме+direction если hash не совпал (банк может менять описания)
    if (enrichedPayments.length > 0) {
      // Проверяем, какие платежи уже существуют и были ли они удалены
      const allOperationHashes = enrichedPayments.map(p => p.operation_hash).filter(Boolean);
      const deletedPaymentsMap = new Map();
      const existingByDateAmountMap = new Map(); // Дополнительная проверка по дате+сумме
      
      if (allOperationHashes.length > 0) {
        const { data: existingPayments, error: fetchError } = await supabase
          .from('payments')
          .select('id, operation_hash, deleted_at, operation_date, amount, direction, expense_category_id, income_category_id, proforma_id, match_status')
          .in('operation_hash', allOperationHashes);
        
        if (!fetchError && existingPayments) {
          existingPayments.forEach(p => {
            if (p.operation_hash) {
              deletedPaymentsMap.set(p.operation_hash, p.deleted_at !== null);
            }
          });
          logger.info(`Found ${deletedPaymentsMap.size} existing payments (out of ${allOperationHashes.length} hashes)`);
        }
      }
      
      // ЗАЩИТА: Получаем ВСЕ существующие платежи по дате+сумме+direction для проверки дублей
      // Это защищает от случая когда банк меняет описание (и hash меняется)
      const uniqueDates = [...new Set(enrichedPayments.map(p => p.operation_date).filter(Boolean))];
      if (uniqueDates.length > 0) {
        const { data: existingByDate, error: dateError } = await supabase
          .from('payments')
          .select('id, operation_date, amount, direction, expense_category_id, income_category_id, proforma_id, match_status, deleted_at')
          .in('operation_date', uniqueDates)
          .is('deleted_at', null);
        
        if (!dateError && existingByDate) {
          existingByDate.forEach(p => {
            const key = `${p.operation_date}_${p.amount}_${p.direction}`;
            if (!existingByDateAmountMap.has(key)) {
              existingByDateAmountMap.set(key, p);
            }
          });
          logger.info(`Built date+amount lookup with ${existingByDateAmountMap.size} entries for duplicate protection`);
        }
      }
      
      // Фильтруем платежи, которые были удалены или являются дублями
      const paymentsToUpsert = enrichedPayments.filter(p => {
        if (!p.operation_hash) return true; // Если нет hash, создаем новый
        
        // Проверка 1: был ли удален по hash
        const wasDeleted = deletedPaymentsMap.get(p.operation_hash);
        if (wasDeleted) {
          logger.info(`Skipping deleted payment with operation_hash: ${p.operation_hash?.substring(0, 8)}...`);
          return false; // Не восстанавливаем удаленные платежи
        }
        
        // Проверка 2: есть ли дубль по дате+сумме+direction (защита от изменения описания банком)
        const dateAmountKey = `${p.operation_date}_${p.amount}_${p.direction}`;
        const existingByDateAmount = existingByDateAmountMap.get(dateAmountKey);
        if (existingByDateAmount && !deletedPaymentsMap.has(p.operation_hash)) {
          // Есть существующий платеж с такой же датой+суммой+direction
          // Сохраняем категории и связи из существующего
          if (existingByDateAmount.expense_category_id && !p.expense_category_id) {
            p.expense_category_id = existingByDateAmount.expense_category_id;
            logger.debug(`Preserved expense_category_id ${existingByDateAmount.expense_category_id} from existing payment`);
          }
          if (existingByDateAmount.income_category_id && !p.income_category_id) {
            p.income_category_id = existingByDateAmount.income_category_id;
          }
          if (existingByDateAmount.proforma_id && !p.proforma_id) {
            p.proforma_id = existingByDateAmount.proforma_id;
            p.match_status = existingByDateAmount.match_status || p.match_status;
            logger.debug(`Preserved proforma_id ${existingByDateAmount.proforma_id} from existing payment`);
          }
          
          // Если hash разный но дата+сумма совпадает - это дубль с измененным описанием
          // Пропускаем его, чтобы не создавать дубликат
          logger.info(`Skipping potential duplicate (same date+amount+direction): ${p.operation_date} ${p.amount} ${p.direction}`);
          return false;
        }
        
        return true;
      });

      const { dedupedPayments, duplicateOperationHashes } = this._dedupePaymentsByOperationHash(paymentsToUpsert);

      if (duplicateOperationHashes.length > 0) {
        logger.warn('Detected duplicate payments within the same CSV upload, keeping the first occurrence only', {
          duplicatesTotal: duplicateOperationHashes.length,
          sampleDuplicates: duplicateOperationHashes.slice(0, 5).map((hash) => `${hash.substring(0, 8)}...`)
        });
      }

      if (dedupedPayments.length === 0) {
        logger.info('All payments were deleted, skipping upsert');
        return {
          total: records.length,
          expenses: expenseStats,
          income: incomeStats
        };
      }
      
      const { data: upserted, error } = await supabase
        .from('payments')
        .upsert(dedupedPayments, { 
          onConflict: 'operation_hash',
          ignoreDuplicates: false
        })
        .select('id, direction, expense_category_id, income_category_id, match_status');

      if (error) {
        logger.error('Supabase error while upserting payments:', error);
        throw error;
      }

      logger.info('Upserted payments', {
        total: enrichedPayments.length,
        upserted: upserted?.length || 0
      });
    }

    return {
      total: records.length,
      expenses: expenseStats,
      income: incomeStats,
      importId: importId
    };
  }

  /**
   * Process expenses - categorize by expense categories
   * @private
   */
  async _processExpenses(expenses, importId, autoMatchThreshold) {
    if (!expenses || expenses.length === 0) {
      return { enriched: [], stats: { processed: 0, categorized: 0, uncategorized: 0, skipped: 0 } };
    }

    const totalExpenses = expenses.length;
    const operationHashes = expenses.map(e => e.operation_hash).filter(Boolean);
    const existingHashes = await this.getExistingOperationHashes(operationHashes, 'out');
    if (existingHashes.size > 0) {
      logger.info('Skipping already imported expense payments', {
        totalCsvExpenses: totalExpenses,
        existingByHash: existingHashes.size,
        willBeProcessed: totalExpenses - existingHashes.size,
        sampleExistingHashes: Array.from(existingHashes).slice(0, 5).map((hash) => `${hash.substring(0, 8)}...`)
      });
    } else {
      logger.info('No existing expense payments found by operation_hash', {
        totalCsvExpenses: totalExpenses
      });
    }
    expenses = expenses.filter((expense) => {
      if (!expense.operation_hash) return true;
      return !existingHashes.has(expense.operation_hash);
    });

    if (!expenses.length) {
      return { enriched: [], stats: { processed: 0, categorized: 0, uncategorized: 0, skipped: totalExpenses } };
    }

    // Generate suggestions and auto-assign categories
    const enriched = [];
    let uncategorizedCount = expenses.length;
    let autoMatchedCount = 0;

    for (const expense of expenses) {
      let suggestions = [];
      let autoMatchedCategoryId = null;
      let autoMatchConfidence = 0;
      
      try {
        suggestions = await this.expenseMappingService.findCategorySuggestions({
          category: expense.category,
          description: expense.description,
          payer_name: expense.payer_name
        }, 3);
        
        if (suggestions.length > 0 && autoMatchThreshold < 100) {
          const bestSuggestion = suggestions[0];
          if (bestSuggestion && bestSuggestion.confidence >= autoMatchThreshold) {
            autoMatchedCategoryId = bestSuggestion.categoryId;
            autoMatchConfidence = bestSuggestion.confidence;
            autoMatchedCount++;
            uncategorizedCount--;
          }
        }
      } catch (mappingError) {
        logger.warn('Failed to generate suggestions for expense', {
          description: expense.description,
          error: mappingError.message
        });
      }

      const finalCategoryId = autoMatchedCategoryId !== null 
        ? autoMatchedCategoryId
        : null;

      // Normalize operation_date
      let normalizedOperationDate = expense.operation_date;
      if (expense.operation_date && typeof expense.operation_date === 'string') {
        try {
          const dateObj = new Date(expense.operation_date);
          if (!isNaN(dateObj.getTime())) {
            normalizedOperationDate = dateObj.toISOString();
          } else {
            const polishFormatMatch = expense.operation_date.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
            if (polishFormatMatch) {
              const [, day, month, year] = polishFormatMatch;
              const dateObj = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
              if (!isNaN(dateObj.getTime())) {
                normalizedOperationDate = dateObj.toISOString();
              }
            }
          }
        } catch (dateError) {
          // Keep original date
        }
      }

      // Рассчитываем amount_pln и currency_exchange при импорте
      const currency = (expense.currency || 'PLN').toUpperCase();
      let amountPln = null;
      let currencyExchange = null;
      
      if (currency === 'PLN') {
        // Для PLN используем amount напрямую
        amountPln = expense.amount;
        currencyExchange = 1;
      } else {
        // Для других валют получаем курс обмена и конвертируем
        try {
          const exchangeRate = await getRate(currency, 'PLN');
          currencyExchange = exchangeRate;
          amountPln = Number((expense.amount * exchangeRate).toFixed(2));
        } catch (rateError) {
          logger.warn('Failed to fetch exchange rate for payment', {
            currency,
            amount: expense.amount,
            error: rateError.message,
            description: expense.description?.substring(0, 50)
          });
          // Если не удалось получить курс, оставляем null
          // amount_pln будет заполнен позже при необходимости
        }
      }

      const paymentRecord = {
        operation_date: normalizedOperationDate,
        payment_date: normalizedOperationDate,
        description: expense.description,
        account: expense.account,
        amount: expense.amount,
        currency: currency,
        currency_exchange: currencyExchange,
        amount_pln: amountPln,
        direction: 'out',
        payer_name: expense.payer_name,
        payer_normalized_name: expense.payer_normalized_name,
        operation_hash: expense.operation_hash,
        source: PAYMENT_SOURCE_BANK,
        import_id: importId,
        match_status: 'unmatched',
        manual_status: null,
        match_confidence: autoMatchConfidence,
        expense_category_id: finalCategoryId
      };

      enriched.push(paymentRecord);
    }

    return {
      enriched,
      stats: {
        processed: expenses.length,
        categorized: autoMatchedCount,
        uncategorized: uncategorizedCount,
        skipped: totalExpenses - expenses.length
      }
    };
  }

  /**
   * Process income - match to proformas
   * @private
   */
  async _processIncome(income, importId) {
    if (!income || income.length === 0) {
      return { enriched: [], stats: { processed: 0, matched: 0, needs_review: 0, unmatched: 0, skipped: 0 } };
    }

    const totalIncome = income.length;
    const operationHashes = income.map(item => item.operation_hash).filter(Boolean);
    const existingHashes = await this.getExistingOperationHashes(operationHashes, 'in');
    if (existingHashes.size > 0) {
      logger.info('Skipping already imported income payments', {
        totalCsvIncome: totalIncome,
        existingByHash: existingHashes.size,
        willBeProcessed: totalIncome - existingHashes.size,
        sampleExistingHashes: Array.from(existingHashes).slice(0, 5).map((hash) => `${hash.substring(0, 8)}...`)
      });
    } else {
      logger.info('No existing income payments found by operation_hash', {
        totalCsvIncome: totalIncome
      });
    }
    income = income.filter((item) => {
      if (!item.operation_hash) return true;
      return !existingHashes.has(item.operation_hash);
    });

    if (!income.length) {
      return { enriched: [], stats: { processed: 0, matched: 0, needs_review: 0, unmatched: 0, skipped: totalIncome } };
    }

    const matchingContext = await this.buildMatchingContext(income);
    const matchedIncome = this.applyMatching(income, matchingContext);
    
    // Рассчитываем amount_pln и currency_exchange для каждого дохода
    const enriched = await Promise.all(matchedIncome.map(async (item) => {
      const currency = (item.currency || 'PLN').toUpperCase();
      let amountPln = null;
      let currencyExchange = null;
      
      if (currency === 'PLN') {
        // Для PLN используем amount напрямую
        amountPln = item.amount;
        currencyExchange = 1;
      } else {
        // Для других валют получаем курс обмена и конвертируем
        try {
          const exchangeRate = await getRate(currency, 'PLN');
          currencyExchange = exchangeRate;
          amountPln = Number((item.amount * exchangeRate).toFixed(2));
        } catch (rateError) {
          logger.warn('Failed to fetch exchange rate for income payment', {
            currency,
            amount: item.amount,
            error: rateError.message,
            description: item.description?.substring(0, 50)
          });
          // Если не удалось получить курс, оставляем null
          // amount_pln будет заполнен позже при необходимости
        }
      }
      
      return {
        ...item,
        source: PAYMENT_SOURCE_BANK,
        import_id: importId,
        currency_exchange: currencyExchange,
        amount_pln: amountPln
      };
    }));

    // Count statuses
    const statusCounts = enriched.reduce((acc, item) => {
      const status = item.match_status || 'needs_review';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    return {
      enriched,
      stats: {
        processed: income.length,
        matched: statusCounts.matched || 0,
        needs_review: statusCounts.needs_review || 0,
        unmatched: statusCounts.unmatched || 0,
        skipped: totalIncome - income.length
      }
    };
  }

  async getExistingOperationHashes(operationHashes = [], direction = null) {
    if (!operationHashes || operationHashes.length === 0) {
      return new Set();
    }

    let query = supabase
      .from('payments')
      .select('operation_hash')
      .in('operation_hash', operationHashes);

    if (direction) {
      query = query.eq('direction', direction);
    }

    const { data, error } = await query;
    if (error) {
      logger.warn('Failed to fetch existing operation hashes', {
        direction,
        error: error.message
      });
      return new Set();
    }

    return new Set(
      (data || [])
        .map((row) => row.operation_hash)
        .filter(Boolean)
    );
  }

  _dedupePaymentsByOperationHash(payments = []) {
    const seenOperationHashes = new Set();
    const duplicates = new Set();
    const deduped = [];

    for (const payment of payments) {
      const hash = payment?.operation_hash;
      if (!hash) {
        deduped.push(payment);
        continue;
      }

      if (seenOperationHashes.has(hash)) {
        duplicates.add(hash);
        continue;
      }

      seenOperationHashes.add(hash);
      deduped.push(payment);
    }

    return {
      dedupedPayments: deduped,
      duplicateOperationHashes: Array.from(duplicates)
    };
  }


  /**
   * Import expenses from CSV file
   * Separate handler for expenses (direction = 'out') to avoid breaking existing income logic
   * @deprecated Use ingestCsvUnified instead
   * @param {Buffer} buffer - CSV file buffer
   * @param {Object} options - Import options
   * @param {string} [options.filename='bank.csv'] - Filename
   * @param {string} [options.uploadedBy=null] - User who uploaded the file
   * @param {number} [options.autoMatchThreshold=100] - Minimum confidence threshold for automatic category assignment (0-100). Default: 100 (disabled - all require manual selection)
   * @returns {Promise<Object>} Import statistics
   */
  async ingestExpensesCsv(buffer, { filename = 'bank.csv', uploadedBy = null, autoMatchThreshold = 100 } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const content = buffer.toString('utf-8');
    const records = parseBankStatement(content);

    logger.info('Parsed CSV file', {
      filename,
      totalRecords: records.length,
      recordsByDirection: {
        in: records.filter(r => r.direction === 'in').length,
        out: records.filter(r => r.direction === 'out').length,
        unknown: records.filter(r => !r.direction || (r.direction !== 'in' && r.direction !== 'out')).length
      },
      sampleIncoming: records.filter(r => r.direction === 'in').slice(0, 3).map(r => ({
        description: r.description?.substring(0, 50),
        payer: r.payer_name,
        amount: r.amount,
        category: r.category
      })),
      sampleOutgoing: records.filter(r => r.direction === 'out').slice(0, 3).map(r => ({
        description: r.description?.substring(0, 50),
        payer: r.payer_name,
        amount: r.amount,
        category: r.category
      }))
    });

    if (!records.length) {
      return {
        total: 0,
        processed: 0,
        categorized: 0,
        uncategorized: 0,
        ignored: 0
      };
    }

    // Filter only expenses (direction = 'out')
    const expenses = records.filter((item) => item.direction === 'out');
    const ignored = records.length - expenses.length;
    
    // Check for potential misclassified incoming payments in expenses
    const potentialIncoming = expenses.filter(e => {
      const desc = (e.description || '').toUpperCase();
      // Check for person name patterns that might indicate incoming payments
      const namePattern = /^[A-ZĄĆĘŁŃÓŚŹŻ]{2,}\s+[A-ZĄĆĘŁŃÓŚŹŻ]{2,}(\s+[A-ZĄĆĘŁŃÓŚŹŻ]{2,})?(\s|,|$)/;
      return namePattern.test(desc) && 
             !desc.includes('ZAKUP') && 
             !desc.includes('OPŁATA') &&
             !desc.includes('PRZELEW WYCHODZĄCY');
    });
    
    if (potentialIncoming.length > 0) {
      logger.warn('Found potential incoming payments in expenses list', {
        count: potentialIncoming.length,
        samples: potentialIncoming.slice(0, 5).map(e => ({
          description: e.description?.substring(0, 50),
          payer: e.payer_name,
          amount: e.amount,
          category: e.category,
          direction: e.direction
        }))
      });
    }
    
    logger.info('Filtered expenses', {
      totalRecords: records.length,
      expenses: expenses.length,
      ignored: ignored,
      potentialIncomingMisclassified: potentialIncoming.length,
      sampleExpenses: expenses.slice(0, 3).map(e => ({
        description: e.description?.substring(0, 50),
        amount: e.amount,
        currency: e.currency,
        direction: e.direction
      }))
    });

    if (expenses.length === 0) {
      return {
        total: records.length,
        processed: 0,
        categorized: 0,
        uncategorized: 0,
        ignored
      };
    }

    // Create import record
    const insertImportResult = await supabase
      .from('payment_imports')
      .insert({
        filename: `expenses_${filename}`,
        total_records: expenses.length,
        user_name: uploadedBy,
        matched: 0,
        needs_review: 0
      })
      .select('id')
      .single();

    if (insertImportResult.error) {
      logger.error('Supabase error while creating expense import:', insertImportResult.error);
      throw insertImportResult.error;
    }

    const importId = insertImportResult.data?.id || null;

    // First, fetch existing payments to preserve their categories
    const operationHashes = expenses.map(e => e.operation_hash).filter(Boolean);
    const existingPaymentsMap = new Map();
    
    if (operationHashes.length > 0) {
      const { data: existingPayments, error: fetchError } = await supabase
        .from('payments')
        .select('operation_hash, expense_category_id')
        .in('operation_hash', operationHashes)
        .eq('direction', 'out');
      
      if (!fetchError && existingPayments) {
        existingPayments.forEach(p => {
          if (p.operation_hash && p.expense_category_id !== null) {
            existingPaymentsMap.set(p.operation_hash, p.expense_category_id);
          }
        });
        logger.info(`Found ${existingPaymentsMap.size} existing payments with categories (out of ${operationHashes.length} total)`);
      }
    }

    // Generate suggestions and auto-assign categories for high-confidence matches
    const enriched = [];
    const suggestionsByHash = new Map(); // operation_hash -> suggestions
    let uncategorizedCount = expenses.length; // All expenses start uncategorized
    let autoMatchedCount = 0; // Count of automatically matched expenses
    let preservedCount = 0; // Count of preserved existing categories

    for (const expense of expenses) {
      // Check if this payment already has a category
      const existingCategoryId = existingPaymentsMap.get(expense.operation_hash);
      
      // Generate suggestions and check for auto-match
      let suggestions = [];
      let autoMatchedCategoryId = null;
      let autoMatchConfidence = 0;
      
      try {
        // Get suggestions for manual review
        suggestions = await this.expenseMappingService.findCategorySuggestions({
          category: expense.category,
          description: expense.description,
          payer_name: expense.payer_name
        }, 3);
        
        if (suggestions.length > 0) {
          logger.debug(`Generated ${suggestions.length} suggestions for expense: ${expense.description?.substring(0, 50)}...`);
          
          // Check if best suggestion meets auto-match threshold
          // If autoMatchThreshold >= 100, auto-categorization is disabled (all require manual selection)
          const bestSuggestion = suggestions[0];
          if (autoMatchThreshold < 100 && bestSuggestion && bestSuggestion.confidence >= autoMatchThreshold) {
            autoMatchedCategoryId = bestSuggestion.categoryId;
            autoMatchConfidence = bestSuggestion.confidence;
            autoMatchedCount++;
            
            // Only decrease uncategorized count if this is a new match (not preserving existing)
            if (!existingCategoryId) {
              uncategorizedCount--;
            }
            
            logger.info(`Auto-matched expense to category ${autoMatchedCategoryId} with ${autoMatchConfidence}% confidence`, {
              description: expense.description?.substring(0, 50),
              categoryId: autoMatchedCategoryId,
              confidence: autoMatchConfidence,
              hadExistingCategory: !!existingCategoryId
            });
          } else if (autoMatchThreshold >= 100) {
            // Auto-categorization is disabled - all expenses require manual selection
            logger.debug('Auto-categorization disabled (threshold >= 100), skipping auto-match', {
              description: expense.description?.substring(0, 50),
              threshold: autoMatchThreshold
            });
          }
        }
      } catch (mappingError) {
        logger.warn('Failed to generate suggestions for expense', {
          description: expense.description,
          error: mappingError.message
        });
      }

      // Prepare payment record
      // Priority: 1) New auto-match, 2) Existing category, 3) null
      const finalCategoryId = autoMatchedCategoryId !== null 
        ? autoMatchedCategoryId  // Use new auto-match if found
        : (existingCategoryId !== undefined ? existingCategoryId : null); // Preserve existing or null
      
      if (existingCategoryId && !autoMatchedCategoryId) {
        preservedCount++;
      }

      // Normalize operation_date to ISO format for proper filtering in PNL reports
      // CSV dates can be in various formats (YYYY-MM-DD, DD.MM.YYYY, etc.)
      let normalizedOperationDate = expense.operation_date;
      if (expense.operation_date && typeof expense.operation_date === 'string') {
        try {
          // Try to parse the date string
          const dateObj = new Date(expense.operation_date);
          if (!isNaN(dateObj.getTime())) {
            // Valid date - convert to ISO string
            normalizedOperationDate = dateObj.toISOString();
          } else {
            // Try common Polish date formats
            // Format: DD.MM.YYYY or DD-MM-YYYY
            const polishFormatMatch = expense.operation_date.match(/^(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})/);
            if (polishFormatMatch) {
              const [, day, month, year] = polishFormatMatch;
              const dateObj = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
              if (!isNaN(dateObj.getTime())) {
                normalizedOperationDate = dateObj.toISOString();
              }
            }
          }
        } catch (dateError) {
          logger.warn('Failed to normalize operation_date', {
            originalDate: expense.operation_date,
            error: dateError.message
          });
          // Keep original date if normalization fails
        }
      }

      // IMPORTANT: Expenses import only processes payments with direction = 'out' (negative amounts)
      // This is filtered earlier in the code (line 375), but we explicitly set it here for clarity
      // PNL reports filter expenses by direction = 'out', income by direction = 'in'
      if (expense.direction !== 'out') {
        logger.warn('Skipping non-expense payment in expenses import', {
          operationHash: expense.operation_hash,
          direction: expense.direction,
          description: expense.description?.substring(0, 50)
        });
        continue; // Skip this payment - should not happen due to earlier filter, but safety check
      }

      const paymentRecord = {
        operation_date: normalizedOperationDate,
        payment_date: normalizedOperationDate, // Required field - use normalized operation_date
        description: expense.description,
        account: expense.account,
        amount: expense.amount,
        currency: expense.currency || 'PLN',
        direction: 'out', // Expenses only - payments with negative amounts (direction = 'out')
        payer_name: expense.payer_name,
        payer_normalized_name: expense.payer_normalized_name,
        operation_hash: expense.operation_hash,
        source: PAYMENT_SOURCE_BANK,
        import_id: importId,
        match_status: 'unmatched', // Expenses don't match to proformas
        manual_status: null,
        match_confidence: autoMatchConfidence // Store confidence for reference
      };
      
      // Always set expense_category_id (either new match, preserved existing, or null)
      paymentRecord.expense_category_id = finalCategoryId;

      enriched.push(paymentRecord);
      
      // Store suggestions by operation_hash for later mapping (even if auto-matched, for reference)
      if (suggestions.length > 0) {
        suggestionsByHash.set(expense.operation_hash, suggestions);
        logger.debug(`Stored ${suggestions.length} suggestions for hash: ${expense.operation_hash.substring(0, 8)}...`);
      }
    }
    
    logger.info(`Expense processing summary: ${expenses.length} total (direction='out' only), ${autoMatchedCount} auto-matched, ${preservedCount} preserved, ${uncategorizedCount} uncategorized`, {
      note: 'Only expenses (direction=out, negative amounts) are processed. Income payments (direction=in, positive amounts) are ignored in expenses import.'
    });

    // Save expenses to database
    // ВАЖНО: Не восстанавливаем удаленные платежи при повторной загрузке CSV
    // ЗАЩИТА: Проверяем дубли по дате+сумме если hash не совпал (банк может менять описания)
    logger.info('Upserting expenses to database', {
      totalToUpsert: enriched.length,
      sampleHashes: enriched.slice(0, 5).map(e => e.operation_hash?.substring(0, 8) + '...')
    });
    
    // Проверяем, какие платежи уже существуют и были ли они удалены
    const enrichedOperationHashes = enriched.map(e => e.operation_hash).filter(Boolean);
    const deletedPaymentsMap = new Map();
    const existingByDateAmountMap = new Map(); // Дополнительная проверка по дате+сумме
    
    if (enrichedOperationHashes.length > 0) {
      const { data: existingPayments, error: fetchError } = await supabase
        .from('payments')
        .select('id, operation_hash, deleted_at, operation_date, amount, expense_category_id')
        .in('operation_hash', enrichedOperationHashes);
      
      if (!fetchError && existingPayments) {
        existingPayments.forEach(p => {
          if (p.operation_hash) {
            deletedPaymentsMap.set(p.operation_hash, p.deleted_at !== null);
          }
        });
        logger.info(`Found ${deletedPaymentsMap.size} existing payments (out of ${enrichedOperationHashes.length} hashes)`);
      }
    }
    
    // ЗАЩИТА: Получаем существующие расходы по дате+сумме для проверки дублей
    const uniqueDates = [...new Set(enriched.map(e => e.operation_date).filter(Boolean))];
    if (uniqueDates.length > 0) {
      const { data: existingByDate, error: dateError } = await supabase
        .from('payments')
        .select('id, operation_date, amount, expense_category_id, deleted_at')
        .eq('direction', 'out')
        .in('operation_date', uniqueDates)
        .is('deleted_at', null);
      
      if (!dateError && existingByDate) {
        existingByDate.forEach(p => {
          const key = `${p.operation_date}_${p.amount}`;
          if (!existingByDateAmountMap.has(key)) {
            existingByDateAmountMap.set(key, p);
          }
        });
        logger.info(`Built date+amount lookup with ${existingByDateAmountMap.size} entries for expense duplicate protection`);
      }
    }
    
    // Фильтруем платежи, которые были удалены или являются дублями
    let skippedDuplicates = 0;
    const expensesToUpsert = enriched.filter(e => {
      if (!e.operation_hash) return true; // Если нет hash, создаем новый
      
      // Проверка 1: был ли удален по hash
      const wasDeleted = deletedPaymentsMap.get(e.operation_hash);
      if (wasDeleted) {
        logger.info(`Skipping deleted expense payment with operation_hash: ${e.operation_hash?.substring(0, 8)}...`);
        return false; // Не восстанавливаем удаленные платежи
      }
      
      // Проверка 2: есть ли дубль по дате+сумме (защита от изменения описания банком)
      const dateAmountKey = `${e.operation_date}_${e.amount}`;
      const existingByDateAmount = existingByDateAmountMap.get(dateAmountKey);
      if (existingByDateAmount && !deletedPaymentsMap.has(e.operation_hash)) {
        // Сохраняем категорию из существующего платежа
        if (existingByDateAmount.expense_category_id && !e.expense_category_id) {
          e.expense_category_id = existingByDateAmount.expense_category_id;
          logger.debug(`Preserved expense_category_id ${existingByDateAmount.expense_category_id} from existing payment`);
        }
        
        // Пропускаем дубль
        skippedDuplicates++;
        logger.debug(`Skipping expense duplicate (same date+amount): ${e.operation_date} ${e.amount}`);
        return false;
      }
      
      return true;
    });
    
    if (skippedDuplicates > 0) {
      logger.info(`Skipped ${skippedDuplicates} expense duplicates (same date+amount, different hash)`);
    }
    
    if (expensesToUpsert.length === 0) {
      logger.info('All expense payments were deleted, skipping upsert');
      return {
        total: records.length,
        processed: 0,
        categorized: 0,
        uncategorized: 0,
        ignored: records.length - expenses.length
      };
    }
    
    const { data: upserted, error } = await supabase
      .from('payments')
      .upsert(expensesToUpsert, { 
        onConflict: 'operation_hash',
        ignoreDuplicates: false // Update existing records
      })
      .select('id, expense_category_id, description, payer_name, operation_date, amount, currency, operation_hash, direction');

    if (error) {
      logger.error('Supabase error while upserting expenses:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
      throw error;
    }
    
    logger.info('Upserted expenses result', {
      upsertedCount: upserted ? upserted.length : 0,
      expectedCount: enriched.length
    });

    // IMPORTANT: Do NOT reset expense_category_id for existing records
    // If a payment already has a category (manually assigned or from previous import),
    // preserve it unless we have a new auto-match with confidence >= threshold
    // This prevents losing work on re-import and allows incremental categorization
    logger.info('Preserving existing categories for payments that already have them');

    // Map suggestions to payment IDs using operation_hash
    // IMPORTANT: upsert may not return all records if they already exist
    // So we need to fetch ALL payments (both newly created and existing) by their operation_hash to get their IDs
    const suggestionsByPaymentId = {};
    
    // Get ALL operation hashes from enriched expenses (not just those with suggestions)
    const allOperationHashes = enriched.map(e => e.operation_hash);
    
    if (allOperationHashes.length > 0) {
      // Fetch all payments (both newly created and existing) by their operation_hash
      const { data: allPayments, error: fetchError } = await supabase
        .from('payments')
        .select('id, expense_category_id, operation_hash')
        .in('operation_hash', allOperationHashes)
        .eq('direction', 'out');

      if (fetchError) {
        logger.warn('Failed to fetch payments for suggestion mapping:', fetchError);
      } else if (allPayments && Array.isArray(allPayments)) {
        logger.info(`Fetched ${allPayments.length} payments from database (including existing), ${suggestionsByHash.size} suggestion sets available`);
        
        // Map suggestions to payment IDs
        for (const payment of allPayments) {
          // Only include suggestions for payments without category
          if (!payment.expense_category_id && payment.operation_hash) {
            if (suggestionsByHash.has(payment.operation_hash)) {
              suggestionsByPaymentId[payment.id] = suggestionsByHash.get(payment.operation_hash);
              logger.debug(`✓ Mapped suggestions for payment ${payment.id} (hash: ${payment.operation_hash.substring(0, 8)}...), ${suggestionsByHash.get(payment.operation_hash).length} suggestions`);
            }
          }
        }
        
        const paymentsWithSuggestions = Object.keys(suggestionsByPaymentId).length;
        const paymentsWithoutCategory = allPayments.filter(p => !p.expense_category_id).length;
        
        logger.info(`Mapped ${paymentsWithSuggestions} payment suggestions out of ${paymentsWithoutCategory} uncategorized payments (total: ${allPayments.length})`);
      } else {
        logger.warn(`No payments found in database for ${allOperationHashes.length} operation hashes`);
      }
    } else {
      logger.info('No operation hashes to map');
    }

    // Update import statistics
    if (importId) {
      const { error: updateImportError } = await supabase
        .from('payment_imports')
        .update({
          matched: autoMatchedCount, // Auto-categorized count
          needs_review: uncategorizedCount // Require manual categorization
        })
        .eq('id', importId);

      if (updateImportError) {
        logger.error('Supabase error while updating expense import stats:', updateImportError);
        // Don't throw - import was successful
      }
    }

    logger.info(`Imported ${expenses.length} expenses: ${autoMatchedCount} auto-matched (>=${autoMatchThreshold}%), ${preservedCount} preserved existing categories, ${uncategorizedCount} require manual categorization, ${Object.keys(suggestionsByPaymentId).length} with suggestions`);

    return {
      total: records.length,
      processed: expenses.length,
      categorized: autoMatchedCount, // Auto-categorized count
      uncategorized: uncategorizedCount,
      ignored,
      autoMatched: autoMatchedCount, // Explicit count for clarity
      autoMatchThreshold: autoMatchThreshold, // Return threshold used
      suggestions: suggestionsByPaymentId // Map of payment_id -> suggestions array
    };
  }

  async resetMatches() {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data: affected, error: listError } = await supabase
      .from('payments')
      .select('manual_proforma_id')
      .not('manual_status', 'is', null);

    if (listError) {
      logger.error('Supabase error while listing payments before reset:', listError);
    }

    const { error } = await supabase
      .from('payments')
      .update({
        match_status: 'unmatched',
        match_confidence: 0,
        match_reason: 'reset by user',
        match_metadata: null,
        proforma_id: null,
        proforma_fullnumber: null
      })
      .neq('match_status', 'unmatched');

    if (error) {
      logger.error('Supabase error while resetting payment matches:', error);
      throw error;
    }

    if (affected && affected.length > 0) {
      const uniqueIds = Array.from(new Set(
        affected
          .map((row) => row.manual_proforma_id)
          .filter(Boolean)
      ));

      for (const proformaId of uniqueIds) {
        // eslint-disable-next-line no-await-in-loop
        await this.updateProformaPaymentAggregates(proformaId);
      }
    }
  }

  async exportCsv() {
    const { payments } = await this.listPayments();

    const header = 'date,description,amount,currency,payer,proforma,status\n';
    const rows = payments.map((item) => [
      item.date || '',
      this.escapeCsv(item.description || ''),
      (item.amount || 0).toFixed(2),
      item.currency || '',
      this.escapeCsv(item.payer || ''),
      item.matched_proforma || '',
      item.status || ''
    ].join(','));

    return header + rows.join('\n');
  }

  escapeCsv(value) {
    const stringValue = String(value);
    if (stringValue.includes('"') || stringValue.includes(',') || stringValue.includes('\n')) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  }

  applyMatching(payments, context) {
    return payments.map((payment) => {
      const enriched = { ...payment };
      const candidates = this.createMatchingCandidates(enriched, context);
      const best = candidates.length > 0 ? candidates[0] : null;

      const matchMetadata = candidates.length
        ? {
            amount_diff: best.amountDiff,
            remaining: best.remaining,
            candidate_count: candidates.length,
            candidates: candidates.slice(0, 5).map((candidate) => ({
              proforma_id: candidate.proformaId,
              proforma_fullnumber: candidate.proformaFullnumber,
              score: candidate.score,
              reason: candidate.reason,
              amount_diff: candidate.amountDiff,
              remaining: candidate.remaining
            }))
          }
        : null;

      return {
        ...enriched,
        payment_date: enriched.operation_date || null,
        match_status: candidates.length ? 'needs_review' : 'unmatched',
        match_confidence: best ? best.score : 0,
        match_reason: best ? best.reason : 'Совпадения не найдены',
        match_metadata: matchMetadata,
        auto_proforma_id: best?.proformaId || null,
        auto_proforma_fullnumber: best?.proformaFullnumber || null,
        // Не назначаем proforma_id автоматически — пользователь решает вручную
        proforma_id: enriched.proforma_id || null,
        proforma_fullnumber: enriched.proforma_fullnumber || null,
        income_category_id: enriched.income_category_id || null
      };
    });
  }

  calculateRemaining(proforma) {
    const total = Number(proforma.total) || 0;
    const paid = Number(proforma.payments_total) || 0;
    return Math.max(total - paid, 0);
  }

  createMatchingCandidates(payment, context) {
    const candidates = [];
    const paymentAmount = Number(payment.amount) || 0;
    const paymentCurrency = (payment.currency || 'PLN').toUpperCase();
    const usedProformaIds = new Set(); // Чтобы избежать дубликатов

    // 1. Поиск по номеру проформы
    // Сначала проверяем поле proforma_fullnumber (если было извлечено парсером)
    let normalizedNumber = this.normalizeProformaNumber(payment.proforma_fullnumber);
    
    // Если не было извлечено парсером, пытаемся извлечь из описания
    if (!normalizedNumber && payment.description) {
      const extracted = this.extractProformaNumberFromDescription(payment.description);
      if (extracted) {
        normalizedNumber = this.normalizeProformaNumber(extracted);
      }
    }
    
    if (normalizedNumber) {
      const candidate = context.proformasByNumber.get(normalizedNumber);
      if (candidate) {
        const remaining = this.calculateRemaining(candidate);
        const amountDiff = Math.abs(paymentAmount - remaining);
        const matched = amountDiff <= AMOUNT_TOLERANCE;

        candidates.push({
          proforma: candidate,
          proformaId: candidate.id,
          proformaFullnumber: candidate.fullnumber,
          proformaCurrency: candidate.currency,
          proformaTotal: Number(candidate.total) || 0,
          paymentsTotal: Number(candidate.payments_total) || 0,
          buyerName: candidate.buyer_name || null,
          score: matched ? 100 : 80,
          reason: matched ? 'По номеру проформы' : 'По номеру (разница в сумме)',
          amountDiff,
          remaining
        });
        usedProformaIds.add(String(candidate.id));
      } else {
        // Если номер проформы найден, но проформа не найдена в базе,
        // это может означать, что проформа удалена, еще не синхронизирована или номер неверный
        logger.debug('Proforma number found but proforma not in database', {
          paymentId: payment.id,
          proformaNumber: normalizedNumber,
          description: payment.description?.substring(0, 100)
        });
        
        // Добавляем кандидата с низким приоритетом, чтобы пользователь видел,
        // что номер проформы был найден, но проформа отсутствует в базе
        // Это поможет понять, что проформа была удалена или еще не синхронизирована
        candidates.push({
          proforma: null,
          proformaId: null,
          proformaFullnumber: normalizedNumber,
          proformaCurrency: paymentCurrency,
          proformaTotal: 0,
          paymentsTotal: 0,
          buyerName: null,
          score: 30,
          reason: `Проформа ${normalizedNumber} не найдена в базе (возможно, удалена)`,
          amountDiff: 0,
          remaining: 0
        });
      }
    }

    // 2. Поиск по имени клиента
    if (payment.payer_normalized_name) {
      const list = context.proformasByBuyer.get(payment.payer_normalized_name) || [];
      for (const proforma of list) {
        if (usedProformaIds.has(String(proforma.id))) continue;

        const remaining = this.calculateRemaining(proforma);
        const amountDiff = Math.abs(paymentAmount - remaining);
        let score = 50;
        let reason = 'По имени клиента';

        if (amountDiff <= AMOUNT_TOLERANCE) {
          score = 80;
          reason = 'По имени и сумме остатка';
        } else {
          const half = (Number(proforma.total) || 0) / 2;
          const halfDiff = Math.abs(paymentAmount - half);
          if (halfDiff <= AMOUNT_TOLERANCE) {
            score = 70;
            reason = 'Похоже на предоплату 50%';
          }
        }

        candidates.push({
          proforma,
          proformaId: proforma.id,
          proformaFullnumber: proforma.fullnumber,
          proformaCurrency: proforma.currency,
          proformaTotal: Number(proforma.total) || 0,
          paymentsTotal: Number(proforma.payments_total) || 0,
          buyerName: proforma.buyer_name || null,
          score,
          reason,
          amountDiff,
          remaining
        });
        usedProformaIds.add(String(proforma.id));
      }
    }

    // 3. Поиск по сумме (точное совпадение или половина для модели 50/50)
    // Это особенно важно, когда в описании платежа нет опознавательных знаков
    // Важно: сравниваем только проформы в той же валюте, что и платеж
    if (paymentAmount > 0 && Array.isArray(context.proformasByAmount)) {
      for (const proforma of context.proformasByAmount) {
        if (usedProformaIds.has(String(proforma.id))) continue;

        const proformaTotal = Number(proforma.total) || 0;
        const proformaPaymentsTotal = Number(proforma.payments_total) || 0;
        const remaining = this.calculateRemaining(proforma);
        
        // Пропускаем полностью оплаченные проформы
        if (remaining <= 0.01) continue;

        const proformaCurrency = (proforma.currency || 'PLN').toUpperCase();
        
        // Сравниваем только проформы в той же валюте, что и платеж
        if (proformaCurrency !== paymentCurrency) {
          continue;
        }

        // Проверяем точное совпадение суммы с остатком к оплате
        const exactDiff = Math.abs(paymentAmount - remaining);
        if (exactDiff <= AMOUNT_TOLERANCE) {
          candidates.push({
            proforma,
            proformaId: proforma.id,
            proformaFullnumber: proforma.fullnumber,
            proformaCurrency: proforma.currency,
            proformaTotal: proformaTotal,
            paymentsTotal: proformaPaymentsTotal,
            buyerName: proforma.buyer_name || null,
            score: 60,
            reason: 'По сумме (совпадение с остатком)',
            amountDiff: exactDiff,
            remaining
          });
          usedProformaIds.add(String(proforma.id));
          continue;
        }

        // Проверяем половину полной суммы проформы (модель 50/50, первый платеж)
        const halfTotal = proformaTotal / 2;
        const halfDiff = Math.abs(paymentAmount - halfTotal);
        if (halfDiff <= AMOUNT_TOLERANCE) {
          candidates.push({
            proforma,
            proformaId: proforma.id,
            proformaFullnumber: proforma.fullnumber,
            proformaCurrency: proforma.currency,
            proformaTotal: proformaTotal,
            paymentsTotal: proformaPaymentsTotal,
            buyerName: proforma.buyer_name || null,
            score: 55,
            reason: 'По сумме (половина проформы, модель 50/50)',
            amountDiff: halfDiff,
            remaining
          });
          usedProformaIds.add(String(proforma.id));
        }
      }
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  normalizeProformaNumber(value) {
    if (!value) return null;
    let normalized = normalizeWhitespace(String(value)).toUpperCase();
    // Стандартизируем формат: CO PROF -> CO-PROF
    normalized = normalized.replace(/CO\s+PROF/g, 'CO-PROF');
    // Убираем лишние пробелы вокруг слэша
    normalized = normalized.replace(/\s*\/\s*/g, '/');
    return normalized;
  }

  extractProformaNumberFromDescription(description) {
    if (!description) return null;
    
    // Улучшенное регулярное выражение для поиска номеров проформ в описании
    // Поддерживает: CO-PROF 123/2025, CO PROF 123/2025, CO-PROF123/2025 и т.д.
    // Также ищем варианты с пробелами вокруг слэша
    const PROFORMA_REGEX = /(CO-?\s*PROF\s*\d+\s*\/\s*\d{4})/i;
    const match = description.match(PROFORMA_REGEX);
    
    if (match && match[1]) {
      // Нормализуем формат: убираем лишние пробелы, стандартизируем дефис
      let normalized = match[1]
        .replace(/\s+/g, ' ')
        .replace(/CO\s+PROF/gi, 'CO-PROF')
        .replace(/\s*\/\s*/g, '/')
        .trim()
        .toUpperCase();
      
      // Убеждаемся, что формат правильный: CO-PROF XXX/YYYY
      // Если между CO и PROF нет дефиса, добавляем его
      if (!normalized.includes('CO-PROF')) {
        normalized = normalized.replace(/CO\s*PROF/i, 'CO-PROF');
      }
      
      return normalized;
    }
    
    return null;
  }

  async fetchPaymentRaw(paymentId) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .is('deleted_at', null) // Не возвращаем удаленные платежи
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('no rows')) {
        const notFoundError = new Error(`Payment ${paymentId} not found`);
        notFoundError.statusCode = 404;
        throw notFoundError;
      }
      logger.error('Supabase error while fetching payment by id:', error);
      throw error;
    }

    if (!data) {
      const notFoundError = new Error(`Payment ${paymentId} not found`);
      notFoundError.statusCode = 404;
      throw notFoundError;
    }

    return data;
  }

  async getPaymentDetails(paymentId) {
    const paymentRaw = await this.fetchPaymentRaw(paymentId);
    
    // Если номер проформы не был извлечен парсером, пытаемся извлечь из описания
    if (!paymentRaw.proforma_fullnumber && paymentRaw.description) {
      const extracted = this.extractProformaNumberFromDescription(paymentRaw.description);
      if (extracted) {
        paymentRaw.proforma_fullnumber = extracted;
      }
    }
    
    const resolved = this.resolvePaymentRecord(paymentRaw);

    let candidates = [];

    try {
      const context = await this.buildMatchingContext([paymentRaw]);
      const computed = this.createMatchingCandidates(paymentRaw, context).map((item) => ({
        proforma_id: item.proformaId,
        proforma_fullnumber: item.proformaFullnumber,
        proforma_currency: item.proformaCurrency,
        proforma_total: item.proformaTotal,
        payments_total: item.paymentsTotal,
        buyer_name: item.buyerName,
        remaining: item.remaining,
        score: item.score,
        reason: item.reason,
        amount_diff: item.amountDiff
      }));

      const uniqueMap = new Map(computed.map((item) => [item.proforma_id, item]));
      candidates = Array.from(uniqueMap.values());
    } catch (error) {
      logger.error('Failed to compute payment candidates:', error);
    }

    if (resolved.manual_status === MANUAL_STATUS_APPROVED && resolved.matched_proforma) {
      try {
        const [manualProforma] = await this.proformaRepository.findByFullnumbers([resolved.matched_proforma]);
        if (manualProforma) {
          const remaining = this.calculateRemaining(manualProforma);
          const manualCandidate = {
            proforma_id: manualProforma.id,
            proforma_fullnumber: manualProforma.fullnumber,
            proforma_currency: manualProforma.currency,
            proforma_total: Number(manualProforma.total) || 0,
            payments_total: Number(manualProforma.payments_total) || 0,
            buyer_name: manualProforma.buyer_name || null,
            remaining,
            score: 100,
            reason: 'Подтверждено вручную',
            amount_diff: 0
          };

          candidates = [
            manualCandidate,
            ...candidates.filter((item) => item.proforma_id !== manualCandidate.proforma_id)
          ];
        }
      } catch (error) {
        logger.error('Failed to fetch manual proforma details:', error);
      }
    }

    return {
      payment: resolved,
      candidates
    };
  }

  async assignManualMatch(paymentId, fullnumber, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);

    const normalizedNumber = this.normalizeProformaNumber(fullnumber);
    if (!normalizedNumber) {
      const validationError = new Error('Введите корректный номер проформы');
      validationError.statusCode = 400;
      throw validationError;
    }

    // Сначала пробуем точный поиск
    let [proforma] = await this.proformaRepository.findByFullnumbers([normalizedNumber]);
    
    // Если не найдено, пробуем гибкий поиск (для случаев когда год указан сокращенно или полностью)
    if (!proforma) {
      // Извлекаем номер и год из формата CO-PROF XXX/YYYY или CO-PROF XXX/YY
      const match = normalizedNumber.match(/CO-PROF\s+(\d+)\/(\d{2,4})/);
      if (match) {
        const number = match[1];
        const year = match[2];
        
        // Генерируем варианты поиска
        const searchVariants = [];
        
        // Если год 2-значный (например, "202"), пробуем разные варианты
        if (year.length === 2) {
          const currentYear = new Date().getFullYear();
          const century = Math.floor(currentYear / 100) * 100;
          // Пробуем текущий век (например, 202 -> 2025)
          searchVariants.push(`CO-PROF ${number}/${century + parseInt(year)}`);
          // Пробуем предыдущий век (например, 202 -> 2024)
          searchVariants.push(`CO-PROF ${number}/${century - 100 + parseInt(year)}`);
        }
        
        // Если год 3-значный (например, "202"), пробуем разные варианты
        if (year.length === 3) {
          const currentYear = new Date().getFullYear();
          const century = Math.floor(currentYear / 100) * 100;
          
          // Пробуем как 2-значный год (последние 2 цифры)
          const shortYear = year.slice(-2);
          searchVariants.push(`CO-PROF ${number}/${century + parseInt(shortYear)}`);
          searchVariants.push(`CO-PROF ${number}/${century - 100 + parseInt(shortYear)}`);
          
          // Пробуем как начало 4-значного года (202 -> 2020-2029)
          // Если текущий год в диапазоне 2020-2029, пробуем текущий год и соседние
          const yearPrefix = parseInt(year);
          if (yearPrefix >= 200 && yearPrefix <= 209) {
            const baseYear = 2000 + yearPrefix;
            // Пробуем текущий год и несколько соседних
            for (let offset = -2; offset <= 2; offset++) {
              const candidateYear = baseYear + offset;
              if (candidateYear >= 2000 && candidateYear <= 2099) {
                searchVariants.push(`CO-PROF ${number}/${candidateYear}`);
              }
            }
          } else {
            // Если не в диапазоне 200-209, пробуем просто добавить цифру в начало
            searchVariants.push(`CO-PROF ${number}/2${year}`);
          }
        }
        
        // Если год 4-значный, пробуем с 2-значным
        if (year.length === 4) {
          const shortYear = year.slice(-2);
          searchVariants.push(`CO-PROF ${number}/${shortYear}`);
        }
        
        // Пробуем найти по вариантам
        if (searchVariants.length > 0) {
          const proformas = await this.proformaRepository.findByFullnumbers(searchVariants);
          if (proformas.length > 0) {
            proforma = proformas[0];
            logger.info('Proforma found with flexible year search', {
              requested: normalizedNumber,
              found: proforma.fullnumber,
              variants: searchVariants
            });
          }
        }
      }
      
      // Если все еще не найдено, пробуем частичный поиск через ILIKE
      if (!proforma) {
        const partialSearch = await this.proformaRepository.findByFullnumberPartial(normalizedNumber);
        if (partialSearch.length > 0) {
          proforma = partialSearch[0];
          logger.info('Proforma found with partial search', {
            requested: normalizedNumber,
            found: proforma.fullnumber
          });
        }
      }
    }
    
    if (!proforma) {
      // Пробуем найти похожие проформы для более информативного сообщения
      let suggestions = [];
      const match = normalizedNumber.match(/CO-PROF\s+(\d+)\//);
      if (match) {
        const number = match[1];
        try {
          const similarProformas = await this.proformaRepository.findByFullnumberPartial(`CO-PROF ${number}/`);
          suggestions = similarProformas.slice(0, 5).map(p => p.fullnumber);
        } catch (suggestError) {
          logger.debug('Failed to get suggestions for similar proformas', { error: suggestError.message });
        }
      }
      
      let errorMessage = `Проформа ${normalizedNumber} не найдена`;
      if (suggestions.length > 0) {
        errorMessage += `. Возможно, вы имели в виду: ${suggestions.join(', ')}`;
      }
      
      const notFoundError = new Error(errorMessage);
      notFoundError.statusCode = 404;
      if (suggestions.length > 0) {
        notFoundError.suggestions = suggestions;
      }
      throw notFoundError;
    }

    // ID категории "На счет" для автоматического присвоения при ручном назначении проформы
    const INCOME_CATEGORY_ON_ACCOUNT_ID = 2;
    
    const now = new Date().toISOString();
    
    // Автоматически присваиваем категорию "На счет" при ручном назначении проформы
    // Только для доходов (direction='in') и только если категория еще не присвоена
    const shouldAssignCategory = raw.direction === 'in' && !raw.income_category_id;

    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: MANUAL_STATUS_APPROVED,
        manual_proforma_id: proforma.id,
        manual_proforma_fullnumber: proforma.fullnumber,
        manual_comment: comment || null,
        manual_user: user || null,
        manual_updated_at: now,
        // Автоматически присваиваем категорию "На счет" при ручном назначении проформы
        income_category_id: shouldAssignCategory ? INCOME_CATEGORY_ON_ACCOUNT_ID : (raw.income_category_id || null)
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while assigning manual match:', error);
      throw error;
    }

    await this.updateProformaPaymentAggregates(proforma.id);

    return this.getPaymentDetails(paymentId);
  }

  async bulkApproveAutoMatches() {
    const error = new Error('Массовое подтверждение отключено. Подтверждайте платежи вручную.');
    error.statusCode = 400;
    throw error;
  }

  async approveAutoMatch(paymentId, { user = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);

    const suggestedProformaId = raw.auto_proforma_id || raw.proforma_id || null;
    const suggestedProformaFullnumber = raw.auto_proforma_fullnumber || raw.proforma_fullnumber || null;

    if (!suggestedProformaId || !suggestedProformaFullnumber) {
      const validationError = new Error('Для этого платежа нет автоматического совпадения');
      validationError.statusCode = 400;
      throw validationError;
    }

    // ID категории "На счет" для автоматического присвоения при одобрении метчинга
    const INCOME_CATEGORY_ON_ACCOUNT_ID = 2;
    
    const now = new Date().toISOString();
    
    // Автоматически присваиваем категорию "На счет" при одобрении метчинга проформы
    // Только для доходов (direction='in')
    const shouldAssignCategory = raw.direction === 'in';
    
    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: MANUAL_STATUS_APPROVED,
        manual_proforma_id: suggestedProformaId,
        manual_proforma_fullnumber: suggestedProformaFullnumber,
        manual_comment: raw.match_reason || null,
        manual_user: user || 'quick-auto',
        manual_updated_at: now,
        match_status: 'matched',
        proforma_id: suggestedProformaId,
        proforma_fullnumber: suggestedProformaFullnumber,
        auto_proforma_id: null,
        auto_proforma_fullnumber: null,
        // Автоматически присваиваем категорию "На счет" при одобрении метчинга
        income_category_id: shouldAssignCategory && !raw.income_category_id 
          ? INCOME_CATEGORY_ON_ACCOUNT_ID 
          : raw.income_category_id || null
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while approving payment match:', error);
      throw error;
    }

    logger.info('Payment manually linked to proforma', {
      paymentId,
      proformaId: suggestedProformaId,
      proformaFullnumber: suggestedProformaFullnumber,
      user: user || 'quick-auto'
    });

    await this.updateProformaPaymentAggregates(suggestedProformaId);

    return this.getPaymentDetails(paymentId);
  }

  /**
   * Mark payment as refund - send to PNL refunds section
   * Sets income_category_id to refunds category and prevents matching to proformas
   * @param {string|number} paymentId - Payment ID
   * @param {number} refundsCategoryId - Income category ID for refunds
   * @param {Object} options - Options
   * @param {string} [options.user=null] - User who marked as refund
   * @param {string} [options.comment=null] - Comment
   * @returns {Promise<Object>} Updated payment with candidates
   */
  async markPaymentAsRefund(paymentId, refundsCategoryId, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);
    
    if (raw.direction !== 'in') {
      throw new Error('Only income payments (direction=in) can be marked as refunds');
    }

    const now = new Date().toISOString();
    
    // Update payment: set income_category_id to refunds category, clear proforma matching
    const { data: updated, error } = await supabase
      .from('payments')
      .update({
        income_category_id: refundsCategoryId,
        match_status: 'unmatched', // Don't match to proformas
        manual_status: null, // Clear manual matching
        manual_proforma_id: null,
        manual_proforma_fullnumber: null,
        manual_comment: comment || null,
        manual_user: user || null,
        manual_updated_at: now,
        updated_at: now
      })
      .eq('id', paymentId)
      .select('*')
      .single();

    if (error) {
      logger.error('Supabase error while marking payment as refund:', error);
      throw error;
    }

    logger.info(`Payment ${paymentId} marked as refund`, {
      refundsCategoryId,
      user,
      comment
    });

    // Return updated payment with candidates (empty since it won't match to proformas)
    const resolved = this.resolvePaymentRecord(updated);
    return {
      payment: resolved,
      candidates: []
    };
  }

  async clearManualMatch(paymentId, { user = null, comment = null } = {}) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);
    const targetProformaId = raw.manual_proforma_id;

    const now = new Date().toISOString();

    const { error } = await supabase
      .from('payments')
      .update({
        manual_status: null,
        manual_proforma_id: null,
        manual_proforma_fullnumber: null,
        manual_comment: comment || null,
        manual_user: user || null,
        manual_updated_at: now
      })
      .eq('id', paymentId);

    if (error) {
      logger.error('Supabase error while clearing manual match:', error);
      throw error;
    }

    logger.info('Payment manual link cleared', {
      paymentId,
      previousProformaId: targetProformaId,
      previousProformaFullnumber: raw.manual_proforma_fullnumber || null,
      user
    });
    
    if (targetProformaId) {
      await this.updateProformaPaymentAggregates(targetProformaId);
    }

    if (raw.proforma_id && raw.proforma_id !== targetProformaId) {
      await this.updateProformaPaymentAggregates(raw.proforma_id);
    }

    return this.getPaymentDetails(paymentId);
  }

  async deletePayment(paymentId) {
    if (!supabase) {
      throw new Error('Supabase client is not configured');
    }

    const raw = await this.fetchPaymentRaw(paymentId);
    const targetProformaId = raw.manual_proforma_id || raw.proforma_id;

    // Мягкое удаление: помечаем платеж как удаленный вместо реального удаления
    // Это предотвращает восстановление платежа при повторной загрузке CSV
    const { error } = await supabase
      .from('payments')
      .update({ 
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', paymentId)
      .is('deleted_at', null); // Только если еще не удален

    if (error) {
      logger.error('Supabase error while soft-deleting payment:', error);
      throw error;
    }

    if (targetProformaId) {
      await this.updateProformaPaymentAggregates(targetProformaId);
    }

    if (raw.manual_proforma_id && raw.manual_proforma_id !== targetProformaId) {
      await this.updateProformaPaymentAggregates(raw.manual_proforma_id);
    }
  }

  async triggerCrmStatusAutomation({ dealIds = [], proformaIds = [], reason = 'payments' } = {}) {
    const service = this.crmStatusAutomationService;
    if (!service || (typeof service.isEnabled === 'function' && !service.isEnabled())) {
      return;
    }

    const normalizedDealIds = new Set(
      (dealIds || [])
        .map((id) => String(id).trim())
        .filter((id) => id.length > 0)
    );

    if (Array.isArray(proformaIds) && proformaIds.length > 0) {
      try {
        const proformas = await this.proformaRepository.findByIds(proformaIds);
        for (const proforma of proformas) {
          if (proforma?.pipedrive_deal_id) {
            normalizedDealIds.add(String(proforma.pipedrive_deal_id).trim());
          }
        }
      } catch (error) {
        logger.warn('Failed to load proformas for CRM automation trigger', {
          reason,
          error: error.message
        });
      }
    }

    if (normalizedDealIds.size === 0) {
      return;
    }

    for (const dealId of normalizedDealIds) {
      try {
        await service.syncDealStage(dealId, { reason });
      } catch (error) {
        logger.warn('CRM status automation failed', {
          dealId,
          reason,
          error: error.message
        });
      }
    }
  }

  async buildMatchingContext(payments) {
    const context = {
      proformasByNumber: new Map(),
      proformasByBuyer: new Map(),
      proformasByAmount: [] // Для поиска по сумме
    };

    if (!payments.length) {
      return context;
    }

    // Извлекаем номера проформ из поля proforma_fullnumber и из описания
    const numbers = new Set();
    for (const payment of payments) {
      // Из поля proforma_fullnumber (если было извлечено парсером)
      if (payment.proforma_fullnumber) {
        const normalized = this.normalizeProformaNumber(payment.proforma_fullnumber);
        if (normalized) {
          numbers.add(normalized);
        }
      }
      
      // Также пытаемся извлечь из описания, если не было извлечено парсером
      if (payment.description && !payment.proforma_fullnumber) {
        const extracted = this.extractProformaNumberFromDescription(payment.description);
        if (extracted) {
          const normalized = this.normalizeProformaNumber(extracted);
          if (normalized) {
            numbers.add(normalized);
          }
        }
      }
    }

    const buyerNames = Array.from(new Set(
      payments
        .map((item) => item.payer_normalized_name)
        .filter(Boolean)
    ));

    if (numbers.size > 0) {
      const numbersArray = Array.from(numbers);
      logger.debug('Searching proformas by numbers', {
        count: numbersArray.length,
        numbers: numbersArray.slice(0, 5)
      });
      
      const proformas = await this.proformaRepository.findByFullnumbers(numbersArray);
      logger.debug('Found proformas by numbers', {
        requested: numbersArray.length,
        found: proformas.length,
        foundNumbers: proformas.map(p => p.fullnumber).slice(0, 5)
      });
      
      for (const proforma of proformas) {
        if (proforma.fullnumber) {
          // Пропускаем полностью оплаченные проформы
          const remaining = this.calculateRemaining(proforma);
          if (remaining <= 0.01) continue;
          
          const normalized = this.normalizeProformaNumber(proforma.fullnumber);
          context.proformasByNumber.set(normalized, proforma);
        }
      }
    }

    if (buyerNames.length > 0) {
      const proformas = await this.proformaRepository.findByBuyerNames(buyerNames);
      for (const proforma of proformas) {
        // Пропускаем полностью оплаченные проформы
        const remaining = this.calculateRemaining(proforma);
        if (remaining <= 0.01) continue;
        
        const key = proforma.buyer_normalized_name;
        if (!key) continue;
        if (!context.proformasByBuyer.has(key)) {
          context.proformasByBuyer.set(key, []);
        }
        context.proformasByBuyer.get(key).push(proforma);
      }
    }

    // Загружаем активные проформы для поиска по сумме
    // Ограничиваем последними 6 месяцами для производительности
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      
      if (supabase) {
        const { data: activeProformas, error } = await supabase
          .from('proformas')
          .select('id, fullnumber, currency, total, payments_total, payments_total_pln, currency_exchange, buyer_name, buyer_normalized_name')
          .eq('status', 'active')
          .gte('issued_at', sixMonthsAgo.toISOString())
          .limit(1000); // Ограничиваем для производительности

        if (!error && activeProformas) {
          context.proformasByAmount = activeProformas;
        }
      }
    } catch (error) {
      logger.warn('Failed to load proformas for amount matching:', error);
    }

    return context;
  }
}

module.exports = PaymentService;
