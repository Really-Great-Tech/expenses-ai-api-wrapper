/**
 * Test script to verify dual observability (Langfuse + LangSmith) integration
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

async function testDualObservability() {
  console.log('🧪 Testing Dual Observability Integration...\n');

  try {
    // Wait for server to be ready
    console.log('⏳ Waiting for server to be ready...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Test 1: Check Langfuse status
    console.log('1️⃣ Testing Langfuse status...');
    try {
      const langfuseResponse = await axios.get(`${BASE_URL}/langfuse/status`);
      console.log('✅ Langfuse Status:', {
        enabled: langfuseResponse.data.enabled,
        connected: langfuseResponse.data.connected,
        version: langfuseResponse.data.version
      });
    } catch (error) {
      console.log('❌ Langfuse Status Error:', error.response?.data || error.message);
    }

    // Test 2: Check LangSmith status
    console.log('\n2️⃣ Testing LangSmith status...');
    try {
      const langsmithResponse = await axios.get(`${BASE_URL}/langsmith/status`);
      console.log('✅ LangSmith Status:', {
        enabled: langsmithResponse.data.enabled,
        connected: langsmithResponse.data.connected,
        version: langsmithResponse.data.version
      });
    } catch (error) {
      console.log('❌ LangSmith Status Error:', error.response?.data || error.message);
    }

    // Test 3: Check health endpoint includes both services
    console.log('\n3️⃣ Testing health endpoint...');
    try {
      const healthResponse = await axios.get(`${BASE_URL}/health`);
      const envVars = healthResponse.data.environment_variables;
      
      console.log('✅ Health Check - Observability Environment Variables:');
      console.log('   Langfuse Enabled:', envVars.LANGFUSE_ENABLED || 'not set');
      console.log('   LangSmith Enabled:', envVars.LANGSMITH_ENABLED || 'not set');
      console.log('   LangSmith API Key:', envVars.LANGSMITH_API_KEY || 'not set');
      console.log('   LangSmith Project:', envVars.LANGSMITH_PROJECT || 'not set');
    } catch (error) {
      console.log('❌ Health Check Error:', error.response?.data || error.message);
    }

    // Test 4: Test LangSmith health endpoint
    console.log('\n4️⃣ Testing LangSmith health endpoint...');
    try {
      const langsmithHealthResponse = await axios.get(`${BASE_URL}/langsmith/health`);
      console.log('✅ LangSmith Health:', langsmithHealthResponse.data);
    } catch (error) {
      console.log('❌ LangSmith Health Error:', error.response?.data || error.message);
    }

    // Test 5: Test LangSmith flush endpoint
    console.log('\n5️⃣ Testing LangSmith flush endpoint...');
    try {
      const flushResponse = await axios.post(`${BASE_URL}/langsmith/flush`);
      console.log('✅ LangSmith Flush:', flushResponse.data);
    } catch (error) {
      console.log('❌ LangSmith Flush Error:', error.response?.data || error.message);
    }

    // Test 6: Trigger a simple classification to test tracing
    console.log('\n6️⃣ Testing simple classification to trigger LangSmith traces...');
    try {
      const testData = {
        markdownContent: 'Test receipt content for classification',
        country: 'US',
        expenseSchema: { properties: { test: 'value' } }
      };

      console.log('   Sending classification request...');
      const classificationResponse = await axios.post(`${BASE_URL}/documents/process`, testData);
      console.log('✅ Classification completed - check LangSmith dashboard for traces');
      console.log('   Response status:', classificationResponse.status);
    } catch (error) {
      console.log('❌ Classification test failed:', error.response?.data || error.message);
      console.log('   This is expected if you don\'t have proper API keys configured');
    }

    console.log('\n🎉 Dual Observability Integration Test Complete!');
    console.log('\n📋 Next Steps:');
    console.log('1. ✅ LANGSMITH_ENABLED=true (already set)');
    console.log('2. ✅ LANGSMITH_API_KEY=your_api_key (already set)');
    console.log('3. Check the server logs for LangSmith debug messages');
    console.log('4. Process a document to see dual tracing in action');
    console.log('5. Check both Langfuse and LangSmith dashboards for traces');
    console.log('\n🔍 Debug Tips:');
    console.log('- Look for LangSmith debug messages in server logs (🔍, ✅, ❌ emojis)');
    console.log('- Verify your LangSmith API key is valid');
    console.log('- Check that the project name appears in LangSmith dashboard');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run the test
testDualObservability();
