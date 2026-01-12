const supabase = require('../supabaseClient');
const logger = require('../../utils/logger');
const receiptExtractionService = require('./receiptExtractionService');
const receiptMatchingService = require('./receiptMatchingService');

/**
 * Main service for receipt uploads and management
 */
class ReceiptService {
  constructor() {
    // Supabase Storage bucket name
    // NOTE: Bucket must be created manually in Supabase Dashboard:
    // Storage → Create bucket → Name: "receipts" → Public: false
    this.storageBucket = 'receipts';
  }

  /**
   * Upload receipt file and start processing
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} originalFilename - Original filename
   * @param {string} mimeType - MIME type
   * @param {string} uploadedBy - User identifier
   * @returns {Promise<{receiptId: string, status: string}>}
   */
  async uploadReceipt(fileBuffer, originalFilename, mimeType, uploadedBy = null) {
    try {
      // Create receipt_uploads record
      const { data: receipt, error: receiptError } = await supabase
        .from('receipt_uploads')
        .insert({
          original_filename: originalFilename,
          mime_type: mimeType,
          size_bytes: fileBuffer.length,
          uploaded_by: uploadedBy,
          status: 'uploaded'
        })
        .select()
        .single();

      if (receiptError || !receipt) {
        throw new Error(`Failed to create receipt record: ${receiptError?.message || 'Unknown error'}`);
      }

      // Upload file to Supabase Storage
      const storagePath = `${receipt.id}/${originalFilename}`;
      const { error: storageError } = await supabase.storage
        .from(this.storageBucket)
        .upload(storagePath, fileBuffer, {
          contentType: mimeType,
          upsert: false
        });

      if (storageError) {
        // If storage fails, try to delete the record
        await supabase
          .from('receipt_uploads')
          .delete()
          .eq('id', receipt.id);

        // Check if bucket doesn't exist
        if (storageError.message?.includes('Bucket not found') || storageError.message?.includes('not found')) {
          throw new Error(`Storage bucket "${this.storageBucket}" не найден. Создайте bucket в Supabase Dashboard: Storage → Create bucket → Name: "receipts"`);
        }

        throw new Error(`Failed to upload file to storage: ${storageError.message}`);
      }

      // Update receipt with storage info
      const { error: updateError } = await supabase
        .from('receipt_uploads')
        .update({
          storage_bucket: this.storageBucket,
          storage_path: storagePath,
          status: 'processing'
        })
        .eq('id', receipt.id);

      if (updateError) {
        logger.warn('Failed to update receipt with storage path', { error: updateError });
      }

      // Start async processing (don't await)
      this.processReceipt(receipt.id, fileBuffer, mimeType).catch(err => {
        logger.error('Error processing receipt', {
          receiptId: receipt.id,
          error: err.message
        });
      });

      return {
        receiptId: receipt.id,
        status: 'processing'
      };

    } catch (error) {
      logger.error('Error uploading receipt', {
        error: error.message,
        filename: originalFilename,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Process receipt: extract data and find candidates
   * @param {string} receiptId - Receipt ID
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} mimeType - MIME type
   */
  async processReceipt(receiptId, fileBuffer, mimeType) {
    try {
      // Create extraction record
      const { data: extraction, error: extractionError } = await supabase
        .from('receipt_extractions')
        .insert({
          receipt_id: receiptId,
          status: 'processing'
        })
        .select()
        .single();

      if (extractionError) {
        throw new Error(`Failed to create extraction record: ${extractionError.message}`);
      }

      // Extract data from receipt
      const extracted = await receiptExtractionService.extractReceiptData(fileBuffer, mimeType);

      // Update extraction record
      const extractionStatus = extracted.error ? 'failed' : 'done';
      const { error: updateError } = await supabase
        .from('receipt_extractions')
        .update({
          status: extractionStatus,
          extracted_json: {
            vendor: extracted.vendor,
            date: extracted.date,
            amount: extracted.amount,
            currency: extracted.currency,
            confidence: extracted.confidence,
            raw_text: extracted.raw_text,
            error: extracted.error || null
          },
          error: extracted.error || null
        })
        .eq('id', extraction.id);

      if (updateError) {
        logger.warn('Failed to update extraction record', { error: updateError });
      }

      // Find candidate payments
      let candidates = [];
      if (!extracted.error && (extracted.amount || extracted.date)) {
        candidates = await receiptMatchingService.findCandidates(extracted);
      }

      // Update receipt status
      const receiptStatus = extracted.error ? 'failed' : 'processing';
      await supabase
        .from('receipt_uploads')
        .update({ status: receiptStatus })
        .eq('id', receiptId);

      logger.info('Receipt processing completed', {
        receiptId,
        extracted: !!extracted.amount,
        candidatesCount: candidates.length
      });

    } catch (error) {
      logger.error('Error processing receipt', {
        receiptId,
        error: error.message,
        stack: error.stack
      });

      // Update extraction status to failed
      await supabase
        .from('receipt_extractions')
        .update({
          status: 'failed',
          error: error.message
        })
        .eq('receipt_id', receiptId);

      // Update receipt status to failed
      await supabase
        .from('receipt_uploads')
        .update({ status: 'failed' })
        .eq('id', receiptId);
    }
  }

  /**
   * Get receipt details with extraction and candidates
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<Object>}
   */
  async getReceiptDetails(receiptId) {
    try {
      // Get receipt
      const { data: receipt, error: receiptError } = await supabase
        .from('receipt_uploads')
        .select('*')
        .eq('id', receiptId)
        .single();

      if (receiptError || !receipt) {
        throw new Error(`Receipt not found: ${receiptError?.message || 'Unknown error'}`);
      }

      // Get extraction
      const { data: extraction } = await supabase
        .from('receipt_extractions')
        .select('*')
        .eq('receipt_id', receiptId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      // Get payment link if exists
      const { data: link } = await supabase
        .from('receipt_payment_links')
        .select('*')
        .eq('receipt_id', receiptId)
        .single();

      // Get candidates if extraction is done
      // Always re-search candidates to catch newly added payments
      let candidates = [];
      if (extraction && extraction.status === 'done' && extraction.extracted_json) {
        const extracted = extraction.extracted_json;
        if (extracted.amount || extracted.date) {
          candidates = await receiptMatchingService.findCandidates(extracted);
          logger.info('Receipt candidates found', {
            receiptId,
            candidatesCount: candidates.length,
            hasAmount: !!extracted.amount,
            hasDate: !!extracted.date
          });
        }
      }

      return {
        receipt,
        extraction: extraction || null,
        link: link || null,
        candidates
      };

    } catch (error) {
      logger.error('Error getting receipt details', {
        receiptId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Re-search candidates for a receipt (useful when payments are added later)
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<Array>} Array of candidate payments
   */
  async reSearchCandidates(receiptId) {
    try {
      // Get extraction
      const { data: extraction } = await supabase
        .from('receipt_extractions')
        .select('*')
        .eq('receipt_id', receiptId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!extraction || extraction.status !== 'done' || !extraction.extracted_json) {
        throw new Error('Extraction not found or not completed');
      }

      const extracted = extraction.extracted_json;
      if (!extracted.amount && !extracted.date) {
        throw new Error('Insufficient extraction data (no amount or date)');
      }

      // Re-search candidates
      const candidates = await receiptMatchingService.findCandidates(extracted);
      
      logger.info('Re-searched candidates for receipt', {
        receiptId,
        candidatesCount: candidates.length,
        extractedAmount: extracted.amount,
        extractedDate: extracted.date
      });

      return candidates;

    } catch (error) {
      logger.error('Error re-searching candidates', {
        receiptId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Link receipt to payment
   * @param {string} receiptId - Receipt ID
   * @param {number} paymentId - Payment ID
   * @param {string} linkedBy - User identifier
   * @returns {Promise<Object>}
   */
  async linkPayment(receiptId, paymentId, linkedBy = null) {
    try {
      // Check if link already exists
      const { data: existingLink } = await supabase
        .from('receipt_payment_links')
        .select('*')
        .eq('receipt_id', receiptId)
        .single();

      if (existingLink) {
        // Update existing link
        const { data: link, error } = await supabase
          .from('receipt_payment_links')
          .update({
            payment_id: paymentId,
            linked_by: linkedBy,
            linked_at: new Date().toISOString()
          })
          .eq('id', existingLink.id)
          .select()
          .single();

        if (error) throw error;
        return link;
      } else {
        // Create new link
        const { data: link, error } = await supabase
          .from('receipt_payment_links')
          .insert({
            receipt_id: receiptId,
            payment_id: paymentId,
            linked_by: linkedBy
          })
          .select()
          .single();

        if (error) throw error;

        // Update receipt status
        await supabase
          .from('receipt_uploads')
          .update({ status: 'matched' })
          .eq('id', receiptId);

        return link;
      }

    } catch (error) {
      logger.error('Error linking receipt to payment', {
        receiptId,
        paymentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Unlink receipt from payment
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<void>}
   */
  async unlinkPayment(receiptId) {
    try {
      const { error } = await supabase
        .from('receipt_payment_links')
        .delete()
        .eq('receipt_id', receiptId);

      if (error) throw error;

      // Update receipt status back to processing
      await supabase
        .from('receipt_uploads')
        .update({ status: 'processing' })
        .eq('id', receiptId);

    } catch (error) {
      logger.error('Error unlinking receipt', {
        receiptId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get signed URL for receipt file
   * @param {string} receiptId - Receipt ID
   * @returns {Promise<string|null>}
   */
  async getReceiptFileUrl(receiptId) {
    try {
      const { data: receipt, error: receiptError } = await supabase
        .from('receipt_uploads')
        .select('storage_bucket, storage_path')
        .eq('id', receiptId)
        .single();

      if (receiptError) {
        logger.error('Error fetching receipt record', {
          receiptId,
          error: receiptError.message
        });
        throw new Error(`Receipt not found: ${receiptError.message}`);
      }

      if (!receipt || !receipt.storage_path) {
        logger.warn('Receipt has no storage path', {
          receiptId,
          receipt: receipt ? { hasStoragePath: !!receipt.storage_path } : null
        });
        throw new Error('Receipt file not found in storage');
      }

      const bucket = receipt.storage_bucket || this.storageBucket;
      const { data, error: urlError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(receipt.storage_path, 3600); // 1 hour expiry

      if (urlError) {
        logger.error('Error creating signed URL', {
          receiptId,
          bucket,
          storagePath: receipt.storage_path,
          error: urlError.message
        });
        throw new Error(`Failed to create file URL: ${urlError.message}`);
      }

      if (!data || !data.signedUrl) {
        logger.error('Signed URL not returned', {
          receiptId,
          bucket,
          storagePath: receipt.storage_path,
          data
        });
        throw new Error('Signed URL not generated');
      }

      return data.signedUrl;

    } catch (error) {
      logger.error('Error getting receipt file URL', {
        receiptId,
        error: error.message,
        stack: error.stack
      });
      throw error; // Re-throw to let API handle it
    }
  }

  /**
   * List all receipts
   * @param {Object} options - Options {limit, offset, status}
   * @returns {Promise<Array>}
   */
  async listReceipts(options = {}) {
    const { limit = 50, offset = 0, status = null } = options;

    try {
      let query = supabase
        .from('receipt_uploads')
        .select('*')
        .is('deleted_at', null)
        .order('uploaded_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data || [];

    } catch (error) {
      logger.error('Error listing receipts', {
        error: error.message
      });
      throw error;
    }
  }
}

module.exports = new ReceiptService();

