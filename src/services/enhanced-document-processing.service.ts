import { Injectable, Logger } from '@nestjs/common';
import { InvoiceSplitterService } from '../modules/invoice-splitter/invoice-splitter.service';
import { ExpenseProcessingService } from './expense-processing.service';
import { ImageQualityAssessmentAgent } from '../agents/image-quality-assessment.agent';
import { LangfuseService } from './langfuse.service';
import { UserSessionService } from './user-session.service';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface EnhancedProcessingResult {
  originalDocument: {
    filename: string;
    totalPages: number;
    hasMultipleInvoices: boolean;
  };
  individualReceipts: {
    receiptId: string;
    invoiceNumber: number;
    pages: number[];
    markdown: string;
    pdfPath: string | null;
    imageQualityAssessment: any;
    expenseProcessingResult: any;
    processingTime: number;
  }[];
  summary: {
    totalReceipts: number;
    successfulProcessing: number;
    failedProcessing: number;
    totalProcessingTime: number;
    averageQualityScore: number;
  };
  tempDirectory: string;
}

@Injectable()
export class EnhancedDocumentProcessingService {
  private readonly logger = new Logger(EnhancedDocumentProcessingService.name);

  constructor(
    private readonly invoiceSplitterService: InvoiceSplitterService,
    private readonly expenseProcessingService: ExpenseProcessingService,
    private readonly langfuseService: LangfuseService,
    private readonly userSessionService: UserSessionService,
  ) {}

