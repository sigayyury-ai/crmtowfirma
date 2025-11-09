const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const PipedriveClient = require('../services/pipedrive');
const WfirmaClient = require('../services/wfirma');

(async () => {
  const results = {
    pipedrive: null,
    wfirma: null
  };

  console.log('=== Checking API connectivity ===');

  // Check Pipedrive
  try {
    const pipedriveClient = new PipedriveClient();
    const pipedriveResult = await pipedriveClient.testConnection();
    results.pipedrive = pipedriveResult;
    if (pipedriveResult.success) {
      console.log('✓ Pipedrive connection OK:', pipedriveResult.user?.email || pipedriveResult.message);
    } else {
      console.error('✗ Pipedrive connection FAILED:', pipedriveResult.error);
      if (pipedriveResult.details) {
        console.error('Details:', pipedriveResult.details);
      }
    }
  } catch (error) {
    results.pipedrive = { success: false, error: error.message };
    console.error('✗ Pipedrive client error:', error.message);
  }

  // Check wFirma
  try {
    const wfirmaClient = new WfirmaClient();
    const wfirmaResult = await wfirmaClient.testConnection();
    results.wfirma = wfirmaResult;
    if (wfirmaResult.success) {
      console.log('✓ wFirma connection OK:', wfirmaResult.message);
      if (wfirmaResult.status) {
        console.log('Status code:', wfirmaResult.status);
      }
    } else {
      console.error('✗ wFirma connection FAILED:', wfirmaResult.error);
      if (wfirmaResult.details) {
        console.error('Details:', wfirmaResult.details);
      }
    }
  } catch (error) {
    results.wfirma = { success: false, error: error.message };
    console.error('✗ wFirma client error:', error.message);
  }

  console.log('\nSummary:', JSON.stringify(results, null, 2));

  if (!results.pipedrive?.success || !results.wfirma?.success) {
    process.exitCode = 1;
  }
})();
