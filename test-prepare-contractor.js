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

async function testPrepareContractor() {
  try {
    logger.info('=== Testing Prepare Contractor Data ===');
    
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
      title: deal.title,
      value: deal.value,
      currency: deal.currency
    });
    
    logger.info('Person data:', {
      id: person?.id,
      name: person?.name,
      email: person?.email,
      postal_address: person?.postal_address,
      postal_address_postal_code: person?.postal_address_postal_code,
      postal_address_locality: person?.postal_address_locality,
      postal_address_country: person?.postal_address_country
    });
    
    logger.info('Organization data:', organization);
    
    // Test prepareContractorData method
    logger.info('Testing prepareContractorData method...');
    
    // Extract email from person
    const email = person?.email?.[0]?.value || person?.primary_email || '';
    logger.info('Extracted email:', email);
    
    const contractorData = invoiceProcessing.prepareContractorData(person, organization, email);
    logger.info('Contractor data result:', contractorData);
    
    if (contractorData.name && contractorData.email) {
      logger.info('✅ Contractor data prepared successfully');
    } else {
      logger.error('❌ Contractor data preparation failed - missing name or email');
    }
    
  } catch (error) {
    logger.error('Error in test:', error);
  }
}

// Run the test
testPrepareContractor().then(() => {
  logger.info('Test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});




