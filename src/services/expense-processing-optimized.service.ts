import { Injectable, Logger } from '@nestjs/common';
import { FileClassificationAgent } from '../agents/file-classification.agent';
import { DataExtractionAgent } from '../agents/data-extraction.agent';
import { IssueDetectionAgent } from '../agents/issue-detection.agent';
import { CitationGeneratorAgent } from '../agents/citation-generator.agent';
import { ImageQualityAssessmentAgent } from '../agents/image-quality-assessment.agent';
import {
  type CompleteProcessingResult,
} from '../schemas/expense-schemas';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ExpenseProcessingOptimizedService {
  private readonly logger = new Logger(ExpenseProcessingOptimizedService.name);

  constructor() {}

  async processExpenseDocumentParallel(
    markdownContent: string,
    filename: string,
    imagePath: string,
    country: string,
    icp: string,
    complianceData: any,
    expenseSchema: any,
    agents: {
      fileClassificationAgent: FileClassificationAgent;
      dataExtractionAgent: DataExtractionAgent;
      issueDetectionAgent: IssueDetectionAgent;
      citationGeneratorAgent: CitationGeneratorAgent;
      imageQualityAssessmentAgent: ImageQualityAssessmentAgent;
    },
    progressCallback?: (stage: string, progress: number) => void,
    markdownExtractionInfo?: { markdownExtractionTime: number; documentReader: string }
  ): Promise<CompleteProcessingResult> {
    // Calculate the true start time including markdown extraction
    const trueStartTime = markdownExtractionInfo
      ? Date.now() - markdownExtractionInfo.markdownExtractionTime
      : Date.now();

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

    try {
      this.logger.log(`Starting PARALLEL expense processing for ${filename}`);

      // PARALLEL GROUP 1: Independent phases that can run simultaneously
      progressCallback?.('parallelPhase1', 10);
      this.logger.log('🚀 Starting Parallel Group 1: Image Quality + Classification + Data Extraction');

      const parallelGroup1Start = Date.now();
      
      const [formattedQualityAssessment, classification, extraction] = await Promise.all([
        // Phase 0: Image Quality Assessment
        this.runImageQualityAssessment(imagePath, timing, agents.imageQualityAssessmentAgent),

        // Phase 1: File Classification
        this.runFileClassification(markdownContent, country, expenseSchema, timing, agents.fileClassificationAgent),

        // Phase 2: Data Extraction
        this.runDataExtraction(markdownContent, complianceData, timing, agents.dataExtractionAgent)
      ]);

      const parallelGroup1End = Date.now();
      const parallelGroup1Duration = (parallelGroup1End - parallelGroup1Start) / 1000;
      
      this.logger.log(`✅ Parallel Group 1 completed in ${parallelGroup1Duration.toFixed(2)}s (was ~${(0.26 + 0.17 + 0.22).toFixed(2)}min sequential)`);
      progressCallback?.('parallelPhase1Complete', 60);

      // PARALLEL GROUP 2: Phases that depend on extraction results
      progressCallback?.('parallelPhase2', 65);
      this.logger.log('🚀 Starting Parallel Group 2: Issue Detection + Citation Generation');

      const parallelGroup2Start = Date.now();
      
      const [compliance, citations] = await Promise.all([
        // Phase 3: Issue Detection
        this.runIssueDetection(country, classification.expense_type || 'unknown', icp, complianceData, extraction, timing, agents.issueDetectionAgent),

        // Phase 4: Citation Generation
        this.runCitationGeneration(extraction, JSON.stringify(complianceData), markdownContent, filename, timing, agents.citationGeneratorAgent)
      ]);

      const parallelGroup2End = Date.now();
      const parallelGroup2Duration = (parallelGroup2End - parallelGroup2Start) / 1000;
      
      this.logger.log(`✅ Parallel Group 2 completed in ${parallelGroup2Duration.toFixed(2)}s (was ~${(0.29 + 0.26).toFixed(2)}min sequential)`);
      progressCallback?.('parallelPhase2Complete', 95);
      
      // Compile final result
      const processingTime = Date.now() - trueStartTime;
      timing.total_processing_time_seconds = (processingTime / 1000).toFixed(1);
      
      // Add performance metrics and fix timing validation for parallel processing
      this.addPerformanceMetrics(timing, parallelGroup1Duration, parallelGroup2Duration);
      this.validateParallelTimingConsistency(timing, parallelGroup1Duration, parallelGroup2Duration);

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
          optimization: {
            parallel_processing: true,
            parallel_group_1_duration_seconds: parallelGroup1Duration.toFixed(1),
            parallel_group_2_duration_seconds: parallelGroup2Duration.toFixed(1),
            estimated_sequential_time_seconds: timing.performance_metrics?.estimated_sequential_time_seconds || '0.0',
            actual_parallel_time_seconds: (processingTime / 1000).toFixed(1)
          }
        },
      };
      
      progressCallback?.('complete', 100);
      this.logger.log(`🎉 PARALLEL expense processing finished for ${filename} in ${(processingTime/1000).toFixed(2)}s`);

      // Save results to file (timing is already included in result)
      await this.saveResultsToFile(filename, result);

      return result;
      
    } catch (error) {
      const processingTime = Date.now() - trueStartTime;
      this.logger.error(`❌ PARALLEL expense processing failed for ${filename}:`, error);
      throw new Error(`Parallel expense processing failed: ${error.message}`);
    }
  }

  private async runImageQualityAssessment(imagePath: string, timing: any, agent: ImageQualityAssessmentAgent) {
    const start = Date.now();
    this.logger.log('📸 Phase 0: Image Quality Assessment (parallel)');

    const result = await agent.assessImageQuality(imagePath);
    const formattedResult = agent.formatAssessmentForWorkflow(result, imagePath);

    const end = Date.now();
    timing.phase_timings.image_quality_assessment_seconds = ((end - start) / 1000).toFixed(1);
    timing.agent_performance.image_quality_assessment = {
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_seconds: ((end - start) / 1000).toFixed(1),
      model_used: formattedResult.model_used,
      execution_mode: 'parallel'
    };

    return formattedResult;
  }

  private async runFileClassification(markdownContent: string, country: string, expenseSchema: any, timing: any, agent: FileClassificationAgent) {
    const start = Date.now();
    this.logger.log('📋 Phase 1: File Classification (parallel)');

    const result = await agent.classifyFile(markdownContent, country, expenseSchema);

    const end = Date.now();
    timing.phase_timings.file_classification_seconds = ((end - start) / 1000).toFixed(1);
    timing.agent_performance.file_classification = {
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_seconds: ((end - start) / 1000).toFixed(1),
      model_used: process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0',
      execution_mode: 'parallel'
    };

    return result;
  }

  private async runDataExtraction(markdownContent: string, complianceData: any, timing: any, agent: DataExtractionAgent) {
    const start = Date.now();
    this.logger.log('🔍 Phase 2: Data Extraction (parallel)');

    const result = await agent.extractData(markdownContent, complianceData);

    const end = Date.now();
    timing.phase_timings.data_extraction_seconds = ((end - start) / 1000).toFixed(1);
    timing.agent_performance.data_extraction = {
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_seconds: ((end - start) / 1000).toFixed(1),
      model_used: process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0',
      execution_mode: 'parallel'
    };

    return result;
  }

  private async runIssueDetection(country: string, receiptType: string, icp: string, complianceData: any, extractedData: any, timing: any, agent: IssueDetectionAgent) {
    const start = Date.now();
    this.logger.log('⚠️ Phase 3: Issue Detection (parallel)');

    const result = await agent.analyzeCompliance(country, receiptType, icp, complianceData, extractedData);

    const end = Date.now();
    timing.phase_timings.issue_detection_seconds = ((end - start) / 1000).toFixed(1);
    timing.agent_performance.issue_detection = {
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_seconds: ((end - start) / 1000).toFixed(1),
      model_used: process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0',
      execution_mode: 'parallel'
    };

    return result;
  }

  private async runCitationGeneration(extractedData: any, extractionRequirements: string, markdownContent: string, filename: string, timing: any, agent: CitationGeneratorAgent) {
    const start = Date.now();
    this.logger.log('📝 Phase 4: Citation Generation (parallel)');

    const result = await agent.generateCitations(extractedData, extractionRequirements, markdownContent, filename);

    const end = Date.now();
    timing.phase_timings.citation_generation_seconds = ((end - start) / 1000).toFixed(1);
    timing.agent_performance.citation_generation = {
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_seconds: ((end - start) / 1000).toFixed(1),
      model_used: process.env.CITATION_MODEL || 'eu.amazon.nova-micro-v1:0',
      execution_mode: 'parallel'
    };

    return result;
  }

  private addPerformanceMetrics(timing: any, group1Duration: number, group2Duration: number) {
    // Calculate estimated sequential time from actual phase timings
    const phaseTimings = timing.phase_timings || {};
    const estimatedSequentialTime = Object.values(phaseTimings)
      .filter((time): time is string => time !== undefined && time !== null && typeof time === 'string')
      .reduce((sum: number, time: string) => sum + parseFloat(time), 0);

    timing.performance_metrics = {
      parallel_group_1_seconds: group1Duration.toFixed(1),
      parallel_group_2_seconds: group2Duration.toFixed(1),
      total_parallel_time_seconds: (group1Duration + group2Duration).toFixed(1),
      estimated_sequential_time_seconds: estimatedSequentialTime.toFixed(1),
      estimated_speedup_factor: (estimatedSequentialTime / (group1Duration + group2Duration)).toFixed(2)
    };
  }

  // Include validation and file saving methods from original service
  private validateParallelTimingConsistency(timing: any, group1Duration: number, group2Duration: number): void {
    try {
      const totalTime: number = parseFloat(timing.total_processing_time_seconds || '0');
      const phaseTimings = timing.phase_timings || {};

      // For parallel processing, calculate expected time based on parallel groups
      const markdownTime = parseFloat(phaseTimings.markdown_extraction_seconds || '0');
      const group1MaxTime = Math.max(
        parseFloat(phaseTimings.image_quality_assessment_seconds || '0'),
        parseFloat(phaseTimings.file_classification_seconds || '0'),
        parseFloat(phaseTimings.data_extraction_seconds || '0')
      );
      const group2MaxTime = Math.max(
        parseFloat(phaseTimings.issue_detection_seconds || '0'),
        parseFloat(phaseTimings.citation_generation_seconds || '0')
      );

      const expectedParallelTime = markdownTime + group1MaxTime + group2MaxTime;

      // Calculate sum of all phases (for comparison)
      const sequentialSum: number = Object.values(phaseTimings)
        .filter((time): time is string => time !== undefined && time !== null && typeof time === 'string')
        .reduce((sum: number, time: string) => sum + parseFloat(time), 0);

      // Allow for small rounding differences (up to 3 seconds)
      const tolerance = 3.0;
      const difference = Math.abs(totalTime - expectedParallelTime);

      if (difference > tolerance) {
        this.logger.warn(
          `Parallel timing inconsistency detected: Total time (${totalTime.toFixed(1)}s) vs Expected parallel time (${expectedParallelTime.toFixed(1)}s). Difference: ${difference.toFixed(1)}s`
        );

        // Add validation metadata to timing
        timing.validation = {
          total_time_seconds: totalTime.toFixed(1),
          expected_parallel_time_seconds: expectedParallelTime.toFixed(1),
          sequential_sum_seconds: sequentialSum.toFixed(1),
          difference_seconds: difference.toFixed(1),
          is_consistent: difference <= tolerance,
          tolerance_seconds: tolerance.toFixed(1),
          processing_mode: 'parallel',
          time_saved_seconds: (sequentialSum - totalTime).toFixed(1)
        };
      } else {
        timing.validation = {
          total_time_seconds: totalTime.toFixed(1),
          expected_parallel_time_seconds: expectedParallelTime.toFixed(1),
          sequential_sum_seconds: sequentialSum.toFixed(1),
          difference_seconds: difference.toFixed(1),
          is_consistent: true,
          tolerance_seconds: tolerance.toFixed(1),
          processing_mode: 'parallel',
          time_saved_seconds: (sequentialSum - totalTime).toFixed(1)
        };
        this.logger.log(`Parallel timing validation passed: Total time (${totalTime.toFixed(1)}s) matches expected parallel time (${expectedParallelTime.toFixed(1)}s). Time saved: ${(sequentialSum - totalTime).toFixed(1)}s`);
      }
    } catch (error) {
      this.logger.error('Error validating parallel timing consistency:', error);
      timing.validation = {
        error: 'Failed to validate parallel timing consistency',
        is_consistent: false,
        processing_mode: 'parallel'
      };
    }
  }

  private async saveResultsToFile(filename: string, result: CompleteProcessingResult): Promise<void> {
    try {
      // Create results directory if it doesn't exist
      const resultsDir = path.join(process.cwd(), 'results');
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }

      // Generate result filename
      const baseFilename = filename.replace(/\.[^/.]+$/, ''); // Remove extension
      const resultFilename = `${baseFilename}_result.json`;
      const resultFilePath = path.join(resultsDir, resultFilename);

      // Write results to file
      fs.writeFileSync(resultFilePath, JSON.stringify(result, null, 2));
      this.logger.log(`Results saved to: ${resultFilePath}`);
    } catch (error) {
      this.logger.error('Failed to save results to file:', error);
    }
  }


}
