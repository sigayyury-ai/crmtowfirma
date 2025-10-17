const PipedriveClient = require('./src/services/pipedrive');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function debugDeal1516() {
  try {
    logger.info('=== Debugging Deal 1516 ===');
    
    const pipedriveClient = new PipedriveClient();
    
    // Get deal 1516 with all fields
    logger.info('Fetching deal 1516 with all fields...');
    const dealResult = await pipedriveClient.getDeal(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const deal = dealResult.deal;
    logger.info('Full deal data:', JSON.stringify(deal, null, 2));
    
    // Check for person data
    if (deal.person_id) {
      logger.info('Fetching person data...');
      const personResult = await pipedriveClient.getPerson(deal.person_id.value);
      if (personResult.success) {
        logger.info('Person data:', JSON.stringify(personResult.person, null, 2));
      } else {
        logger.error('Failed to fetch person:', personResult.error);
      }
    }
    
    // Check for organization data
    if (deal.org_id) {
      logger.info('Fetching organization data...');
      const orgResult = await pipedriveClient.getOrganization(deal.org_id.value);
      if (orgResult.success) {
        logger.info('Organization data:', JSON.stringify(orgResult.organization, null, 2));
      } else {
        logger.error('Failed to fetch organization:', orgResult.error);
      }
    }
    
    // Check Invoice type field specifically
    const INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    const invoiceType = deal[INVOICE_TYPE_FIELD_KEY];
    logger.info('Invoice type field value:', invoiceType);
    
    // Check all custom fields
    logger.info('All custom fields:');
    Object.keys(deal).forEach(key => {
      if (key.startsWith('ad') || key.includes('custom') || key.includes('field')) {
        logger.info(`  ${key}: ${deal[key]}`);
      }
    });
    
  } catch (error) {
    logger.error('Error in debug:', error);
  }
}

// Run the debug
debugDeal1516().then(() => {
  logger.info('Debug completed');
  process.exit(0);
}).catch(error => {
  logger.error('Debug failed:', error);
  process.exit(1);
});




