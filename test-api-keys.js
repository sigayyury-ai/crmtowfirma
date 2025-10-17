#!/usr/bin/env node

/**
 * Тест API Keys авторизации wFirma
 * Проверяет подключение и работу с API
 */

require('dotenv').config();
const WfirmaClient = require('./src/services/wfirma');
const logger = require('./src/utils/logger');

async function testApiKeysAuthorization() {
  console.log('🔐 Тестирование API Keys авторизации wFirma...\n');

  try {
    // Создаем клиент
    const wfirmaClient = new WfirmaClient();
    
    console.log('📋 Конфигурация:');
    console.log(`   Access Key: ${process.env.WFIRMA_ACCESS_KEY ? '✅ Установлен' : '❌ Не установлен'}`);
    console.log(`   Secret Key: ${process.env.WFIRMA_SECRET_KEY ? '✅ Установлен' : '❌ Не установлен'}`);
    console.log(`   Base URL: ${process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl'}\n`);

    // Тест 1: Проверка подключения
    console.log('🔑 Тест 1: Проверка подключения...');
    const connectionResult = await wfirmaClient.checkConnection();
    
    if (connectionResult.success) {
      console.log('✅ Подключение настроено:', connectionResult.message);
      console.log(`   Access Key: ${connectionResult.access_key}`);
      console.log(`   Secret Key: ${connectionResult.secret_key}`);
    } else {
      console.log('❌ Ошибка подключения:', connectionResult.error);
    }

    // Тест 2: Проверка подключения к API
    console.log('\n🌐 Тест 2: Подключение к wFirma API...');
    const apiResult = await wfirmaClient.testConnection();
    
    if (apiResult.success) {
      console.log('✅ API подключение успешно:', apiResult.message);
      if (apiResult.data) {
        console.log('📊 Данные ответа:', JSON.stringify(apiResult.data, null, 2));
      }
    } else {
      console.log('❌ Ошибка API подключения:', apiResult.error);
      if (apiResult.details) {
        console.log('📋 Детали ошибки:', JSON.stringify(apiResult.details, null, 2));
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
      if (contractorsResult.details) {
        console.log('📋 Детали ошибки:', JSON.stringify(contractorsResult.details, null, 2));
      }
    }

  } catch (error) {
    console.error('💥 Критическая ошибка:', error.message);
    console.error('📋 Stack trace:', error.stack);
  }
}

// Запуск теста
if (require.main === module) {
  testApiKeysAuthorization()
    .then(() => {
      console.log('\n🏁 Тестирование завершено');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Тестирование завершилось с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = testApiKeysAuthorization;






