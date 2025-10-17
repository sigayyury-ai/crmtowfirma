require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');
const UserManagementService = require('./src/services/userManagement');
const logger = require('./src/utils/logger');

// Устанавливаем переменные окружения для wFirma
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = 'b90c19c9d6926305725556800560268f';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

async function testContractorCreation() {
  console.log('👤 Testing Direct Contractor Creation in wFirma...\n');

  const wfirmaClient = new WfirmaClient();
  const userManagement = new UserManagementService();

  // Тестовые данные контрагента
  const testContractors = [
    {
      name: 'Test Customer 1',
      email: 'test1@example.com',
      address: 'Test Street 1',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '',
      type: 'person'
    },
    {
      name: 'Test Company Ltd',
      email: 'company@example.com',
      address: 'Business Avenue 123',
      zip: '00-001',
      city: 'Warszawa',
      country: 'PL',
      business_id: '1234567890',
      type: 'company'
    },
    {
      name: 'International Customer',
      email: 'international@example.com',
      address: 'Main Street 45',
      zip: '10115',
      city: 'Berlin',
      country: 'DE',
      business_id: '',
      type: 'person'
    }
  ];

  console.log('1. Testing wFirma connection...');
  const connectionResult = await wfirmaClient.testConnection();
  if (connectionResult.success) {
    console.log('✅ wFirma connection successful');
  } else {
    console.log(`❌ wFirma connection failed: ${connectionResult.error}`);
    return;
  }

  console.log('\n2. Testing contractor creation...');
  
  for (let i = 0; i < testContractors.length; i++) {
    const contractorData = testContractors[i];
    console.log(`\n   Testing contractor ${i + 1}: ${contractorData.name}`);
    console.log(`   Email: ${contractorData.email}`);
    console.log(`   Country: ${contractorData.country}`);
    
    try {
      const result = await userManagement.findOrCreateContractor(contractorData);
      
      if (result.success) {
        console.log(`   ✅ Success: ${result.source}`);
        console.log(`   📋 Contractor ID: ${result.contractor.id}`);
        console.log(`   📧 Email: ${result.contractor.email}`);
        console.log(`   🌍 Country: ${result.contractor.country}`);
      } else {
        console.log(`   ❌ Failed: ${result.error}`);
        if (result.details) {
          console.log(`   📝 Details: ${JSON.stringify(result.details)}`);
        }
      }
    } catch (error) {
      console.log(`   💥 Error: ${error.message}`);
    }
  }

  console.log('\n3. Testing country code normalization...');
  const testCountries = ['Polska', 'Niemcy', 'Poland', 'Germany', 'PL', 'DE'];
  
  for (const country of testCountries) {
    // Создаем временный экземпляр InvoiceProcessingService для тестирования
    const InvoiceProcessingService = require('./src/services/invoiceProcessing');
    const invoiceService = new InvoiceProcessingService();
    const normalized = invoiceService.normalizeCountryCode(country);
    console.log(`   ${country} → ${normalized}`);
  }

  console.log('\n🏁 Contractor creation test completed\n');
}

testContractorCreation();




