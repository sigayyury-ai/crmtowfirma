const axios = require('axios');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
const PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function updateDealValue() {
  try {
    logger.info('=== Updating Deal 1516 Value ===');
    
    // Update deal 1516 to set value to 1000 EUR
    const updateData = {
      value: 1000
    };
    
    logger.info('Updating deal 1516 with value:', updateData);
    
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
      logger.info('✅ Deal 1516 value updated successfully');
      logger.info('New value:', response.data.data.value);
      logger.info('Formatted value:', response.data.data.formatted_value);
    } else {
      logger.error('Failed to update deal 1516 value:', response.data.error);
    }
    
  } catch (error) {
    logger.error('Error updating deal 1516 value:', error.response?.data || error.message);
  }
}

// Run the update
updateDealValue().then(() => {
  logger.info('Update completed');
  process.exit(0);
}).catch(error => {
  logger.error('Update failed:', error);
  process.exit(1);
});




