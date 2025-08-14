import { Logger } from '@nestjs/common';
import { ExpenseComplianceUQLMValidator } from './ExpenseComplianceUQLMValidator';
import { BedrockLlmService } from '../../bedrockLlm';
import {
  ValidationDimension,
  ComplianceValidationResult,
  ComplianceValidationResultImpl,
  ValidationSummary,
  ValidationMetadata,
  ValidationUtils,
  ReliabilityLevel,
  ValidationError,
  ValidationErrorType
} from './types';
import pLimit from '../../p-limit';

/**
 * Configuration interface for parallel validation
 */
export interface ParallelValidationConfig {
  parallelValidationEnabled: boolean;
  dimensionConcurrency: number;
  judgeConcurrency: number;
  jobConcurrency: number;
  bedrockRateLimitPerSecond: number;
  fallbackToSequential: boolean;
  minSuccessfulDimensions: number;
}

/**
 * Performance metrics for parallel validation
 */
export interface ParallelValidationMetrics {
  total_validation_time_seconds: string;
  sequential_equivalent_time_seconds: string;
  time_saved_seconds: string;
  speedup_factor: string;
  dimensions_processed_in_parallel: number;
  judges_processed_in_parallel: number;
  successful_dimensions: number;
  failed_dimensions: number;
  fallback_used: boolean;
  execution_mode: 'parallel' | 'sequential' | 'hybrid';
}

/**
 * Batch job interface for Level 3 parallelization
 */
export interface ValidationJob {
  id: string;
  aiResponse: string;
  country: string;
  receiptType: string;
  icp: any;
  complianceJson: any;
  extractedJson: any;
}

/**
 * Judge result interface for type safety
 */
interface JudgeResult {
  model_name: string;
  confidence_score: number;
  response: string;
  success: boolean;
}

/**
 * ParallelExpenseComplianceUQLMValidator - Enhanced validation class with three-level parallelization
 * 
 * Level 1: Parallel validation dimensions (6 concurrent dimensions)
 * Level 2: Parallel judge panels within each dimension (3 concurrent judges per dimension)
 * Level 3: Parallel job processing for batch operations
 * 
 * Uses composition instead of inheritance to avoid private property access issues
 */
export class ParallelExpenseComplianceUQLMValidator {
  private config: ParallelValidationConfig;
  private dimensionLimiter: ReturnType<typeof pLimit>;
  private judgeLimiter: ReturnType<typeof pLimit>;
  private jobLimiter: ReturnType<typeof pLimit>;
  private rateLimiter: ReturnType<typeof pLimit>;
  private logger: Logger;
  private sequentialValidator: ExpenseComplianceUQLMValidator;
  private bedrockServices: BedrockLlmService[];
  private validationVersion: string = '2.0.0-parallel';

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(ParallelExpenseComplianceUQLMValidator.name);
    
    // Create sequential validator for fallback
    this.sequentialValidator = new ExpenseComplianceUQLMValidator(this.logger);
    
    // Initialize Bedrock services (same as base class)
    const judgeModels = [
      process.env.BEDROCK_JUDGE_MODEL_1 || 'eu.amazon.nova-pro-v1:0',
      process.env.BEDROCK_JUDGE_MODEL_2 || 'eu.amazon.nova-lite-v1:0',
      process.env.BEDROCK_JUDGE_MODEL_3 || 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    ];

    this.bedrockServices = judgeModels.map(modelId =>
      new BedrockLlmService({ modelId })
    );
    
    // Initialize parallel validation configuration from environment variables
    this.config = this.loadParallelConfig();
    
    // Initialize rate limiters for different levels of parallelization
    this.dimensionLimiter = pLimit(this.config.dimensionConcurrency);
    this.judgeLimiter = pLimit(this.config.judgeConcurrency);
    this.jobLimiter = pLimit(this.config.jobConcurrency);
    this.rateLimiter = pLimit(this.config.bedrockRateLimitPerSecond);
    
