#!/usr/bin/env node

/**
 * Получение Access Token для wFirma OAuth 2.0
 * Использует authorization code flow
 */

require('dotenv').config();
const axios = require('axios');
const logger = require('./src/utils/logger');

async function getAccessToken(authorizationCode) {
  console.log('🔐 Получение Access Token для wFirma OAuth 2.0...\n');

  const clientId = process.env.WFIRMA_CLIENT_ID || '0a749723fca35677bf7a6f931646385e';
  const clientSecret = process.env.WFIRMA_CLIENT_SECRET || 'c5b3bc3058a60caaf13b4e57cd4d5c15';
  const redirectUri = 'https://comoon.io/oauth/callback';
  const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';

  if (!authorizationCode) {
    console.log('❌ Ошибка: Не предоставлен authorization code');
    console.log('\n📝 Инструкция:');
    console.log('1. Откройте URL авторизации в браузере:');
    console.log(`   ${baseURL}/oauth/authorize?client_id=${clientId}&response_type=code&scope=read write&redirect_uri=${encodeURIComponent(redirectUri)}`);
    console.log('2. Авторизуйтесь в wFirma');
    console.log('3. Скопируйте код из redirect URL (параметр "code")');
    console.log('4. Запустите скрипт с кодом:');
    console.log(`   node get-access-token.js YOUR_AUTHORIZATION_CODE`);
    return;
  }

  try {
    console.log('📋 Параметры запроса:');
    console.log(`   Client ID: ${clientId}`);
    console.log(`   Authorization Code: ${authorizationCode.substring(0, 20)}...`);
    console.log(`   Redirect URI: ${redirectUri}`);
    console.log(`   Base URL: ${baseURL}\n`);

    // Запрос access token
    const tokenResponse = await axios.post(`${baseURL}/oauth/token`, {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code: authorizationCode,
      redirect_uri: redirectUri
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (tokenResponse.data) {
      console.log('✅ Access Token получен успешно!');
      console.log('\n📊 Данные токена:');
      console.log(`   Access Token: ${tokenResponse.data.access_token}`);
      console.log(`   Token Type: ${tokenResponse.data.token_type || 'Bearer'}`);
      console.log(`   Expires In: ${tokenResponse.data.expires_in || 'N/A'} секунд`);
      if (tokenResponse.data.refresh_token) {
        console.log(`   Refresh Token: ${tokenResponse.data.refresh_token}`);
      }
      if (tokenResponse.data.scope) {
        console.log(`   Scope: ${tokenResponse.data.scope}`);
      }

      console.log('\n🔧 Добавьте в .env файл:');
      console.log(`WFIRMA_ACCESS_TOKEN=${tokenResponse.data.access_token}`);
      if (tokenResponse.data.refresh_token) {
        console.log(`WFIRMA_REFRESH_TOKEN=${tokenResponse.data.refresh_token}`);
      }

      // Тест API с полученным токеном
      console.log('\n🧪 Тестирование API с полученным токеном...');
      await testAPIWithToken(tokenResponse.data.access_token);

    } else {
      console.log('❌ Неожиданный ответ от сервера');
    }

  } catch (error) {
    console.error('💥 Ошибка получения Access Token:', error.message);
    
    if (error.response) {
      console.error('📋 Статус ответа:', error.response.status);
      console.error('📋 Данные ответа:', JSON.stringify(error.response.data, null, 2));
    }
    
    console.log('\n🔍 Возможные причины:');
    console.log('- Неверный authorization code');
    console.log('- Код уже использован (одноразовый)');
    console.log('- Неверные client_id или client_secret');
    console.log('- Неверный redirect_uri');
    console.log('- Проблемы с сетью или сервером wFirma');
  }
}

async function testAPIWithToken(accessToken) {
  try {
    const baseURL = process.env.WFIRMA_BASE_URL || 'https://api2.wfirma.pl';
    
    const response = await axios.get(`${baseURL}/contractors`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    console.log('✅ API тест успешен!');
    console.log(`📊 Статус: ${response.status}`);
    console.log(`📊 Данные: ${JSON.stringify(response.data, null, 2)}`);

  } catch (error) {
    console.log('⚠️  API тест не прошел:', error.message);
    if (error.response) {
      console.log(`📋 Статус: ${error.response.status}`);
      console.log(`📋 Данные: ${JSON.stringify(error.response.data, null, 2)}`);
    }
  }
}

// Запуск скрипта
if (require.main === module) {
  const authCode = process.argv[2];
  
  getAccessToken(authCode)
    .then(() => {
      console.log('\n🏁 Процесс завершен');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Процесс завершился с ошибкой:', error.message);
      process.exit(1);
    });
}

module.exports = getAccessToken;






