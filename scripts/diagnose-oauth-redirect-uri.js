#!/usr/bin/env node

/**
 * Диагностика проблемы redirect_uri_mismatch для Google OAuth
 * 
 * Этот скрипт проверяет текущую конфигурацию и показывает,
 * какой redirect URI должен быть зарегистрирован в Google Cloud Console
 */

require('dotenv').config();
const config = require('../src/config/googleOAuth');

console.log('\n🔍 Диагностика Google OAuth Redirect URI\n');
console.log('═'.repeat(60));

// Проверяем переменные окружения
console.log('\n📋 Текущая конфигурация:\n');

const nodeEnv = process.env.NODE_ENV || 'development';
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL?.trim();
const baseUrl = process.env.BASE_URL?.trim();

console.log(`NODE_ENV: ${nodeEnv}`);
console.log(`GOOGLE_CLIENT_ID: ${googleClientId ? googleClientId.substring(0, 30) + '...' : '❌ НЕ УСТАНОВЛЕН'}`);
console.log(`GOOGLE_CLIENT_SECRET: ${googleClientSecret ? '✅ Установлен' : '❌ НЕ УСТАНОВЛЕН'}`);
console.log(`GOOGLE_CALLBACK_URL: ${googleCallbackUrl || '(не установлен, будет использоваться значение по умолчанию)'}`);
console.log(`BASE_URL: ${baseUrl || '(не установлен)'}`);

// Определяем фактический callback URL
const actualCallbackUrl = config.googleOAuth.callbackURL;
console.log(`\n✅ Фактический callback URL (используется в коде):`);
console.log(`   ${actualCallbackUrl}`);

// Проверяем, является ли это полным URL
const isFullUrl = actualCallbackUrl.startsWith('http://') || actualCallbackUrl.startsWith('https://');

if (!isFullUrl && nodeEnv === 'production') {
  console.log('\n⚠️  ВНИМАНИЕ: В production должен быть полный URL!');
  console.log('   Текущий callback URL является относительным, что может вызвать проблемы.');
}

// Определяем ожидаемые redirect URIs для Google Cloud Console
console.log('\n📝 Redirect URIs, которые должны быть зарегистрированы в Google Cloud Console:\n');

const expectedUris = [];

if (nodeEnv === 'production') {
  expectedUris.push('https://invoices.comoon.io/auth/google/callback');
} else {
  // В development может быть несколько вариантов
  expectedUris.push('http://localhost:3000/auth/google/callback');
  expectedUris.push('http://127.0.0.1:3000/auth/google/callback');
  
  // Если есть BASE_URL, добавляем его
  if (baseUrl) {
    expectedUris.push(`${baseUrl}/auth/google/callback`);
  }
  
  // Если GOOGLE_CALLBACK_URL установлен и это полный URL
  if (googleCallbackUrl && (googleCallbackUrl.startsWith('http://') || googleCallbackUrl.startsWith('https://'))) {
    expectedUris.push(googleCallbackUrl);
  }
}

// Убираем дубликаты
const uniqueUris = [...new Set(expectedUris)];

uniqueUris.forEach((uri, index) => {
  console.log(`   ${index + 1}. ${uri}`);
});

// Проверяем, соответствует ли фактический callback URL ожидаемым
console.log('\n🔗 Проверка соответствия:\n');

if (isFullUrl) {
  const matches = uniqueUris.some(uri => uri === actualCallbackUrl);
  if (matches) {
    console.log('   ✅ Фактический callback URL соответствует одному из ожидаемых');
  } else {
    console.log('   ⚠️  Фактический callback URL НЕ соответствует ожидаемым');
    console.log(`   Фактический: ${actualCallbackUrl}`);
    console.log(`   Ожидаемые: ${uniqueUris.join(', ')}`);
  }
} else {
  console.log('   ℹ️  Callback URL является относительным (это нормально для development)');
}

// Инструкции по исправлению
console.log('\n📚 Инструкции по исправлению:\n');

console.log('1. Откройте Google Cloud Console:');
console.log('   https://console.cloud.google.com/apis/credentials\n');

console.log('2. Найдите ваш OAuth 2.0 Client ID:');
if (googleClientId) {
  console.log(`   ${googleClientId}\n`);
} else {
  console.log('   (GOOGLE_CLIENT_ID не установлен в .env)\n');
}

