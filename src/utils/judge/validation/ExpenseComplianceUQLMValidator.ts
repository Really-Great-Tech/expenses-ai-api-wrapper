import { Logger } from '@nestjs/common';
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
  ValidationErrorType,
  IssueValidationScore
} from './types';

/**
 * ExpenseComplianceUQLMValidator - Main validation class for expense compliance validation
 * Uses multiple Bedrock LLM models to validate AI responses across different dimensions
 */
export class ExpenseComplianceUQLMValidator {
  private bedrockServices: BedrockLlmService[];
  private logger: Logger;
  private validationVersion: string = '1.0.0';

  constructor(logger?: Logger) {
    this.logger = logger || new Logger(ExpenseComplianceUQLMValidator.name);
    
    // Initialize multiple Bedrock services for judge panel with different temperatures
    const judgeConfigs = [
      {
        modelId: process.env.BEDROCK_JUDGE_MODEL_1 || 'eu.anthropic.claude-3-7-sonnet-20250219-v1:0',
        temperature: parseFloat(process.env.BEDROCK_JUDGE_MODEL_1_TEMPERATURE || '0.3')
      },
      {
        modelId: process.env.BEDROCK_JUDGE_MODEL_2 || 'eu.anthropic.claude-3-haiku-20240307-v1:0',
        temperature: parseFloat(process.env.BEDROCK_JUDGE_MODEL_2_TEMPERATURE || '0.7')
      },
      {
        modelId: process.env.BEDROCK_JUDGE_MODEL_3 || 'eu.anthropic.claude-3-5-sonnet-20240620-v1:0',
        temperature: parseFloat(process.env.BEDROCK_JUDGE_MODEL_3_TEMPERATURE || '0.5')
      }
    ];

    this.bedrockServices = judgeConfigs.map(config =>
      new BedrockLlmService({
        modelId: config.modelId,
        temperature: config.temperature
      })
    );
    
    this.logger.log('✅ ExpenseComplianceUQLMValidator initialized with 3 judge models and custom temperatures');
    judgeConfigs.forEach((config, index) => {
      this.logger.log(`   Judge ${index + 1}: ${config.modelId} (temp: ${config.temperature})`);
    });
  }

  /**
   * Main validation method - validates AI response across all dimensions
   */
  async validateComplianceResponse(
    aiResponse: string,
    country: string,
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any
  ): Promise<ValidationSummary> {
    const startTime = Date.now();
    const startTimeISO = new Date(startTime).toISOString();
    this.logger.log(`🔍 Starting compliance validation for ${country} ${receiptType}`);

    try {
      // Parse AI response if it's a JSON string
      let parsedResponse: any;
      try {
        parsedResponse = typeof aiResponse === 'string' ? JSON.parse(aiResponse) : aiResponse;
      } catch {
        parsedResponse = { raw_response: aiResponse };
      }

      // Extract issues from AI response for issue-level evaluation
      const extractedIssues = this._extractIssuesFromAIResponse(parsedResponse);

      // Validate all dimensions
      const dimensions = Object.values(ValidationDimension);
      const validationResults: ComplianceValidationResult[] = [];
      const dimensionTimings: Record<string, any> = {};

      for (const dimension of dimensions) {
        const dimensionStartTime = Date.now();
        const dimensionStartTimeISO = new Date(dimensionStartTime).toISOString();
        
        try {
          this.logger.log(`📊 Validating dimension: ${ValidationUtils.dimensionToString(dimension)}`);
          
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

          const result = await this._validateDimensionWithPanel(validationPrompt, dimension, extractedIssues);
          validationResults.push(result);
          
          const dimensionEndTime = Date.now();
          const dimensionEndTimeISO = new Date(dimensionEndTime).toISOString();
          const dimensionDuration = ((dimensionEndTime - dimensionStartTime) / 1000).toFixed(1);
          
          dimensionTimings[dimension] = {
            start_time: dimensionStartTimeISO,
            end_time: dimensionEndTimeISO,
            duration_seconds: dimensionDuration,
            judge_models_used: this.bedrockServices.map(service => service.getCurrentModelName())
          };
          
        } catch (error) {
          this.logger.error(`❌ Error validating ${dimension}: ${error.message}`);
          validationResults.push(this._createErrorResult(dimension, error.message));
          
          const dimensionEndTime = Date.now();
          const dimensionEndTimeISO = new Date(dimensionEndTime).toISOString();
          const dimensionDuration = ((dimensionEndTime - dimensionStartTime) / 1000).toFixed(1);
          
          dimensionTimings[dimension] = {
            start_time: dimensionStartTimeISO,
            end_time: dimensionEndTimeISO,
            duration_seconds: dimensionDuration,
            judge_models_used: this.bedrockServices.map(service => service.getCurrentModelName())
          };
        }
      }

      // Calculate overall assessment with timing information
      const endTime = Date.now();
      const endTimeISO = new Date(endTime).toISOString();
      const totalDuration = ((endTime - startTime) / 1000).toFixed(1);
      
      const overallAssessment = this._calculateOverallAssessment(
        validationResults,
        startTime,
        endTime,
        startTimeISO,
        endTimeISO,
        totalDuration,
        dimensionTimings
      );
      
      const processingTime = endTime - startTime;
      this.logger.log(`✅ Validation completed in ${processingTime}ms`);

      return overallAssessment;

    } catch (error) {
      this.logger.error(`❌ Validation failed: ${error.message}`);
      throw new ValidationError(
        ValidationErrorType.VALIDATION_TIMEOUT,
        `Validation process failed: ${error.message}`,
        undefined,
        error
      );
    }
  }

