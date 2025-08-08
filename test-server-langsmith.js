/**
 * Test to trigger server-side LangSmith tracing and check logs
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

// Simple test content
const testContent = `
RECEIPT
Test Store
Date: 2025-01-07
Amount: $10.00
Total: $10.00
`;

async function testServerLangSmith() {
  console.log('🔍 Testing Server-Side LangSmith Integration...\n');

  try {
    // Create test file
    const testFile = 'server-test.txt';
    fs.writeFileSync(testFile, testContent);

    // Process document
    console.log('📤 Uploading document to trigger LangSmith tracing...');
    console.log('   Watch your server console for these messages:');
    console.log('   🔍 Creating parallel LangSmith trace...');
    console.log('   ✅ LangSmith trace created successfully');
    console.log('   🚀 Creating LangSmith trace: "expense-processing-sequential"');

    const form = new FormData();
    form.append('file', fs.createReadStream(testFile));
    form.append('country', 'US');
    form.append('icp', 'server-test');
    form.append('userId', 'test-user');
    form.append('sessionId', 'test-session');

    const response = await axios.post(`${BASE_URL}/documents/process`, form, {
      headers: { ...form.getHeaders() },
      timeout: 30000,
    });

    console.log('✅ Document uploaded successfully');
    console.log('   Job ID:', response.data.jobId);

    // Wait a moment
    console.log('\n⏳ Waiting 5 seconds for processing to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check status
    try {
      const statusResponse = await axios.get(`${BASE_URL}/documents/status/${response.data.jobId}`);
      console.log('📊 Job Status:', statusResponse.data.status);
    } catch (error) {
      console.log('⚠️  Status check failed:', error.message);
    }

    // Flush LangSmith
    console.log('\n🚿 Flushing LangSmith...');
    const flushResponse = await axios.post(`${BASE_URL}/langsmith/flush`);
    console.log('   Flush result:', flushResponse.data.success ? 'SUCCESS' : 'FAILED');

    console.log('\n🎯 Next Steps:');
    console.log('1. Check your server console logs for LangSmith debug messages');
    console.log('2. Look for messages with 🔍, ✅, ❌ emojis');
    console.log('3. If you see "LangSmith trace created successfully", check LangSmith dashboard');
    console.log('4. If you don\'t see debug messages, the integration needs debugging');

    console.log('\n📊 Expected in LangSmith Dashboard:');
    console.log('   Project: expense-processing-default');
    console.log('   Trace: expense-processing-sequential');
    console.log('   Timestamp: around', new Date().toISOString());

    // Clean up
    fs.unlinkSync(testFile);

  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    
    // Clean up on error
    try {
      fs.unlinkSync('server-test.txt');
    } catch (e) {}
  }
}

testServerLangSmith();
