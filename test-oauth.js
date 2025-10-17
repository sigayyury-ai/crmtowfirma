#!/usr/bin/env node

/**
 * Тест OAuth 2.0 авторизации wFirma
 * Проверяет подключение и получение access token
 */

require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');
const logger = require('./src/utils/logger');

async function testOAuthAuthorization() {
  console.log('🔐 Тестирование OAuth 2.0 авторизации wFirma...\n');

  try {
    // Создаем клиент
    const wfirmaClient = new WfirmaClient();
    
    console.log('📋 Конфигурация:');
    console.log(`   Client ID: ${process.env.WFIRMA_CLIENT_ID ? '✅ Установлен' : '❌ Не установлен'}`);
    console.log(`   Client Secret: ${process.env.WFIRMA_CLIENT_SECRET ? '✅ Установлен' : '❌ Не установлен'}`);
    console.log(`   Access Token: ${process.env.WFIRMA_ACCESS_TOKEN ? '✅ Установлен' : '❌ Не установлен'}`);
    console.log(`   Base URL: ${process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl'}\n`);

    // Тест 1: Проверка получения access token
    console.log('🔑 Тест 1: Получение Access Token...');
    const tokenResult = await wfirmaClient.getAccessToken();
    
    if (tokenResult.success) {
      console.log('✅ Access Token доступен:', tokenResult.access_token?.substring(0, 20) + '...');
    } else {
      console.log('⚠️  Access Token недоступен:', tokenResult.error);
      if (tokenResult.auth_url) {
        console.log('🔗 URL для авторизации:', tokenResult.auth_url);
        console.log('\n📝 Инструкция:');
        console.log('1. Откройте URL в браузере');
        console.log('2. Авторизуйтесь в wFirma');
        console.log('3. Скопируйте код из redirect URL');
        console.log('4. Используйте код для получения access token\n');
      }
    }

    // Тест 2: Проверка подключения к API
    console.log('🌐 Тест 2: Подключение к wFirma API...');
    const connectionResult = await wfirmaClient.testConnection();
    
    if (connectionResult.success) {
      console.log('✅ Подключение успешно:', connectionResult.message);
      if (connectionResult.data) {
        console.log('📊 Данные ответа:', JSON.stringify(connectionResult.data, null, 2));
      }
    } else {
      console.log('❌ Ошибка подключения:', connectionResult.error);
      if (connectionResult.auth_url) {
        console.log('🔗 Требуется авторизация:', connectionResult.auth_url);
      }
      if (connectionResult.details) {
        console.log('📋 Детали ошибки:', JSON.stringify(connectionResult.details, null, 2));
      }
    }

    // Тест 3: Получение списка контрагентов
    console.log('\n👥 Тест 3: Получение списка контрагентов...');
    const contractorsResult = await wfirmaClient.getContractors();
    
    if (contractorsResult.success) {
      console.log('✅ Контрагенты получены успешно');
      if (contractorsResult.contractors) {
        console.log(`📊 Найдено контрагентов: ${contractorsResult.contractors.length}`);
      }
      if (contractorsResult.rawResponse) {
        console.log('📄 XML ответ получен (требует парсинга)');
      }
    } else {
      console.log('❌ Ошибка получения контрагентов:', contractorsResult.error);
      if (contractorsResult.auth_url) {
        console.log('🔗 Требуется авторизация:', contractorsResult.auth_url);
      }
    }

  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    console.error('📋 Stack trace:', error.stack);
  }
}

// Запуск теста
if (require.main === module) {
  testOAuthAuthorization()
    .then(() => {
      console.log('\n🏁 Тестирование завершено');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Тестирование завершилось с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = testOAuthAuthorization;






