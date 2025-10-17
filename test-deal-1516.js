const PipedriveClient = require('./src/services/pipedrive');
const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testDeal1516() {
  try {
    logger.info('=== Testing Deal 1516 ===');
    
    // Initialize services
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // Test Pipedrive connection first
    logger.info('Testing Pipedrive connection...');
    const connectionTest = await pipedriveClient.testConnection();
    if (!connectionTest.success) {
      logger.error('Pipedrive connection failed:', connectionTest.error);
      return;
    }
    logger.info('Pipedrive connection successful:', connectionTest.message);
    
    // Get deal 1516
    logger.info('Fetching deal 1516...');
    const dealResult = await pipedriveClient.getDealWithRelatedData(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const { deal, person, organization } = dealResult;
    logger.info('Deal 1516 data:', {
      id: deal.id,
      title: deal.title,
      value: deal.value,
      currency: deal.currency,
      status: deal.status,
      person: person ? { name: person.name, email: person.email } : null,
      organization: organization ? { name: organization.name } : null
    });
    
    // Check if deal has Invoice type field
    const invoiceType = deal[invoiceProcessing.INVOICE_TYPE_FIELD_KEY];
    logger.info('Invoice type field value:', invoiceType);
    
    // Test processing this specific deal
    logger.info('Processing deal 1516 for Proforma creation...');
    const processResult = await invoiceProcessing.processDealById(1516);
    
    if (processResult.success) {
      logger.info('Deal 1516 processed successfully:', processResult);
    } else {
      logger.error('Failed to process deal 1516:', processResult.error);
    }
    
  } catch (error) {
    logger.error('Error in test:', error);
  }
}

// Run the test
testDeal1516().then(() => {
  logger.info('Test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});




