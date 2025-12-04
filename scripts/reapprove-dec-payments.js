#!/usr/bin/env node

/**
 * Deprecated helper: bulk auto-approval is no longer allowed.
 * Script now simply warns the operator and exits.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function main() {
  if (!supabase) {
    throw new Error('Supabase client is not configured');
  }

  logger.info('Bulk re-approval script disabled', {
    message: 'Массовое подтверждение авто-совпадений отключено. Используйте интерфейс для ручной проверки.'
  });
  console.log('ℹ️  Bulk auto-approval is disabled. Please review and approve payments manually in the UI.');
}

main().catch((error) => {
  logger.error('reapprove-dec-payments failed', { error: error.message });
  console.error('❌ Error:', error.message);
  process.exit(1);
});


