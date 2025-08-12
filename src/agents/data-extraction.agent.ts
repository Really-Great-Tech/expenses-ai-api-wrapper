import { Anthropic } from '@llamaindex/anthropic';
import { ExpenseDataSchema, type ExpenseData } from '../schemas/expense-schemas';
import { LangfuseService } from '../services/langfuse.service';
import { LangSmithService } from '../services/langsmith.service';
import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';
import { BedrockLlmService } from '../utils/bedrockLlm';
import { BaseAgent } from './base.agent';

// Data Extraction JSON Schema for LangSmith prompt template
const DATA_EXTRACTION_SCHEMA = {
  "country": "Germany",
  "supplier_name": "THE SUSHI CLUB",
  "supplier_address": "Mohrenstr.42, 10117 Berlin",
  "supplier_vat_number": "DE123456789",
  "supplier_phone": "+49 30 23 916 036",
  "supplier_email": "info@thesushiclub.de",
  "supplier_website": "WWW.TheSushiClub.de",
  "customer_name": null,
  "customer_address": null,
  "invoice_number": "INV-2019-001234",
  "receipt_number": "R-001234",
  "transaction_reference": "L0001 FRÜH",
  "currency": "EUR",
  "total_amount": 64.40,
  "subtotal": 54.12,
  "tax_amount": 10.28,
  "tax_rate": 19.0,
  "discount_amount": null,
  "tip_amount": null,
  "date_of_issue": "2019-02-05",
  "transaction_time": "23:10:54",
  "payment_method": "Credit Card",
  "card_last_four": "1234",
  "line_items": [
    {
      "description": "Miso Soup",
      "quantity": 1,
      "unit_price": 3.90,
      "total_price": 3.90,
      "category": "Food"
    },
    {
      "description": "Sushi Platter",
      "quantity": 2,
      "unit_price": 25.11,
      "total_price": 50.22,
      "category": "Food"
    }
  ],
  "receipt_type": "Restaurant Receipt",
  "document_type": "Rechnung",
  "table_number": "24",
  "server_name": null,
  "location_city": "Berlin",
  "location_country": "Germany",
  "special_notes": "TIP IS NOT INCLUDED",
  "terms_conditions": null,
  "business_registration_number": null
};

