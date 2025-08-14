import { Injectable, Logger } from '@nestjs/common';
import { FileClassificationAgent } from '../agents/file-classification.agent';
import { DataExtractionAgent } from '../agents/data-extraction.agent';
import { IssueDetectionAgent } from '../agents/issue-detection.agent';
import { CitationGeneratorAgent } from '../agents/citation-generator.agent';
import { ImageQualityAssessmentAgent } from '../agents/image-quality-assessment.agent';
import { ExpenseProcessingOptimizedService } from './expense-processing-optimized.service';
import { LangfuseService } from './langfuse.service';
import { ExpenseComplianceUQLMValidator } from '../utils/judge/validation/ExpenseComplianceUQLMValidator';
import { ParallelExpenseComplianceUQLMValidator } from '../utils/judge/validation/ParallelExpenseComplianceUQLMValidator';
import {
  type FileClassificationResult,
  type ExpenseData,
  type IssueDetectionResult,
  type CitationResult,
  type CompleteProcessingResult,
  type ProcessingTiming,
} from '../schemas/expense-schemas';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ExpenseProcessingService {
  private readonly logger = new Logger(ExpenseProcessingService.name);
  
  private fileClassificationAgent: FileClassificationAgent;
  private dataExtractionAgent: DataExtractionAgent;
  private issueDetectionAgent: IssueDetectionAgent;
  private citationGeneratorAgent: CitationGeneratorAgent;
  private imageQualityAssessmentAgent: ImageQualityAssessmentAgent;
  private optimizedService: ExpenseProcessingOptimizedService;
  private complianceValidator: ExpenseComplianceUQLMValidator | ParallelExpenseComplianceUQLMValidator;

  constructor(private langfuseService: LangfuseService) {
    // Use Bedrock as default provider with Anthropic fallback
    const provider: 'bedrock' | 'anthropic' = 'bedrock';

    this.logger.log(`Using provider: ${provider} (AWS Bedrock with Anthropic fallback)`);

    // Initialize agents WITH Langfuse tracing
    this.fileClassificationAgent = new FileClassificationAgent(provider, process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0', this.langfuseService);
    this.dataExtractionAgent = new DataExtractionAgent(provider, this.langfuseService);
    this.issueDetectionAgent = new IssueDetectionAgent(provider, this.langfuseService);
    this.citationGeneratorAgent = new CitationGeneratorAgent(provider, this.langfuseService);
    this.imageQualityAssessmentAgent = new ImageQualityAssessmentAgent(provider, this.langfuseService);

    // Initialize optimized service with Langfuse
    this.optimizedService = new ExpenseProcessingOptimizedService(this.langfuseService);

    // Initialize LLM-as-judge compliance validator with parallel processing support
    try {
      const useParallelValidation = process.env.PARALLEL_VALIDATION_ENABLED !== 'false';
      
      if (useParallelValidation) {
        this.logger.log('🚀 Initializing PARALLEL LLM-as-judge compliance validator...');
        this.complianceValidator = new ParallelExpenseComplianceUQLMValidator();
        this.logger.log('✅ PARALLEL LLM-as-judge compliance validator initialized successfully');
        this.logger.log(`📊 Parallel Configuration:`);
        this.logger.log(`   - Dimension Concurrency: ${process.env.VALIDATION_DIMENSION_CONCURRENCY || 6}`);
        this.logger.log(`   - Judge Concurrency: ${process.env.VALIDATION_JUDGE_CONCURRENCY || 3}`);
        this.logger.log(`   - Rate Limit: ${process.env.BEDROCK_RATE_LIMIT_PER_SECOND || 10} req/sec`);
      } else {
        this.logger.log('🔄 Initializing SEQUENTIAL LLM-as-judge compliance validator...');
        this.complianceValidator = new ExpenseComplianceUQLMValidator(this.logger);
        this.logger.log('✅ Sequential LLM-as-judge compliance validator initialized successfully');
      }
    } catch (error) {
      this.logger.error('❌ Failed to initialize LLM-as-judge compliance validator:', error);
      this.logger.error('Stack trace:', error.stack);
      this.complianceValidator = null;
    }
  }

  async processExpenseDocument(
    markdownContent: string,
    filename: string,
    imagePath: string,
    country: string,
    icp: string,
    complianceData: any,
    expenseSchema: any,
    progressCallback?: (stage: string, progress: number) => void,
    markdownExtractionInfo?: { markdownExtractionTime: number; documentReader: string },
    useParallelProcessing: boolean = true,
    userId?: string
  ): Promise<CompleteProcessingResult> {
    // Choose between parallel and sequential processing
    if (useParallelProcessing) {
      this.logger.log(`🚀 Using PARALLEL processing for ${filename}`);
      return this.optimizedService.processExpenseDocumentParallel(
        markdownContent,
        filename,
        imagePath,
        country,
        icp,
        complianceData,
        expenseSchema,
        {
          fileClassificationAgent: this.fileClassificationAgent,
          dataExtractionAgent: this.dataExtractionAgent,
          issueDetectionAgent: this.issueDetectionAgent,
          citationGeneratorAgent: this.citationGeneratorAgent,
          imageQualityAssessmentAgent: this.imageQualityAssessmentAgent,
        },
        this.complianceValidator,
        progressCallback,
        markdownExtractionInfo,
        userId
      );
    } else {
      this.logger.log(`⏳ Using SEQUENTIAL processing for ${filename}`);
      return this.processExpenseDocumentSequential(
        markdownContent,
        filename,
        imagePath,
        country,
        icp,
        complianceData,
        expenseSchema,
        progressCallback,
        markdownExtractionInfo,
        userId
      );
    }
  }

  private async processExpenseDocumentSequential(
    markdownContent: string,
    filename: string,
    imagePath: string,
    country: string,
    icp: string,
    complianceData: any,
    expenseSchema: any,
    progressCallback?: (stage: string, progress: number) => void,
    markdownExtractionInfo?: { markdownExtractionTime: number; documentReader: string },
    userId?: string
  ): Promise<CompleteProcessingResult> {
    // Calculate the true start time including markdown extraction
    const trueStartTime = markdownExtractionInfo
      ? Date.now() - markdownExtractionInfo.markdownExtractionTime
      : Date.now();

    // Generate session ID for this processing run
    const sessionId = this.generateSessionId(filename);
    const effectiveUserId = userId || this.generateDefaultUserId();

    this.logger.log(`👤 User: ${effectiveUserId}, Session: ${sessionId}`);

    // Create main processing trace with user and session
    const mainTrace = this.langfuseService?.createTrace({
      name: 'expense-processing-sequential',
      input: {
        filename,
        country,
        icp,
        imagePath: path.basename(imagePath),
        markdownContentLength: markdownContent.length,
        processingMode: 'sequential',
      },
      metadata: {
        service: 'ExpenseProcessingService',
        filename,
        country,
        icp,
        processingMode: 'sequential',
        markdownExtractionTime: markdownExtractionInfo?.markdownExtractionTime,
        documentReader: markdownExtractionInfo?.documentReader,
      },
      tags: ['expense-processing', 'sequential', country, icp],
      userId: effectiveUserId,
      sessionId: sessionId,
    });

    const currentTime = Date.now();
    const timing: any = {
      phase_timings: {},
      agent_performance: {},
    };

    // Add markdown extraction timing if provided
    if (markdownExtractionInfo) {
      timing.phase_timings.markdown_extraction_seconds = (markdownExtractionInfo.markdownExtractionTime / 1000).toFixed(1);
      timing.agent_performance.markdown_extraction = {
        start_time: new Date(trueStartTime).toISOString(),
        end_time: new Date(currentTime).toISOString(),
        duration_seconds: (markdownExtractionInfo.markdownExtractionTime / 1000).toFixed(1),
        document_reader_used: markdownExtractionInfo.documentReader,
      };
    }

    // Main trace already created above with user and session tracking

    try {
      this.logger.log(`Starting complete expense processing for ${filename}`);

      // Phase 0: Image Quality Assessment
      progressCallback?.('imageQualityAssessment', 5);
      this.logger.log('Phase 0: Image Quality Assessment');

      const qualityStart = Date.now();
      const qualityAssessment = await this.imageQualityAssessmentAgent.assessImageQuality(imagePath, mainTrace);
      const qualityEnd = Date.now();
      const formattedQualityAssessment = this.imageQualityAssessmentAgent.formatAssessmentForWorkflow(qualityAssessment, imagePath);

      timing.phase_timings.image_quality_assessment_seconds = ((qualityEnd - qualityStart) / 1000).toFixed(1);
      timing.agent_performance.image_quality_assessment = {
        start_time: new Date(qualityStart).toISOString(),
        end_time: new Date(qualityEnd).toISOString(),
        duration_seconds: ((qualityEnd - qualityStart) / 1000).toFixed(1),
        model_used: formattedQualityAssessment.model_used,
      };

      // Phase 1: File Classification
      progressCallback?.('fileClassification', 15);
      this.logger.log('Phase 1: File Classification');

      const classificationStart = Date.now();
      const classification = await this.fileClassificationAgent.classifyFile(
        markdownContent,
        country,
        expenseSchema,
        mainTrace
      );
      const classificationEnd = Date.now();

      timing.phase_timings.file_classification_seconds = ((classificationEnd - classificationStart) / 1000).toFixed(1);
      timing.agent_performance.file_classification = {
        start_time: new Date(classificationStart).toISOString(),
        end_time: new Date(classificationEnd).toISOString(),
        duration_seconds: ((classificationEnd - classificationStart) / 1000).toFixed(1),
        model_used: this.fileClassificationAgent.getActualModelUsed(),
      };

      progressCallback?.('fileClassification', 25);
      
      // Phase 2: Data Extraction (parallel with classification results)
      progressCallback?.('dataExtraction', 30);
      this.logger.log('Phase 2: Data Extraction');

      const extractionStart = Date.now();
      const extraction = await this.dataExtractionAgent.extractData(
        markdownContent,
        complianceData,
        mainTrace
      );
      const extractionEnd = Date.now();

      timing.phase_timings.data_extraction_seconds = ((extractionEnd - extractionStart) / 1000).toFixed(1);
      timing.agent_performance.data_extraction = {
        start_time: new Date(extractionStart).toISOString(),
        end_time: new Date(extractionEnd).toISOString(),
        duration_seconds: ((extractionEnd - extractionStart) / 1000).toFixed(1),
        model_used: this.dataExtractionAgent.getActualModelUsed(),
      };

      progressCallback?.('dataExtraction', 50);
      
      // Phase 3: Issue Detection
      progressCallback?.('issueDetection', 55);
      this.logger.log('Phase 3: Issue Detection');

      const issueDetectionStart = Date.now();
      const compliance = await this.issueDetectionAgent.analyzeCompliance(
        country,
        classification.expense_type || 'All',
        icp,
        complianceData,
        extraction,
        mainTrace
      );
      const issueDetectionEnd = Date.now();

      timing.phase_timings.issue_detection_seconds = ((issueDetectionEnd - issueDetectionStart) / 1000).toFixed(1);
      timing.agent_performance.issue_detection = {
        start_time: new Date(issueDetectionStart).toISOString(),
        end_time: new Date(issueDetectionEnd).toISOString(),
        duration_seconds: ((issueDetectionEnd - issueDetectionStart) / 1000).toFixed(1),
        model_used: this.issueDetectionAgent.getActualModelUsed(),
      };

      progressCallback?.('issueDetection', 75);

      // Phase 4: Citation Generation
      progressCallback?.('citationGeneration', 80);
      this.logger.log('Phase 4: Citation Generation');

      const citationStart = Date.now();
      const citations = await this.citationGeneratorAgent.generateCitations(
        extraction,
        markdownContent,
        filename,
        mainTrace
      );
      const citationEnd = Date.now();

      timing.phase_timings.citation_generation_seconds = ((citationEnd - citationStart) / 1000).toFixed(1);
      timing.agent_performance.citation_generation = {
        start_time: new Date(citationStart).toISOString(),
        end_time: new Date(citationEnd).toISOString(),
        duration_seconds: ((citationEnd - citationStart) / 1000).toFixed(1),
        model_used: this.citationGeneratorAgent.getActualModelUsed(),
      };

      progressCallback?.('citationGeneration', 95);

      // Phase 5: LLM-as-Judge Validation with Debug Logging
      progressCallback?.('llmValidation', 96);
      
      let llmValidationTime = 0;
      let executionMode = 'sequential';
      let parallelMetrics = {};
      
      if (this.complianceValidator) {
        try {
          const validationStart = Date.now();
          
          // Determine if we're using parallel validation
          const isParallelValidator = this.complianceValidator instanceof ParallelExpenseComplianceUQLMValidator;
          const parallelEnabled = process.env.PARALLEL_VALIDATION_ENABLED !== 'false';
          
          this.logger.log(`🔍 Phase 5: LLM-as-Judge Validation (Sequential Processing)`);
          this.logger.log(`📊 Validator Type: ${isParallelValidator ? 'ParallelExpenseComplianceUQLMValidator' : 'ExpenseComplianceUQLMValidator'}`);
          this.logger.log(`⚡ Parallel Processing: ${parallelEnabled ? 'ENABLED' : 'DISABLED'}`);
          
          if (isParallelValidator && parallelEnabled) {
            this.logger.log(`🚀 STARTING PARALLEL LLM VALIDATION (in sequential pipeline)`);
            this.logger.log(`📈 Configuration:`);
            this.logger.log(`   - Dimension Concurrency: ${process.env.VALIDATION_DIMENSION_CONCURRENCY || 6}`);
            this.logger.log(`   - Judge Concurrency: ${process.env.VALIDATION_JUDGE_CONCURRENCY || 3}`);
            this.logger.log(`   - Rate Limit: ${process.env.BEDROCK_RATE_LIMIT_PER_SECOND || 10} req/sec`);
            executionMode = 'parallel';
          } else {
            this.logger.log(`🔄 Using sequential validation`);
            executionMode = 'sequential';
          }
          
          // Create Langfuse span for LLM validation
          const validationSpan = mainTrace?.span({
            name: 'llm-validation',
            input: {
              country,
              receiptType: classification.expense_type || 'unknown',
              icp,
              complianceDataSize: JSON.stringify(complianceData).length,
              extractedDataSize: JSON.stringify(extraction).length,
              executionMode,
              parallelEnabled: isParallelValidator && parallelEnabled
            },
            metadata: {
              phase: 'llm_validation',
              validation_dimensions: 6,
              execution_mode: executionMode,
              validator_type: isParallelValidator ? 'parallel' : 'sequential'
            }
          });

          this.logger.log(`⏱️ Starting validation execution...`);
          const validationResult = await this.complianceValidator.validateComplianceResponse(
            JSON.stringify(compliance),
            country,
            classification.expense_type || 'unknown',
            icp,
            complianceData,
            extraction
          );
          const validationEnd = Date.now();
          llmValidationTime = validationEnd - validationStart;

          // Extract parallel metrics if available
          const parallelResult = validationResult as any;
          if (parallelResult.performance_metrics) {
            parallelMetrics = parallelResult.performance_metrics;
            executionMode = parallelResult.performance_metrics.execution_mode || executionMode;
            
            this.logger.log(`📊 Validation completed in ${(llmValidationTime / 1000).toFixed(2)}s (${executionMode} mode)`);
            
            if (parallelResult.performance_metrics.speedup_factor) {
              this.logger.log(`⚡ Speedup: ${parallelResult.performance_metrics.speedup_factor}x faster`);
            }
          }

          timing.phase_timings.llm_validation_seconds = (llmValidationTime / 1000).toFixed(1);
          timing.agent_performance.llm_validation = {
            start_time: new Date(validationStart).toISOString(),
            end_time: new Date(validationEnd).toISOString(),
            duration_seconds: (llmValidationTime / 1000).toFixed(1),
            judge_models_used: validationResult.metadata?.judge_models || [],
            execution_mode: executionMode,
            parallel_metrics: parallelMetrics,
            validator_type: isParallelValidator ? 'parallel' : 'sequential',
            parallel_enabled: isParallelValidator && parallelEnabled
          };

          // Update validation span with complete validation result
          if (validationSpan) {
            validationSpan.update({
              output: validationResult,
              metadata: {
                validation_completed: true,
                judge_models_used: validationResult.metadata?.judge_models || [],
                judge_panel_size: validationResult.metadata?.judge_models?.length || 0,
                processing_time_ms: llmValidationTime,
                execution_mode: executionMode,
                parallel_metrics: parallelMetrics
              }
            });
            validationSpan.end();
          }

          // Save validation results to separate file
          await this.saveLLMValidationResults(filename, validationResult);

          this.logger.log(`✅ LLM-as-judge validation completed in ${(llmValidationTime / 1000).toFixed(2)}s (${executionMode} mode)`);
          
        } catch (error) {
          this.logger.error(`❌ LLM-as-judge validation failed: ${error.message}`);
          this.logger.error(`Stack trace:`, error.stack);
          timing.phase_timings.llm_validation_seconds = '0.0';
          timing.agent_performance.llm_validation = {
            start_time: new Date().toISOString(),
            end_time: new Date().toISOString(),
            duration_seconds: '0.0',
            error: error.message,
            execution_mode: 'error',
            validator_type: this.complianceValidator instanceof ParallelExpenseComplianceUQLMValidator ? 'parallel' : 'sequential'
          };
        }
      } else {
        this.logger.warn('⚠️ LLM-as-judge validation skipped (validator not available)');
        timing.phase_timings.llm_validation_seconds = '0.0';
      }

      progressCallback?.('llmValidation', 98);
      
      // Compile final result
      const processingTime = Date.now() - trueStartTime;
      timing.total_processing_time_seconds = (processingTime / 1000).toFixed(1);

      // Add timing validation
      this.validateTimingConsistency(timing);

      const result: CompleteProcessingResult = {
        image_quality_assessment: formattedQualityAssessment,
        classification,
        extraction,
        compliance,
        citations,
        timing,
        metadata: {
          filename,
          processing_time: processingTime,
          country,
          icp,
          processed_at: new Date().toISOString(),
          // Removed excessive timing metrics per user request
        },
      };
      
      progressCallback?.('complete', 100);
      this.logger.log(`Complete expense processing finished for ${filename} in ${processingTime}ms`);

      // Save results to file (timing is already included in result)
      await this.saveResultsToFile(filename, result);

      // Finalize main trace with success
      if (mainTrace) {
        mainTrace.update({
          output: {
            success: true,
            classification_result: classification?.expense_type,
            processing_time_seconds: (processingTime / 1000).toFixed(1),
            total_phases: 5,
            issues_detected: compliance?.validation_result?.issues?.length || 0,
          },
          metadata: {
            final_processing_time_seconds: (processingTime / 1000).toFixed(1),
            success: true,
            phases_completed: ['image_quality', 'classification', 'extraction', 'compliance', 'citations'],
            processing_mode: 'sequential',
            // Individual agent processing times
            agent_timings: {
              image_quality_seconds: timing.phase_timings.image_quality_assessment_seconds,
              classification_seconds: timing.phase_timings.file_classification_seconds,
              extraction_seconds: timing.phase_timings.data_extraction_seconds,
              compliance_seconds: timing.phase_timings.issue_detection_seconds,
              citations_seconds: timing.phase_timings.citation_generation_seconds,
            },
          },
        });
        
        // Flush the trace
        await this.langfuseService.flush();
      }

      return result;
      
    } catch (error) {
      const processingTime = Date.now() - trueStartTime;
      this.logger.error(`Expense processing failed for ${filename}:`, error);

      // Finalize main trace with error
      if (mainTrace) {
        mainTrace.update({
          output: {
            success: false,
            error: error.message,
            processing_time_seconds: (processingTime / 1000).toFixed(1),
          },
          metadata: {
            final_processing_time_ms: processingTime,
            success: false,
            error: error.message,
          },
        });
        
        // Flush the trace
        await this.langfuseService.flush();
      }

      // Return error result
      throw new Error(`Expense processing failed: ${error.message}`);
    }
  }

  /**
   * NEW: Run LLM-as-judge validation on existing compliance results
   */
  async validateComplianceResults(
    complianceResult: any,
    country: string,
    receiptType: string,
    icp: string,
    complianceData: any,
    extractedData: any,
    filename?: string
  ): Promise<any> {
    if (!this.complianceValidator) {
      throw new Error('LLM-as-judge compliance validator not available');
    }

    this.logger.log(`🔍 Running LLM-as-judge validation for ${filename || 'unknown file'}`);

    try {
      const validationResult = await this.complianceValidator.validateComplianceResponse(
        JSON.stringify(complianceResult),
        country,
        receiptType,
        icp,
        complianceData,
        extractedData
      );

      // Save validation results if filename provided
      if (filename) {
        await this.saveLLMValidationResults(filename, validationResult);
      }

      this.logger.log(`✅ LLM-as-judge validation completed with confidence: ${validationResult?.overall_score || 0}`);
      return validationResult;

    } catch (error) {
      this.logger.error('❌ LLM-as-judge validation failed:', error);
      throw new Error(`LLM validation failed: ${error.message}`);
    }
  }

  async classifyFileOnly(
    markdownContent: string,
    country: string,
    expenseSchema: any
  ): Promise<FileClassificationResult> {
    return this.fileClassificationAgent.classifyFile(markdownContent, country, expenseSchema);
  }

  async extractDataOnly(
    markdownContent: string,
    complianceData: any
  ): Promise<ExpenseData> {
    return this.dataExtractionAgent.extractData(markdownContent, complianceData);
  }

  async analyzeComplianceOnly(
    country: string,
    receiptType: string,
    icp: string,
    complianceData: any,
    extractedData: any
  ): Promise<IssueDetectionResult> {
    return this.issueDetectionAgent.analyzeCompliance(
      country,
      receiptType,
      icp,
      complianceData,
      extractedData
    );
  }

  async generateCitationsOnly(
    extractedData: any,
    markdownContent: string,
    filename: string
  ): Promise<CitationResult> {
    return this.citationGeneratorAgent.generateCitations(
      extractedData,
      markdownContent,
      filename
    );
  }

  // Health check for all agents
  async healthCheck(): Promise<{ status: string; agents: Record<string, boolean> }> {
    const agents = {
      fileClassification: true,
      dataExtraction: true,
      issueDetection: true,
      citationGeneration: true,
      llmValidation: this.complianceValidator !== null,
    };

    // Could add actual health checks for each agent here
    // For now, just return healthy status

    const allHealthy = Object.values(agents).every(status => status);
    
    return {
      status: allHealthy ? 'healthy' : 'degraded',
      agents,
    };
  }

  private async saveResultsToFile(filename: string, result: CompleteProcessingResult): Promise<void> {
    try {
      // Create results directory if it doesn't exist
      const resultsDir = path.join(process.cwd(), 'results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      // Generate output filename based on input filename
      const baseName = path.parse(filename).name;
      const outputFilename = `${baseName}_result.json`;
      const outputPath = path.join(resultsDir, outputFilename);

      // Save the complete result as JSON
      fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf8');

      this.logger.log(`Results saved to: ${outputPath}`);
    } catch (error) {
      this.logger.error(`Failed to save results for ${filename}:`, error);
      // Don't throw error - saving is optional, don't fail the main process
    }
  }

  /**
   * NEW: Save LLM validation results separately
   */
  private async saveLLMValidationResults(filename: string, validationResult: any): Promise<void> {
    try {
      // Create validation_results directory if it doesn't exist
      const validationDir = path.join(process.cwd(), 'validation_results');
      if (!fs.existsSync(validationDir)) {
        fs.mkdirSync(validationDir, { recursive: true });
      }

      // Generate output filename based on input filename
      const baseName = path.parse(filename).name;
      const outputFilename = `${baseName}_llm_validation.json`;
      const outputPath = path.join(validationDir, outputFilename);

      // Save the validation result as JSON
      fs.writeFileSync(outputPath, JSON.stringify(validationResult, null, 2), 'utf8');

      this.logger.log(`LLM validation results saved to: ${outputPath}`);
    } catch (error) {
      this.logger.error(`Failed to save LLM validation results for ${filename}:`, error);
      // Don't throw error - saving is optional, don't fail the main process
    }
  }

  /**
   * Generate a session ID for the processing run
   */
  private generateSessionId(filename: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileBaseName = path.basename(filename, path.extname(filename));
    const randomSuffix = randomUUID().substring(0, 8);
    return `expense-${fileBaseName}-${timestamp}-${randomSuffix}`;
  }

  /**
   * Generate a default user ID (can be overridden by API key or client ID)
   */
  private generateDefaultUserId(): string {
    return 'default-user';
  }

  private getFastestPhase(phaseTimings: any): { phase: string; time_minutes: string } {
    const phases = Object.entries(phaseTimings).filter(([_, time]) => time !== undefined) as [string, string][];
    if (phases.length === 0) return { phase: 'none', time_minutes: '0.00' };

    const fastest = phases.reduce((min, [phase, time]) =>
      parseFloat(time) < parseFloat(min.time_minutes) ? { phase, time_minutes: time } : min,
      { phase: phases[0][0], time_minutes: phases[0][1] }
    );
    return fastest;
  }

  private getSlowestPhase(phaseTimings: any): { phase: string; time_minutes: string } {
    const phases = Object.entries(phaseTimings).filter(([_, time]) => time !== undefined) as [string, string][];
    if (phases.length === 0) return { phase: 'none', time_minutes: '0.00' };

    const slowest = phases.reduce((max, [phase, time]) =>
      parseFloat(time) > parseFloat(max.time_minutes) ? { phase, time_minutes: time } : max,
      { phase: phases[0][0], time_minutes: phases[0][1] }
    );
    return slowest;
  }

  private getAveragePhaseTime(phaseTimings: any): string {
    const times = Object.values(phaseTimings).filter(time => time !== undefined) as string[];
    if (times.length === 0) return "0.00";
    const average = times.reduce((sum, time) => sum + parseFloat(time), 0) / times.length;
    return average.toFixed(2);
  }

  private validateTimingConsistency(timing: any): void {
    try {
      const totalTime: number = parseFloat(timing.total_processing_time_seconds || '0');
      const phaseTimings = timing.phase_timings || {};

      // Calculate sum of all phase times
      const phaseSum: number = Object.values(phaseTimings)
        .filter((time): time is string => time !== undefined && time !== null && typeof time === 'string')
        .reduce((sum: number, time: string) => sum + parseFloat(time), 0);

      // Allow for small rounding differences (up to 3 seconds)
      const tolerance = 3.0;
      const difference = Math.abs(totalTime - phaseSum);

      if (difference > tolerance) {
        this.logger.warn(
          `Timing inconsistency detected: Total time (${totalTime.toFixed(1)}s) vs Phase sum (${phaseSum.toFixed(1)}s). Difference: ${difference.toFixed(1)}s`
        );

        // Just log timing info without adding validation metadata to results
        this.logger.warn(
          `Timing inconsistency detected: Total time (${totalTime.toFixed(1)}s) vs Phase sum (${phaseSum.toFixed(1)}s). Difference: ${difference.toFixed(1)}s`
        );
      } else {
        this.logger.log(`Timing validation passed: Total time matches phase sum within tolerance`);
      }
    } catch (error) {
      this.logger.error('Error validating timing consistency:', error);
    }
  }
}
