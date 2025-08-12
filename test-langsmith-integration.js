#!/usr/bin/env node

/**
 * Test script to verify LangSmith integration is working correctly
 * This script will create a test trace directly using the LangSmith service
 */

require('dotenv').config();

async function testLangSmithIntegration() {
  console.log('🔍 Testing LangSmith Integration...\n');

  try {
    // Test 1: Check environment variables
    console.log('1️⃣ Checking environment variables...');
    const requiredVars = ['LANGSMITH_API_KEY', 'LANGSMITH_PROJECT', 'LANGSMITH_ENABLED'];
    
    for (const varName of requiredVars) {
      const value = process.env[varName];
      if (!value) {
        console.log(`❌ ${varName}: NOT SET`);
        process.exit(1);
      } else {
        console.log(`✅ ${varName}: ${varName === 'LANGSMITH_API_KEY' ? value.substring(0, 10) + '...' : value}`);
      }
    }

    // Test 2: Import LangSmith SDK
    console.log('\n2️⃣ Testing LangSmith SDK import...');
    const { Client, RunTree } = require('langsmith');
    console.log('✅ LangSmith SDK imported successfully');

    // Test 3: Create LangSmith client
    console.log('\n3️⃣ Creating LangSmith client...');
    const client = new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
    });
    console.log('✅ LangSmith client created successfully');

    // Test 4: Create and post a test trace
    console.log('\n4️⃣ Creating test trace...');
    const trace = new RunTree({
      name: 'integration-test-trace',
      inputs: { 
        test: 'LangSmith integration test',
        timestamp: new Date().toISOString(),
        source: 'integration-test-script'
      },
      run_type: 'chain',
      client: client,
      project_name: process.env.LANGSMITH_PROJECT || 'expense-processing-default',
      tags: ['integration-test', 'verification'],
    });

    console.log(`✅ Trace created with ID: ${trace.id}`);

    // Test 5: Post the trace
    console.log('\n5️⃣ Posting trace to LangSmith...');
    await trace.postRun();
    console.log('✅ Trace posted successfully');

    // Test 6: Create a child generation
    console.log('\n6️⃣ Creating child generation...');
    const generation = trace.createChild({
      name: 'test-generation',
      inputs: { prompt: 'Test prompt for generation' },
      run_type: 'llm',
    });

    await generation.postRun();
    console.log(`✅ Generation created and posted with ID: ${generation.id}`);

    // Test 7: Update generation with outputs
    console.log('\n7️⃣ Updating generation with outputs...');
    generation.end({
      outputs: { response: 'Test response from generation' },
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });

    await generation.patchRun();
    console.log('✅ Generation updated successfully');

    // Test 8: Finalize the main trace
    console.log('\n8️⃣ Finalizing main trace...');
    trace.end({
      outputs: { 
        success: true,
        test_result: 'Integration test completed successfully',
        generations_created: 1
      },
    });

    await trace.patchRun();
    console.log('✅ Trace finalized successfully');

    // Test 9: Flush client
    console.log('\n9️⃣ Flushing LangSmith client...');
    await client.flush();
    console.log('✅ Client flushed successfully');

    // Success message
    console.log('\n🎉 LangSmith Integration Test PASSED!');
    console.log('✅ All tests completed successfully');
    console.log(`🔗 Check your LangSmith dashboard for the trace:`);
    console.log(`   Project: ${process.env.LANGSMITH_PROJECT || 'expense-processing-default'}`);
    console.log(`   Trace ID: ${trace.id}`);
    console.log(`   URL: https://smith.langchain.com/o/default/projects/p/${process.env.LANGSMITH_PROJECT || 'expense-processing-default'}/r/${trace.id}`);

  } catch (error) {
    console.error('\n❌ LangSmith Integration Test FAILED!');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run the test
testLangSmithIntegration();
