/**
 * Test script to trigger dual tracing (Langfuse + LangSmith) by processing a document
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = 'http://localhost:3000/rgt-expense/api/v1';

// Create a simple test receipt content
const testReceiptContent = `
RECEIPT
Store: Test Store
Date: 2025-01-07
Amount: $25.50
Tax: $2.30
Total: $27.80
Payment: Credit Card
`;

async function testDualTracing() {
  console.log('🧪 Testing Dual Tracing (Langfuse + LangSmith)...\n');

  try {
    // Create a temporary test file
    const testFileName = 'test-receipt.txt';
    fs.writeFileSync(testFileName, testReceiptContent);
    console.log('📄 Created test receipt file');

    // Prepare form data for file upload
    const form = new FormData();
    form.append('file', fs.createReadStream(testFileName));
    form.append('country', 'US');
    form.append('icp', 'test-icp');
    form.append('userId', 'test-user-123');
    form.append('sessionId', 'test-session-456');

    console.log('🚀 Uploading document for processing...');
    console.log('   This should trigger dual tracing in both Langfuse and LangSmith');

    // Process the document
    const response = await axios.post(`${BASE_URL}/documents/process`, form, {
      headers: {
        ...form.getHeaders(),
      },
      timeout: 60000, // 60 second timeout
    });

    console.log('✅ Document processing initiated successfully!');
    console.log('   Job ID:', response.data.jobId);
    console.log('   Status:', response.data.status);

    // Wait a moment for processing to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check job status
    console.log('\n🔍 Checking job status...');
    try {
      const statusResponse = await axios.get(`${BASE_URL}/documents/status/${response.data.jobId}`);
      console.log('   Job Status:', statusResponse.data.status);
      console.log('   Progress:', statusResponse.data.progress || 'N/A');
    } catch (error) {
      console.log('   Status check failed:', error.response?.data || error.message);
    }

    console.log('\n🎉 Dual Tracing Test Complete!');
    console.log('\n📊 Check Your Dashboards:');
    console.log('1. 🔵 Langfuse Dashboard: Look for traces with name "expense-processing-sequential"');
    console.log('2. 🟢 LangSmith Dashboard: Look for project "expense-processing-default"');
    console.log('3. 🔍 Server Logs: Look for LangSmith debug messages (🔍, ✅, ❌ emojis)');

    console.log('\n🔍 Expected Debug Messages in Server Logs:');
    console.log('   - 🔍 Creating parallel LangSmith trace...');
    console.log('   - ✅ LangSmith trace created successfully');
    console.log('   - 🚀 Creating LangSmith trace: "expense-processing-sequential"');
    console.log('   - ✅ LangSmith trace posted successfully');

    // Clean up
    fs.unlinkSync(testFileName);
    console.log('\n🧹 Cleaned up test file');

  } catch (error) {
    console.log('❌ Test failed:', error.response?.data || error.message);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('   Server is not running. Please start the server first.');
    } else if (error.response?.status === 400) {
      console.log('   This might be a validation error - check the server logs for details');
    } else if (error.response?.status === 500) {
      console.log('   Internal server error - check the server logs for details');
    }

    console.log('\n🔧 Troubleshooting:');
    console.log('1. Make sure the server is running on http://localhost:3000');
    console.log('2. Check server logs for any error messages');
    console.log('3. Verify AWS credentials are properly configured');
    console.log('4. Check that both LANGFUSE_ENABLED and LANGSMITH_ENABLED are true');

    // Clean up on error
    try {
      fs.unlinkSync('test-receipt.txt');
    } catch (e) {
      // File might not exist
    }
  }
}

// Run the test
testDualTracing();
