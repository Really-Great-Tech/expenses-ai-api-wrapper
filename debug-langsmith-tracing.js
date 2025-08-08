/**
 * Debug script to test LangSmith tracing and see detailed logs
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

// Create a simple test receipt
const testReceiptContent = `
RECEIPT
Store: Debug Test Store
Date: 2025-01-07
Amount: $15.99
Tax: $1.28
Total: $17.27
Payment: Credit Card
Category: Office Supplies
`;

async function debugLangSmithTracing() {
  console.log('🔍 Debug: Testing LangSmith Tracing...\n');

  try {
    // Step 1: Verify services are working
    console.log('1️⃣ Verifying LangSmith service...');
    const statusResponse = await axios.get(`${BASE_URL}/langsmith/status`);
    console.log('   Status:', statusResponse.data);

    const healthResponse = await axios.get(`${BASE_URL}/langsmith/health`);
    console.log('   Health:', healthResponse.data);

    // Step 2: Test flush to ensure connection
    console.log('\n2️⃣ Testing LangSmith connection...');
    const flushResponse = await axios.post(`${BASE_URL}/langsmith/flush`);
    console.log('   Flush result:', flushResponse.data);

    // Step 3: Create test file and process it
    console.log('\n3️⃣ Creating test document...');
    const testFileName = 'debug-receipt.txt';
    fs.writeFileSync(testFileName, testReceiptContent);
    console.log('   ✅ Test file created');

    // Step 4: Process the document
    console.log('\n4️⃣ Processing document (this should trigger LangSmith traces)...');
    console.log('   📋 Watch your server logs for these debug messages:');
    console.log('      🔍 Creating parallel LangSmith trace...');
    console.log('      ✅ LangSmith trace created successfully');
    console.log('      🚀 Creating LangSmith generation');
    console.log('      ✅ LangSmith generation posted successfully');

    const form = new FormData();
    form.append('file', fs.createReadStream(testFileName));
    form.append('country', 'US');
    form.append('icp', 'debug-test');
    form.append('userId', 'debug-user-123');
    form.append('sessionId', 'debug-session-456');

    const processResponse = await axios.post(`${BASE_URL}/documents/process`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 120000, // 2 minute timeout
    });

    console.log('   ✅ Document processing initiated');
    console.log('   Job ID:', processResponse.data.jobId);

    // Step 5: Wait and check status
    console.log('\n5️⃣ Waiting for processing to complete...');
    let jobCompleted = false;
    let attempts = 0;
    const maxAttempts = 12; // 2 minutes max

    while (!jobCompleted && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
      attempts++;

      try {
        const statusResponse = await axios.get(`${BASE_URL}/documents/status/${processResponse.data.jobId}`);
        console.log(`   Attempt ${attempts}: Status = ${statusResponse.data.status}`);

        if (statusResponse.data.status === 'completed' || statusResponse.data.status === 'failed') {
          jobCompleted = true;
          console.log('   ✅ Job completed with status:', statusResponse.data.status);
        }
      } catch (error) {
        console.log(`   ⚠️  Status check failed: ${error.message}`);
      }
    }

    // Step 6: Final flush to ensure all traces are sent
    console.log('\n6️⃣ Final flush to ensure traces are sent...');
    await axios.post(`${BASE_URL}/langsmith/flush`);
    console.log('   ✅ Final flush completed');

    // Step 7: Instructions for checking dashboard
    console.log('\n🎯 Now check your LangSmith dashboard:');
    console.log('   1. Go to https://smith.langchain.com');
    console.log('   2. Look for project: "expense-processing-default"');
    console.log('   3. Look for traces with name: "expense-processing-sequential"');
    console.log('   4. Check the timestamp matches when you ran this test');

    console.log('\n🔍 If you don\'t see traces, check:');
    console.log('   1. Server logs for LangSmith debug messages (🔍, ✅, ❌ emojis)');
    console.log('   2. Your LangSmith API key is valid');
    console.log('   3. Network connectivity to https://api.smith.langchain.com');
    console.log('   4. Project name matches exactly: "expense-processing-default"');

    // Clean up
    fs.unlinkSync(testFileName);
    console.log('\n🧹 Test file cleaned up');

  } catch (error) {
    console.log('❌ Debug test failed:', error.response?.data || error.message);
    
    if (error.response?.status === 400) {
      console.log('   This might be a validation error - check server logs');
    } else if (error.response?.status === 500) {
      console.log('   Internal server error - check server logs for details');
    }

    // Clean up on error
    try {
      fs.unlinkSync('debug-receipt.txt');
    } catch (e) {
      // File might not exist
    }
  }
}

// Run the debug test
debugLangSmithTracing();
