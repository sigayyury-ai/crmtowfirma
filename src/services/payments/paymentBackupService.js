/**
 * PaymentBackupService - Pre-import backups with auto-cleanup
 * 
 * Creates snapshots of payments before CSV import.
 * Backups are automatically deleted after 24 hours.
 */

const { createClient } = require('@supabase/supabase-js');
const logger = require('../../utils/logger');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

class PaymentBackupService {
  constructor() {
    this.BACKUP_RETENTION_HOURS = 24;
  }

  /**
   * Create a backup of payments that might be affected by import
   * @param {string} importId - Import ID for reference
   * @param {Array} operationDates - Dates from CSV to determine which payments to backup
   * @returns {Promise<Object>} Backup record
   */
  async createPreImportBackup(importId, operationDates = []) {
    try {
      if (!operationDates || operationDates.length === 0) {
        logger.info('No dates provided for backup, skipping');
        return null;
      }

      // Get unique dates
      const uniqueDates = [...new Set(operationDates.filter(Boolean))];
      
      // Fetch all payments for these dates (to backup before potential changes)
      const { data: paymentsToBackup, error: fetchError } = await supabase
        .from('payments')
        .select('id, operation_hash, operation_date, amount, currency, direction, payer_name, description, expense_category_id, income_category_id, proforma_id, match_status, manual_status, deleted_at, created_at')
        .in('operation_date', uniqueDates);

      if (fetchError) {
        logger.error('Failed to fetch payments for backup', { error: fetchError.message });
        throw fetchError;
      }

      if (!paymentsToBackup || paymentsToBackup.length === 0) {
        logger.info('No existing payments found for backup dates', { dates: uniqueDates.slice(0, 5) });
        return null;
      }

      // Create backup record
      const expiresAt = new Date(Date.now() + this.BACKUP_RETENTION_HOURS * 60 * 60 * 1000);
      
      const { data: backup, error: insertError } = await supabase
        .from('payment_backups')
        .insert({
          import_id: importId,
          backup_type: 'pre_import',
          payments_count: paymentsToBackup.length,
          payments_data: paymentsToBackup,
          expires_at: expiresAt.toISOString()
        })
        .select('id, payments_count, expires_at')
        .single();

      if (insertError) {
        // If table doesn't exist, log warning but don't fail import
        if (insertError.code === '42P01') {
          logger.warn('payment_backups table does not exist. Run migration 021 to enable backups.');
          return null;
        }
        logger.error('Failed to create backup', { error: insertError.message });
        throw insertError;
      }

      logger.info('Created pre-import backup', {
        backupId: backup.id,
        paymentsCount: backup.payments_count,
        expiresAt: backup.expires_at,
        datesBackedUp: uniqueDates.length
      });

      return backup;
    } catch (error) {
      // Don't fail the import if backup fails
      logger.error('Backup creation failed, continuing with import', { error: error.message });
      return null;
    }
  }

  /**
   * Restore payments from a backup
   * @param {string} backupId - Backup ID to restore from
   * @returns {Promise<Object>} Restore result
   */
  async restoreFromBackup(backupId) {
    try {
      // Get backup
      const { data: backup, error: fetchError } = await supabase
        .from('payment_backups')
        .select('*')
        .eq('id', backupId)
        .is('deleted_at', null)
        .single();

      if (fetchError || !backup) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      const paymentsData = backup.payments_data;
      if (!Array.isArray(paymentsData) || paymentsData.length === 0) {
        throw new Error('Backup contains no payment data');
      }

      logger.info('Restoring from backup', {
        backupId,
        paymentsCount: paymentsData.length,
        createdAt: backup.created_at
      });

      // Restore each payment (upsert by id)
      const { data: restored, error: upsertError } = await supabase
        .from('payments')
        .upsert(paymentsData, { 
          onConflict: 'id',
          ignoreDuplicates: false 
        })
        .select('id');

      if (upsertError) {
        logger.error('Failed to restore payments', { error: upsertError.message });
        throw upsertError;
      }

      // Mark backup as used (don't delete, keep for audit)
      await supabase
        .from('payment_backups')
        .update({ backup_type: 'restored' })
        .eq('id', backupId);

      logger.info('Restored payments from backup', {
        backupId,
        restoredCount: restored?.length || 0
      });

      return {
        success: true,
        backupId,
        restoredCount: restored?.length || 0
      };
    } catch (error) {
      logger.error('Restore from backup failed', { error: error.message, backupId });
      throw error;
    }
  }

  /**
   * Cleanup expired backups (called by cron)
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupExpiredBackups() {
    try {
      const now = new Date().toISOString();

      // Find expired backups
      const { data: expired, error: fetchError } = await supabase
        .from('payment_backups')
        .select('id, payments_count, created_at')
        .lt('expires_at', now)
        .is('deleted_at', null);

      if (fetchError) {
        logger.error('Failed to fetch expired backups', { error: fetchError.message });
        throw fetchError;
      }

      if (!expired || expired.length === 0) {
        logger.debug('No expired backups to cleanup');
        return { deleted: 0 };
      }

      const expiredIds = expired.map(b => b.id);

      // Soft delete expired backups
      const { error: deleteError } = await supabase
        .from('payment_backups')
        .update({ deleted_at: now, payments_data: [] }) // Clear data to save space
        .in('id', expiredIds);

      if (deleteError) {
        logger.error('Failed to delete expired backups', { error: deleteError.message });
        throw deleteError;
      }

      logger.info('Cleaned up expired payment backups', {
        deletedCount: expiredIds.length,
        totalPaymentsCleared: expired.reduce((sum, b) => sum + b.payments_count, 0)
      });

      return { deleted: expiredIds.length };
    } catch (error) {
      logger.error('Backup cleanup failed', { error: error.message });
      throw error;
    }
  }

  /**
   * List recent backups
   * @param {number} limit - Max number of backups to return
   * @returns {Promise<Array>} List of backups
   */
  async listBackups(limit = 10) {
    const { data, error } = await supabase
      .from('payment_backups')
      .select('id, import_id, backup_type, payments_count, created_at, expires_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to list backups', { error: error.message });
      throw error;
    }

    return data || [];
  }
}

module.exports = new PaymentBackupService();
