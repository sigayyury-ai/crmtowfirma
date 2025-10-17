#!/usr/bin/env node

/**
 * Детальный тест wFirma API
 * Проверяет различные варианты endpoints и форматов
 */

require('dotenv').config();
const axios = require('axios');

async function testWfirmaAPI() {
  console.log('🔍 Детальное тестирование wFirma API...\n');

  const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
  const accessToken = process.env.WFIRMA_ACCESS_TOKEN;

  if (!accessToken) {
    console.log('❌ Access Token не установлен. Сначала получите токен через OAuth 2.0');
    console.log('🔗 URL для авторизации:');
    console.log(`${baseURL}/oauth/authorize?client_id=${process.env.WFIRMA_CLIENT_ID}&response_type=code&scope=read write&redirect_uri=https%3A%2F%2Fcomoon.io%2Foauth%2Fcallback`);
    return;
  }

  console.log(`📋 Тестируем с токеном: ${accessToken.substring(0, 20)}...`);
  console.log(`🌐 Base URL: ${baseURL}\n`);

  // Тест 1: Проверка базового API
  console.log('🔍 Тест 1: Проверка базового API...');
  try {
    const response = await axios.get(baseURL, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });
    console.log(`✅ Базовый API доступен - Статус: ${response.status}`);
  } catch (error) {
    console.log(`❌ Базовый API недоступен - ${error.response?.status || error.message}`);
  }

  // Тест 2: Различные варианты endpoints
  const endpointVariants = [
    // Стандартные варианты
    '/contractors',
    '/contractors.json',
    '/contractors/list',
    '/contractors/list.json',
    '/contractors/add',
    '/contractors/add.json',
    
    // API префиксы
    '/api/contractors',
    '/api/contractors.json',
    '/api/v1/contractors',
    '/api/v1/contractors.json',
    
    // Альтернативные названия
    '/companies',
    '/companies.json',
    '/companies/list',
    '/companies/list.json',
    '/clients',
    '/clients.json',
    '/clients/list',
    '/clients/list.json',
    
    // Другие ресурсы
    '/invoices',
    '/invoices.json',
    '/invoices/list',
    '/invoices/list.json',
    '/bank_accounts',
    '/bank_accounts.json',
    '/bank_accounts/list',
    '/bank_accounts/list.json'
  ];

  console.log('\n🔍 Тест 2: Проверка различных endpoints...');
  
  for (const endpoint of endpointVariants) {
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

  // Тест 3: Различные методы аутентификации
  console.log('\n🔐 Тест 3: Различные методы аутентификации...');
  
  const authMethods = [
    {
      name: 'Bearer Token',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    },
    {
      name: 'Basic Auth',
      headers: { 'Authorization': `Basic ${Buffer.from(`${process.env.WFIRMA_CLIENT_ID}:${process.env.WFIRMA_CLIENT_SECRET}`).toString('base64')}` }
    },
    {
      name: 'API Key in Header',
      headers: { 'X-API-Key': accessToken }
    },
    {
      name: 'API Key in Query',
      params: { 'api_key': accessToken }
    }
  ];

  for (const authMethod of authMethods) {
    try {
      console.log(`🔑 Тестируем: ${authMethod.name}`);
      
      const config = {
        headers: {
          ...authMethod.headers,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };

      if (authMethod.params) {
        config.params = authMethod.params;
      }
      
      const response = await axios.get(`${baseURL}/contractors.json`, config);

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

  // Тест 4: Проверка OAuth endpoints
  console.log('\n🔐 Тест 4: Проверка OAuth endpoints...');
  
  const oauthEndpoints = [
    '/oauth/authorize',
    '/oauth/token',
    '/oauth/me',
    '/oauth/user',
    '/user',
    '/me',
    '/profile'
  ];

  for (const endpoint of oauthEndpoints) {
    try {
      console.log(`🔗 Тестируем OAuth: ${endpoint}`);
      
      const response = await axios.get(`${baseURL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        },
        timeout: 10000
      });

      console.log(`✅ ${endpoint} - Статус: ${response.status}`);
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${endpoint} - Статус: ${error.response.status}`);
      } else {
        console.log(`❌ ${endpoint} - Ошибка: ${error.message}`);
      }
    }
  }
}

// Запуск теста
if (require.main === module) {
  testWfirmaAPI()
    .then(() => {
      console.log('\n🏁 Детальное тестирование завершено');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Тестирование завершилось с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = testWfirmaAPI;