    this.logger.log(`✅ ParallelExpenseComplianceUQLMValidator initialized with config:`, {
      parallelValidationEnabled: this.config.parallelValidationEnabled,
      dimensionConcurrency: this.config.dimensionConcurrency,
      judgeConcurrency: this.config.judgeConcurrency,
      jobConcurrency: this.config.jobConcurrency,
      bedrockRateLimitPerSecond: this.config.bedrockRateLimitPerSecond,
      fallbackToSequential: this.config.fallbackToSequential,
      judgeModelsCount: this.bedrockServices.length
    });
  }

  /**
   * Load parallel validation configuration from environment variables
   */
  private loadParallelConfig(): ParallelValidationConfig {
    return {
      parallelValidationEnabled: process.env.PARALLEL_VALIDATION_ENABLED === 'true',
      dimensionConcurrency: parseInt(process.env.VALIDATION_DIMENSION_CONCURRENCY || '6'),
      judgeConcurrency: parseInt(process.env.VALIDATION_JUDGE_CONCURRENCY || '3'),
      jobConcurrency: parseInt(process.env.VALIDATION_JOB_CONCURRENCY || '5'),
      bedrockRateLimitPerSecond: parseInt(process.env.BEDROCK_RATE_LIMIT_PER_SECOND || '10'),
      fallbackToSequential: process.env.VALIDATION_FALLBACK_TO_SEQUENTIAL === 'true',
      minSuccessfulDimensions: 3 // Minimum 50% success rate
    };
  }

  /**
   * Main parallel validation method - validates AI response across all dimensions in parallel
   */
  async validateComplianceResponseParallel(
    aiResponse: string,
    country: string,
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any
  ): Promise<ValidationSummary> {
    const startTime = Date.now();
    const startTimeISO = new Date(startTime).toISOString();
    
    this.logger.log(`🚀 Starting PARALLEL compliance validation for ${country} ${receiptType}`);
    this.logger.log(`📊 Parallel config: ${this.config.dimensionConcurrency} dimensions, ${this.config.judgeConcurrency} judges per dimension`);

    // Check if parallel validation is enabled
    if (!this.config.parallelValidationEnabled) {
      this.logger.log('⚠️ Parallel validation disabled, falling back to sequential');
      return this.sequentialValidator.validateComplianceResponse(aiResponse, country, receiptType, icp, complianceJson, extractedJson);
    }

    try {
      // Parse AI response if it's a JSON string
      let parsedResponse: any;
      try {
        parsedResponse = typeof aiResponse === 'string' ? JSON.parse(aiResponse) : aiResponse;
      } catch {
        parsedResponse = { raw_response: aiResponse };
      }

      // Level 1 Parallelization: Validate all dimensions in parallel
      const validationResults = await this._validateDimensionsInParallel(
        aiResponse,
        parsedResponse,
        country,
        receiptType,
        icp,
        complianceJson,
        extractedJson
      );

      // Check if we have minimum successful dimensions
      const successfulDimensions = validationResults.filter(result => 
        !result.issues.some(issue => issue.includes('Validation error'))
      );

      if (successfulDimensions.length < this.config.minSuccessfulDimensions) {
        if (this.config.fallbackToSequential) {
          this.logger.warn(`⚠️ Only ${successfulDimensions.length}/${validationResults.length} dimensions successful, falling back to sequential`);
          return this.sequentialValidator.validateComplianceResponse(aiResponse, country, receiptType, icp, complianceJson, extractedJson);
        } else {
          throw new ValidationError(
            ValidationErrorType.INSUFFICIENT_DATA,
            `Insufficient successful validations: ${successfulDimensions.length}/${validationResults.length}`
          );
        }
      }

      // Calculate timing and performance metrics
      const endTime = Date.now();
      const endTimeISO = new Date(endTime).toISOString();
      const totalDuration = ((endTime - startTime) / 1000).toFixed(1);
      
      // Calculate performance metrics
      const performanceMetrics = this._calculateParallelPerformanceMetrics(
        validationResults,
        startTime,
        endTime,
        successfulDimensions.length,
        validationResults.length - successfulDimensions.length
      );

      // Create dimension timings (parallel execution means all dimensions run concurrently)
      const dimensionTimings: Record<string, any> = {};
      validationResults.forEach(result => {
        dimensionTimings[result.dimension] = {
          start_time: startTimeISO,
          end_time: endTimeISO,
          duration_seconds: totalDuration,
          judge_models_used: result.judge_models || [],
          execution_mode: 'parallel'
        };
      });

      // Calculate overall assessment with parallel timing information
      const overallAssessment = this._calculateOverallAssessment(
        validationResults,
        startTime,
        endTime,
        startTimeISO,
        endTimeISO,
        totalDuration,
        dimensionTimings,
        performanceMetrics
      );
      
      const processingTime = endTime - startTime;
      this.logger.log(`✅ PARALLEL validation completed in ${processingTime}ms (${successfulDimensions.length}/${validationResults.length} dimensions successful)`);

      return overallAssessment;

    } catch (error) {
      this.logger.error(`❌ Parallel validation failed: ${error.message}`);
      
      // Fallback to sequential if enabled
      if (this.config.fallbackToSequential) {
        this.logger.log('🔄 Falling back to sequential validation');
        return this.sequentialValidator.validateComplianceResponse(aiResponse, country, receiptType, icp, complianceJson, extractedJson);
      }
      
      throw new ValidationError(
        ValidationErrorType.VALIDATION_TIMEOUT,
        `Parallel validation process failed: ${error.message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Level 1 Parallelization: Validate all dimensions in parallel
   */
  private async _validateDimensionsInParallel(
    aiResponse: string,
    parsedResponse: any,
    country: string,
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any
  ): Promise<ComplianceValidationResult[]> {
    const dimensions = Object.values(ValidationDimension);
    
    this.logger.log(`🔄 Processing ${dimensions.length} dimensions in parallel (concurrency: ${this.config.dimensionConcurrency})`);

    // Create validation tasks for each dimension
    const validationTasks = dimensions.map(dimension => 
      this.dimensionLimiter(async () => {
        try {
          this.logger.log(`📊 Starting parallel validation for dimension: ${ValidationUtils.dimensionToString(dimension)}`);
          
          const validationPrompt = this._createValidationPrompt(
            aiResponse,
            parsedResponse,
            country,
            receiptType,
            icp,
            complianceJson,
            extractedJson,
            dimension
          );

          // Level 2 Parallelization: Use parallel judges within this dimension
          const result = await this._validateDimensionWithParallelJudges(validationPrompt, dimension);
          
          this.logger.log(`✅ Completed parallel validation for dimension: ${ValidationUtils.dimensionToString(dimension)}`);
          return result;
          
        } catch (error) {
          this.logger.error(`❌ Error in parallel validation for ${dimension}: ${error.message}`);
          return this._createErrorResult(dimension, error.message);
        }
      })
    );

    // Execute all dimension validations in parallel with graceful error handling
    const results = await Promise.allSettled(validationTasks);
    
    // Process results and handle any rejections
    const validationResults: ComplianceValidationResult[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        validationResults.push(result.value as ComplianceValidationResult);
      } else {
        const dimension = dimensions[index];
        this.logger.error(`❌ Dimension validation rejected for ${dimension}: ${result.reason}`);
        validationResults.push(this._createErrorResult(dimension, result.reason?.message || 'Unknown error'));
      }
    });

    return validationResults;
  }

  /**
   * Level 2 Parallelization: Validate dimension using parallel judge panels
   */
  private async _validateDimensionWithParallelJudges(
    validationPrompt: string,
    dimension: ValidationDimension
  ): Promise<ComplianceValidationResult> {
    try {
      this.logger.log(`🏛️ Starting parallel judge panel for ${dimension} (${this.bedrockServices.length} judges)`);

      // Create judge tasks with rate limiting
      const judgeTasks = this.bedrockServices.map((service, index) => 
        this.judgeLimiter(async () => {
          const modelName = service.getCurrentModelName();
          
          try {
            // Apply rate limiting for Bedrock API calls
            return await this.rateLimiter(async () => {
              const response = await service.chat({
                messages: [{ role: 'user', content: validationPrompt }]
              });
              
              const responseText = response.message.content;
              const confidence = this._extractConfidenceScore(responseText);
              
              return {
                model_name: modelName,
                confidence_score: confidence,
                response: responseText,
                success: true
              } as JudgeResult;
            });
            
          } catch (error) {
            this.logger.warn(`⚠️ Parallel judge ${index + 1} (${modelName}) failed for ${dimension}: ${error.message}`);
            return {
              model_name: modelName,
              confidence_score: 0.0,
              response: `Error: ${error.message}`,
              success: false
            } as JudgeResult;
          }
        })
      );

      // Execute all judge tasks in parallel
      const judgeResults = await Promise.allSettled(judgeTasks);
      
      // Process judge results
      const judgeResponses: string[] = [];
      const confidenceScores: number[] = [];
      const judgeDetails: { model_name: string; confidence_score: number; response: string; }[] = [];
      let successfulJudges = 0;

      judgeResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const judgeResult = result.value as JudgeResult;
          if (judgeResult.success) {
            judgeResponses.push(judgeResult.response);
            confidenceScores.push(judgeResult.confidence_score);
            judgeDetails.push({
              model_name: judgeResult.model_name,
              confidence_score: judgeResult.confidence_score,
              response: judgeResult.response
            });
            successfulJudges++;
          } else {
            judgeResponses.push(judgeResult.response);
            confidenceScores.push(judgeResult.confidence_score);
            judgeDetails.push({
              model_name: judgeResult.model_name,
              confidence_score: judgeResult.confidence_score,
              response: judgeResult.response
            });
          }
        } else {
          const modelName = this.bedrockServices[index]?.getCurrentModelName() || `judge_${index + 1}`;
          const errorMsg = result.reason?.message || 'Unknown error';
          
          judgeResponses.push(`Error: ${errorMsg}`);
          confidenceScores.push(0.0);
          judgeDetails.push({
            model_name: modelName,
            confidence_score: 0.0,
            response: `Error: ${errorMsg}`
          });
        }
      });

      this.logger.log(`🏛️ Parallel judge panel completed for ${dimension}: ${successfulJudges}/${this.bedrockServices.length} judges successful`);

      // Use the first successful response as primary, or first response if none successful
      const primaryResponse = judgeResponses.find(r => !r.startsWith('Error:')) || judgeResponses[0];
      
      // Calculate average confidence score
      const avgConfidence = confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
      
      // Extract issues and summary from primary response
      const issues = this._extractIssuesFromText(primaryResponse);
      const summary = this._extractSummaryFromText(primaryResponse);
      
      // Determine reliability based on consensus and success rate
      const reliability = this._determineParallelReliabilityFromScores(confidenceScores, successfulJudges, this.bedrockServices.length);

      // Get judge model names
      const judgeModels = this.bedrockServices.map(service => service.getCurrentModelName());

      return new ComplianceValidationResultImpl(
        dimension,
        avgConfidence,
        issues,
        summary,
        primaryResponse,
        reliability,
        judgeModels,
        judgeDetails
      );

    } catch (error) {
      this.logger.error(`❌ Parallel judge panel failed for ${dimension}: ${error.message}`);
      return this._createErrorResult(dimension, error.message);
    }
  }

  /**
   * Level 3 Parallelization: Process multiple validation jobs in parallel
   */
  async validateBatchJobsInParallel(jobs: ValidationJob[]): Promise<ValidationSummary[]> {
    this.logger.log(`🚀 Starting batch parallel validation for ${jobs.length} jobs (concurrency: ${this.config.jobConcurrency})`);
    
    const batchTasks = jobs.map(job => 
      this.jobLimiter(async () => {
        try {
          this.logger.log(`📋 Processing job ${job.id}`);
          
          const result = await this.validateComplianceResponseParallel(
            job.aiResponse,
            job.country,
            job.receiptType,
            job.icp,
            job.complianceJson,
            job.extractedJson
          );
          
          this.logger.log(`✅ Completed job ${job.id}`);
          return result;
          
        } catch (error) {
          this.logger.error(`❌ Job ${job.id} failed: ${error.message}`);
          throw error;
        }
      })
    );

    // Execute all batch jobs in parallel
    const results = await Promise.allSettled(batchTasks);
    
    // Process results
    const validationSummaries: ValidationSummary[] = [];
    let successfulJobs = 0;
    
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        validationSummaries.push(result.value as ValidationSummary);
        successfulJobs++;
      } else {
        this.logger.error(`❌ Batch job ${jobs[index].id} rejected: ${result.reason}`);
        // Could create a failed validation summary here if needed
      }
    });

    this.logger.log(`✅ Batch parallel validation completed: ${successfulJobs}/${jobs.length} jobs successful`);
    
    return validationSummaries;
  }

  /**
   * Create validation prompt for specific dimension (replicated from base class)
   */
  private _createValidationPrompt(
    aiResponse: string,
    parsedResponse: any,
    country: string,
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any,
    dimension: ValidationDimension
  ): string {
    const baseContext = `
Country: ${country}
Receipt Type: ${receiptType}
AI Response: ${aiResponse}

Extracted Data: ${JSON.stringify(extractedJson, null, 2)}
Compliance Rules: ${JSON.stringify(complianceJson, null, 2)}
ICP Context: ${JSON.stringify(icp, null, 2)}
`;

    switch (dimension) {
      case ValidationDimension.FACTUAL_GROUNDING:
        return `${baseContext}

TASK: Evaluate the factual grounding of the AI response.

Assess whether the AI response is factually grounded in the provided extracted data. Check if:
1. All claims in the response can be traced back to the extracted data
2. No information is fabricated or assumed beyond what's provided
3. Numerical values, dates, and amounts match the extracted data
4. Entity names and details are accurately represented

Rate your confidence (0-100) that the response is factually grounded and list any issues found.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any factual grounding issues]
SUMMARY: [Brief assessment]`;

      case ValidationDimension.KNOWLEDGE_BASE_ADHERENCE:
        return `${baseContext}

TASK: Evaluate adherence to compliance knowledge base.

Assess whether the AI response correctly applies the compliance rules and knowledge base for ${country}. Check if:
1. Compliance rules are correctly interpreted and applied
2. Country-specific regulations are properly considered
3. Receipt type requirements are accurately addressed
4. No contradictions with established compliance guidelines

Rate your confidence (0-100) that the response adheres to the knowledge base and list any issues.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any knowledge base adherence issues]
SUMMARY: [Brief assessment]`;

      case ValidationDimension.COMPLIANCE_ACCURACY:
        return `${baseContext}

TASK: Evaluate compliance accuracy of the assessment.

Assess whether the compliance determination is accurate. Check if:
1. Compliance status (compliant/non-compliant) is correctly determined
2. Required fields are properly validated
3. Business rules are correctly applied
4. Edge cases are handled appropriately

Rate your confidence (0-100) that the compliance assessment is accurate and list any issues.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any compliance accuracy issues]
SUMMARY: [Brief assessment]`;

      case ValidationDimension.ISSUE_CATEGORIZATION:
        return `${baseContext}

