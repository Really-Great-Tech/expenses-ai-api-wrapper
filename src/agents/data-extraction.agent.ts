import { Anthropic } from '@llamaindex/anthropic';
import { ExpenseDataSchema, type ExpenseData } from '../schemas/expense-schemas';
import { LangfuseService } from '../services/langfuse.service';
import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';
import { BedrockLlmService } from '../utils/bedrockLlm';
import { BaseAgent } from './base.agent';

export class DataExtractionAgent extends BaseAgent {
  private llm: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock', langfuseService?: LangfuseService) {
    super(langfuseService);
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
    parentTrace?: LangfuseTraceClient
  ): Promise<ExpenseData> {
    const startTime = new Date();
    let trace: LangfuseTraceClient | null = null;
    let generation: LangfuseGenerationClient | null = null;

    try {
      this.logger.log('Starting data extraction with standard receipt/invoice schema');

      // Create Langfuse trace
      const traceInput = {
        markdownContent: markdownContent.substring(0, 500) + '...', // Truncate for brevity
        contentLength: markdownContent.length,
        extractionType: 'standard_receipt_schema',
      };

      if (parentTrace) {
        // Create as a span within parent trace
        generation = this.langfuseService?.createGeneration(parentTrace, {
          name: 'data-extraction',
          input: traceInput,
          model: this.getActualModelUsed(),
          startTime,
          metadata: {
            agent: 'DataExtractionAgent',
            provider: this.currentProvider,
            contentLength: markdownContent.length,
            extractionType: 'standard_receipt_schema',
          },
        }) || null;
      } else {
        // Create standalone trace
        trace = this.langfuseService?.createTrace({
          name: 'data-extraction',
          input: traceInput,
          metadata: {
            agent: 'DataExtractionAgent',
            provider: this.currentProvider,
            contentLength: markdownContent.length,
            extractionType: 'standard_receipt_schema',
          },
          tags: ['data-extraction', 'expense-processing'],
        }) || null;

        // Create generation within trace
        generation = this.langfuseService?.createGeneration(trace, {
          name: 'extraction-llm-call',
          input: traceInput,
          model: this.getActualModelUsed(),
          startTime,
          metadata: {
            agent: 'DataExtractionAgent',
            provider: this.currentProvider,
          },
        }) || null;
      }

      const systemPrompt = await this.getPromptTemplate('data-extraction-system-prompt');
      const systemPromptInfo = { ...this.lastPromptInfo! };

      const userPrompt = await this.buildExtractionPrompt(markdownContent);
      const userPromptInfo = { ...this.lastPromptInfo! };

      // Generate prompt version tags
      const promptVersionTags = this.getAllPromptVersionTags([systemPromptInfo, userPromptInfo]);

      const response = await this.llm.chat({
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
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
            promptTokens: Math.floor(userPrompt.length / 4),
            completionTokens: Math.floor(rawContent.length / 4),
            totalTokens: Math.floor((userPrompt.length + rawContent.length) / 4),
          },
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: true,
            fieldsExtracted: Object.keys(result).length,
            modelUsed: this.getActualModelUsed(),
            provider: this.currentProvider,
            // Include prompt metadata
            systemPrompt: {
              promptName: systemPromptInfo.name,
              promptVersion: systemPromptInfo.version || 'unknown',
              promptConfig: systemPromptInfo.config || {}
            },
            userPrompt: {
              promptName: userPromptInfo.name,
              promptVersion: userPromptInfo.version || 'unknown',
              promptConfig: userPromptInfo.config || {}
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

  private async buildExtractionPrompt(markdownContent: string): Promise<string> {
    // Get prompt from Langfuse (no fallback)
    return await this.getPromptTemplate(
      'data-extraction-user-prompt',
      {
        markdownContent
      }
    );
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
