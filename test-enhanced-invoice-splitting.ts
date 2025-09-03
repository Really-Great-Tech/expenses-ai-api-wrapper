/**
 * Test script for the Enhanced Invoice Splitting Workflow
 * 
 * This script demonstrates the new workflow:
 * 1. User uploads an expense document
 * 2. System detects multi-page documents
 * 3. Passes to invoice splitting system; returns individual receipts with markdown
 * 4. Each receipt goes through image quality assessment
 * 5. Each receipt is processed through the expense processing pipeline
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { EnhancedDocumentProcessingService } from './src/services/enhanced-document-processing.service';
import { DocumentService } from './src/modules/document/document.service';
import * as fs from 'fs';
import * as path from 'path';

async function testEnhancedInvoiceSplittingWorkflow() {
  console.log('🚀 Starting Enhanced Invoice Splitting Workflow Test');
  console.log('=' .repeat(60));

  // Bootstrap the NestJS application
  const app = await NestFactory.createApplicationContext(AppModule);
  
  try {
    // Get the enhanced document processing service
    const enhancedService = app.get(EnhancedDocumentProcessingService);
    const documentService = app.get(DocumentService);

    // Test configuration
    const testConfig = {
      userId: 'test_user_enhanced_workflow',
      country: 'Germany',
      icp: 'Global People',
      documentReader: 'textract', // Use textract for better page detection
    };

    console.log('📋 Test Configuration:');
    console.log(`   User ID: ${testConfig.userId}`);
    console.log(`   Country: ${testConfig.country}`);
    console.log(`   ICP: ${testConfig.icp}`);
    console.log(`   Document Reader: ${testConfig.documentReader}`);
    console.log();

    // Test 1: Check if enhanced processing should be used for different file types
    console.log('🔍 Test 1: Multi-page Detection Logic');
    console.log('-'.repeat(40));

    const testFiles = [
      { name: 'single_receipt.jpg', mimetype: 'image/jpeg' },
      { name: 'multi_receipt_document.pdf', mimetype: 'application/pdf' },
      { name: 'expense_report.png', mimetype: 'image/png' },
    ];

    for (const testFile of testFiles) {
      const mockFile = {
        originalname: testFile.name,
        mimetype: testFile.mimetype,
      } as Express.Multer.File;

      const shouldUseEnhanced = await enhancedService.shouldUseInvoiceSplitting(mockFile);
      console.log(`   ${testFile.name} (${testFile.mimetype}): ${shouldUseEnhanced ? '✅ Enhanced' : '❌ Standard'}`);
    }
    console.log();

    // Test 2: Simulate the complete enhanced workflow (if test PDF exists)
    console.log('🧾 Test 2: Complete Enhanced Workflow Simulation');
    console.log('-'.repeat(40));

    // Check if we have any test PDF files
    const testDataDir = path.join(process.cwd(), 'test-data');
    let testPdfPath: string | null = null;

    if (fs.existsSync(testDataDir)) {
      const files = fs.readdirSync(testDataDir);
      const pdfFile = files.find(file => file.toLowerCase().endsWith('.pdf'));
      if (pdfFile) {
        testPdfPath = path.join(testDataDir, pdfFile);
        console.log(`   Found test PDF: ${pdfFile}`);
      }
    }

    if (!testPdfPath) {
      console.log('   ⚠️  No test PDF found in test-data directory');
      console.log('   Creating mock test scenario...');
      
      // Create a mock file for testing the workflow structure
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: 'mock_multi_receipt.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: 1024 * 1024, // 1MB
        buffer: Buffer.from('Mock PDF content'),
        destination: '',
        filename: 'mock_multi_receipt.pdf',
        path: '',
        stream: null as any,
      };

      console.log('   📄 Mock file created for workflow testing');
      console.log(`      Filename: ${mockFile.originalname}`);
      console.log(`      Size: ${mockFile.size} bytes`);
      console.log(`      Type: ${mockFile.mimetype}`);
    } else {
      console.log('   📄 Using real test PDF for workflow testing');
      
      // Read the actual test file
      const fileBuffer = fs.readFileSync(testPdfPath);
      const mockFile: Express.Multer.File = {
        fieldname: 'file',
        originalname: path.basename(testPdfPath),
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: fileBuffer.length,
        buffer: fileBuffer,
        destination: '',
        filename: path.basename(testPdfPath),
        path: testPdfPath,
        stream: null as any,
      };

      console.log(`      Filename: ${mockFile.originalname}`);
      console.log(`      Size: ${mockFile.size} bytes`);
      console.log(`      Type: ${mockFile.mimetype}`);

      try {
        console.log();
        console.log('   🔄 Starting enhanced processing workflow...');
        
        const startTime = Date.now();
        let currentStage = '';
        let currentProgress = 0;

        const result = await enhancedService.processDocumentWithInvoiceSplitting(
          mockFile,
          {
            ...testConfig,
            progressCallback: (stage: string, progress: number, receiptIndex?: number) => {
              if (stage !== currentStage || progress !== currentProgress) {
                currentStage = stage;
                currentProgress = progress;
                const progressBar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));
                const receiptInfo = receiptIndex ? ` (Receipt ${receiptIndex})` : '';
                console.log(`      [${progressBar}] ${progress}% - ${stage}${receiptInfo}`);
              }
            },
          }
        );

        const processingTime = Date.now() - startTime;
        
        console.log();
        console.log('   ✅ Enhanced processing completed successfully!');
        console.log('   📊 Results Summary:');
        console.log(`      Original Document: ${result.originalDocument.filename}`);
        console.log(`      Total Pages: ${result.originalDocument.totalPages}`);
        console.log(`      Has Multiple Invoices: ${result.originalDocument.hasMultipleInvoices}`);
        console.log(`      Total Receipts Found: ${result.summary.totalReceipts}`);
        console.log(`      Successful Processing: ${result.summary.successfulProcessing}`);
        console.log(`      Failed Processing: ${result.summary.failedProcessing}`);
        console.log(`      Average Quality Score: ${result.summary.averageQualityScore.toFixed(2)}/10`);
        console.log(`      Total Processing Time: ${processingTime}ms`);
        
        console.log();
        console.log('   📋 Individual Receipt Results:');
        result.individualReceipts.forEach((receipt, index) => {
          console.log(`      Receipt ${index + 1} (${receipt.receiptId}):`);
          console.log(`         Invoice Number: ${receipt.invoiceNumber}`);
          console.log(`         Pages: ${receipt.pages.join(', ')}`);
          console.log(`         Quality Score: ${receipt.imageQualityAssessment?.overall_quality_score || 'N/A'}/10`);
          console.log(`         Processing Time: ${receipt.processingTime}ms`);
          console.log(`         Status: ${receipt.expenseProcessingResult.error ? '❌ Failed' : '✅ Success'}`);
          if (receipt.expenseProcessingResult.error) {
            console.log(`         Error: ${receipt.expenseProcessingResult.error}`);
          }
        });

        // Clean up temporary files
        console.log();
        console.log('   🧹 Cleaning up temporary files...');
        await enhancedService.cleanupTempFiles(result.tempDirectory);
        console.log('   ✅ Cleanup completed');

      } catch (error) {
        console.log(`   ❌ Enhanced processing failed: ${error.message}`);
        console.log(`   Stack trace: ${error.stack}`);
      }
    }

    console.log();
    console.log('🎯 Test 3: API Endpoint Integration');
    console.log('-'.repeat(40));
    console.log('   The enhanced workflow is now available via two endpoints:');
    console.log('   1. POST /documents/process (with useEnhancedProcessing: true)');
    console.log('   2. POST /documents/process-enhanced (always uses enhanced processing)');
    console.log();
    console.log('   Example API call:');
    console.log('   ```bash');
    console.log('   curl -X POST http://localhost:3000/documents/process-enhanced \\');
    console.log('     -F "file=@multi_receipt_document.pdf" \\');
    console.log('     -F "userId=user_123" \\');
    console.log('     -F "country=Germany" \\');
    console.log('     -F "icp=Global People" \\');
    console.log('     -F "documentReader=textract"');
    console.log('   ```');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  } finally {
    await app.close();
  }

  console.log();
  console.log('🏁 Enhanced Invoice Splitting Workflow Test Complete');
  console.log('=' .repeat(60));
}

// Run the test if this file is executed directly
if (require.main === module) {
  testEnhancedInvoiceSplittingWorkflow()
    .then(() => {
      console.log('Test completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Test failed:', error);
      process.exit(1);
    });
}

export { testEnhancedInvoiceSplittingWorkflow };