/**
 * Validation module for expense compliance validation
 *
 * This module provides TypeScript validation enums and interfaces that replicate
 * the Python UQLM validation functionality for expense compliance validation.
 *
 * @module validation
 */

// Import all validation types and enums first
import {
  ValidationDimension,
  type ReliabilityLevel,
  type ComplianceValidationResult,
  type ComplianceValidationResultDict,
  ComplianceValidationResultImpl,
  type ValidationSummary,
  type ValidationMetadata,
  type ValidationUQResult,
  type ValidationJudgeResponse,
  type ValidationConfig,
  ValidationErrorType,
  ValidationError,
  ValidationUtils
} from './types';

// Import the main validator class
import { ExpenseComplianceUQLMValidator } from './ExpenseComplianceUQLMValidator';

// Export all validation types and enums
export {
  ValidationDimension,
  type ReliabilityLevel,
  type ComplianceValidationResult,
  type ComplianceValidationResultDict,
  ComplianceValidationResultImpl,
  type ValidationSummary,
  type ValidationMetadata,
  type ValidationUQResult,
  type ValidationJudgeResponse,
  type ValidationConfig,
  ValidationErrorType,
  ValidationError,
  ValidationUtils
} from './types';

// Export the main validator class
export { ExpenseComplianceUQLMValidator };

// Re-export relevant types from the main judge types for convenience
export type {
  UQResult,
  JudgeResponse,
  ScoringTemplate,
  EnsembleConfig,
  TuningResult,
  GraderFunction,
  ScorerComponent,
  ProgressCallback
} from '../types';

/**
 * Default validation configuration
 */
export const DEFAULT_VALIDATION_CONFIG: ValidationConfig = {
  dimensions: [
    ValidationDimension.FACTUAL_GROUNDING,
    ValidationDimension.KNOWLEDGE_BASE_ADHERENCE,
    ValidationDimension.COMPLIANCE_ACCURACY,
    ValidationDimension.ISSUE_CATEGORIZATION,
    ValidationDimension.RECOMMENDATION_VALIDITY,
    ValidationDimension.HALLUCINATION_DETECTION
  ],
  min_confidence_threshold: 0.7,
  max_retries: 3,
  timeout_ms: 30000,
  include_detailed_analysis: true
};

/**
 * Validation dimension priorities for expense compliance
 * Higher numbers indicate higher priority
 */
export const VALIDATION_DIMENSION_PRIORITIES: Record<ValidationDimension, number> = {
  [ValidationDimension.COMPLIANCE_ACCURACY]: 10,
  [ValidationDimension.FACTUAL_GROUNDING]: 9,
  [ValidationDimension.HALLUCINATION_DETECTION]: 8,
  [ValidationDimension.KNOWLEDGE_BASE_ADHERENCE]: 7,
  [ValidationDimension.ISSUE_CATEGORIZATION]: 6,
  [ValidationDimension.RECOMMENDATION_VALIDITY]: 5
};

/**
 * Default validation prompts for each dimension
 */
export const DEFAULT_VALIDATION_PROMPTS: Record<ValidationDimension, string> = {
  [ValidationDimension.FACTUAL_GROUNDING]: `
    Evaluate the factual accuracy of the expense analysis. Check if:
    - All stated facts are verifiable and correct
    - No false information is presented
    - Claims are supported by evidence
    Rate the factual grounding on a scale of 0.0 to 1.0.
  `,
  
  [ValidationDimension.KNOWLEDGE_BASE_ADHERENCE]: `
    Assess how well the analysis adheres to established expense compliance knowledge:
    - Follows standard expense policies and procedures
    - Uses correct terminology and classifications
    - Applies relevant regulations and guidelines
    Rate the knowledge base adherence on a scale of 0.0 to 1.0.
  `,
  
  [ValidationDimension.COMPLIANCE_ACCURACY]: `
    Evaluate the accuracy of compliance determinations:
    - Correct identification of compliant vs non-compliant expenses
    - Proper application of compliance rules
    - Accurate assessment of policy violations
    Rate the compliance accuracy on a scale of 0.0 to 1.0.
  `,
  
  [ValidationDimension.ISSUE_CATEGORIZATION]: `
    Assess the quality of issue identification and categorization:
    - Issues are correctly identified and classified
    - Severity levels are appropriately assigned
    - Categories align with standard expense issue types
    Rate the issue categorization on a scale of 0.0 to 1.0.
  `,
  
  [ValidationDimension.RECOMMENDATION_VALIDITY]: `
    Evaluate the validity and usefulness of recommendations:
    - Recommendations are actionable and specific
    - Solutions address identified issues appropriately
    - Suggestions are practical and implementable
    Rate the recommendation validity on a scale of 0.0 to 1.0.
  `,
  
  [ValidationDimension.HALLUCINATION_DETECTION]: `
    Check for hallucinations or fabricated information:
    - No invented facts or data points
    - All references and citations are real
    - No made-up policies or procedures mentioned
    Rate the absence of hallucinations on a scale of 0.0 to 1.0.
  `
};

/**
 * Helper function to create a new ComplianceValidationResult
 */
export function createValidationResult(
  dimension: ValidationDimension,
  confidence_score: number,
  issues: string[],
  summary: string,
  raw_response: string,
  reliability_level: ReliabilityLevel
): ComplianceValidationResult {
  return new ComplianceValidationResultImpl(
    dimension,
    confidence_score,
    issues,
    summary,
    raw_response,
    reliability_level
  );
}

/**
 * Helper function to create a ValidationSummary
 */
export function createValidationSummary(
  dimension_results: ComplianceValidationResult[],
  metadata: ValidationMetadata,
  recommendations: string[] = []
): ValidationSummary {
  const overall_score = ValidationUtils.calculateOverallScore(dimension_results);
  const overall_reliability = ValidationUtils.calculateOverallReliability(dimension_results);
  const critical_issues = ValidationUtils.extractCriticalIssues(dimension_results);
  
  return {
    overall_score,
    dimensions_count: dimension_results.length,
    dimension_results,
    overall_reliability,
    critical_issues,
    recommendations,
    timestamp: new Date(),
    metadata
  };
}

/**
 * Helper function to determine reliability level based on confidence score
 */
export function getReliabilityFromConfidence(confidence: number): ReliabilityLevel {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

/**
 * Helper function to validate a ValidationConfig
 */
export function validateConfig(config: ValidationConfig): boolean {
  // Check if dimensions array is not empty
  if (!config.dimensions || config.dimensions.length === 0) {
    return false;
  }
  
  // Check confidence threshold is valid
  if (config.min_confidence_threshold !== undefined) {
    if (!ValidationUtils.validateConfidenceScore(config.min_confidence_threshold)) {
      return false;
    }
  }
  
  // Check timeout is positive
  if (config.timeout_ms !== undefined && config.timeout_ms <= 0) {
    return false;
  }
  
  // Check max retries is non-negative
  if (config.max_retries !== undefined && config.max_retries < 0) {
    return false;
  }
  
  return true;
}

/**
 * Helper function to merge validation configs
 */
export function mergeValidationConfigs(
  base: ValidationConfig,
  override: Partial<ValidationConfig>
): ValidationConfig {
  return {
    ...base,
    ...override,
    dimensions: override.dimensions || base.dimensions,
    custom_prompts: {
      ...base.custom_prompts,
      ...override.custom_prompts
    }
  };
}