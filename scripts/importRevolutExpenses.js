require('dotenv').config();
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

async function importRevolutExpenses() {
  const filePath = process.argv[2] || 'tests/transaction-statement_28-Aug-2025_18-Nov-2025.csv';
  const autoMatchThreshold = parseInt(process.argv[3]) || 90;
  
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = filePath.split('/').pop();
  
  console.log(`Uploading ${fileName}...`);
  console.log(`Auto-match threshold: ${autoMatchThreshold}%`);
  
  const formData = new FormData();
  formData.append('file', fileBuffer, {
    filename: fileName,
    contentType: 'text/csv'
  });
  
  try {
    const response = await axios.post(
      `http://localhost:3000/api/payments/import-expenses?autoMatchThreshold=${autoMatchThreshold}`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );
    
    const result = response.data;
    
    if (result.success) {
      const stats = result.data;
      console.log('\n✅ Import successful!');
      console.log(`Total records: ${stats.total}`);
      console.log(`Processed: ${stats.processed}`);
      console.log(`Auto-categorized: ${stats.autoMatched || stats.categorized} (>=${autoMatchThreshold}%)`);
      console.log(`Uncategorized: ${stats.uncategorized}`);
      console.log(`Ignored: ${stats.ignored || 0}`);
      
      if (stats.suggestions && Object.keys(stats.suggestions).length > 0) {
        console.log(`\nSuggestions available for ${Object.keys(stats.suggestions).length} payments`);
      }
    } else {
      console.error('❌ Import failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error uploading file:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

importRevolutExpenses();



