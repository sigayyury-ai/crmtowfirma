require('dotenv').config();

const supabase = require('../src/services/supabaseClient');
const logger = require('../src/utils/logger');

async function run() {
  if (!supabase) {
    logger.error('Supabase client is not initialized.');
    process.exit(1);
  }

  try {
    const { data, error } = await supabase.from('proformas').select('id').limit(1);

    if (error) {
      logger.error('Supabase query error:', error);
      process.exit(1);
    }

    logger.info(`Supabase connection OK. Retrieved ${data.length} proforma record(s).`);
    process.exit(0);
  } catch (err) {
    logger.error('Unexpected Supabase connection error:', err);
    process.exit(1);
  }
}

run();

