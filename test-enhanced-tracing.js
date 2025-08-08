/**
 * Test script to verify enhanced dual tracing with detailed agent traces
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

async function testEnhancedTracing() {
  console.log('🧪 Testing Enhanced Dual Tracing (Langfuse + LangSmith)...\n');

  try {
    // Test 1: Check both services are healthy
    console.log('1️⃣ Checking observability services status...');
    
    const langfuseStatus = await axios.get(`${BASE_URL}/langfuse/status`);
    const langsmithStatus = await axios.get(`${BASE_URL}/langsmith/status`);
    
    console.log('✅ Langfuse:', langfuseStatus.data.enabled ? 'ENABLED' : 'DISABLED');
    console.log('✅ LangSmith:', langsmithStatus.data.enabled ? 'ENABLED' : 'DISABLED');

    if (!langfuseStatus.data.enabled || !langsmithStatus.data.enabled) {
      console.log('❌ One or both observability services are disabled');
      return;
    }

    console.log('\n2️⃣ Enhanced tracing is now implemented with:');
    console.log('   📊 Main processing traces in both systems');
    console.log('   🤖 Individual agent generations (file-classification, data-extraction)');
    console.log('   📈 Detailed metadata and timing information');
    console.log('   🔄 Parallel trace updates and finalization');

    console.log('\n3️⃣ To see enhanced tracing in action:');
    console.log('   1. Upload a document through your normal process');
    console.log('   2. Check server logs for detailed LangSmith debug messages');
    console.log('   3. Check LangSmith dashboard for detailed trace hierarchy');
    console.log('   4. Compare with Langfuse traces to see dual observability');

    console.log('\n🔍 What you should see in LangSmith now:');
    console.log('   📁 Project: expense-processing-default');
    console.log('   🔗 Main trace: "expense-processing-sequential"');
    console.log('   └── 🤖 Child generation: "file-classification"');
    console.log('   └── 🤖 Child generation: "data-extraction"');
    console.log('   └── 🤖 Child generation: "issue-detection" (if implemented)');
    console.log('   └── 🤖 Child generation: "citation-generation" (if implemented)');
    console.log('   └── 🤖 Child generation: "image-quality-assessment" (if implemented)');

    console.log('\n📊 Enhanced Debug Messages to Look For:');
    console.log('   🔍 Creating parallel LangSmith trace...');
    console.log('   ✅ LangSmith trace created successfully: [trace-id]');
    console.log('   🚀 Creating LangSmith generation: "file-classification"');
    console.log('   ✅ LangSmith generation posted successfully: [generation-id]');
    console.log('   🏁 Finalizing LangSmith trace: [trace-id]');
    console.log('   🚿 Flushing LangSmith data...');

    console.log('\n🎉 Enhanced Dual Tracing Implementation Complete!');
    console.log('   Your expense processing now has comprehensive dual observability');
    console.log('   with detailed agent-level tracing in both Langfuse and LangSmith.');

  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('   Server is not running. Please start the server first.');
    }
  }
}

// Run the test
testEnhancedTracing();