  /**
   * Create validation prompt for specific dimension
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
    // Extract issues from the AI response for issue-level evaluation
    const extractedIssues = this._extractIssuesFromAIResponse(parsedResponse);
    
    const baseContext = `
Country: ${country}
Receipt Type: ${receiptType}
AI Response: ${aiResponse}

Extracted Data: ${JSON.stringify(extractedJson, null, 2)}
Compliance Rules: ${JSON.stringify(complianceJson, null, 2)}
ICP Context: ${JSON.stringify(icp, null, 2)}

ISSUES IDENTIFIED IN AI RESPONSE:
${extractedIssues.map((issue, index) => `${index + 1}. [${issue.issue_type}] ${issue.description}`).join('\n')}
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

For each issue identified above, evaluate its factual grounding validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of how this issue affects factual grounding validation]`).join('\n')}

Overall confidence (0-100) that the response is factually grounded: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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

For each issue identified above, evaluate its knowledge base adherence validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of how this issue affects knowledge base adherence validation]`).join('\n')}

Overall confidence (0-100) that the response adheres to the knowledge base: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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

For each issue identified above, evaluate its compliance accuracy validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of how accurately this issue was identified and categorized]`).join('\n')}

Overall confidence (0-100) that the compliance assessment is accurate: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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

For each issue identified above, evaluate its categorization accuracy validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of how well this issue is categorized and described]`).join('\n')}

Overall confidence (0-100) that issues are correctly categorized: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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

For each issue identified above, evaluate its recommendation validity validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of how valid and helpful the recommendations are for this issue]`).join('\n')}

Overall confidence (0-100) that recommendations are valid: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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

For each issue identified above, evaluate its hallucination detection validation score (0-100):
${extractedIssues.map((issue, index) => `Issue ${index + 1} validation_score: [0-100] - [explanation of whether this issue contains hallucinated information]`).join('\n')}

Overall confidence (0-100) that the response is free from hallucinations: [0-100]

Response format:
${extractedIssues.map((_, index) => `ISSUE_${index + 1}_VALIDATION_SCORE: [0-100] - [explanation]`).join('\n')}
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
   * Extract issues from AI response for issue-level evaluation
   */
  private _extractIssuesFromAIResponse(parsedResponse: any): Array<{issue_type: string, description: string}> {
    try {
      // Try to extract issues from the parsed response
      if (parsedResponse?.validation_result?.issues && Array.isArray(parsedResponse.validation_result.issues)) {
        return parsedResponse.validation_result.issues.map((issue: any, index: number) => ({
          issue_type: issue.issue_type || `Issue ${index + 1}`,
          description: issue.description || issue.toString()
        }));
      }
      
      // Fallback: if no structured issues found, return a generic placeholder
      return [{
        issue_type: 'General Validation',
        description: 'Overall AI response validation'
      }];
    } catch (error) {
      // Fallback for any parsing errors
      return [{
        issue_type: 'General Validation',
        description: 'Overall AI response validation'
      }];
    }
  }

  /**
   * Extract issue validation scores from judge response text
   */
  private _extractIssueValidationScores(text: string, dimension: ValidationDimension, extractedIssues: Array<{issue_type: string, description: string}>): IssueValidationScore[] {
    const validationScores: IssueValidationScore[] = [];
    
    try {
      // Look for ISSUE_X_VALIDATION_SCORE patterns
      extractedIssues.forEach((issue, index) => {
        const issuePattern = new RegExp(`ISSUE_${index + 1}_VALIDATION_SCORE:\\s*(\\d+)\\s*-\\s*(.+?)(?=\\n|ISSUE_|CONFIDENCE:|$)`, 'is');
        const match = text.match(issuePattern);
        
        if (match) {
          const score = parseInt(match[1]);
          const explanation = match[2].trim();
          
          if (score >= 0 && score <= 100) {
            validationScores.push({
              issue_index: index,
              issue_description: issue.description,
              issue_type: issue.issue_type,
              validation_score: score,
              judge_explanation: explanation,
              dimension: dimension
            });
          }
        } else {
          // Fallback: assign a neutral score if no specific validation score found
          validationScores.push({
            issue_index: index,
            issue_description: issue.description,
            issue_type: issue.issue_type,
            validation_score: 50, // Neutral score
            judge_explanation: 'No specific validation score assessment provided',
            dimension: dimension
          });
        }
      });
    } catch (error) {
      this.logger.warn(`Failed to extract issue validation scores for ${dimension}: ${error.message}`);
      
      // Fallback: create neutral validation scores for all issues
      extractedIssues.forEach((issue, index) => {
        validationScores.push({
          issue_index: index,
          issue_description: issue.description,
          issue_type: issue.issue_type,
          validation_score: 50,
          judge_explanation: 'Validation score parsing failed',
          dimension: dimension
        });
      });
    }
    
    return validationScores;
  }

