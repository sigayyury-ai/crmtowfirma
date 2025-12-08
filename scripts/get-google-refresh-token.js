#!/usr/bin/env node

/**
 * Скрипт для получения Google Calendar API Refresh Token
 * 
 * Использование:
 * 1. Убедитесь что GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET установлены в .env
 * 2. Запустите: node scripts/get-google-refresh-token.js
 * 3. Откройте URL который появится в консоли
 * 4. Авторизуйтесь и скопируйте код из URL
 * 5. Вставьте код в консоль
 * 6. Refresh token будет выведен - скопируйте его в .env как GOOGLE_REFRESH_TOKEN
 */

require('dotenv').config();
const { google } = require('googleapis');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function getRefreshToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret || clientId === 'your_google_client_id' || clientSecret === 'your_google_client_secret') {
    console.error('❌ Ошибка: GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET должны быть установлены в .env');
    console.error('   Получите их в Google Cloud Console: https://console.cloud.google.com/apis/credentials');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    'urn:ietf:wg:oauth:2.0:oob' // Для установленных приложений
  );

  // Scopes для Google Calendar API
  const scopes = [
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly'
  ];

  // Генерируем URL для авторизации
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline', // Важно для получения refresh token
    scope: scopes,
    prompt: 'consent' // Принудительно запрашиваем согласие для получения refresh token
  });

  console.log('\n📋 Инструкция:\n');
  console.log('1. Откройте этот URL в браузере:');
  console.log(`\n   ${authUrl}\n`);
  console.log('2. Войдите с аккаунтом Google, который имеет доступ к календарю');
  console.log('3. Разрешите доступ к календарю');
  console.log('4. После авторизации вы будете перенаправлены на страницу с кодом');
  console.log('5. Скопируйте код из URL (параметр "code=...") или со страницы\n');

  rl.question('Вставьте код авторизации здесь: ', async (code) => {
    try {
      const { tokens } = await oauth2Client.getToken(code.trim());
      
      console.log('\n✅ Успешно получен Refresh Token!\n');
      console.log('Добавьте эти переменные в ваш .env файл:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log(`GOOGLE_CALENDAR_ID=primary  # или email календаря, например: hello@comoon.io`);
      console.log(`GOOGLE_TIMEZONE=Europe/Warsaw  # часовой пояс календаря\n`);
      
      if (tokens.access_token) {
        console.log('✅ Access Token также получен (будет использоваться автоматически)');
      }
      
      rl.close();
      process.exit(0);
    } catch (error) {
      console.error('\n❌ Ошибка при получении токена:', error.message);
      console.error('\nПроверьте:');
      console.error('1. Код был скопирован полностью');
      console.error('2. GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET правильные');
      console.error('3. В Google Cloud Console включен Google Calendar API');
      rl.close();
      process.exit(1);
    }
  });
}

getRefreshToken();

