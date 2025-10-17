// Устанавливаем переменные окружения
process.env.WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
process.env.WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
process.env.WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
process.env.WFIRMA_BASE_URL = 'https://api2.wfirma.pl';

const UserManagementService = require('./src/services/userManagement');
const logger = require('./src/utils/logger');

async function testUserManagement() {
  console.log('🔧 Testing User Management Service...\n');

  try {
    const userManagement = new UserManagementService();

    // Test 1: Поиск существующего контрагента
    console.log('📋 Test 1: Searching for existing contractor...');
    const existingUserData = {
      email: 'test.service.hardcoded@example.com', // Этот email мы создали ранее
      name: 'Test Service Hardcoded',
      address: 'Test Street 123',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '1234567890',
      type: 'person'
    };

    const result1 = await userManagement.findOrCreateContractor(existingUserData);
    if (result1.success) {
      if (result1.found) {
        console.log('✅ Existing contractor found:', result1.contractor.name, '(ID:', result1.contractor.id + ')');
      } else if (result1.created) {
        console.log('✅ New contractor created:', result1.contractor.name, '(ID:', result1.contractor.id + ')');
      }
    } else {
      console.log('❌ Failed:', result1.error);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Создание нового контрагента
    console.log('📋 Test 2: Creating new contractor...');
    const newUserData = {
      email: 'test.user.management@example.com',
      name: 'Test User Management',
      address: 'Test Street 456',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '9876543210',
      type: 'person'
    };

    const result2 = await userManagement.findOrCreateContractor(newUserData);
    if (result2.success) {
      if (result2.found) {
        console.log('✅ Existing contractor found:', result2.contractor.name, '(ID:', result2.contractor.id + ')');
      } else if (result2.created) {
        console.log('✅ New contractor created:', result2.contractor.name, '(ID:', result2.contractor.id + ')');
      }
    } else {
      console.log('❌ Failed:', result2.error);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Тест кэширования
    console.log('📋 Test 3: Testing cache...');
    const result3 = await userManagement.findOrCreateContractor(existingUserData);
    if (result3.success) {
      if (result3.fromCache) {
        console.log('✅ Contractor retrieved from cache:', result3.contractor.name);
      } else {
        console.log('❌ Contractor not retrieved from cache');
      }
    } else {
      console.log('❌ Failed:', result3.error);
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Статистика кэша
    console.log('📋 Test 4: Cache statistics...');
    const cacheStats = userManagement.getCacheStats();
    console.log('✅ Cache stats:', cacheStats);

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 5: Поиск несуществующего контрагента
    console.log('📋 Test 5: Searching for non-existent contractor...');
    const nonExistentUserData = {
      email: 'nonexistent@example.com',
      name: 'Non Existent User',
      address: 'Test Street 789',
      zip: '80-000',
      city: 'Gdańsk',
      country: 'PL',
      business_id: '1111111111',
      type: 'person'
    };

    const result5 = await userManagement.findOrCreateContractor(nonExistentUserData);
    if (result5.success) {
      if (result5.found) {
        console.log('✅ Contractor found:', result5.contractor.name, '(ID:', result5.contractor.id + ')');
      } else if (result5.created) {
        console.log('✅ New contractor created:', result5.contractor.name, '(ID:', result5.contractor.id + ')');
      }
    } else {
      console.log('❌ Failed:', result5.error);
    }

  } catch (error) {
    console.log('❌ Error during user management test:', error.message);
  }
}

testUserManagement();




