/**
 * Direct test of LangSmith tracing to verify it's working
 */

const { Client, RunTree } = require('langsmith');
require('dotenv').config();

async function testLangSmithDirect() {
  console.log('🔍 Direct LangSmith Test...\n');

  try {
    // Check environment variables
    console.log('1️⃣ Environment Variables:');
    console.log('   LANGSMITH_API_KEY:', process.env.LANGSMITH_API_KEY ? 'SET' : 'NOT SET');
    console.log('   LANGSMITH_PROJECT:', process.env.LANGSMITH_PROJECT || 'NOT SET');
    console.log('   LANGSMITH_ENDPOINT:', process.env.LANGSMITH_ENDPOINT || 'NOT SET');

    if (!process.env.LANGSMITH_API_KEY) {
      console.log('❌ LANGSMITH_API_KEY not set');
      return;
    }

    // Create client
    console.log('\n2️⃣ Creating LangSmith client...');
    const client = new Client({
      apiKey: process.env.LANGSMITH_API_KEY,
      apiUrl: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com',
    });
    console.log('✅ Client created');

    // Create a test trace
    console.log('\n3️⃣ Creating test trace...');
    const trace = new RunTree({
      name: 'direct-test-trace',
      inputs: { 
        test: 'Direct LangSmith test',
        timestamp: new Date().toISOString(),
        source: 'debug-script'
      },
      run_type: 'chain',
      client: client,
      project_name: process.env.LANGSMITH_PROJECT || 'expense-processing-default',
      tags: ['debug', 'direct-test'],
    });

    console.log('   Trace ID:', trace.id);
    console.log('   Project:', process.env.LANGSMITH_PROJECT || 'expense-processing-default');

    // Post the trace
    console.log('\n4️⃣ Posting trace to LangSmith...');
    await trace.postRun();
    console.log('✅ Trace posted successfully');

    // Create a child generation
    console.log('\n5️⃣ Creating child generation...');
    const generation = trace.createChild({
      name: 'test-generation',
      inputs: { prompt: 'Test prompt for generation' },
      run_type: 'llm',
      extra: {
        metadata: {
          model: 'test-model',
          provider: 'test-provider',
        }
      }
    });

    console.log('   Generation ID:', generation.id);

    // Post the generation
    await generation.postRun();
    console.log('✅ Generation posted successfully');

    // Update generation with output
    generation.end({
      outputs: { 
        result: 'Test generation output',
        success: true 
      },
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      }
    });

    await generation.patchRun();
    console.log('✅ Generation updated with output');

    // Finalize main trace
    console.log('\n6️⃣ Finalizing main trace...');
    trace.end({
      outputs: { 
        success: true,
        message: 'Direct test completed successfully',
        generations_created: 1
      }
    });

    await trace.patchRun();
    console.log('✅ Main trace finalized');

    // Flush to ensure everything is sent
    console.log('\n7️⃣ Flushing client...');
    await client.flush();
    console.log('✅ Client flushed');

    console.log('\n🎉 Direct LangSmith test completed successfully!');
    console.log('\n📊 Check your LangSmith dashboard:');
    console.log('   1. Go to https://smith.langchain.com');
    console.log('   2. Look for project:', process.env.LANGSMITH_PROJECT || 'expense-processing-default');
    console.log('   3. Look for trace: "direct-test-trace"');
    console.log('   4. Should have 1 child generation: "test-generation"');
    console.log('   5. Timestamp:', new Date().toISOString());

    console.log('\n🔍 If you see this trace, LangSmith is working correctly.');
    console.log('   The issue is likely in the NestJS application integration.');

  } catch (error) {
    console.log('❌ Direct test failed:', error.message);
    console.log('   Error details:', error);
    
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      console.log('   → Check your LANGSMITH_API_KEY');
    } else if (error.message.includes('network') || error.message.includes('ENOTFOUND')) {
      console.log('   → Check network connectivity to LangSmith');
    } else if (error.message.includes('project')) {
      console.log('   → Check your project name');
    }
  }
}

// Run the test
testLangSmithDirect();