  /**
   * Validate dimension using multiple Bedrock models as judges
   */
  private async _validateDimensionWithPanel(
    validationPrompt: string,
    dimension: ValidationDimension,
    extractedIssues?: Array<{issue_type: string, description: string}>
  ): Promise<ComplianceValidationResult> {
    try {
      const judgeResponses: string[] = [];
      const confidenceScores: number[] = [];
      const judgeDetails: { model_name: string; confidence_score: number; response: string; }[] = [];

      // Get responses from all judge models
      for (let i = 0; i < this.bedrockServices.length; i++) {
        const modelName = this.bedrockServices[i].getCurrentModelName();
        
        try {
          const response = await this.bedrockServices[i].chat({
            messages: [{ role: 'user', content: validationPrompt }]
          });
          
          const responseText = response.message.content;
          judgeResponses.push(responseText);
          
          const confidence = this._extractConfidenceScore(responseText);
          confidenceScores.push(confidence);
          
          judgeDetails.push({
            model_name: modelName,
            confidence_score: confidence,
            response: responseText
          });
          
        } catch (error) {
          this.logger.warn(`⚠️ Judge ${i + 1} (${modelName}) failed for ${dimension}: ${error.message}`);
          const errorResponse = `Error: ${error.message}`;
          judgeResponses.push(errorResponse);
          confidenceScores.push(0.0);
          
          judgeDetails.push({
            model_name: modelName,
            confidence_score: 0.0,
            response: errorResponse
          });
        }
      }

      // Use the first successful response as primary
      const primaryResponse = judgeResponses.find(r => !r.startsWith('Error:')) || judgeResponses[0];
      
      // Calculate average confidence score
      const avgConfidence = confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
      
      // Extract issues and summary from primary response
      const issues = this._extractIssuesFromText(primaryResponse);
      const summary = this._extractSummaryFromText(primaryResponse);
      
      // Extract issue validation scores if extractedIssues provided
      let issueValidationScores: IssueValidationScore[] | undefined;
      if (extractedIssues && extractedIssues.length > 0) {
        issueValidationScores = this._extractIssueValidationScores(primaryResponse, dimension, extractedIssues);
      }
      
      // Determine reliability based on consensus
      const reliability = this._determineReliabilityFromScores(confidenceScores);

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
        judgeDetails,
        issueValidationScores
      );

    } catch (error) {
      this.logger.error(`❌ Panel validation failed for ${dimension}: ${error.message}`);
      return this._createErrorResult(dimension, error.message);
    }
  }

  /**
   * Extract confidence score from LLM response text
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
   * Extract issues from response text
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
   * Extract summary from response text
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
   * Determine reliability level based on confidence scores from multiple judges
   */
  private _determineReliabilityFromScores(scores: number[]): ReliabilityLevel {
    if (scores.length === 0) return 'low';
    
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const variance = this._calculateVariance(scores);
    
    // High reliability: high average score and low variance
    if (avgScore >= 0.8 && variance <= 0.04) return 'high'; // variance of 0.2^2
    
    // Low reliability: low average score or high variance
    if (avgScore <= 0.3 || variance >= 0.25) return 'low'; // variance of 0.5^2
    
    // Medium reliability: everything else
    return 'medium';
  }

  /**
   * Calculate variance of confidence scores
   */
  private _calculateVariance(scores: number[]): number {
    if (scores.length <= 1) return 0;
    
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const squaredDiffs = scores.map(score => Math.pow(score - mean, 2));
    return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / scores.length;
  }

  /**
   * Calculate overall assessment from dimensional results
   */
  private _calculateOverallAssessment(
    validationResults: ComplianceValidationResult[],
    startTime: number,
    endTime: number,
    startTimeISO: string,
    endTimeISO: string,
    totalDuration: string,
    dimensionTimings: Record<string, any>
  ): ValidationSummary {
    const overallScore = ValidationUtils.calculateOverallScore(validationResults);
    const overallReliability = ValidationUtils.calculateOverallReliability(validationResults);
    const criticalIssues = ValidationUtils.extractCriticalIssues(validationResults);
    
    // Generate recommendations based on results
    const recommendations = this._generateRecommendations(validationResults);

    // Generate aggregated issue scores
    const issueValidationScores = ValidationUtils.aggregateIssueScores(validationResults, 'weighted');

    // Get all judge model names
    const judgeModels = this.bedrockServices.map(service => service.getCurrentModelName());

    const metadata: ValidationMetadata = {
      validation_version: this.validationVersion,
      judge_models: judgeModels,
      judge_model: judgeModels[0] || 'unknown', // Primary judge for backward compatibility
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
        issue_level_scoring_enabled: issueValidationScores.length > 0,
        aggregated_issues_count: issueValidationScores.length
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
      metadata,
      issue_validation_scores: issueValidationScores.length > 0 ? issueValidationScores : undefined
    };
  }

  /**
   * Generate recommendations based on validation results
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
   * Create error result for failed validation
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

}