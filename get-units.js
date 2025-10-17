require('dotenv').config();

const axios = require('axios');
const logger = require('./src/utils/logger');

// Хардкодим ключи для тестирования
const WFIRMA_APP_KEY = '8e76feba50499c61fddd0905b4f310ea';
const WFIRMA_ACCESS_KEY = '61d2eee61d9104b2c9e5e1766af27633';
const WFIRMA_SECRET_KEY = 'd096f54b74c3f4adeb2fd4ab362cd085';
const WFIRMA_BASE_URL = 'https://api2.wfirma.pl';
const COMPANY_ID = '885512';

const wfirmaClient = axios.create({
  baseURL: WFIRMA_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'accessKey': WFIRMA_ACCESS_KEY,
    'secretKey': WFIRMA_SECRET_KEY,
    'appKey': WFIRMA_APP_KEY,
    'company_id': COMPANY_ID
  },
  timeout: 15000
});

async function getUnits() {
  console.log('🔧 Getting available units from wFirma...');

  try {
    // Попробуем разные endpoints для получения единиц измерения
    const endpoints = [
      '/units',
      '/units/find',
      '/goods_units',
      '/goods_units/find'
    ];

    for (const endpoint of endpoints) {
      console.log(`\n📋 Trying endpoint: ${endpoint}`);
      try {
        const response = await wfirmaClient.get(endpoint);
        
        if (response.data) {
          console.log(`✅ Success with ${endpoint}`);
          console.log('Response:', JSON.stringify(response.data, null, 2));
          
          // Если это XML ответ
          if (typeof response.data === 'string' && response.data.includes('<?xml')) {
            console.log('\n📄 XML Response:');
            console.log(response.data);
          }
        }
      } catch (error) {
        console.log(`❌ Failed with ${endpoint}: ${error.response?.status} - ${error.response?.data?.message || error.message}`);
      }
    }

  } catch (error) {
    console.error('❌ Error getting units:', error.message);
  }
}

getUnits();




