import { UQResult, JudgeResponse } from '../types';

/**
 * Validation dimensions for expense compliance validation
 * Matches the Python UQLM validation functionality
 */
export enum ValidationDimension {
  FACTUAL_GROUNDING = 'factual_grounding',
  KNOWLEDGE_BASE_ADHERENCE = 'knowledge_base_adherence',
  COMPLIANCE_ACCURACY = 'compliance_accuracy',
  ISSUE_CATEGORIZATION = 'issue_categorization',
  RECOMMENDATION_VALIDITY = 'recommendation_validity',
  HALLUCINATION_DETECTION = 'hallucination_detection'
}

/**
 * Reliability levels for validation results
 */
export type ReliabilityLevel = 'high' | 'medium' | 'low';

/**
 * Individual compliance validation result for a specific dimension
 */
export interface ComplianceValidationResult {
  /** The validation dimension being assessed */
  dimension: ValidationDimension;
  
  /** Confidence score between 0.0 and 1.0 */
  confidence_score: number;
  
  /** List of identified issues or problems */
  issues: string[];
  
  /** Summary of the validation result */
  summary: string;
  
  /** Raw response from the validation process */
  raw_response: string;
  
  /** Reliability level of the validation result */
  reliability_level: ReliabilityLevel;
  
  /** Names of the judge models used for this dimension */
  judge_models?: string[];
  
  /** Individual judge responses and scores */
  judge_details?: {
    model_name: string;
    confidence_score: number;
    response: string;
  }[];
  
  /**
   * Convert the validation result to a dictionary/object format
   * for JSON serialization
   */
  toDict(): ComplianceValidationResultDict;
}

/**
 * Dictionary representation of ComplianceValidationResult
 * for JSON serialization
 */
export interface ComplianceValidationResultDict {
  dimension: string;
  confidence_score: number;
  issues: string[];
  summary: string;
  raw_response: string;
  reliability_level: ReliabilityLevel;
  judge_models?: string[];
  judge_details?: {
    model_name: string;
    confidence_score: number;
    response: string;
  }[];
}

/**
 * Implementation of ComplianceValidationResult interface
 */
export class ComplianceValidationResultImpl implements ComplianceValidationResult {
  constructor(
    public dimension: ValidationDimension,
    public confidence_score: number,
    public issues: string[],
    public summary: string,
    public raw_response: string,
    public reliability_level: ReliabilityLevel,
    public judge_models?: string[],
    public judge_details?: {
      model_name: string;
      confidence_score: number;
      response: string;
    }[]
  ) {
    // Validate confidence score is between 0.0 and 1.0
    if (confidence_score < 0.0 || confidence_score > 1.0) {
      throw new Error('Confidence score must be between 0.0 and 1.0');
    }
  }

  toDict(): ComplianceValidationResultDict {
    return {
      dimension: this.dimension,
      confidence_score: this.confidence_score,
      issues: [...this.issues],
      summary: this.summary,
      raw_response: this.raw_response,
      reliability_level: this.reliability_level,
      judge_models: this.judge_models ? [...this.judge_models] : undefined,
      judge_details: this.judge_details ? [...this.judge_details] : undefined
    };
  }
}

/**
 * Summary of validation results across multiple dimensions
 */
export interface ValidationSummary {
  /** Overall validation score (0.0 to 1.0) */
  overall_score: number;
  
  /** Number of dimensions validated */
  dimensions_count: number;
  
  /** Results for each validation dimension */
  dimension_results: ComplianceValidationResult[];
  
  /** Overall reliability level */
  overall_reliability: ReliabilityLevel;
  
  /** Critical issues found across all dimensions */
  critical_issues: string[];
  
  /** Recommendations based on validation results */
  recommendations: string[];
  
  /** Timestamp of validation */
  timestamp: Date;
  
  /** Metadata about the validation process */
  metadata: ValidationMetadata;
}

/**
 * Metadata for validation process
 */
export interface ValidationMetadata {
  /** Version of validation system used */
  validation_version: string;
  
  /** All judge models used in the panel */
  judge_models?: string[];
  
  /** Primary judge model (for backward compatibility) */
  judge_model?: string;
  
  /** Processing time in milliseconds */
  processing_time_ms?: number;
  
  /** Detailed timing information matching main result format */
  timing?: {
    validation_start_time?: string;
    validation_end_time?: string;
    total_validation_time_seconds?: string;
    dimension_timings?: Record<string, {
      start_time: string;
      end_time: string;
      duration_seconds: string;
      judge_models_used: string[];
    }>;
  };
  
  /** Number of retries attempted */
  retry_count?: number;
  
  /** Additional context or configuration */
  context?: Record<string, any>;
}