export class DataExtractionAgent extends BaseAgent {
  private llm: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock', langfuseService?: LangfuseService, langsmithService?: LangSmithService) {
    super(langfuseService, langsmithService);
    this.currentProvider = provider;
    this.logger.log(`Initializing DataExtractionAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      this.llm = new BedrockLlmService();
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    }
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

  async extractData(
    markdownContent: string,
    complianceRequirements: any, // Note: No longer used for schema definition, kept for API compatibility
    parentTrace?: LangfuseTraceClient,
    langsmithParentTrace?: any
  ): Promise<ExpenseData> {
    const startTime = new Date();
    let trace: LangfuseTraceClient | null = null;
    let generation: LangfuseGenerationClient | null = null;
    let langsmithGeneration: any = null;

    try {
      this.logger.log('Starting data extraction with standard receipt/invoice schema');

      // Create Langfuse trace with exact prompt inputs
      const traceInput = {
        markdownContent,
        contentLength: markdownContent.length,
        extractionType: 'standard_receipt_schema',
      };

      // Get prompt first to have version info
      const combinedPrompt = await this.getPromptTemplate('data-extraction-prompt', {
        markdownContent,
        jsonSchema: JSON.stringify(DATA_EXTRACTION_SCHEMA, null, 2)
      });
      const promptInfo = { ...this.lastPromptInfo! };

      // Debug: Log the actual prompt being sent
      this.logger.debug(`🔍 Data extraction prompt preview: ${combinedPrompt.substring(0, 500)}...`);
      this.logger.debug(`📄 Markdown content length: ${markdownContent.length}`);
      this.logger.debug(`📄 Markdown preview: ${markdownContent.substring(0, 200)}...`);

      if (parentTrace) {
        // Create as a span within parent trace (DISABLED - hard switch to LangSmith)
        generation = null; // Disabled Langfuse generation creation
        // generation = this.langfuseService?.createGeneration(parentTrace, {
        //   name: 'data-extraction',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'DataExtractionAgent',
        //     provider: this.currentProvider,
        //     contentLength: markdownContent.length,
        //     extractionType: 'standard_receipt_schema',
        //   },
        // }) || null;

        // Create parallel LangSmith generation with prompt metadata
        if (langsmithParentTrace) {
          langsmithGeneration = await this.langsmithService?.createGeneration(langsmithParentTrace, {
            name: 'data-extraction',
            input: traceInput,
            model: this.getActualModelUsed(),
            startTime,
            promptName: 'data-extraction-prompt',
            promptCommitHash: this.lastPromptInfo?.config?.commitHash,
            metadata: {
              agent: 'DataExtractionAgent',
              provider: this.currentProvider,
              contentLength: markdownContent.length,
              extractionType: 'standard_receipt_schema',
            },
          }) || null;
        }
      } else {
        // Create standalone trace (DISABLED - hard switch to LangSmith)
        trace = null; // Disabled Langfuse trace creation
        generation = null; // Disabled Langfuse generation creation
        // trace = this.langfuseService?.createTrace({
        //   name: 'data-extraction',
        //   input: traceInput,
        //   metadata: {
        //     agent: 'DataExtractionAgent',
        //     provider: this.currentProvider,
        //     contentLength: markdownContent.length,
        //     extractionType: 'standard_receipt_schema',
        //   },
        //   tags: ['data-extraction', 'expense-processing'],
        // }) || null;

        // // Create generation within trace
        // generation = this.langfuseService?.createGeneration(trace, {
        //   name: 'extraction-llm-call',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'DataExtractionAgent',
        //     provider: this.currentProvider,
        //   },
        // }) || null;
      }

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
      const result = ExpenseDataSchema.parse(parsedResult);



      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update Langfuse generation with results
      if (generation) {
        this.langfuseService?.updateGeneration(generation, {
          output: {
            extraction_result: result
          },
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
            fieldsExtracted: Object.keys(result).length,
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

      }

      // Update parallel LangSmith generation with results
      if (langsmithGeneration) {
        this.logger.debug(`🔄 Updating LangSmith generation with ${Object.keys(result).length} extracted fields`);
        await this.langsmithService?.updateGeneration(langsmithGeneration, {
          output: {
            extraction_result: result
          },
          usage: {
            promptTokens: Math.floor(combinedPrompt.length / 4),
            completionTokens: Math.floor(rawContent.length / 4),
            totalTokens: Math.floor((combinedPrompt.length + rawContent.length) / 4),
          },
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: true,
            fieldsExtracted: Object.keys(result).length,
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
      }

      // Finalize trace if it's a standalone trace
      if (trace && !parentTrace) {
        // Add prompt version tags to the trace
        this.langfuseService?.addTagsToTrace(trace, promptVersionTags);
        
        this.langfuseService?.finalizeTrace(trace, {
          extraction_result: result,
          processing_time_ms: duration,
          success: true,
        }, {
          duration_ms: duration,
          success: true,
          fieldsExtracted: Object.keys(result).length,
          promptVersionTags: promptVersionTags,
        });
      }

      this.logger.log(`Data extraction completed: ${Object.keys(result).length} fields extracted in ${duration}ms`);

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error('Data extraction failed:', error);

      // Update Langfuse with error
      if (generation) {
        this.langfuseService?.updateGeneration(generation, {
          output: null,
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: false,
            error: error.message,
          },
        });
      }

      // Update LangSmith with error
      if (langsmithGeneration) {
        this.logger.debug(`🔄 Updating LangSmith generation with error`);
        await this.langsmithService?.updateGeneration(langsmithGeneration, {
          output: null,
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: false,
            error: error.message,
          },
        });
      }

      if (trace && !parentTrace) {
        this.langfuseService?.finalizeTrace(trace, null, {
          duration_seconds: (duration / 1000).toFixed(1),
          success: false,
          error: error.message,
        });
      }

      // Return minimal fallback result
      return {
        vendor_name: 'extraction_failed',
        notes: `Error: ${error.message}`,
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