  async processDocumentWithInvoiceSplitting(
    file: Express.Multer.File,
    options: {
      userId: string;
      country: string;
      icp: string;
      documentReader?: string;
      complianceData?: any;
      expenseSchema?: any;
      progressCallback?: (stage: string, progress: number, receiptIndex?: number) => void;
    }
  ): Promise<EnhancedProcessingResult> {
    const startTime = Date.now();
    let mainTrace;

    try {
      this.logger.log(`🚀 Starting enhanced document processing with invoice splitting for: ${file.originalname}`);

      // Create main trace for the entire workflow
      if (this.userSessionService && options.userId) {
        const jobInfo = await this.userSessionService.createJobForUser(
          options.userId,
          file.originalname,
          options.country,
          options.icp
        );

        mainTrace = this.langfuseService?.createTraceWithUserSession(
          {
            name: `enhanced-document-processing-${file.originalname}`,
            input: {
              filename: file.originalname,
              userId: options.userId,
              country: options.country,
              icp: options.icp,
              fileSize: file.size,
              processingMode: 'enhanced-with-splitting',
            },
            metadata: {
              service: 'EnhancedDocumentProcessingService',
              filename: file.originalname,
              userId: options.userId,
              country: options.country,
              icp: options.icp,
              processingMode: 'enhanced-with-splitting',
            },
            tags: ['enhanced-processing', 'invoice-splitting', options.country, options.icp],
          },
          jobInfo.jobId,
          this.userSessionService
        );
      }

      options.progressCallback?.('invoiceSplitting', 10);

      // Step 1: Analyze and split document using invoice splitter
      this.logger.log('📄 Step 1: Analyzing document for invoice splitting');
      this.logger.log(`🔍 DEBUG: Starting LLM-based analysis of document: ${file.originalname}`);
      
      const splitResult = await this.invoiceSplitterService.analyzeAndSplitDocument(
        file,
        { documentReader: options.documentReader || 'textract' }
      );

      if (!splitResult.success) {
        throw new Error('Invoice splitting failed');
      }

      const { data: splitData } = splitResult;
      
      // DEBUG: Show detailed analysis results
      this.logger.log(`📊 Document analysis complete: ${splitData.totalInvoices} invoices found in ${splitData.totalPages} pages`);
      this.logger.log(`🔍 DEBUG: Invoice splitter intelligence results:`);
      this.logger.log(`   - Total pages in document: ${splitData.totalPages}`);
      this.logger.log(`   - Total receipts identified by LLM: ${splitData.totalInvoices}`);
      this.logger.log(`   - Has multiple invoices: ${splitData.hasMultipleInvoices}`);
      
      // DEBUG: Show each identified receipt group
      splitData.invoices.forEach((invoice, index) => {
        this.logger.log(`   📋 Receipt ${index + 1}:`);
        this.logger.log(`      - Invoice Number: ${invoice.invoiceNumber}`);
        this.logger.log(`      - Pages: [${invoice.pages.join(', ')}] (${invoice.pages.length} page${invoice.pages.length > 1 ? 's' : ''})`);
        this.logger.log(`      - Confidence: ${invoice.confidence}`);
        this.logger.log(`      - LLM Reasoning: "${invoice.reasoning}"`);
        this.logger.log(`      - Content Length: ${invoice.content?.length || 0} characters`);
        this.logger.log(`      - PDF Path: ${invoice.pdfPath ? 'Available' : 'Not available'}`);
      });
      
      // DEBUG: Show which pages are NOT being processed (if any)
      const allPages = Array.from({ length: splitData.totalPages }, (_, i) => i + 1);
      const processedPages = splitData.invoices.flatMap(invoice => invoice.pages);
      const unprocessedPages = allPages.filter(page => !processedPages.includes(page));
      
      if (unprocessedPages.length > 0) {
        this.logger.log(`⚠️  DEBUG: Pages NOT identified as receipts by LLM: [${unprocessedPages.join(', ')}]`);
        this.logger.log(`   These pages likely contain: cover pages, summaries, or non-receipt content`);
      } else {
        this.logger.log(`✅ DEBUG: All ${splitData.totalPages} pages identified as containing receipt content`);
      }

      options.progressCallback?.('invoiceSplitting', 20);

      // Step 2: Process each individual receipt IN PARALLEL
      const totalReceipts = splitData.invoices.length;
      this.logger.log(`🚀 Starting parallel processing of ${totalReceipts} individual receipts`);

      // Create processing promises for all receipts
      const receiptProcessingPromises = splitData.invoices.map(async (invoice, i) => {
        const receiptId = `receipt_${invoice.invoiceNumber}_${randomUUID().substring(0, 8)}`;
        const receiptStartTime = Date.now();
        
        try {
          this.logger.log(`🧾 Processing receipt ${i + 1}/${totalReceipts}: Invoice ${invoice.invoiceNumber} (${receiptId})`);
          this.logger.log(`🔍 DEBUG: Receipt details:`);
          this.logger.log(`   - Receipt ID: ${receiptId}`);
          this.logger.log(`   - Invoice Number: ${invoice.invoiceNumber}`);
          this.logger.log(`   - Pages: [${invoice.pages.join(', ')}]`);
          this.logger.log(`   - Confidence: ${invoice.confidence}`);
          this.logger.log(`   - Total Pages: ${invoice.totalPages || invoice.pages.length}`);
          this.logger.log(`   - Content Preview: "${invoice.content?.substring(0, 100) || 'No content'}..."`);
          
          // Progress callback for individual receipt
          const baseProgress = 20 + (i / totalReceipts) * 70;
          options.progressCallback?.('processingReceipt', Math.round(baseProgress), i + 1);

          // Step 2: Process through expense processing pipeline (includes image quality assessment)
          this.logger.log(`⚙️ Processing receipt ${receiptId} through expense pipeline`);
          
          // Create a temporary image path for processing if we have a PDF
          let imagePath = invoice.pdfPath || '';
          
          // Create unique filename for this receipt to avoid overriding
          const baseFilename = path.parse(file.originalname).name;
          const uniqueReceiptFilename = `${baseFilename}_receipt_${invoice.invoiceNumber}.pdf`;
          
          const expenseResult = await this.expenseProcessingService.processExpenseDocument(
            invoice.content, // markdown content
            uniqueReceiptFilename, // Use unique filename to prevent overriding
            imagePath,
            options.country,
            options.icp,
            options.complianceData || {},
            options.expenseSchema || {},
            (stage, progress) => {
              // Nested progress callback for expense processing
              const receiptProgress = baseProgress + (progress / 100) * (70 / totalReceipts);
              options.progressCallback?.(stage, Math.round(receiptProgress), i + 1);
            },
            undefined, // markdownExtractionInfo
            true, // useParallelProcessing - IMPORTANT: This enables parallel processing within each receipt
            options.userId
          );

          const receiptProcessingTime = Date.now() - receiptStartTime;

          this.logger.log(`✅ Receipt ${receiptId} processed successfully in ${receiptProcessingTime}ms`);

          const receiptResult = {
            receiptId,
            invoiceNumber: invoice.invoiceNumber,
            pages: invoice.pages,
            markdown: invoice.content,
            pdfPath: invoice.pdfPath,
            imageQualityAssessment: expenseResult.image_quality_assessment || null,
            expenseProcessingResult: expenseResult,
            processingTime: receiptProcessingTime,
            success: true,
          };

          // Store result immediately when receipt completes
          await this.saveIndividualReceiptResult(file.originalname, receiptResult);
          this.logger.log(`💾 Receipt ${receiptId} result saved immediately`);

          return receiptResult;

        } catch (error) {
          const receiptProcessingTime = Date.now() - receiptStartTime;
          this.logger.error(`❌ Failed to process receipt ${receiptId}:`, error);
          
          const receiptResult = {
            receiptId,
            invoiceNumber: invoice.invoiceNumber,
            pages: invoice.pages,
            markdown: invoice.content,
            pdfPath: invoice.pdfPath,
            imageQualityAssessment: null,
            expenseProcessingResult: {
              error: error.message,
              processed: false,
            },
            processingTime: receiptProcessingTime,
            success: false,
          };

          // Store failed result immediately
          await this.saveIndividualReceiptResult(file.originalname, receiptResult);
          this.logger.log(`💾 Failed receipt ${receiptId} result saved immediately`);

          return receiptResult;
        }
      });

      // Wait for all receipts to be processed in parallel
      this.logger.log(`⏳ Waiting for ${totalReceipts} receipts to complete parallel processing...`);
      const receiptResults = await Promise.all(receiptProcessingPromises);

      // Process results and calculate statistics
      const individualReceipts = receiptResults;
      const successfulProcessing = receiptResults.filter(r => r.success).length;
      const failedProcessing = receiptResults.filter(r => !r.success).length;
      const totalQualityScore = receiptResults
        .filter(r => r.imageQualityAssessment?.overall_quality_score)
        .reduce((sum, r) => sum + r.imageQualityAssessment.overall_quality_score, 0);

      this.logger.log(`📊 Parallel processing complete: ${successfulProcessing}/${totalReceipts} successful, ${failedProcessing} failed`);
      
      // DEBUG: Final processing summary
      this.logger.log(`🔍 DEBUG: Final processing summary:`);
      this.logger.log(`   - Original document: ${file.originalname}`);
      this.logger.log(`   - Total pages in document: ${splitData.totalPages}`);
      this.logger.log(`   - Receipts identified by LLM: ${totalReceipts}`);
      this.logger.log(`   - Successfully processed receipts: ${successfulProcessing}`);
      this.logger.log(`   - Failed processing: ${failedProcessing}`);
      this.logger.log(`   - Average quality score: ${(totalQualityScore / Math.max(successfulProcessing, 1)).toFixed(2)}`);
      
      // DEBUG: Show processing results for each receipt
      receiptResults.forEach((receipt, index) => {
        this.logger.log(`   📋 Receipt ${index + 1} (${receipt.receiptId}):`);
        this.logger.log(`      - Pages: [${receipt.pages.join(', ')}]`);
        this.logger.log(`      - Processing: ${receipt.success ? '✅ Success' : '❌ Failed'}`);
        this.logger.log(`      - Processing Time: ${receipt.processingTime}ms`);
        this.logger.log(`      - Quality Score: ${receipt.imageQualityAssessment?.overall_quality_score || 'N/A'}/10`);
        if (!receipt.success && (receipt.expenseProcessingResult as any)?.error) {
          this.logger.log(`      - Error: ${(receipt.expenseProcessingResult as any).error}`);
        }
      });

      const totalProcessingTime = Date.now() - startTime;
      const averageQualityScore = totalQualityScore > 0 ? totalQualityScore / Math.max(successfulProcessing, 1) : 0;

      options.progressCallback?.('complete', 100);

      const result: EnhancedProcessingResult = {
        originalDocument: {
          filename: splitData.originalFileName,
          totalPages: splitData.totalPages,
          hasMultipleInvoices: splitData.hasMultipleInvoices,
        },
        individualReceipts,
        summary: {
          totalReceipts,
          successfulProcessing,
          failedProcessing,
          totalProcessingTime,
          averageQualityScore,
        },
        tempDirectory: splitData.tempDirectory,
      };

      // Update main trace with final results
      if (mainTrace) {
        mainTrace.update({
          output: {
            success: true,
            totalReceipts,
            successfulProcessing,
            failedProcessing,
            averageQualityScore,
            totalProcessingTime,
          },
          metadata: {
            final_processing_time_ms: totalProcessingTime,
            success: true,
            total_receipts: totalReceipts,
            successful_processing: successfulProcessing,
            failed_processing: failedProcessing,
            average_quality_score: averageQualityScore,
          },
        });

        await this.langfuseService.flush();
      }

      this.logger.log(`🎯 Enhanced document processing complete: ${successfulProcessing}/${totalReceipts} receipts processed successfully in ${totalProcessingTime}ms`);
      
      // Individual receipt results are already saved immediately as they complete
      // Now save consolidated summary and markdown files
      await this.saveConsolidatedSummary(file.originalname, individualReceipts);
      await this.saveIndividualReceiptMarkdown(file.originalname, individualReceipts);
      
      return result;

    } catch (error) {
      const totalProcessingTime = Date.now() - startTime;
      this.logger.error(`❌ Enhanced document processing failed for ${file.originalname}:`, error);

      // Update main trace with error
      if (mainTrace) {
        mainTrace.update({
          output: {
            success: false,
            error: error.message,
            processing_time_ms: totalProcessingTime,
          },
          metadata: {
            final_processing_time_ms: totalProcessingTime,
            success: false,
            error: error.message,
          },
        });

        await this.langfuseService.flush();
      }

      throw new Error(`Enhanced document processing failed: ${error.message}`);
    }
  }

