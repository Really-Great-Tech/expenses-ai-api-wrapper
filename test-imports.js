/**
 * Test to check if our TypeScript files can be imported
 */

console.log('🔍 Testing TypeScript imports...');

try {
  // Test if we can require the compiled JavaScript files
  console.log('1. Testing LangSmithService import...');
  const LangSmithService = require('./dist/services/langsmith.service.js');
  console.log('✅ LangSmithService imported successfully');

  console.log('2. Testing LangSmithModule import...');
  const LangSmithModule = require('./dist/modules/langsmith/langsmith.module.js');
  console.log('✅ LangSmithModule imported successfully');

  console.log('3. Testing ExpenseProcessingService import...');
  const ExpenseProcessingService = require('./dist/services/expense-processing.service.js');
  console.log('✅ ExpenseProcessingService imported successfully');

  console.log('4. Testing AppModule import...');
  const AppModule = require('./dist/app.module.js');
  console.log('✅ AppModule imported successfully');

  console.log('\n🎉 All imports successful! The issue might be runtime-related.');

} catch (error) {
  console.log('❌ Import failed:', error.message);
  console.log('Stack trace:', error.stack);
  
  console.log('\n🔧 Possible solutions:');
  console.log('1. Run: npm run build');
  console.log('2. Check for missing dependencies');
  console.log('3. Check TypeScript compilation errors');
}
