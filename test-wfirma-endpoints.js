#!/usr/bin/env node

/**
 * Тест различных endpoints wFirma API
 * Проверяет правильные URL для работы с API
 */

require('dotenv').config();
const axios = require('axios');

async function testWfirmaEndpoints() {
  console.log('🔍 Тестирование endpoints wFirma API...\n');

  const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
  const accessToken = process.env.WFIRMA_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('❌ Access Token не установлен. Сначала получите токен через OAuth 2.0');
    console.log('🔗 URL для авторизации:');
    console.log(`${baseURL}/oauth/authorize?client_id=${process.env.WFIRMA_CLIENT_ID}&response_type=code&scope=read write&redirect_uri=https%3A%2F%2Fcomoon.io%2Foauth%2Fcallback%2F`);
    return;
  }

  console.log(`📋 Тестируем с токеном: ${accessToken.substring(0, 20)}...`);
  console.log(`🌐 Base URL: ${baseURL}\n`);

  // Тест 1: Проверка OAuth endpoints
  console.log('🔐 Тест 1: OAuth endpoints...');
  const oauthEndpoints = [
    '/oauth/me',
    '/oauth/user',
    '/oauth/profile',
    '/user',
    '/me',
    '/profile'
  ];

  for (const endpoint of oauthEndpoints) {
    try {
      console.log(`🔗 Тестируем: ${endpoint}`);
      
      const response = await axios.get(`${baseURL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ ${endpoint} - Статус: ${response.status}`);
      if (response.data) {
        console.log(`   📊 Данные: ${JSON.stringify(response.data, null, 2).substring(0, 200)}...`);
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
  }

  // Тест 2: Проверка API endpoints
  console.log('\n🔍 Тест 2: API endpoints...');
  const apiEndpoints = [
    '/api/contractors',
    '/api/contractors.json',
    '/api/v1/contractors',
    '/api/v1/contractors.json',
    '/contractors',
    '/contractors.json',
    '/companies',
    '/companies.json',
    '/invoices',
    '/invoices.json'
  ];

  for (const endpoint of apiEndpoints) {
    try {
      console.log(`🔗 Тестируем: ${endpoint}`);
      
      const response = await axios.get(`${baseURL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ ${endpoint} - Статус: ${response.status}`);
      if (response.data) {
        if (typeof response.data === 'string') {
          if (response.data.includes('<?xml')) {
            console.log(`   📄 XML ответ (${response.data.length} символов)`);
            if (response.data.includes('<contractors>') || response.data.includes('<companies>') || response.data.includes('<invoices>')) {
              console.log(`   🎯 Найден контент!`);
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
  }

  // Тест 3: Проверка различных методов аутентификации
  console.log('\n🔐 Тест 3: Различные методы аутентификации...');
  
  const authMethods = [
    {
      name: 'Bearer Token',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    },
    {
      name: 'Authorization Header',
      headers: { 'Authorization': accessToken }
    },
    {
      name: 'X-Auth-Token',
      headers: { 'X-Auth-Token': accessToken }
    },
    {
      name: 'X-API-Key',
      headers: { 'X-API-Key': accessToken }
    }
  ];

  for (const authMethod of authMethods) {
    try {
      console.log(`🔑 Тестируем: ${authMethod.name}`);
      
      const response = await axios.get(`${baseURL}/contractors.json`, {
        headers: {
          ...authMethod.headers,
          'Accept': 'application/json'
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
  testWfirmaEndpoints()
    .then(() => {
      console.log('\n🏁 Тестирование endpoints завершено');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Тестирование завершилось с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = testWfirmaEndpoints;