  /**
   * Determine if a document should use invoice splitting based on file characteristics
   */
  async shouldUseInvoiceSplitting(file: Express.Multer.File): Promise<boolean> {
    // For now, we'll use invoice splitting for all PDF files
    // This could be enhanced with more sophisticated detection logic
    return file.mimetype === 'application/pdf';
  }

  /**
   * Clean up temporary files created during processing
   */
  async cleanupTempFiles(tempDirectory: string): Promise<void> {
    try {
      await this.invoiceSplitterService.cleanupTempFiles(tempDirectory);
      this.logger.log(`🧹 Cleaned up temporary files in: ${tempDirectory}`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to cleanup temp files in ${tempDirectory}:`, error);
    }
  }

  /**
   * Get processing results for a specific receipt
   */
  getReceiptResult(results: EnhancedProcessingResult, receiptId: string) {
    return results.individualReceipts.find(receipt => receipt.receiptId === receiptId);
  }

  /**
   * Get summary statistics from processing results
   */
  getProcessingSummary(results: EnhancedProcessingResult) {
    return {
      ...results.summary,
      originalDocument: results.originalDocument,
      receipts: results.individualReceipts.map(receipt => ({
        receiptId: receipt.receiptId,
        invoiceNumber: receipt.invoiceNumber,
        pages: receipt.pages,
        qualityScore: receipt.imageQualityAssessment?.overall_quality_score || 0,
        processed: !receipt.expenseProcessingResult.error,
        processingTime: receipt.processingTime,
      })),
    };
  }

  /**
   * Save individual receipt result immediately when it completes
   */
  private async saveIndividualReceiptResult(
    originalFilename: string,
    receipt: any
  ): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');

      // Create results directory if it doesn't exist
      const resultsDir = path.join(process.cwd(), 'results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      // Get base filename without extension
      const baseFilename = path.parse(originalFilename).name;

      // Create filename: originalname_receipt_X_result.json
      const receiptFilename = `${baseFilename}_receipt_${receipt.invoiceNumber}_result.json`;
      const receiptFilePath = path.join(resultsDir, receiptFilename);

      // Create individual receipt result object
      const receiptResult = {
        originalDocument: {
          filename: originalFilename,
          receiptId: receipt.receiptId,
          invoiceNumber: receipt.invoiceNumber,
          pages: receipt.pages,
          processingTime: receipt.processingTime,
          processedAt: new Date().toISOString(),
        },
        imageQualityAssessment: receipt.imageQualityAssessment,
        expenseProcessingResult: receipt.expenseProcessingResult,
        metadata: {
          receiptId: receipt.receiptId,
          invoiceNumber: receipt.invoiceNumber,
          pages: receipt.pages,
          pdfPath: receipt.pdfPath,
          markdownLength: receipt.markdown?.length || 0,
          processingTime: receipt.processingTime,
          success: receipt.success !== false,
          processedAt: new Date().toISOString(),
          originalFilename: originalFilename,
          storedImmediately: true, // Flag to indicate immediate storage
        }
      };

      // Save the individual receipt result immediately
      fs.writeFileSync(receiptFilePath, JSON.stringify(receiptResult, null, 2), 'utf8');
      
      this.logger.log(`   ✅ Immediately saved receipt ${receipt.invoiceNumber} result: ${receiptFilePath}`);

    } catch (error) {
      this.logger.error(`   ❌ Failed to immediately save receipt ${receipt.invoiceNumber} result:`, error);
    }
  }

  /**
   * Save consolidated summary after all receipts complete
   */
  private async saveConsolidatedSummary(
    originalFilename: string,
    receipts: any[]
  ): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');

      // Create results directory if it doesn't exist
      const resultsDir = path.join(process.cwd(), 'results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      // Get base filename without extension
      const baseFilename = path.parse(originalFilename).name;

      this.logger.log(`📋 Saving consolidated summary for ${receipts.length} receipts from ${originalFilename}`);

      // Save consolidated summary file (individual receipts already saved immediately)
      const summaryFilename = `${baseFilename}_enhanced_summary.json`;
      const summaryFilePath = path.join(resultsDir, summaryFilename);

      const summaryResult = {
        originalDocument: {
          filename: originalFilename,
          totalReceipts: receipts.length,
          processedAt: new Date().toISOString(),
        },
        summary: {
          totalReceipts: receipts.length,
          successfulProcessing: receipts.filter(r => r.success !== false).length,
          failedProcessing: receipts.filter(r => r.success === false).length,
          averageQualityScore: this.calculateAverageQualityScore(receipts),
          totalProcessingTime: receipts.reduce((sum, r) => sum + (r.processingTime || 0), 0),
        },
        individualReceipts: receipts.map(receipt => ({
          receiptId: receipt.receiptId,
          invoiceNumber: receipt.invoiceNumber,
          pages: receipt.pages,
          qualityScore: receipt.imageQualityAssessment?.overall_quality_score || 0,
          processingTime: receipt.processingTime,
          success: receipt.success !== false,
          resultFile: `${baseFilename}_receipt_${receipt.invoiceNumber}_result.json`,
        })),
        metadata: {
          processingMode: 'enhanced-with-splitting',
          processedAt: new Date().toISOString(),
          originalFilename: originalFilename,
        }
      };

      fs.writeFileSync(summaryFilePath, JSON.stringify(summaryResult, null, 2), 'utf8');
      this.logger.log(`   📋 Saved enhanced processing summary: ${summaryFilePath}`);

    } catch (error) {
      this.logger.error(`Failed to save individual receipt results for ${originalFilename}:`, error);
      // Don't throw error - saving is optional, don't fail the main process
    }
  }

  /**
   * Calculate average quality score from receipts
   */
  private calculateAverageQualityScore(receipts: any[]): number {
    const receiptsWithQuality = receipts.filter(r =>
      r.imageQualityAssessment?.overall_quality_score !== undefined
    );
    
    if (receiptsWithQuality.length === 0) return 0;
    
    const totalScore = receiptsWithQuality.reduce((sum, r) =>
      sum + r.imageQualityAssessment.overall_quality_score, 0
    );
    
    return parseFloat((totalScore / receiptsWithQuality.length).toFixed(2));
  }

  /**
   * Save individual receipt markdown content to separate files in the markdown_extractions folder
   */
  private async saveIndividualReceiptMarkdown(
    originalFilename: string,
    receipts: any[]
  ): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');

      // Create markdown_extractions directory if it doesn't exist
      const markdownDir = path.join(process.cwd(), 'markdown_extractions');
      if (!fs.existsSync(markdownDir)) {
        fs.mkdirSync(markdownDir, { recursive: true });
      }

      // Get base filename without extension
      const baseFilename = path.parse(originalFilename).name;

      this.logger.log(`📝 Saving ${receipts.length} individual receipt markdown files for ${originalFilename}`);

      // Save each receipt markdown separately
      for (const receipt of receipts) {
        try {
          // Create filename: originalname_receipt_X_textract.md (following existing convention)
          const markdownFilename = `${baseFilename}_receipt_${receipt.invoiceNumber}_textract.md`;
          const markdownFilePath = path.join(markdownDir, markdownFilename);

          // Add metadata header to markdown content
          const timestamp = new Date().toISOString();
          const markdownWithMetadata = `---
# Markdown Extraction Results - Individual Receipt
- **Original File**: ${originalFilename}
- **Receipt ID**: ${receipt.receiptId}
- **Invoice Number**: ${receipt.invoiceNumber}
- **Pages**: ${receipt.pages.join(', ')}
- **Document Reader**: textract (via invoice splitting)
- **Extracted At**: ${timestamp}
- **Content Length**: ${receipt.markdown?.length || 0} characters
- **Processing Mode**: enhanced-with-splitting
---

${receipt.markdown || 'No markdown content available'}`;

          // Write markdown content to file
          fs.writeFileSync(markdownFilePath, markdownWithMetadata, 'utf8');
          
          this.logger.log(`   ✅ Saved receipt ${receipt.invoiceNumber} markdown: ${markdownFilePath}`);

        } catch (error) {
          this.logger.error(`   ❌ Failed to save receipt ${receipt.invoiceNumber} markdown:`, error);
        }
      }

      // Also save a consolidated markdown file with all receipts
      const consolidatedFilename = `${baseFilename}_enhanced_all_receipts_textract.md`;
      const consolidatedFilePath = path.join(markdownDir, consolidatedFilename);

      const consolidatedMarkdown = `---
# Enhanced Invoice Splitting - All Receipts
- **Original File**: ${originalFilename}
- **Total Receipts**: ${receipts.length}
- **Document Reader**: textract (via invoice splitting)
- **Extracted At**: ${new Date().toISOString()}
- **Processing Mode**: enhanced-with-splitting
---

${receipts.map((receipt, index) => `
# Receipt ${receipt.invoiceNumber} (Pages: ${receipt.pages.join(', ')})

**Receipt ID**: ${receipt.receiptId}
**Invoice Number**: ${receipt.invoiceNumber}
**Pages**: ${receipt.pages.join(', ')}
**Quality Score**: ${receipt.imageQualityAssessment?.overall_quality_score || 'N/A'}/10

## Content

${receipt.markdown || 'No markdown content available'}

${index < receipts.length - 1 ? '\n---\n' : ''}
`).join('')}`;

      fs.writeFileSync(consolidatedFilePath, consolidatedMarkdown, 'utf8');
      this.logger.log(`   📋 Saved consolidated markdown: ${consolidatedFilePath}`);

    } catch (error) {
      this.logger.error(`Failed to save individual receipt markdown for ${originalFilename}:`, error);
      // Don't throw error - saving is optional, don't fail the main process
    }
  }
}