import { Anthropic } from '@llamaindex/anthropic';
import { IssueDetectionResultSchema, type IssueDetectionResult } from '../schemas/expense-schemas';
import { LangfuseService } from '../services/langfuse.service';
import { LangSmithService } from '../services/langsmith.service';
import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';
import * as fs from 'fs';
import * as path from 'path';
import { BedrockLlmService } from '../utils/bedrockLlm';
import { BaseAgent } from './base.agent';

// Issue Detection JSON Schema for LangSmith prompt template
const ISSUE_DETECTION_SCHEMA = {
  "validation_result": {
    "is_valid": true,
    "issues_count": 2,
    "issues": [
      {
        "issue_type": "Standards & Compliance | Fix Identified",
        "field": "tax_amount",
        "description": "Tax amount appears to be calculated incorrectly based on the total and tax rate",
        "recommendation": "Verify tax calculation and update if necessary",
        "knowledge_base_reference": "Tax calculations must comply with local tax regulations"
      },
      {
        "issue_type": "Standards & Compliance | Follow-up Action Identified",
        "field": "receipt_date",
        "description": "Receipt date is more than 30 days old",
        "recommendation": "Submit expense report within company policy timeframe",
        "knowledge_base_reference": "Expenses must be submitted within 30 days of incurrence"
      }
    ],
    "corrected_receipt": null,
    "compliance_summary": "Receipt contains minor compliance issues that require attention but does not prevent processing"
  },
  "technical_details": {
    "content_type": "expense_receipt",
    "country": "United States",
    "icp": "North America",
    "receipt_type": "retail_purchase",
    "issues_count": 2
  }
};

export class IssueDetectionAgent extends BaseAgent {
  private llm: any;
  private expenseSchema: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock', langfuseService?: LangfuseService, langsmithService?: LangSmithService) {
    super(langfuseService, langsmithService);
    this.currentProvider = provider;
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