console.log('3. Нажмите на Client ID для редактирования\n');

console.log('4. В разделе "Authorized redirect URIs" убедитесь, что добавлены:');
uniqueUris.forEach((uri, index) => {
  console.log(`   ${index + 1}. ${uri}`);
});

console.log('\n5. Если callback URL отсутствует, добавьте его и нажмите "Save"\n');

console.log('6. После сохранения подождите 1-2 минуты для применения изменений\n');

console.log('7. Попробуйте авторизоваться снова\n');

// Дополнительные проверки
console.log('\n🔧 Дополнительные проверки:\n');

if (!googleClientId || !googleClientSecret) {
  console.log('   ❌ GOOGLE_CLIENT_ID или GOOGLE_CLIENT_SECRET не установлены');
  console.log('      Получите их в Google Cloud Console:\n');
  console.log('      1. Перейдите в https://console.cloud.google.com/apis/credentials');
  console.log('      2. Создайте OAuth 2.0 Client ID (тип: Web application)');
  console.log('      3. Добавьте Authorized redirect URIs (см. выше)');
  console.log('      4. Скопируйте Client ID и Client Secret в .env файл\n');
}

if (nodeEnv === 'production' && !isFullUrl) {
  console.log('   ⚠️  В production должен быть установлен полный URL:');
  console.log('      GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback\n');
}

// Проверка на наличие flowName в запросе
console.log('\n💡 Примечание о flowName=GeneralOAuthFlow:\n');
console.log('   Если вы видите этот параметр в URL авторизации, это нормально.');
console.log('   Google использует разные OAuth flows, и GeneralOAuthFlow - это стандартный flow.\n');
console.log('   Проблема redirect_uri_mismatch возникает, когда:');
console.log('   - Redirect URI в запросе не совпадает с зарегистрированным в Google Cloud Console');
console.log('   - Или redirect URI вообще не зарегистрирован\n');

// Дополнительная информация для продакшена
if (nodeEnv === 'production') {
  console.log('\n🚀 Информация для продакшена:\n');
  console.log('   На продакшене (Render) убедитесь, что:');
  console.log('   1. NODE_ENV=production');
  console.log('   2. GOOGLE_CALLBACK_URL=https://invoices.comoon.io/auth/google/callback');
  console.log('      (или не установлен - код автоматически использует правильный URL)\n');
  console.log('   В Google Cloud Console для вашего Client ID должны быть:');
  console.log('   - Authorized redirect URIs: https://invoices.comoon.io/auth/google/callback');
  console.log('   - Authorized JavaScript origins: https://invoices.comoon.io\n');
  
  if (!isFullUrl && !googleCallbackUrl) {
    console.log('   ⚠️  ВНИМАНИЕ: GOOGLE_CALLBACK_URL не установлен, но это нормально.');
    console.log('      Код автоматически использует https://invoices.comoon.io/auth/google/callback\n');
  }
}

// Проверка соответствия Client ID
if (googleClientId) {
  console.log('\n🔑 Проверка Client ID:\n');
  
  // Определяем, какой это Client ID (локальный или продакшенный)
  const isLocalClientId = googleClientId.includes('m33ju7ellb9ik4lo76vcnjjn0udbqhtd');
  const isProdClientId = googleClientId.includes('e9p16svl3m3nveun69ooqjsn77kuefda');
  
  if (isLocalClientId) {
    console.log('   ✅ Используется локальный Client ID (для development)');
    console.log('   Redirect URIs для этого Client ID:');
    console.log('   - http://localhost:3000/auth/google/callback');
    console.log('   - http://127.0.0.1:3000/auth/google/callback\n');
  } else if (isProdClientId) {
    console.log('   ✅ Используется продакшенный Client ID');
    console.log('   Redirect URIs для этого Client ID:');
    console.log('   - https://invoices.comoon.io/auth/google/callback\n');
  } else {
    console.log('   ℹ️  Используется другой Client ID');
    console.log('   Убедитесь, что в Google Cloud Console для этого Client ID зарегистрированы правильные redirect URIs\n');
  }
}

console.log('═'.repeat(60));
console.log('\n');
