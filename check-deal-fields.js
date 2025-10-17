const axios = require('axios');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
const PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function checkDealFields() {
  try {
    logger.info('=== Checking Deal Fields ===');
    
    // Get deal fields
    const response = await axios.get(
      `${PIPEDRIVE_BASE_URL}/dealFields`,
      {
        params: {
          api_token: PIPEDRIVE_API_TOKEN
        }
      }
    );
    
    if (response.data.success) {
      const fields = response.data.data;
      logger.info('Total deal fields:', fields.length);
      
      // Find Invoice type field
      const invoiceTypeField = fields.find(field => 
        field.key === 'ad67729ecfe0345287b71a3b00910e8ba5b3b496' ||
        field.name?.toLowerCase().includes('invoice') ||
        field.name?.toLowerCase().includes('type')
      );
      
      if (invoiceTypeField) {
        logger.info('Invoice type field found:', {
          key: invoiceTypeField.key,
          name: invoiceTypeField.name,
          field_type: invoiceTypeField.field_type,
          options: invoiceTypeField.options
        });
        
        if (invoiceTypeField.options) {
          logger.info('Available options:');
          invoiceTypeField.options.forEach(option => {
            logger.info(`  - ${option.label} (${option.id})`);
          });
        }
      } else {
        logger.warn('Invoice type field not found');
        
        // Show all fields with 'invoice' or 'type' in name
        const relatedFields = fields.filter(field => 
          field.name?.toLowerCase().includes('invoice') ||
          field.name?.toLowerCase().includes('type') ||
          field.key?.includes('ad67729ecfe0345287b71a3b00910e8ba5b3b496')
        );
        
        logger.info('Related fields:');
        relatedFields.forEach(field => {
          logger.info(`  - ${field.name} (${field.key}) - ${field.field_type}`);
        });
      }
    } else {
      logger.error('Failed to get deal fields:', response.data.error);
    }
    
  } catch (error) {
    logger.error('Error checking deal fields:', error.response?.data || error.message);
  }
}

// Run the check
checkDealFields().then(() => {
  logger.info('Check completed');
  process.exit(0);
}).catch(error => {
  logger.error('Check failed:', error);
  process.exit(1);
});