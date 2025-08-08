/**
 * Diagnostic script to check LangSmith service injection
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

async function diagnoseLangSmithInjection() {
  console.log('🔍 Diagnosing LangSmith Service Injection...\n');

  try {
    // Test 1: Check if LangSmith service is properly initialized
    console.log('1️⃣ Checking LangSmith service status...');
    const statusResponse = await axios.get(`${BASE_URL}/langsmith/status`);
    console.log('   Status:', statusResponse.data);

    if (!statusResponse.data.enabled) {
      console.log('❌ LangSmith service is DISABLED');
      console.log('   Check: LANGSMITH_ENABLED=true in .env');
      return;
    }

    if (!statusResponse.data.connected) {
      console.log('❌ LangSmith service is not connected');
      console.log('   Check: LANGSMITH_API_KEY in .env');
      return;
    }

    console.log('✅ LangSmith service is enabled and connected');

    // Test 2: Check health endpoint
    console.log('\n2️⃣ Checking LangSmith health...');
    const healthResponse = await axios.get(`${BASE_URL}/langsmith/health`);
    console.log('   Health:', healthResponse.data);

    // Test 3: Test flush (this confirms the service is working)
    console.log('\n3️⃣ Testing LangSmith flush...');
    const flushResponse = await axios.post(`${BASE_URL}/langsmith/flush`);
    console.log('   Flush:', flushResponse.data);

    console.log('\n✅ LangSmith service is working correctly');
    console.log('\n🔍 The issue is likely:');
    console.log('   1. Service injection in ExpenseProcessingService');
    console.log('   2. The processing flow not calling the updated methods');
    console.log('   3. Server not running the latest compiled code');

    console.log('\n🚀 Next Steps:');
    console.log('   1. Restart your server completely (stop and start)');
    console.log('   2. Make sure you built the latest code: npm run build');
    console.log('   3. Check server startup logs for service injection messages');
    console.log('   4. Look for this message on startup:');
    console.log('      "LangSmith Service: ✅ Injected"');

  } catch (error) {
    console.log('❌ Diagnostic failed:', error.response?.data || error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('   Server is not running or not accessible');
    }
  }
}

diagnoseLangSmithInjection();