  /**
   * Get the actual model name used, accounting for fallback scenarios
   */
  getActualModelUsed(): string {
    if (this.currentProvider === 'bedrock' && this.llm.getCurrentModelName) {
      // For BedrockLlmService, get the actual model name (handles fallback)
      return this.llm.getCurrentModelName();
    } else if (this.currentProvider === 'bedrock') {
      // Fallback for older BedrockLlmService without getCurrentModelName
      return process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0';
    } else {
      // Direct Anthropic usage
      return 'claude-3-5-sonnet-20241022';
    }
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
    extractedData: any,
    parentTrace?: LangfuseTraceClient,
    langsmithParentTrace?: any
  ): Promise<IssueDetectionResult> {
    const startTime = new Date();
    let trace: LangfuseTraceClient | null = null;
    let generation: LangfuseGenerationClient | null = null;
    let langsmithGeneration: any = null;

    try {
      this.logger.log(`Starting compliance analysis for ${country}/${icp}`);



      // Create Langfuse trace with exact prompt inputs
      const traceInput = {
        expenseTaxonomyDescription: JSON.stringify(this.expenseSchema?.properties || {}, null, 2),
        country,
        receiptType,
        icp,
        complianceDataJson: JSON.stringify(complianceData, null, 2),
        extractedDataJson: JSON.stringify(extractedData, null, 2)
      };

      if (parentTrace) {
        // Create as a span within parent trace (DISABLED - hard switch to LangSmith)
        generation = null; // Disabled Langfuse generation creation
        // generation = this.langfuseService?.createGeneration(parentTrace, {
        //   name: 'issue-detection',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'IssueDetectionAgent',
        //     provider: this.currentProvider,
        //     country,
        //     icp,
        //     receiptType,
        //   },
        // }) || null;

        // Create parallel LangSmith generation with prompt metadata
        if (langsmithParentTrace) {
          langsmithGeneration = await this.langsmithService?.createGeneration(langsmithParentTrace, {
            name: 'issue-detection',
            input: traceInput,
            model: this.getActualModelUsed(),
            startTime,
            promptName: 'issue-detection-prompt',
            promptCommitHash: this.lastPromptInfo?.config?.commitHash,
            metadata: {
              agent: 'IssueDetectionAgent',
              provider: this.currentProvider,
              country,
              icp,
              receiptType,
            },
          }) || null;
        }
      } else {
        // Create standalone trace (DISABLED - hard switch to LangSmith)
        trace = null; // Disabled Langfuse trace creation
        generation = null; // Disabled Langfuse generation creation
        // trace = this.langfuseService?.createTrace({
        //   name: 'issue-detection',
        //   input: traceInput,
        //   metadata: {
        //     agent: 'IssueDetectionAgent',
        //     provider: this.currentProvider,
        //     country,
        //     icp,
        //     receiptType,
        //   },
        //   tags: ['issue-detection', 'compliance-analysis', 'expense-processing'],
        // }) || null;

        // // Create generation within trace
        // generation = this.langfuseService?.createGeneration(trace, {
        //   name: 'compliance-analysis-llm-call',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'IssueDetectionAgent',
        //     provider: this.currentProvider,
        //   },
        // }) || null;
      }

      // Get prompt first to have version info
      const combinedPrompt = await this.getPromptTemplate('issue-detection-prompt', {
        expenseTaxonomyDescription: JSON.stringify(this.expenseSchema?.properties || {}, null, 2),
        country,
        receiptType,
        icp,
        complianceData: JSON.stringify(complianceData, null, 2),
        extractedData: JSON.stringify(extractedData, null, 2),
        jsonSchema: JSON.stringify(ISSUE_DETECTION_SCHEMA, null, 2)
      });
      const promptInfo = { ...this.lastPromptInfo! };

      // Generate prompt version tags (now just one prompt)
      const promptVersionTags = this.getPromptVersionTags();

      const response = await this.llm.chat({
        messages: [
          {
            role: 'user',
            content: combinedPrompt,
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

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update Langfuse generation with results
      this.langfuseService?.updateGeneration(generation, {
        output: result,
        usage: {
          // Rough estimate: 4 chars per token
          promptTokens: Math.floor(combinedPrompt.length / 4),
          completionTokens: Math.floor(rawContent.length / 4),
          totalTokens: Math.floor((combinedPrompt.length + rawContent.length) / 4),
        },
        endTime,
        metadata: {
          duration_seconds: (duration / 1000).toFixed(1),
          success: true,
          issuesCount: result.validation_result.issues_count,
          isValid: result.validation_result.is_valid,
          country,
          icp,
          modelUsed: this.getActualModelUsed(),
          provider: this.currentProvider,
          // Include prompt metadata
          prompt: {
            promptName: promptInfo.name,
            promptVersion: promptInfo.version || 'unknown',
            promptConfig: promptInfo.config || {}
          },
        },
      });

      // Update parallel LangSmith generation with results
      if (langsmithGeneration) {
        await this.langsmithService?.updateGeneration(langsmithGeneration, {
          output: result,
          usage: {
            promptTokens: Math.floor(combinedPrompt.length / 4),
            completionTokens: Math.floor(rawContent.length / 4),
            totalTokens: Math.floor((combinedPrompt.length + rawContent.length) / 4),
          },
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: true,
            issuesCount: result.validation_result.issues_count,
            isValid: result.validation_result.is_valid,
            country,
            icp,
            modelUsed: this.getActualModelUsed(),
            provider: this.currentProvider,
          },
        });
      }

      // Finalize trace if it's a standalone trace
      if (trace && !parentTrace) {
        // Add prompt version tags to the trace
        this.langfuseService?.addTagsToTrace(trace, promptVersionTags);
        
        this.langfuseService?.finalizeTrace(trace, {
          compliance_result: result,
          processing_time_ms: duration,
          success: true,
        }, {
          duration_ms: duration,
          success: true,
          issuesCount: result.validation_result.issues_count,
          isValid: result.validation_result.is_valid,
          promptVersionTags: promptVersionTags,
        });
      }

      this.logger.log(`Compliance analysis completed: ${result.validation_result.issues_count} issues found in ${duration}ms`);

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error('Compliance analysis failed:', error);

      // Update Langfuse with error
      this.langfuseService?.updateGeneration(generation, {
        output: null,
        endTime,
        metadata: {
          duration_ms: duration,
          success: false,
          error: error.message,
          country,
          icp,
        },
      });

      if (trace && !parentTrace) {
        this.langfuseService?.finalizeTrace(trace, null, {
          duration_ms: duration,
          success: false,
          error: error.message,
        });
      }

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


  private parseJsonResponse(content: string): any {
    try {
      // Log the raw response for debugging
      this.logger.debug('🔍 Raw LLM response:', content.substring(0, 500) + (content.length > 500 ? '...' : ''));

      // More aggressive JSON extraction
      let cleanContent = content;

      // Remove markdown code blocks
      cleanContent = cleanContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');

      // Try to find JSON object in the response
      const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanContent = jsonMatch[0];
        this.logger.debug('🎯 Extracted JSON from mixed response');
      } else {
        // Fallback: look for the first { and last }
        const firstBrace = cleanContent.indexOf('{');
        const lastBrace = cleanContent.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleanContent = cleanContent.substring(firstBrace, lastBrace + 1);
          this.logger.debug('🎯 Extracted JSON using brace matching');
        }
      }

      cleanContent = cleanContent.trim();
      this.logger.debug('🧹 Cleaned response:', cleanContent.substring(0, 500) + (cleanContent.length > 500 ? '...' : ''));

      return JSON.parse(cleanContent);
    } catch (error) {
      this.logger.error('❌ Failed to parse JSON response:', error);
      this.logger.error('📄 Full raw content that failed to parse:', content);
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }
}
