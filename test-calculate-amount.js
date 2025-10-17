const InvoiceProcessingService = require('./src/services/invoiceProcessing');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testCalculateAmount() {
  try {
    logger.info('=== Testing Calculate Amount Method ===');
    
    const invoiceProcessing = new InvoiceProcessingService();
    
    // Test with different values
    const testCases = [
      { totalAmount: 100, invoiceType: 'PROFORMA', deal: { id: 1516, value: 100 } },
      { totalAmount: 0, invoiceType: 'PROFORMA', deal: { id: 1516, value: 0 } },
      { totalAmount: 500, invoiceType: 'PROFORMA', deal: { id: 1516, value: 500 } }
    ];
    
    for (const testCase of testCases) {
      logger.info(`Testing: totalAmount=${testCase.totalAmount}, invoiceType=${testCase.invoiceType}`);
      
      try {
        const result = await invoiceProcessing.calculateInvoiceAmount(
          testCase.totalAmount, 
          testCase.invoiceType, 
          testCase.deal
        );
        
        logger.info('Result:', result);
        
        if (result.success) {
          logger.info(`✅ Success: Amount=${result.amount}, Message=${result.message}`);
        } else {
          logger.error(`❌ Failed: ${result.error}`);
        }
      } catch (error) {
        logger.error(`❌ Exception: ${error.message}`);
      }
      
      logger.info('---');
    }
    
  } catch (error) {
    logger.error('Error in test:', error);
  }
}

// Run the test
testCalculateAmount().then(() => {
  logger.info('Test completed');
  process.exit(0);
}).catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});