TASK: Evaluate issue categorization accuracy.

Assess whether identified issues are correctly categorized. Check if:
1. Issues are properly classified by type and severity
2. Issue descriptions are clear and actionable
3. Categorization follows established taxonomy
4. No issues are missed or incorrectly classified

Rate your confidence (0-100) that issues are correctly categorized and list any problems.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any issue categorization problems]
SUMMARY: [Brief assessment]`;

      case ValidationDimension.RECOMMENDATION_VALIDITY:
        return `${baseContext}

TASK: Evaluate recommendation validity and usefulness.

Assess whether provided recommendations are valid and helpful. Check if:
1. Recommendations are actionable and specific
2. Suggestions address the identified issues
3. Recommendations are feasible and practical
4. No contradictory or harmful advice is given

Rate your confidence (0-100) that recommendations are valid and list any issues.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any recommendation validity issues]
SUMMARY: [Brief assessment]`;

      case ValidationDimension.HALLUCINATION_DETECTION:
        return `${baseContext}

TASK: Detect hallucinations and fabricated information.

Assess whether the AI response contains hallucinated or fabricated information. Check for:
1. Information not present in the source data
2. Fabricated compliance rules or requirements
3. Made-up entity names, amounts, or dates
4. Assumptions presented as facts

Rate your confidence (0-100) that the response is free from hallucinations and list any detected fabrications.

