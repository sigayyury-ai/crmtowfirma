const PipedriveClient = require('./src/services/pipedrive');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function checkDealValue() {
  try {
    logger.info('=== Checking Deal 1516 Value ===');
    
    const pipedriveClient = new PipedriveClient();
    
    // Get deal 1516
    const dealResult = await pipedriveClient.getDeal(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const deal = dealResult.deal;
    logger.info('Deal 1516 value fields:');
    logger.info('  value:', deal.value);
    logger.info('  weighted_value:', deal.weighted_value);
    logger.info('  acv:', deal.acv);
    logger.info('  arr:', deal.arr);
    logger.info('  mrr:', deal.mrr);
    logger.info('  currency:', deal.currency);
    
    // Check all fields that might contain amounts
    logger.info('All amount-related fields:');
    Object.keys(deal).forEach(key => {
      if (key.includes('value') || key.includes('amount') || key.includes('price') || key.includes('cost')) {
        logger.info(`  ${key}: ${deal[key]}`);
      }
    });
    
  } catch (error) {
    logger.error('Error checking deal value:', error);
  }
}

// Run the check
checkDealValue().then(() => {
  logger.info('Check completed');
  process.exit(0);
}).catch(error => {
  logger.error('Check failed:', error);
  process.exit(1);
});