/**
 * Extended UQResult that includes validation-specific data
 */
export interface ValidationUQResult extends UQResult {
  data: UQResult['data'] & {
    /** Validation results for each dimension */
    validation_results?: ComplianceValidationResult[];
    
    /** Validation summary */
    validation_summary?: ValidationSummary;
    
    /** Dimension-specific scores */
    dimension_scores?: Record<ValidationDimension, number>;
  };
  
  metadata: UQResult['metadata'] & {
    /** Validation-specific metadata */
    validation_metadata?: ValidationMetadata;
  };
}

/**
 * Extended JudgeResponse for validation-specific judging
 */
export interface ValidationJudgeResponse extends JudgeResponse {
  /** Validation dimension being judged */
  validation_dimension?: ValidationDimension;
  
  /** Detailed validation results */
  validation_results?: ComplianceValidationResult[];
  
  /** Issues identified during validation */
  identified_issues?: string[];
}

/**
 * Configuration for validation process
 */
export interface ValidationConfig {
  /** Dimensions to validate */
  dimensions: ValidationDimension[];
  
  /** Minimum confidence threshold */
  min_confidence_threshold?: number;
  
  /** Maximum number of retries for failed validations */
  max_retries?: number;
  
  /** Timeout for validation process in milliseconds */
  timeout_ms?: number;
  
  /** Custom validation prompts for each dimension */
  custom_prompts?: Partial<Record<ValidationDimension, string>>;
  
  /** Whether to include detailed issue analysis */
  include_detailed_analysis?: boolean;
}

/**
 * Validation error types
 */
export enum ValidationErrorType {
  INVALID_DIMENSION = 'invalid_dimension',
  CONFIDENCE_OUT_OF_RANGE = 'confidence_out_of_range',
  VALIDATION_TIMEOUT = 'validation_timeout',
  JUDGE_UNAVAILABLE = 'judge_unavailable',
  INSUFFICIENT_DATA = 'insufficient_data'
}

/**
 * Custom error for validation failures
 */
export class ValidationError extends Error {
  constructor(
    public errorType: ValidationErrorType,
    message: string,
    public dimension?: ValidationDimension,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Utility functions for validation
 */
export class ValidationUtils {
  /**
   * Calculate overall reliability level based on individual results
   */
  static calculateOverallReliability(results: ComplianceValidationResult[]): ReliabilityLevel {
    if (results.length === 0) return 'low';
    
    const reliabilityCounts = results.reduce((acc, result) => {
      acc[result.reliability_level] = (acc[result.reliability_level] || 0) + 1;
      return acc;
    }, {} as Record<ReliabilityLevel, number>);
    
    const total = results.length;
    const highCount = reliabilityCounts.high || 0;
    const mediumCount = reliabilityCounts.medium || 0;
    
    if (highCount / total >= 0.7) return 'high';
    if ((highCount + mediumCount) / total >= 0.5) return 'medium';
    return 'low';
  }
  
  /**
   * Calculate overall validation score from dimension results
   */
  static calculateOverallScore(results: ComplianceValidationResult[]): number {
    if (results.length === 0) return 0.0;
    
    const totalScore = results.reduce((sum, result) => sum + result.confidence_score, 0);
    return totalScore / results.length;
  }
  
  /**
   * Extract critical issues from validation results
   */
  static extractCriticalIssues(results: ComplianceValidationResult[]): string[] {
    const criticalIssues: string[] = [];
    
    results.forEach(result => {
      if (result.confidence_score < 0.5 || result.reliability_level === 'low') {
        criticalIssues.push(...result.issues);
      }
    });
    
    // Remove duplicates
    return [...new Set(criticalIssues)];
  }
  
  /**
   * Validate that a confidence score is within valid range
   */
  static validateConfidenceScore(score: number): boolean {
    return score >= 0.0 && score <= 1.0;
  }
  
  /**
   * Convert ValidationDimension enum to human-readable string
   */
  static dimensionToString(dimension: ValidationDimension): string {
    const dimensionNames: Record<ValidationDimension, string> = {
      [ValidationDimension.FACTUAL_GROUNDING]: 'Factual Grounding',
      [ValidationDimension.KNOWLEDGE_BASE_ADHERENCE]: 'Knowledge Base Adherence',
      [ValidationDimension.COMPLIANCE_ACCURACY]: 'Compliance Accuracy',
      [ValidationDimension.ISSUE_CATEGORIZATION]: 'Issue Categorization',
      [ValidationDimension.RECOMMENDATION_VALIDITY]: 'Recommendation Validity',
      [ValidationDimension.HALLUCINATION_DETECTION]: 'Hallucination Detection'
    };
    
    return dimensionNames[dimension] || dimension;
  }
}