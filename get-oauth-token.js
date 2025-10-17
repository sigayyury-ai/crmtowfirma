require('dotenv').config();
const axios = require('axios');

async function getOAuthToken() {
  console.log('🔐 Getting OAuth 2.0 access token for wFirma...\n');
  
  const clientId = process.env.WFIRMA_CLIENT_ID;
  const clientSecret = process.env.WFIRMA_CLIENT_SECRET;
  const redirectUri = 'https://comoon.io/wptbox/oauth/';
  
  if (!clientId || !clientSecret) {
    console.error('❌ WFIRMA_CLIENT_ID and WFIRMA_CLIENT_SECRET must be set in environment variables');
    return;
  }
  
  // Шаг 1: Создаем URL для авторизации
  const authUrl = `https://wfirma.pl/oauth2/auth?response_type=code&client_id=${clientId}&scope=invoices-read invoices-write contractors-read contractors-write company_accounts-read users-read&redirect_uri=${encodeURIComponent(redirectUri)}`;
  
  console.log('📋 Step 1: Authorization URL');
  console.log('Open this URL in your browser and authorize the application:');
  console.log(authUrl);
  console.log('');
  console.log('After authorization, you will be redirected to:');
  console.log(`${redirectUri}?code=AUTHORIZATION_CODE`);
  console.log('');
  console.log('Copy the authorization code from the URL and run:');
  console.log(`node get-oauth-token.js YOUR_AUTHORIZATION_CODE`);
  console.log('');
  
  // Если передан authorization code, обмениваем его на access token
  const authCode = process.argv[2];
  if (authCode) {
    console.log('🔄 Step 2: Exchanging authorization code for access token...');
    
    try {
      const response = await axios.post('https://api2.wfirma.pl/oauth2/token?oauth_version=2', {
        grant_type: 'authorization_code',
        code: authCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.access_token) {
        console.log('✅ Success! Access token obtained:');
        console.log('Access Token:', response.data.access_token);
        console.log('Refresh Token:', response.data.refresh_token || 'Not provided');
        console.log('Expires In:', response.data.expires_in || 'Not specified');
        console.log('');
        console.log('Add these to your .env file:');
        console.log(`WFIRMA_ACCESS_TOKEN=${response.data.access_token}`);
        if (response.data.refresh_token) {
          console.log(`WFIRMA_REFRESH_TOKEN=${response.data.refresh_token}`);
        }
      } else {
        console.error('❌ Invalid response from token endpoint:', response.data);
      }
    } catch (error) {
      console.error('❌ Error exchanging authorization code:', error.response?.data || error.message);
    }
  }
}

getOAuthToken();
