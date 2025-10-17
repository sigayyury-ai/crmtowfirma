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

async function testProcessDealDetailed() {
  try {
    logger.info('=== Testing Process Deal 1516 Detailed ===');
    
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // Get deal 1516 with related data
    logger.info('Fetching deal 1516 with related data...');
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
      currency: deal.currency,
      person: person ? { name: person.name, email: person.email } : null,
      organization: organization ? { name: organization.name } : null
    });
    
    // Test each step of the process
    logger.info('Step 1: Getting invoice type...');
    const invoiceType = invoiceProcessing.getInvoiceTypeFromDeal(deal);
    logger.info('Invoice type:', invoiceType);
    
    if (!invoiceType) {
      logger.error('No invoice type found for deal 1516');
      return;
    }
    
    logger.info('Step 2: Preparing contractor data...');
    // Extract email from person
    const email = person?.email?.[0]?.value || person?.primary_email || '';
    logger.info('Extracted email:', email);
    const contractorData = invoiceProcessing.prepareContractorData(person, organization, email);
    logger.info('Contractor data:', contractorData);
    
    logger.info('Step 3: Calculating invoice amount...');
    const amountResult = await invoiceProcessing.calculateInvoiceAmount(deal.value, invoiceType, deal);
    logger.info('Amount result:', amountResult);
    
    if (!amountResult.success) {
      logger.error('Amount calculation failed:', amountResult.error);
      return;
    }
    
    logger.info('Step 4: Creating invoice in wFirma...');
    const invoiceResult = await invoiceProcessing.createInvoiceInWfirma(deal, contractorData, invoiceType);
    logger.info('Invoice creation result:', invoiceResult);
    
    if (invoiceResult.success) {
      logger.info('✅ Proforma invoice created successfully!');
      logger.info('Invoice ID:', invoiceResult.invoiceId);
    } else {
      logger.error('❌ Failed to create Proforma invoice:', invoiceResult.error);
    }
    
  } catch (error) {
    logger.error('Error in detailed test:', error);
  }
}

// Run the test
testProcessDealDetailed().then(() => {
  logger.info('Detailed test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Detailed test failed:', error);
  process.exit(1);
});
