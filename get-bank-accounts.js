const axios = require('axios');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
const WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
const WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
const WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
const WFIRMA_BASE_URL = 'https://api2.wfirma.pl';
const COMPANY_ID = '885512';

async function getBankAccounts() {
  try {
    logger.info('=== Getting Bank Accounts from wFirma ===');
    
    // Get bank accounts
    const response = await axios.get(
      `${WFIRMA_BASE_URL}/bankaccounts/find`,
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'accessKey': WFIRMA_ACCESS_KEY,
          'secretKey': WFIRMA_SECRET_KEY,
          'appKey': WFIRMA_APP_KEY,
          'company_id': COMPANY_ID
        },
        params: {
          inputFormat: 'json',
          outputFormat: 'json'
        }
      }
    );
    
    if (response.data && response.data.bankaccounts) {
      logger.info('Bank accounts found:');
      response.data.bankaccounts.forEach(account => {
        logger.info(`  - ID: ${account.id}, Name: ${account.name}, Currency: ${account.currency}`);
      });
      
      // Find EUR account
      const eurAccount = response.data.bankaccounts.find(account => 
        account.currency === 'EUR' || account.name.includes('EUR')
      );
      
      if (eurAccount) {
        logger.info(`✅ EUR Account found: ID=${eurAccount.id}, Name=${eurAccount.name}`);
      } else {
        logger.warn('❌ No EUR account found');
      }
      
      // Find PLN account
      const plnAccount = response.data.bankaccounts.find(account => 
        account.currency === 'PLN' || account.name.includes('PLN')
      );
      
      if (plnAccount) {
        logger.info(`✅ PLN Account found: ID=${plnAccount.id}, Name=${plnAccount.name}`);
      } else {
        logger.warn('❌ No PLN account found');
      }
      
    } else {
      logger.error('No bank accounts found in response:', response.data);
    }
    
  } catch (error) {
    logger.error('Error getting bank accounts:', error.response?.data || error.message);
  }
}

// Run the function
getBankAccounts().then(() => {
  logger.info('Bank accounts check completed');
  process.exit(0);
}).catch(error => {
  logger.error('Bank accounts check failed:', error);
  process.exit(1);
});




