const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const crypto = require('crypto');
const FacebookAdsMappingService = require('./facebookAdsMappingService');
const FacebookAdsExpenseService = require('./facebookAdsExpenseService');
const { parseFacebookAdsCsv } = require('./facebookAdsCsvParser');

/**
 * Service for importing Facebook Ads CSV files
 */
class FacebookAdsImportService {
  constructor() {
    this.mappingService = new FacebookAdsMappingService();
    this.expenseService = new FacebookAdsExpenseService();
  }

  /**
   * Calculate file hash for duplicate detection
   * @param {string} content - File content
   * @returns {string} - SHA256 hash
   */
  calculateFileHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Check if file was already imported
   * @param {string} fileHash - File hash
   * @returns {Promise<Object|null>} - Import batch or null
   */
  async findExistingImport(fileHash) {
    if (!supabase || !fileHash) {
      return null;
    }

    const { data, error } = await supabase
      .from('facebook_ads_import_batches')
      .select('*')
      .eq('file_hash', fileHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      logger.error('Failed to check existing import', {
        error: error.message,
        fileHash
      });
      return null;
    }

    return data;
  }

  /**
   * Create import batch record
   * @param {Object} params
   * @param {string} params.fileName - File name
   * @param {string} params.fileHash - File hash
   * @param {number} params.totalRows - Total rows in CSV
   * @param {string} [params.importedBy] - User identifier
   * @returns {Promise<Object>} - Created batch
   */
  async createImportBatch({ fileName, fileHash, totalRows, importedBy = null }) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const { data, error } = await supabase
      .from('facebook_ads_import_batches')
      .insert({
        file_name: fileName,
        file_hash: fileHash,
        total_rows: totalRows,
        imported_by: importedBy
      })
      .select()
      .single();

    if (error) {
      logger.error('Failed to create import batch', {
        error: error.message
      });
      throw new Error('Не удалось создать батч импорта');
    }

