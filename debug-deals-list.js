const PipedriveClient = require('./src/services/pipedrive');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function debugDealsList() {
  try {
    logger.info('=== Debugging Deals List ===');
    
    const pipedriveClient = new PipedriveClient();
    const INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Get all open deals with higher limit
    logger.info('Fetching all open deals...');
    const dealsResult = await pipedriveClient.getDeals({
      limit: 500,
      start: 0,
      status: 'open'
    });
    
    if (!dealsResult.success) {
      logger.error('Failed to fetch deals:', dealsResult.error);
      return;
    }
    
    logger.info(`Total open deals: ${dealsResult.deals.length}`);
    
    // Check if deal 1516 is in the list
    const deal1516 = dealsResult.deals.find(deal => deal.id === 1516);
    if (deal1516) {
      logger.info('✅ Deal 1516 found in open deals list');
      logger.info('Deal 1516 invoice type field value:', deal1516[INVOICE_TYPE_FIELD_KEY]);
    } else {
      logger.warn('❌ Deal 1516 NOT found in open deals list');
      
      // Check if deal 1516 exists at all
      logger.info('Checking if deal 1516 exists...');
      const dealResult = await pipedriveClient.getDeal(1516);
      if (dealResult.success) {
        logger.info('Deal 1516 exists, status:', dealResult.deal.status);
        logger.info('Deal 1516 invoice type field value:', dealResult.deal[INVOICE_TYPE_FIELD_KEY]);
      } else {
        logger.error('Deal 1516 does not exist:', dealResult.error);
      }
    }
    
    // Show all deals with invoice type field set
    logger.info('Deals with invoice type field set:');
    dealsResult.deals.forEach(deal => {
      const invoiceTypeValue = deal[INVOICE_TYPE_FIELD_KEY];
      if (invoiceTypeValue && invoiceTypeValue !== '' && invoiceTypeValue !== null) {
        logger.info(`  Deal ${deal.id}: ${deal.title} - Invoice type: ${invoiceTypeValue}`);
      }
    });
    
  } catch (error) {
    logger.error('Error in debug:', error);
  }
}

// Run the debug
debugDealsList().then(() => {
  logger.info('Debug completed');
  process.exit(0);
}).catch(error => {
  logger.error('Debug failed:', error);
  process.exit(1);
});
