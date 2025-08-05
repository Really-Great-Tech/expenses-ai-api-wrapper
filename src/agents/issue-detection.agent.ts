import { Anthropic } from '@llamaindex/anthropic';
import { IssueDetectionResultSchema, type IssueDetectionResult } from '../schemas/expense-schemas';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BedrockLlmService } from '../utils/bedrockLlm';

export class IssueDetectionAgent {
  private readonly logger = new Logger(IssueDetectionAgent.name);
  private llm: any;
  private expenseSchema: any;
  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock') {
    this.logger.log(`Initializing IssueDetectionAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      this.llm = new BedrockLlmService();
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    }

    // Load expense schema
    this.loadExpenseSchema();
  }

  private loadExpenseSchema(): void {
    try {
      const schemaPath = path.join(process.cwd(), 'expense_file_schema.json');
      const schemaContent = fs.readFileSync(schemaPath, 'utf8');
      this.expenseSchema = JSON.parse(schemaContent);
      this.logger.log('Expense schema loaded successfully');
    } catch (error) {
      this.logger.error('Failed to load expense schema:', error);
      this.expenseSchema = null;
    }
  }

  async analyzeCompliance(
    country: string,
    receiptType: string,
    icp: string,
    complianceData: any,
    extractedData: any
  ): Promise<IssueDetectionResult> {
    try {
      this.logger.log(`Starting compliance analysis for ${country}/${icp}`);

      const prompt = this.buildCompliancePrompt(
        country,
        receiptType,
        icp,
        complianceData,
        extractedData
      );

      const response = await this.llm.chat({
        messages: [
          {
            role: 'system',
            content: `Persona: You are an expert compliance and tax analysis AI specializing in expense document validation. Your primary function is to analyze extracted receipt data against country-specific compliance requirements and ICP-specific rules to identify issues, violations, and recommendations.

Task: Perform comprehensive issue detection and analysis by cross-referencing extracted receipt data against the provided country database and ICP-specific requirements.

ANALYSIS WORKFLOW:
1. Load and understand the compliance requirements from the country database (receiptStandards, compliancePoliciesGrossUpRelated, compliancePoliciesAdditionalInfoRelated)
2. Analyze the extracted receipt data against these requirements
3. Identify specific compliance violations, tax implications, and documentation gaps
4. Categorize each issue according to the specified categories
5. Provide specific recommendations based on the knowledge base

ISSUE CATEGORIES:

CATEGORY 1: COMPLIANCE VIOLATIONS REQUIRING FIXES
Issue type: Standards & Compliance | Fix Identified
Flag issue type: Standards & Compliance related
Scope: Mandatory field violations, format errors, missing required information
Examples:
- "The VAT number has only 2 numbers, should have 9"
- "Missing mandatory supplier name on the receipt"
- "Invoice number is not clearly visible or missing"
- "Date of issue is not present on the receipt"
- "Required supplier address is missing or incomplete"

Recommendation: "It is recommended to address this issue with the supplier or provider". This should be the static recommendation for fix identified issue.


CATEGORY 2: TAX IMPLICATIONS AND GROSS-UP SCENARIOS
Issue type: Standards & Compliance | Gross-up Identified
Flag issue type: Standards & Compliance related
Scope: Expense limits, tax exemption violations, gross-up requirements
Examples:
- "Phone expenses in this country is limited to €20/month"
"Home office expenses exceed the maximum of €1,260/year"
"Wellness benefits exceed the maximum of €600/year"
"Meal expenses are not tax exempt and will be grossed up"
"Fuel expenses will be taxed as per country regulations"

Recommendation: State the specific gross-up guidelines for this type of expense based on the knowledge base (e.g., "Phone expenses are tax-free up to €20/month, amounts exceeding this limit will be grossed-up" or "Home office expenses are tax exempt up to €6/day, maximum €1,260/year, excess amounts will be taxed")


CATEGORY 3: ADDITIONAL DOCUMENTATION REQUIREMENTS
Issue type: Standards & Compliance | Follow-up Action Identified
Flag issue type: Standards & Compliance related
Scope: Missing supporting documentation, approval requirements, additional forms
Examples:
- "Expense is car rental related - additional documentation is required"
- "Mileage claim requires logbook with date, route, purpose, and odometer readings"
- "Training expenses require direct manager approval"
- "Flight expenses require A1 certificate when traveling"
- "Mobile phone expenses require proof of separate personal phone"

Recommendation examples:
- "Submission of car rental expense in this country requires, in addition the mileage breakdown from the car rental service, per day"
- "Please provide mileage logbook with complete route details and odometer readings"
- "Manager approval is required before processing this training expense"
- "Please provide A1 certificate for international travel documentation"
- "Please provide proof of separate personal phone for mobile phone reimbursement"
- "Please use the specific travel expense report template for this country"
- "Please provide map with route details (Google Maps sufficient) for mileage claims"


CRITICAL REQUIREMENTS:
- ONLY use knowledge from the provided country database and ICP-specific rules
- DO NOT make up any information not provided in the knowledge base
- Cross-reference ALL extracted data fields against receiptStandards, compliancePoliciesGrossUpRelated, and compliancePoliciesAdditionalInfoRelated
- Quote the knowledge base when providing issues and recommendations
- Ensure all analysis is based on the provided compliance standards and policies
- Be thorough and systematic in checking every applicable requirement
- Dynamically filter requirements based on ICP, expense type, and travel/non-travel classification
- Calculate confidence score based on clarity of violations and knowledge base coverage
- Ensure all fields are properly populated according to the structured output model

ISSUE TYPE FORMAT REQUIREMENTS:
- Use EXACT format: "Standards & Compliance | Fix Identified" for issues requiring fixes based on receipt standards
- Use EXACT format: "Standards & Compliance | Gross-up Identified" for tax gross-up issues
- Use EXACT format: "Standards & Compliance | Follow-up Action Identified" for follow-up actions

VALIDATION CHECKLIST:
□ Check all mandatory fields against receiptStandards requirements
□ Validate expense type against compliancePoliciesGrossUpRelated rules
□ Check ICP-specific requirements and rules
□ Verify tax exemption limits and gross-up scenarios from compliancePoliciesGrossUpRelated
□ Identify missing documentation requirements from compliancePoliciesAdditionalInfoRelated
□ Cross-reference location-specific compliance rules
□ Validate currency and amount formatting
□ Check storage and retention requirements

CRITICAL: You MUST return a JSON object with EXACTLY this structure and field names:
{
  "validation_result": {
    "is_valid": boolean,
    "issues_count": number,
    "issues": [
      {
        "issue_type": "Standards & Compliance | Fix Identified" | "Standards & Compliance | Gross-up Identified" | "Standards & Compliance | Follow-up Action Identified",
        "field": "field_name_where_issue_found",
        "description": "detailed_description_of_issue",
        "recommendation": "specific_action_to_resolve",
        "knowledge_base_reference": "quote_from_compliance_data"
      }
    ],
    "corrected_receipt": null,
    "compliance_summary": "overall_compliance_assessment_and_key_findings"
  },
  "technical_details": {
    "content_type": "expense_receipt",
    "country": "country_name",
    "icp": "icp_name",
    "receipt_type": "receipt_type",
    "issues_count": number
  }
}

Do NOT use any other field names. Do NOT add extra fields. Return ONLY the JSON object.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse the JSON response manually since structured output isn't working as expected
      let rawContent: string;

      // Parse the JSON response manually since structured output isn't working as expected
      if (typeof response.message.content === 'string') {
        rawContent = response.message.content;
      } else if (Array.isArray(response.message.content) && response.message.content.length > 0) {
        // Anthropic format: [{"type":"text","text":"actual JSON content"}]
        const firstItem = response.message.content[0];
        if (firstItem && firstItem.type === 'text' && firstItem.text) {
          rawContent = firstItem.text;
        } else {
          rawContent = JSON.stringify(response.message.content);
        }
      } else if (response.message.content && typeof response.message.content === 'object') {
        rawContent = JSON.stringify(response.message.content);
      } else {
        rawContent = String(response.message.content || '');
      }

      this.logger.debug(`Raw response type: ${typeof response.message.content}`);
      this.logger.debug(`Extracted content: ${rawContent.substring(0, 200)}...`);

      const parsedResult = this.parseJsonResponse(rawContent);
      const result = IssueDetectionResultSchema.parse(parsedResult);

      this.logger.log(`Compliance analysis completed: ${result.validation_result.issues_count} issues found`);

      return result;
    } catch (error) {
      this.logger.error('Compliance analysis failed:', error);

      // Return fallback result
      return {
        validation_result: {
          is_valid: false,
          issues_count: 1,
          issues: [
            {
              issue_type: 'Standards & Compliance | Fix Identified',
              field: 'system_error',
              description: `Compliance analysis failed: ${error.message}`,
              recommendation: 'Please retry the compliance analysis or contact support.',
              knowledge_base_reference: 'System error during analysis',
            },
          ],
          corrected_receipt: null,
          compliance_summary: 'Analysis failed due to system error',
        },
        technical_details: {
          content_type: 'expense_receipt',
          country: 'unknown',
          icp: 'unknown',
          receipt_type: 'unknown',
          issues_count: 1,
        },
      };
    }
  }

  private buildCompliancePrompt(
    country: string,
    receiptType: string,
    icp: string,
    complianceData: any,
    extractedData: any
  ): string {
    // Create expense taxonomy description from the loaded schema
    let expenseTaxonomyDescription = "";
    if (this.expenseSchema?.properties) {
      for (const [fieldName, fieldInfo] of Object.entries(this.expenseSchema.properties)) {
        const title = (fieldInfo as any)?.title || fieldName;
        const description = (fieldInfo as any)?.description || "";
        expenseTaxonomyDescription += `\n**${fieldName}** (${title}):\n${description}\n`;
      }
    } else {
      expenseTaxonomyDescription = "Expense schema not available";
    }

    return `COMPLIANCE ANALYSIS REQUEST:

COUNTRY: ${country}
RECEIPT TYPE: ${receiptType}
ICP: ${icp}

COMPLIANCE REQUIREMENTS (Country Database):
${JSON.stringify(complianceData, null, 2)}

EXTRACTED RECEIPT DATA:
${JSON.stringify(extractedData, null, 2)}

EXPENSE TAXONOMY (JSON):
${expenseTaxonomyDescription}

ANALYSIS INSTRUCTIONS:
Perform comprehensive compliance analysis by:
1. Cross-referencing each extracted field against the receiptStandards for the specified ICP and expense type
2. Checking expense type against compliancePoliciesGrossUpRelated rules and limits for tax implications
3. Identifying any missing mandatory fields or incorrect formats from receiptStandards
4. Detecting tax implications and gross-up scenarios from compliancePoliciesGrossUpRelated
5. Identifying additional documentation requirements from compliancePoliciesAdditionalInfoRelated
6. Providing specific recommendations based on the knowledge base

Analyze systematically and provide detailed findings in the specified format.`;
  }

  private parseJsonResponse(content: string): any {
    try {
      // Remove markdown code blocks if present
      const cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      return JSON.parse(cleanContent);
    } catch (error) {
      this.logger.error('Failed to parse JSON response:', error);
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }
}
