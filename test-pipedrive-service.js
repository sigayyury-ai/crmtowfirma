// Устанавливаем переменные окружения для тестирования
process.env.PIPEDRIVE_API_TOKEN = 'e43a34e0b803db1a5464dd667f5a35c27b22dd2e';
process.env.PIPEDRIVE_BASE_URL = 'https://api.pipedrive.com/v1';

const PipedriveClient = require('./src/services/pipedrive');

async function testPipedriveService() {
  console.log('🔧 Testing Pipedrive service...\n');

  try {
    const pipedriveClient = new PipedriveClient();

    // Тест 1: Подключение
    console.log('📋 Test 1: Testing connection...');
    const connectionResult = await pipedriveClient.testConnection();
    
    if (connectionResult.success) {
      console.log('✅ Connection successful');
      console.log(`👤 User: ${connectionResult.user.name} (${connectionResult.user.email})`);
      console.log(`🏢 Company: ${connectionResult.user.company_name}`);
    } else {
      console.log('❌ Connection failed:', connectionResult.error);
      return;
    }

    console.log('\n==================================================\n');

    // Тест 2: Получение сделок
    console.log('📋 Test 2: Getting deals...');
    const dealsResult = await pipedriveClient.getDeals({ limit: 3 });
    
    if (dealsResult.success) {
      console.log('✅ Deals retrieved successfully');
      console.log(`📊 Retrieved: ${dealsResult.deals.length} deals`);
      
      if (dealsResult.deals.length > 0) {
        const firstDeal = dealsResult.deals[0];
        console.log(`🎯 First deal: ${firstDeal.title} (ID: ${firstDeal.id})`);
        console.log(`💰 Value: ${firstDeal.value} ${firstDeal.currency}`);
        console.log(`📅 Stage: ${firstDeal.stage_id}`);
        
        // Тест 3: Получение полной информации о сделке
        console.log('\n📋 Test 3: Getting deal with related data...');
        const fullDealResult = await pipedriveClient.getDealWithRelatedData(firstDeal.id);
        
        if (fullDealResult.success) {
          console.log('✅ Full deal data retrieved successfully');
          console.log(`🎯 Deal: ${fullDealResult.deal.title}`);
          
          if (fullDealResult.relatedData.organization) {
            console.log(`🏢 Organization: ${fullDealResult.relatedData.organization.name}`);
          }
          
          if (fullDealResult.relatedData.person) {
            console.log(`👤 Person: ${fullDealResult.relatedData.person.name}`);
            if (fullDealResult.relatedData.person.email && fullDealResult.relatedData.person.email.length > 0) {
              console.log(`📧 Email: ${fullDealResult.relatedData.person.email[0].value}`);
            }
          }
        } else {
          console.log('❌ Failed to get full deal data:', fullDealResult.error);
        }
      }
    } else {
      console.log('❌ Failed to get deals:', dealsResult.error);
    }

    console.log('\n🎉 Pipedrive service tests completed successfully!');

  } catch (error) {
    console.error('❌ Error testing Pipedrive service:', error.message);
  }
}

// Запускаем тест
testPipedriveService();




