# LLM-as-Judge Validation

## Overview

The LLM-as-Judge validation system validates AI-generated compliance analysis responses using multiple LLM models as independent judges. It evaluates compliance responses across 6 dimensions to ensure accuracy and reliability.

## Components

- **ExpenseComplianceUQLMValidator** - Main validator class
- **3 Judge Panel** - Uses 3 different LLM models for consensus
- **6 Validation Dimensions** - Specific aspects of compliance analysis
- **Integrated Pipeline** - Runs as Phase 5 in expense processing

## Validation Dimensions

1. **Factual Grounding** - Ensures claims are traceable to source data
2. **Knowledge Base Adherence** - Validates correct application of compliance rules  
3. **Compliance Accuracy** - Verifies correctness of compliance determinations
4. **Issue Categorization** - Ensures proper classification of identified issues
5. **Recommendation Validity** - Validates usefulness of recommendations
6. **Hallucination Detection** - Identifies fabricated information

## Usage

### Automatic Integration

Validation runs automatically as Phase 5 in expense processing:

```typescript
const result = await expenseProcessingService.processExpenseDocument(
  markdownContent, filename, imagePath, country, icp, 
  complianceData, expenseSchema
);
```

### Standalone Validation

```typescript
const validationResult = await expenseProcessingService.validateComplianceResults(
  complianceResult, country, receiptType, icp, complianceData, extractedData, filename
);
```

## Configuration

Set judge models via environment variables:

```bash
BEDROCK_JUDGE_MODEL_1=eu.anthropic.claude-3-7-sonnet-20250219-v1:0
BEDROCK_JUDGE_MODEL_2=eu.anthropic.claude-3-haiku-20240307-v1:0
BEDROCK_JUDGE_MODEL_3=eu.anthropic.claude-3-5-sonnet-20240620-v1:0
```

## Output

### Validation Summary
```typescript
interface ValidationSummary {
  overall_score: number;           // 0.0 to 1.0
  dimensions_count: number;        // Always 6
  dimension_results: ComplianceValidationResult[];
  overall_reliability: 'high' | 'medium' | 'low';
  critical_issues: string[];
  recommendations: string[];
  metadata: ValidationMetadata;
}
```

### Dimension Results
```typescript
interface ComplianceValidationResult {
  dimension: ValidationDimension;
  confidence_score: number;        // 0.0 to 1.0
  issues: string[];
  summary: string;
  reliability_level: 'high' | 'medium' | 'low';
  judge_models: string[];          // Actual models used
}
```

## Result Storage

- **Main Results**: Only timing metadata included in main processing results
- **Detailed Results**: Complete validation stored in `validation_results/` folder
- **Langfuse Traces**: Full validation results included in observability traces

## Files

```
src/utils/judge/validation/
├── ExpenseComplianceUQLMValidator.ts  # Main validator
├── types.ts                          # TypeScript interfaces  
├── index.ts                          # Exports
└── README.md                         # This file

validation_results/                    # Detailed results
└── filename_validation_timestamp.json
```

## API

### ExpenseComplianceUQLMValidator
```typescript
class ExpenseComplianceUQLMValidator {
  constructor(logger?: Logger);
  
  async validateComplianceResponse(
    aiResponse: string,
    country: string, 
    receiptType: string,
    icp: any,
    complianceJson: any,
    extractedJson: any
  ): Promise<ValidationSummary>;
}
```

### Validation Enums
```typescript
enum ValidationDimension {
  FACTUAL_GROUNDING = 'factual_grounding',
  KNOWLEDGE_BASE_ADHERENCE = 'knowledge_base_adherence', 
  COMPLIANCE_ACCURACY = 'compliance_accuracy',
  ISSUE_CATEGORIZATION = 'issue_categorization',
  RECOMMENDATION_VALIDITY = 'recommendation_validity',
  HALLUCINATION_DETECTION = 'hallucination_detection'
}