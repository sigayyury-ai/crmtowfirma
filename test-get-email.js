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

async function testGetEmail() {
  try {
    logger.info('=== Testing Get Customer Email ===');
    
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // Get deal 1516 with related data
    const dealResult = await pipedriveClient.getDealWithRelatedData(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const { deal, person, organization } = dealResult;
    
    logger.info('Deal data:', {
      id: deal.id,
      title: deal.title
    });
    
    logger.info('Person data:', {
      id: person?.id,
      name: person?.name,
      email: person?.email,
      primary_email: person?.primary_email
    });
    
    logger.info('Organization data:', organization);
    
    // Test getCustomerEmail method
    logger.info('Testing getCustomerEmail method...');
    const email = invoiceProcessing.getCustomerEmail(person, organization);
    logger.info('Extracted email:', email);
    
    if (email) {
      logger.info('✅ Email extracted successfully');
    } else {
      logger.error('❌ Failed to extract email');
    }
    
  } catch (error) {
    logger.error('Error in test:', error);
  }
}

// Run the test
testGetEmail().then(() => {
  logger.info('Test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});




