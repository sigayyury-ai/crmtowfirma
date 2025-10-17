const axios = require('axios');

// Новый API ключ Pipedrive
const PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
const PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

async function testPipedriveAPI() {
  console.log('🔧 Testing Pipedrive API with new token...\n');

  try {
    // Тест 1: Получение информации о пользователе
    console.log('📋 Test 1: Getting user info...');
    const userResponse = await axios.get(`${PIPEDRIVE_BASE_URL}/users/me`, {
      params: { api_token: PIPEDRIVE_API_TOKEN }
    });
    
    if (userResponse.data.success) {
      console.log('✅ User info retrieved successfully');
      console.log(`👤 User: ${userResponse.data.data.name} (${userResponse.data.data.email})`);
      console.log(`🏢 Company: ${userResponse.data.data.company_name}`);
    } else {
      console.log('❌ Failed to get user info');
    }

    console.log('\n==================================================\n');

    // Тест 2: Получение списка сделок
    console.log('📋 Test 2: Getting deals...');
    const dealsResponse = await axios.get(`${PIPEDRIVE_BASE_URL}/deals`, {
      params: { 
        api_token: PIPEDRIVE_API_TOKEN,
        limit: 5
      }
    });
    
    if (dealsResponse.data.success) {
      console.log('✅ Deals retrieved successfully');
      console.log(`📊 Total deals: ${dealsResponse.data.additional_data.pagination.total_count}`);
      console.log(`📋 Retrieved: ${dealsResponse.data.data.length} deals`);
      
      if (dealsResponse.data.data.length > 0) {
        const firstDeal = dealsResponse.data.data[0];
        console.log(`🎯 First deal: ${firstDeal.title} (ID: ${firstDeal.id})`);
        console.log(`💰 Value: ${firstDeal.value} ${firstDeal.currency}`);
        console.log(`📅 Stage: ${firstDeal.stage_id}`);
      }
    } else {
      console.log('❌ Failed to get deals');
    }

    console.log('\n==================================================\n');

    // Тест 3: Получение списка организаций
    console.log('📋 Test 3: Getting organizations...');
    const orgsResponse = await axios.get(`${PIPEDRIVE_BASE_URL}/organizations`, {
      params: { 
        api_token: PIPEDRIVE_API_TOKEN,
        limit: 5
      }
    });
    
    if (orgsResponse.data.success) {
      console.log('✅ Organizations retrieved successfully');
      console.log(`🏢 Total organizations: ${orgsResponse.data.additional_data.pagination.total_count}`);
      console.log(`📋 Retrieved: ${orgsResponse.data.data.length} organizations`);
      
      if (orgsResponse.data.data.length > 0) {
        const firstOrg = orgsResponse.data.data[0];
        console.log(`🏢 First organization: ${firstOrg.name} (ID: ${firstOrg.id})`);
      }
    } else {
      console.log('❌ Failed to get organizations');
    }

    console.log('\n==================================================\n');

    // Тест 4: Получение списка контактов
    console.log('📋 Test 4: Getting persons...');
    const personsResponse = await axios.get(`${PIPEDRIVE_BASE_URL}/persons`, {
      params: { 
        api_token: PIPEDRIVE_API_TOKEN,
        limit: 5
      }
    });
    
    if (personsResponse.data.success) {
      console.log('✅ Persons retrieved successfully');
      console.log(`👥 Total persons: ${personsResponse.data.additional_data.pagination.total_count}`);
      console.log(`📋 Retrieved: ${personsResponse.data.data.length} persons`);
      
      if (personsResponse.data.data.length > 0) {
        const firstPerson = personsResponse.data.data[0];
        console.log(`👤 First person: ${firstPerson.name} (ID: ${firstPerson.id})`);
        console.log(`📧 Email: ${firstPerson.email ? firstPerson.email[0].value : 'N/A'}`);
      }
    } else {
      console.log('❌ Failed to get persons');
    }

    console.log('\n🎉 All Pipedrive API tests completed successfully!');

  } catch (error) {
    console.error('❌ Error testing Pipedrive API:', error.message);
    if (error.response) {
      console.error('📊 Response status:', error.response.status);
      console.error('📊 Response data:', error.response.data);
    }
  }
}

// Запускаем тест
testPipedriveAPI();




