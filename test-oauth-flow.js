const axios = require('axios');

async function testOAuthFlow() {
  console.log('🔐 Testing OAuth 2.0 flow for wFirma...\n');
  
  const clientId = '0a749723fca35677bf7a6f931646385e';
  const clientSecret = 'c5b3bc3058a60caaf13b4e57cd4d5c15';
  const redirectUri = 'https://comoon.io/wptbox/oauth/';
  
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
  console.log(`node test-oauth-flow.js YOUR_AUTHORIZATION_CODE`);
  console.log('');
  
  // Если передан authorization code, обмениваем его на access token
  const authCode = process.argv[2];
  if (authCode) {
    console.log('🔄 Step 2: Exchanging authorization code for access token...');
    
    try {
      const response = await axios.post('https://api2.wfirma.pl/oauth2/token?oauth_version=2', {
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret
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
        console.log('');
        
        // Тестируем API с полученным токеном
        console.log('🧪 Step 3: Testing API with access token...');
        await testApiWithToken(response.data.access_token);
      } else {
        console.error('❌ Invalid response from token endpoint:', response.data);
      }
    } catch (error) {
      console.error('❌ Error exchanging authorization code:', error.response?.data || error.message);
    }
  }
}

async function testApiWithToken(accessToken) {
  try {
    const response = await axios.get('https://api2.wfirma.pl/contractors/find', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    console.log('✅ API test successful!');
    console.log('Response:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('❌ API test failed:', error.response?.data || error.message);
  }
}

testOAuthFlow();
