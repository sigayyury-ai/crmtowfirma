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

async function debugProcessDeal() {
  try {
    logger.info('=== Debugging Process Deal 1516 ===');
    
    const pipedriveClient = new PipedriveClient();
    const invoiceProcessing = new InvoiceProcessingService();
    
    // Get deal 1516
    logger.info('Fetching deal 1516...');
    const dealResult = await pipedriveClient.getDeal(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const deal = dealResult.deal;
    logger.info('Deal 1516 invoice type field value:', deal[invoiceProcessing.INVOICE_TYPE_FIELD_KEY]);
    
    // Test getInvoiceTypeFromDeal method
    logger.info('Testing getInvoiceTypeFromDeal method...');
    const invoiceType = invoiceProcessing.getInvoiceTypeFromDeal(deal);
    logger.info('Extracted invoice type:', invoiceType);
    
    // Test getPendingInvoiceDeals method
    logger.info('Testing getPendingInvoiceDeals method...');
    const pendingResult = await invoiceProcessing.getPendingInvoiceDeals();
    logger.info('Pending deals result:', pendingResult);
    
    // Test calculateInvoiceAmount method
    if (invoiceType) {
      logger.info('Testing calculateInvoiceAmount method...');
      const amountResult = invoiceProcessing.calculateInvoiceAmount(deal, invoiceType);
      logger.info('Amount calculation result:', amountResult);
    }
    
  } catch (error) {
    logger.error('Error in debug:', error);
  }
}

// Run the debug
debugProcessDeal().then(() => {
  logger.info('Debug completed');
  process.exit(0);
}).catch(error => {
  logger.error('Debug failed:', error);
  process.exit(1);
});




