const PipedriveClient = require('./src/services/pipedrive');
const logger = require('./src/utils/logger');

// Hardcoded environment variables for testing
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function checkPersonData() {
  try {
    logger.info('=== Checking Person Data for Deal 1516 ===');
    
    const pipedriveClient = new PipedriveClient();
    
    // Get deal 1516
    const dealResult = await pipedriveClient.getDeal(1516);
    
    if (!dealResult.success) {
      logger.error('Failed to fetch deal 1516:', dealResult.error);
      return;
    }
    
    const deal = dealResult.deal;
    logger.info('Deal 1516 person_id:', deal.person_id);
    
    if (deal.person_id) {
      // Get person data
      const personResult = await pipedriveClient.getPerson(deal.person_id.value);
      
      if (personResult.success) {
        const person = personResult.person;
        logger.info('Person data:', {
          id: person.id,
          name: person.name,
          email: person.email,
          phone: person.phone,
          org_id: person.org_id
        });
        
        // Check all person fields
        logger.info('All person fields:');
        Object.keys(person).forEach(key => {
          if (person[key] !== null && person[key] !== undefined && person[key] !== '') {
            logger.info(`  ${key}: ${JSON.stringify(person[key])}`);
          }
        });
      } else {
        logger.error('Failed to fetch person:', personResult.error);
      }
    } else {
      logger.warn('Deal 1516 has no person_id');
    }
    
  } catch (error) {
    logger.error('Error checking person data:', error);
  }
}

// Run the check
checkPersonData().then(() => {
  logger.info('Check completed');
  process.exit(0);
}).catch(error => {
  logger.error('Check failed:', error);
  process.exit(1);
});




