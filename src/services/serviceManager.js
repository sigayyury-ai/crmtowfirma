const WfirmaClient = require('./wfirma');
const PipedriveClient = require('./pipedrive');
const UserManagementService = require('./userManagement');
const ProductManagementService = require('./productManagement');
const InvoiceProcessingService = require('./invoiceProcessing');
const { getScheduler } = require('./scheduler');
const logger = require('../utils/logger');

// Singleton instances
let wfirmaClientInstance = null;
let pipedriveClientInstance = null;

/**
 * Get or create wFirma client instance (singleton)
 */
function getWfirmaClient() {
  if (!wfirmaClientInstance) {
    try {
      console.log('🔧 Creating wFirma client singleton...');
      wfirmaClientInstance = new WfirmaClient();
      console.log('✅ wFirma client singleton created');
    } catch (error) {
      console.log('❌ Failed to create wFirma client singleton:', error.message);
      return null;
    }
  }
  return wfirmaClientInstance;
}

/**
 * Get or create Pipedrive client instance (singleton)
 */
function getPipedriveClient() {
  if (!pipedriveClientInstance) {
    try {
      console.log('🔧 Creating Pipedrive client singleton...');
      pipedriveClientInstance = new PipedriveClient();
      console.log('✅ Pipedrive client singleton created');
    } catch (error) {
      console.log('❌ Failed to create Pipedrive client singleton:', error.message);
      return null;
    }
  }
  return pipedriveClientInstance;
}

/**
 * Get UserManagementService instance
 */
function getUserManagementService() {
  const wfirmaClient = getWfirmaClient();
  if (!wfirmaClient) return null;
  
  try {
    return new UserManagementService();
  } catch (error) {
    console.log('❌ Failed to create UserManagementService:', error.message);
    return null;
  }
}

/**
 * Get ProductManagementService instance
 */
function getProductManagementService() {
  const wfirmaClient = getWfirmaClient();
  if (!wfirmaClient) return null;
  
  try {
    return new ProductManagementService();
  } catch (error) {
    console.log('❌ Failed to create ProductManagementService:', error.message);
    return null;
  }
}

/**
 * Get InvoiceProcessingService instance
 */
function getInvoiceProcessingService() {
  const wfirmaClient = getWfirmaClient();
  const pipedriveClient = getPipedriveClient();
  if (!wfirmaClient || !pipedriveClient) return null;
  
  try {
    return new InvoiceProcessingService();
  } catch (error) {
    console.log('❌ Failed to create InvoiceProcessingService:', error.message);
    return null;
  }
}

/**
 * Get SchedulerService instance
 */
function getSchedulerService() {
  const wfirmaClient = getWfirmaClient();
  const pipedriveClient = getPipedriveClient();
  if (!wfirmaClient || !pipedriveClient) return null;
  
  try {
    return getScheduler();
  } catch (error) {
    console.log('❌ Failed to create SchedulerService:', error.message);
    return null;
  }
}

module.exports = {
  getWfirmaClient,
  getPipedriveClient,
  getUserManagementService,
  getProductManagementService,
  getInvoiceProcessingService,
  getSchedulerService
};
