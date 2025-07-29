import { OpenAI } from '@llamaindex/openai';
import { Anthropic } from '@llamaindex/anthropic';
import { IssueDetectionResultSchema, type IssueDetectionResult } from '../schemas/expense-schemas';
import { Logger } from '@nestjs/common';

export class IssueDetectionAgent {
  private readonly logger = new Logger(IssueDetectionAgent.name);
  private llm: any;

  constructor(provider: 'openai' | 'anthropic' = 'anthropic') {
    if (provider === 'anthropic') {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    } else {
      this.llm = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o',
      });
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
1. Load and understand the compliance requirements from the country database
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
- VAT number format violations (incorrect digit count, format)
- Missing mandatory supplier information (name, address, VAT ID)
- Missing invoice/receipt identifiers or serial numbers
- Date format issues or missing transaction dates
- Currency mismatches with local requirements
- Missing tax information for high-value invoices
- Poor receipt quality affecting readability
- Missing worker details for specific invoice types
- Incomplete supplier tax identification
Recommendation: "It is recommended to address this issue with the supplier or provider"

CATEGORY 2: TAX IMPLICATIONS AND GROSS-UP SCENARIOS
Issue type: Standards & Compliance | Gross-up Identified
Flag issue type: Standards & Compliance related
Scope: Expense limits, tax exemption violations, gross-up requirements
Examples:
- Expenses exceeding tax-free limits (phone €20/month, home office €1,260/year, wellness €600/year)
- Non-tax-exempt expenses (personal meals, office groceries, entertainment without third party)
- Transportation to workplace expenses
- Internet expenses exceeding flat rate allowances
- Mobile phone expenses without personal phone proof
- Fuel and vehicle expenses subject to taxation
Recommendation: State specific gross-up guidelines from knowledge base with exact limits and tax implications

CATEGORY 3: ADDITIONAL DOCUMENTATION REQUIREMENTS
Issue type: Standards & Compliance | Follow-up Action Identified
Flag issue type: Standards & Compliance related
Scope: Missing supporting documentation, approval requirements, additional forms
Examples:
- Mileage claims requiring detailed logbooks
- Training expenses requiring manager approval
- Travel expenses requiring A1 certificates or travel templates
- Car rental requiring additional mileage documentation
- Entertainment requiring third party proof
- IT equipment requiring property documentation
- International travel requiring per diem calculations
- Storage period compliance for original documents
Recommendation: Specify exact documentation requirements and procedures from knowledge base

CRITICAL REQUIREMENTS:
- ONLY use knowledge from the provided country database and ICP-specific rules
- DO NOT make up any information not provided in the knowledge base
- Cross-reference ALL extracted data fields against specific country and ICP requirements
- Quote the knowledge base when providing issues and recommendations
- Ensure all analysis is based on the provided compliance standards and policies
- Be thorough and systematic in checking every applicable requirement
- Dynamically filter requirements based on ICP, receipt type, and expense category
- Calculate confidence score based on clarity of violations and knowledge base coverage
- Your output MUST BE ONLY a valid JSON object matching the specified structure

OUTPUT FORMAT:
Return a JSON object with the following structure:

{
  "validation_result": {
    "is_valid": true/false,
    "issues_count": number,
    "issues": [
      {
        "issue_type": "Standards & Compliance | Fix Identified/Gross-up Identified/Follow-up Action Identified",
        "field": "specific_field_name",
        "description": "Detailed description of the issue based on knowledge base",
        "recommendation": "Specific action to resolve based on compliance requirements",
        "knowledge_base_reference": "Quote from the compliance data that supports this finding"
      }
    ],
    "corrected_receipt": null,
    "compliance_summary": "Overall compliance assessment and key findings"
  },
  "technical_details": {
    "content_type": "ReceiptValidationResult",
    "country": "analyzed_country",
    "icp": "analyzed_icp",
    "receipt_type": "analyzed_receipt_type",
    "issues_count": number_of_issues,
    "has_reasoning": true
  }
}

VALIDATION CHECKLIST:
□ Check all mandatory fields against FileRelatedRequirements
□ Validate expense type against ExpenseTypes rules
□ Check ICP-specific requirements and rules
□ Verify tax exemption limits and gross-up scenarios
□ Identify missing documentation requirements
□ Cross-reference location-specific compliance rules
□ Validate currency and amount formatting
□ Check storage and retention requirements`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse the JSON response manually since structured output isn't working as expected
      let rawContent: string;
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
          content_type: 'ReceiptValidationResult',
          country: 'unknown',
          icp: 'unknown',
          receipt_type: 'unknown',
          issues_count: 1,
          has_reasoning: true,
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
    return `COMPLIANCE ANALYSIS REQUEST:

COUNTRY: ${country}
RECEIPT TYPE: ${receiptType}
ICP: ${icp}

COMPLIANCE REQUIREMENTS (Country Database):
${JSON.stringify(complianceData, null, 2)}

EXTRACTED RECEIPT DATA:
${JSON.stringify(extractedData, null, 2)}

ANALYSIS INSTRUCTIONS:
Perform comprehensive compliance analysis by:
1. Cross-referencing each extracted field against the FileRelatedRequirements for the specified ICP and receipt type
2. Checking expense type against ExpenseTypes rules and limits
3. Identifying any missing mandatory fields or incorrect formats
4. Detecting tax implications and gross-up scenarios
5. Identifying additional documentation requirements
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