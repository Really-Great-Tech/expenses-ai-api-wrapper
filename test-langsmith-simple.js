/**
 * Simple test to verify LangSmith SDK works
 */

// Test 1: Check if langsmith package can be imported
console.log('🔍 Testing LangSmith SDK import...');
try {
  const { Client } = require('langsmith');
  const { RunTree } = require('langsmith');
  console.log('✅ LangSmith SDK imported successfully');
  console.log('   Client:', typeof Client);
  console.log('   RunTree:', typeof RunTree);
} catch (error) {
  console.log('❌ Failed to import LangSmith SDK:', error.message);
  process.exit(1);
}

// Test 2: Check environment variables
console.log('\n🔍 Checking environment variables...');
require('dotenv').config();

const envVars = {
  LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
  LANGSMITH_ENABLED: process.env.LANGSMITH_ENABLED,
  LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
  LANGSMITH_ENDPOINT: process.env.LANGSMITH_ENDPOINT,
  LANGSMITH_TRACING: process.env.LANGSMITH_TRACING,
};

console.log('Environment variables:');
Object.entries(envVars).forEach(([key, value]) => {
  if (key === 'LANGSMITH_API_KEY') {
    console.log(`   ${key}: ${value ? `SET (${value.substring(0, 10)}...${value.substring(value.length - 4)})` : 'NOT SET'}`);
  } else {
    console.log(`   ${key}: ${value || 'NOT SET'}`);
  }
});

// Test 3: Try to create LangSmith client
console.log('\n🔍 Testing LangSmith client creation...');
try {
  const { Client } = require('langsmith');
  
  if (!process.env.LANGSMITH_API_KEY) {
    console.log('❌ Cannot test client - LANGSMITH_API_KEY not set');
    process.exit(1);
  }

  const client = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
  });

  console.log('✅ LangSmith client created successfully');
  console.log('   API URL:', process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com');
  
  // Test 4: Try to create a simple trace
  console.log('\n🔍 Testing simple trace creation...');
  
  const { RunTree } = require('langsmith');
  
  const trace = new RunTree({
    name: 'test-trace',
    inputs: { test: 'input' },
    run_type: 'chain',
    client: client,
    project_name: process.env.LANGSMITH_PROJECT || 'expense-processing-default',
  });

  console.log('✅ RunTree created successfully');
  console.log('   Trace ID:', trace.id);
  console.log('   Project:', process.env.LANGSMITH_PROJECT || 'expense-processing-default');

  // Test 5: Try to post the trace
  console.log('\n🔍 Testing trace posting...');
  
  trace.postRun()
    .then(() => {
      console.log('✅ Trace posted successfully to LangSmith!');
      console.log('   Check your LangSmith dashboard for the trace');
      console.log('   Project:', process.env.LANGSMITH_PROJECT || 'expense-processing-default');
      
      // Finalize the trace
      trace.end({ outputs: { test: 'output', success: true } });
      return trace.patchRun();
    })
    .then(() => {
      console.log('✅ Trace finalized successfully!');
      console.log('\n🎉 LangSmith integration test PASSED!');
      console.log('   Your LangSmith configuration is working correctly.');
      console.log('   The issue might be with the NestJS application startup.');
    })
    .catch(error => {
      console.log('❌ Failed to post trace to LangSmith:', error.message);
      console.log('   This could indicate:');
      console.log('   1. Invalid API key');
      console.log('   2. Network connectivity issues');
      console.log('   3. LangSmith service unavailable');
      console.log('   Error details:', error);
    });

} catch (error) {
  console.log('❌ Failed to create LangSmith client:', error.message);
  console.log('   Error details:', error);
}
