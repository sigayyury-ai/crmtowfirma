const axios = require('axios');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
const PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function updateDeal1516() {
  try {
    logger.info('=== Updating Deal 1516 with Invoice Type ===');
    
    // Invoice type field key
    const INVOICE_TYPE_FIELD_KEY = 'ad67729ecfe0345287b71a3b00910e8ba5b3b496';
    
    // Update deal 1516 to set Invoice type to "Proforma" (ID: 70)
    const updateData = {
      [INVOICE_TYPE_FIELD_KEY]: 70
    };
    
    logger.info('Updating deal 1516 with data:', updateData);
    
    const response = await axios.put(
      `${PIPEDRIVE_BASE_URL}/deals/1516`,
      updateData,
      {
        params: {
          api_token: PIPEDRIVE_API_TOKEN
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.data.success) {
      logger.info('Deal 1516 updated successfully:', response.data.data);
      
      // Verify the update
      const verifyResponse = await axios.get(
        `${PIPEDRIVE_BASE_URL}/deals/1516`,
        {
          params: {
            api_token: PIPEDRIVE_API_TOKEN
          }
        }
      );
      
      if (verifyResponse.data.success) {
        const updatedDeal = verifyResponse.data.data;
        const invoiceType = updatedDeal[INVOICE_TYPE_FIELD_KEY];
        logger.info('Verification - Invoice type field value:', invoiceType);
        
        if (invoiceType === 70 || invoiceType === "70") {
          logger.info('✅ Deal 1516 successfully updated with Proforma invoice type');
        } else {
          logger.warn('⚠️ Invoice type field was not updated correctly. Current value:', invoiceType);
        }
      }
    } else {
      logger.error('Failed to update deal 1516:', response.data.error);
    }
    
  } catch (error) {
    logger.error('Error updating deal 1516:', error.response?.data || error.message);
  }
}

// Run the update
updateDeal1516().then(() => {
  logger.info('Update completed');
  process.exit(0);
}).catch(error => {
  logger.error('Update failed:', error);
  process.exit(1);
});
