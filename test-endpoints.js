#!/usr/bin/env node

/**
 * Тест различных endpoints wFirma API
 * Проверяет правильные URL для работы с контрагентами
 */

require('dotenv').config();
const axios = require('axios');

async function testEndpoints() {
  console.log('🔍 Тестирование различных endpoints wFirma API...\n');

  const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
  const accessToken = process.env.WFIRMA_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('❌ Access Token не установлен. Сначала получите токен через OAuth 2.0');
    return;
  }

  const endpoints = [
    '/contractors.json',
    '/contractors/add.json',
    '/contractors/list.json',
    '/invoices.json',
    '/invoices/add.json',
    '/bank_accounts.json',
    '/companies.json',
    '/companies/add.json'
  ];

  console.log(`📋 Тестируем ${endpoints.length} endpoints с токеном: ${accessToken.substring(0, 20)}...\n`);

  for (const endpoint of endpoints) {
    try {
      console.log(`🔗 Тестируем: ${endpoint}`);
      
      const response = await axios.get(`${baseURL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ ${endpoint} - Статус: ${response.status}`);
      
      if (response.data) {
        if (typeof response.data === 'string') {
          if (response.data.includes('<?xml')) {
            console.log(`   📄 XML ответ (${response.data.length} символов)`);
            if (response.data.includes('<contractors>') || response.data.includes('<companies>')) {
              console.log(`   🎯 Найден контент контрагентов!`);
            }
          } else {
            console.log(`   📄 Текстовый ответ: ${response.data.substring(0, 100)}...`);
          }
        } else {
          console.log(`   📊 JSON ответ: ${JSON.stringify(response.data, null, 2).substring(0, 200)}...`);
        }
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${endpoint} - Статус: ${error.response.status}`);
        if (error.response.data) {
          if (typeof error.response.data === 'string') {
            if (error.response.data.includes('CONTROLLER NOT FOUND')) {
              console.log(`   🚫 Controller not found`);
            } else if (error.response.data.includes('AUTH')) {
              console.log(`   🔐 Auth error`);
            } else {
              console.log(`   📄 Ответ: ${error.response.data.substring(0, 100)}...`);
            }
          } else {
            console.log(`   📊 JSON ошибка: ${JSON.stringify(error.response.data, null, 2).substring(0, 100)}...`);
          }
        }
      } else {
        console.log(`❌ ${endpoint} - Ошибка: ${error.message}`);
      }
    }
    
    console.log(''); // Пустая строка для разделения
  }

  // Тест с разными методами аутентификации
  console.log('🔐 Тестирование различных методов аутентификации...\n');
  
  const authMethods = [
    {
      name: 'Bearer Token',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    },
    {
      name: 'Basic Auth (deprecated)',
      headers: { 'Authorization': `Basic ${Buffer.from(`${process.env.WFIRMA_CLIENT_ID}:${process.env.WFIRMA_CLIENT_SECRET}`).toString('base64')}` }
    }
  ];

  for (const authMethod of authMethods) {
    try {
      console.log(`🔑 Тестируем: ${authMethod.name}`);
      
      const response = await axios.get(`${baseURL}/contractors.json`, {
        headers: {
          ...authMethod.headers,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ ${authMethod.name} - Статус: ${response.status}`);
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${authMethod.name} - Статус: ${error.response.status}`);
        if (error.response.data) {
          console.log(`   📄 Ответ: ${JSON.stringify(error.response.data, null, 2).substring(0, 100)}...`);
        }
      } else {
        console.log(`❌ ${authMethod.name} - Ошибка: ${error.message}`);
      }
    }
  }
}

// Запуск теста
if (require.main === module) {
  testEndpoints()
    .then(() => {
      console.log('\n🏁 Тестирование endpoints завершено');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Тестирование завершилось с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = testEndpoints;