    return data;
  }

  /**
   * Update import batch statistics
   * @param {string} batchId - Batch ID
   * @param {Object} stats - Statistics
   * @param {number} stats.processedRows - Processed rows count
   * @param {number} stats.mappedRows - Mapped rows count
   * @param {number} stats.unmappedRows - Unmapped rows count
   * @param {Array} [stats.errors] - Error array
   * @returns {Promise<Object>} - Updated batch
   */
  async updateImportBatch(batchId, stats) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    const updateData = {
      processed_rows: stats.processedRows || 0,
      mapped_rows: stats.mappedRows || 0,
      unmapped_rows: stats.unmappedRows || 0
    };

    if (stats.errors) {
      updateData.errors = stats.errors;
    }

    const { data, error } = await supabase
      .from('facebook_ads_import_batches')
      .update(updateData)
      .eq('id', batchId)
      .select()
      .single();

    if (error) {
      logger.error('Failed to update import batch', {
        error: error.message,
        batchId
      });
      throw new Error('Не удалось обновить батч импорта');
    }

    return data;
  }

  /**
   * Import CSV file (main method)
   * @param {string} csvContent - CSV file content
   * @param {string} fileName - File name
   * @param {string} [userId] - User identifier
   * @returns {Promise<Object>} - Import results
   */
  async importCsv(csvContent, fileName, userId = null) {
    if (!supabase) {
      throw new Error('Supabase недоступен');
    }

    // Calculate file hash
    const fileHash = this.calculateFileHash(csvContent);

    // Check for duplicate import
    const existingImport = await this.findExistingImport(fileHash);
    if (existingImport) {
      logger.warn('Duplicate import detected', {
        fileName,
        fileHash,
        existingBatchId: existingImport.id
      });
      // Return existing import info but don't throw - allow re-import if needed
      // throw new Error('Этот файл уже был импортирован ранее');
    }

    // Parse CSV
    const parseResult = parseFacebookAdsCsv(csvContent);
    
    logger.info('Facebook Ads Import: CSV parse result', {
      fileName,
      totalRows: parseResult.totalRows,
      validRecords: parseResult.records.length,
      errorsCount: parseResult.errors.length,
      errors: parseResult.errors.slice(0, 10) // First 10 errors
    });

    if (parseResult.errors.length > 0) {
      logger.warn('CSV parsing errors', {
        fileName,
        errorsCount: parseResult.errors.length,
        errors: parseResult.errors.slice(0, 10)
      });
    }

    if (parseResult.records.length === 0) {
      logger.error('Facebook Ads Import: No valid records found', {
        fileName,
        totalRows: parseResult.totalRows,
        errors: parseResult.errors,
        firstFewLines: csvContent.split('\n').slice(0, 5)
      });
      throw new Error(`CSV файл не содержит валидных записей. Всего строк: ${parseResult.totalRows}, ошибок: ${parseResult.errors.length}. Первая ошибка: ${parseResult.errors[0]?.message || 'неизвестно'}`);
    }

    // Create import batch
    const batch = await this.createImportBatch({
      fileName,
      fileHash,
      totalRows: parseResult.totalRows,
      importedBy: userId
    });

    const batchId = batch.id;
    let processedRows = 0;
    let mappedRows = 0;
    let unmappedRows = 0;
    const errors = [...parseResult.errors];

    // Process each record
    const statusChecks = [];
    for (const record of parseResult.records) {
      try {
        // Find mapping for this campaign
        const mapping = await this.mappingService.getMappingByCampaign(record.campaignName);

        // Get previous expense before updating (for status detection)
        const previousExpense = await this.expenseService.getExpenseByCampaignAndPeriod(
          record.campaignNameNormalized,
          record.reportStartDate,
          record.reportEndDate
        );

        // Create or update expense
        await this.expenseService.upsertExpense({
          campaignName: record.campaignName,
          campaignNameNormalized: record.campaignNameNormalized,
          productId: mapping ? mapping.product_id : null,
          reportStartDate: record.reportStartDate,
          reportEndDate: record.reportEndDate,
          amountPln: record.amountPln,
          currency: record.currency,
          importBatchId: batchId
        });

        // Store for status check
        if (previousExpense) {
          statusChecks.push({
            record,
            previousAmount: parseFloat(previousExpense.amount_pln || 0),
            previousActive: previousExpense.is_campaign_active
          });
        }

        processedRows += 1;
        if (mapping) {
          mappedRows += 1;
        } else {
          unmappedRows += 1;
        }
      } catch (error) {
        logger.error('Error processing CSV record', {
          error: error.message,
          record,
          batchId
        });
        errors.push({
          row: record.rowNumber,
          message: `Ошибка обработки: ${error.message}`,
          campaignName: record.campaignName
        });
      }
    }

    // Update batch statistics
    await this.updateImportBatch(batchId, {
      processedRows,
      mappedRows,
      unmappedRows,
      errors
    });

    // Detect campaign status changes (compare with previous import)
    await this.detectCampaignStatusChanges(statusChecks);

    return {
      success: true,
      batchId,
      totalRows: parseResult.totalRows,
      processedRows,
      mappedRows,
      unmappedRows,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Detect campaign status changes (active/inactive)
   * @param {Array} statusChecks - Array of {record, previousAmount, previousActive}
   * @returns {Promise<void>}
   */
  async detectCampaignStatusChanges(statusChecks) {
    if (!supabase || !statusChecks || statusChecks.length === 0) {
      return;
    }

    for (const { record, previousAmount, previousActive } of statusChecks) {
      try {
        // Compare amounts - if same, campaign is inactive
        const currentAmount = record.amountPln;
        const isActive = Math.abs(previousAmount - currentAmount) > 0.01; // Allow small rounding differences

        if (previousActive !== isActive) {
          await this.expenseService.updateCampaignStatus(
            record.campaignNameNormalized,
            isActive
          );
        }
      } catch (error) {
        logger.warn('Error detecting campaign status', {
          error: error.message,
          record
        });
      }
    }
  }
}

module.exports = FacebookAdsImportService;