Response format:
CONFIDENCE: [0-100]
ISSUES: [List any detected hallucinations]
SUMMARY: [Brief assessment]`;

      default:
        throw new ValidationError(
          ValidationErrorType.INVALID_DIMENSION,
          `Unknown validation dimension: ${dimension}`
        );
    }
  }

  /**
   * Extract confidence score from LLM response text (replicated from base class)
   */
  private _extractConfidenceScore(text: string): number {
    // Look for CONFIDENCE: [number] pattern
    const confidenceMatch = text.match(/CONFIDENCE:\s*(\d+)/i);
    if (confidenceMatch) {
      const score = parseInt(confidenceMatch[1]);
      return Math.max(0, Math.min(100, score)) / 100.0; // Normalize to 0-1
    }

    // Fallback: look for standalone numbers between 0-100
    const numberMatch = text.match(/\b(\d{1,3})\b/);
    if (numberMatch) {
      const score = parseInt(numberMatch[1]);
      if (score >= 0 && score <= 100) {
        return score / 100.0;
      }
    }

    // Default to medium confidence if no score found
    return 0.5;
  }

  /**
   * Extract issues from response text (replicated from base class)
   */
  private _extractIssuesFromText(text: string): string[] {
    const issues: string[] = [];
    
    // Look for ISSUES: section
    const issuesMatch = text.match(/ISSUES:\s*(.*?)(?=\n[A-Z]+:|$)/is);
    if (issuesMatch) {
      const issuesText = issuesMatch[1].trim();
      if (issuesText && issuesText.toLowerCase() !== 'none' && issuesText !== '[]') {
        // Split by common delimiters and clean up
        const issueList = issuesText
          .split(/[,;\n]/)
          .map(issue => issue.trim())
          .filter(issue => issue.length > 0 && !issue.match(/^\[.*\]$/));
        
        issues.push(...issueList);
      }
    }

    return issues;
  }

  /**
   * Extract summary from response text (replicated from base class)
   */
  private _extractSummaryFromText(text: string): string {
    // Look for SUMMARY: section
    const summaryMatch = text.match(/SUMMARY:\s*(.*?)(?=\n[A-Z]+:|$)/is);
    if (summaryMatch) {
      return summaryMatch[1].trim();
    }

    // Fallback: use first sentence or truncated text
    const firstSentence = text.split('.')[0];
    return firstSentence.length > 10 ? firstSentence + '.' : 'Validation completed';
  }

  /**
   * Create error result for failed validation (replicated from base class)
   */
  private _createErrorResult(dimension: ValidationDimension, errorMsg: string): ComplianceValidationResult {
    const judgeModels = this.bedrockServices.map(service => service.getCurrentModelName());
    const judgeDetails = judgeModels.map(modelName => ({
      model_name: modelName,
      confidence_score: 0.0,
      response: `Error: ${errorMsg}`
    }));

    return new ComplianceValidationResultImpl(
      dimension,
      0.0, // Zero confidence for errors
      [`Validation error: ${errorMsg}`],
      `Failed to validate ${ValidationUtils.dimensionToString(dimension)}`,
      `Error: ${errorMsg}`,
      'low',
      judgeModels,
      judgeDetails
    );
  }

  /**
   * Calculate variance of confidence scores (replicated from base class)
   */
  private _calculateVariance(scores: number[]): number {
    if (scores.length <= 1) return 0;
    
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / scores.length;
  }

  /**
   * Determine reliability level for parallel processing considering success rate
   */
  private _determineParallelReliabilityFromScores(
    scores: number[], 
    successfulJudges: number, 
    totalJudges: number
  ): ReliabilityLevel {
    if (scores.length === 0 || successfulJudges === 0) return 'low';
    
    const successRate = successfulJudges / totalJudges;
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = this._calculateVariance(scores);
    
    // High reliability: high success rate, high average score, and low variance
    if (successRate >= 0.8 && avgScore >= 0.8 && variance <= 0.04) return 'high';
    
    // Low reliability: low success rate, low average score, or high variance
    if (successRate <= 0.5 || avgScore <= 0.3 || variance >= 0.25) return 'low';
    
    // Medium reliability: everything else
    return 'medium';
  }

  /**
   * Calculate performance metrics for parallel validation
   */
  private _calculateParallelPerformanceMetrics(
    validationResults: ComplianceValidationResult[],
    startTime: number,
    endTime: number,
    successfulDimensions: number,
    failedDimensions: number
  ): ParallelValidationMetrics {
    const totalTime = (endTime - startTime) / 1000;
    
    // Estimate sequential time (assuming each dimension takes ~5 seconds with 3 judges each taking ~1.5 seconds)
    const estimatedSequentialTime = validationResults.length * 5; // 5 seconds per dimension
    
    const timeSaved = Math.max(0, estimatedSequentialTime - totalTime);
    const speedupFactor = estimatedSequentialTime > 0 ? estimatedSequentialTime / totalTime : 1;

    return {
      total_validation_time_seconds: totalTime.toFixed(1),
      sequential_equivalent_time_seconds: estimatedSequentialTime.toFixed(1),
      time_saved_seconds: timeSaved.toFixed(1),
      speedup_factor: speedupFactor.toFixed(2),
      dimensions_processed_in_parallel: validationResults.length,
      judges_processed_in_parallel: this.bedrockServices.length,
      successful_dimensions: successfulDimensions,
      failed_dimensions: failedDimensions,
      fallback_used: false,
      execution_mode: 'parallel'
    };
  }

  /**
   * Generate recommendations based on validation results (replicated from base class)
   */
  private _generateRecommendations(results: ComplianceValidationResult[]): string[] {
    const recommendations: string[] = [];
    
    results.forEach(result => {
      if (result.confidence_score < 0.7) {
        recommendations.push(
          `Improve ${ValidationUtils.dimensionToString(result.dimension).toLowerCase()}: ${result.summary}`
        );
      }
      
      if (result.issues.length > 0) {
        recommendations.push(
          `Address issues in ${ValidationUtils.dimensionToString(result.dimension).toLowerCase()}: ${result.issues.join(', ')}`
        );
      }
    });

    // Add general recommendations
    if (recommendations.length === 0) {
      recommendations.push('Validation passed successfully - no specific recommendations');
    } else if (recommendations.length > 3) {
      recommendations.unshift('Multiple validation issues detected - prioritize critical fixes');
    }

    return recommendations;
  }

  /**
   * Enhanced overall assessment calculation with parallel metrics
   */
  private _calculateOverallAssessment(
    validationResults: ComplianceValidationResult[],
    startTime: number,
    endTime: number,
    startTimeISO: string,
    endTimeISO: string,
    totalDuration: string,
    dimensionTimings: Record<string, any>,
    performanceMetrics?: ParallelValidationMetrics
  ): ValidationSummary {
    const overallScore = ValidationUtils.calculateOverallScore(validationResults);
    const overallReliability = ValidationUtils.calculateOverallReliability(validationResults);
    const criticalIssues = ValidationUtils.extractCriticalIssues(validationResults);
    
    // Generate recommendations based on results
    const recommendations = this._generateRecommendations(validationResults);

    // Get all judge model names
    const judgeModels = this.bedrockServices.map(service => service.getCurrentModelName());

    const metadata: ValidationMetadata = {
      validation_version: this.validationVersion,
      judge_models: judgeModels,
      judge_model: judgeModels[0] || 'unknown',
      processing_time_ms: endTime - startTime,
      timing: {
        validation_start_time: startTimeISO,
        validation_end_time: endTimeISO,
        total_validation_time_seconds: totalDuration,
        dimension_timings: dimensionTimings
      },
      context: {
        dimensions_validated: validationResults.length,
        judge_panel_size: this.bedrockServices.length,
        execution_mode: 'parallel',
        parallel_config: {
          dimension_concurrency: this.config.dimensionConcurrency,
          judge_concurrency: this.config.judgeConcurrency,
          rate_limit_per_second: this.config.bedrockRateLimitPerSecond
        },
        performance_metrics: performanceMetrics
      }
    };

    return {
      overall_score: overallScore,
      dimensions_count: validationResults.length,
      dimension_results: validationResults,
      overall_reliability: overallReliability,
      critical_issues: criticalIssues,
      recommendations,
      timestamp: new Date(),
      metadata
    };
  }

  /**
   * Get current parallel validation configuration
   */
  getParallelConfig(): ParallelValidationConfig {
    return { ...this.config };
  }

  /**
   * Update parallel validation configuration
   */
  updateParallelConfig(newConfig: Partial<ParallelValidationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Update limiters if concurrency settings changed
    if (newConfig.dimensionConcurrency) {
      this.dimensionLimiter = pLimit(this.config.dimensionConcurrency);
    }
    if (newConfig.judgeConcurrency) {
      this.judgeLimiter = pLimit(this.config.judgeConcurrency);
    }
    if (newConfig.jobConcurrency) {
      this.jobLimiter = pLimit(this.config.jobConcurrency);
    }
    if (newConfig.bedrockRateLimitPerSecond) {
      this.rateLimiter = pLimit(this.config.bedrockRateLimitPerSecond);
    }
    
    this.logger.log('🔧 Parallel validation configuration updated:', newConfig);
  }

  /**
   * Check if parallel validation is currently enabled and properly configured
   */
  isParallelValidationReady(): boolean {
    return this.config.parallelValidationEnabled &&
           this.bedrockServices.length >= 2 && // Need at least 2 judges for meaningful parallelization
           this.config.dimensionConcurrency > 1;
  }

  /**
   * Get performance statistics for monitoring
   */
  getPerformanceStats(): {
    isParallelEnabled: boolean;
    dimensionConcurrency: number;
    judgeConcurrency: number;
    jobConcurrency: number;
    rateLimitPerSecond: number;
    judgeModelsCount: number;
    fallbackEnabled: boolean;
  } {
    return {
      isParallelEnabled: this.config.parallelValidationEnabled,
      dimensionConcurrency: this.config.dimensionConcurrency,
      judgeConcurrency: this.config.judgeConcurrency,
      jobConcurrency: this.config.jobConcurrency,
      rateLimitPerSecond: this.config.bedrockRateLimitPerSecond,
      judgeModelsCount: this.bedrockServices.length,
      fallbackEnabled: this.config.fallbackToSequential
    };
  }

  /**
   * Delegate to sequential validator for backward compatibility
   */
  async validateComplianceResponse(
    aiResponse: string,
    country: string,
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any
  ): Promise<ValidationSummary> {
    // If parallel is enabled, use parallel validation, otherwise use sequential
    if (this.config.parallelValidationEnabled && this.isParallelValidationReady()) {
      return this.validateComplianceResponseParallel(aiResponse, country, receiptType, icp, complianceJson, extractedJson);
    } else {
      return this.sequentialValidator.validateComplianceResponse(aiResponse, country, receiptType, icp, complianceJson, extractedJson);
    }
  }
}