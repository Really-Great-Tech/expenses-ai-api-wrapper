import { Anthropic } from '@llamaindex/anthropic';
import { FileClassificationResultSchema, type FileClassificationResult } from '../schemas/expense-schemas';
import { LangfuseService } from '../services/langfuse.service';
import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';
import { BedrockLlmService } from '../utils/bedrockLlm';
import { BaseAgent } from './base.agent';

export class FileClassificationAgent extends BaseAgent {
  private llm: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock',  private readonly modelName: string, langfuseService?: LangfuseService) {
    super(langfuseService);
    this.currentProvider = provider;
    this.logger.log(`Initializing FileClassificationAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      this.llm = new BedrockLlmService();
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: this.modelName,
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
      return this.modelName;
    } else {
      // Direct Anthropic usage
      return this.modelName;
    }
  }

  async classifyFile(
    markdownContent: string,
    expectedCountry: string,
    expenseSchema: any,
    parentTrace?: LangfuseTraceClient
  ): Promise<FileClassificationResult> {
    const startTime = new Date();
    let trace: LangfuseTraceClient | null = null;
    let generation: LangfuseGenerationClient | null = null;

    try {
      this.logger.log('Starting file classification');

      // Create Langfuse trace
      const traceInput = {
        markdownContent: markdownContent.substring(0, 500) + '...', // Truncate for brevity
        expectedCountry,
        contentLength: markdownContent.length,
        schemaFields: Object.keys(expenseSchema?.properties || {}),
      };

      if (parentTrace) {
        // Create as a span within parent trace
        generation = this.langfuseService?.createGeneration(parentTrace, {
          name: 'file-classification',
          input: traceInput,
          model: this.modelName,
          startTime,
          metadata: {
            agent: 'FileClassificationAgent',
            provider: this.currentProvider,
            expectedCountry,
            contentLength: markdownContent.length,
            modelUsed: this.getActualModelUsed(),
          },
        }) || null;
      } else {
        // Create standalone trace (will add prompt tags after prompts are loaded)
        trace = this.langfuseService?.createTrace({
          name: 'file-classification',
          input: traceInput,
          metadata: {
            agent: 'FileClassificationAgent',
            provider: this.currentProvider,
            expectedCountry,
            contentLength: markdownContent.length,
            modelUsed: this.getActualModelUsed(),
          },
          tags: ['file-classification', 'expense-processing'],
        }) || null;

        // Create generation within trace
        generation = this.langfuseService?.createGeneration(trace, {
          name: 'classification-llm-call',
          input: traceInput,
          model: this.modelName,
          startTime,
          metadata: {
            agent: 'FileClassificationAgent',
            provider: this.currentProvider,
            modelUsed: this.getActualModelUsed(),
          },
        }) || null;
      }

      const systemPrompt = await this.getPromptTemplate(
        'file-classification-system-prompt'
      );
      const systemPromptInfo = { ...this.lastPromptInfo! };

      const userPrompt = await this.buildClassificationPrompt(markdownContent, expectedCountry, expenseSchema);
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

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

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
      const result = FileClassificationResultSchema.parse(parsedResult);

      // Update Langfuse generation with results
      this.langfuseService?.updateGeneration(generation, {
        output: result,
        usage: {
          // Note: We don't have exact token counts from LlamaIndex, so we estimate
          promptTokens: Math.floor(userPrompt.length / 4), // Rough estimate: 4 chars per token
          completionTokens: Math.floor(rawContent.length / 4),
          totalTokens: Math.floor((userPrompt.length + rawContent.length) / 4),
        },
        endTime,
        metadata: {
          duration_seconds: (duration / 1000).toFixed(1),
          success: true,
          is_expense: result.is_expense,
          expense_type: result.expense_type,
          language: result.language,
          classification_confidence: result.classification_confidence,
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

      // Finalize trace if it's a standalone trace
      if (trace && !parentTrace) {
        // Add prompt version tags to the trace
        this.langfuseService?.addTagsToTrace(trace, promptVersionTags);
        
        this.langfuseService?.finalizeTrace(trace, {
          classification_result: result,
          processing_time_ms: duration,
          success: true,
        }, {
          duration_ms: duration,
          success: true,
          is_expense: result.is_expense,
          expense_type: result.expense_type,
          promptVersionTags: promptVersionTags,
        });
      }

      this.logger.log(`File classification completed: ${result.is_expense ? 'EXPENSE' : 'NOT_EXPENSE'} - ${result.expense_type} (${result.language}) in ${duration}ms`);

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error('File classification failed:', error);

      // Update Langfuse with error
      this.langfuseService?.updateGeneration(generation, {
        output: null,
        endTime,
        metadata: {
          duration_ms: duration,
          success: false,
          error: error.message,
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
        is_expense: false,
        expense_type: null,
        language: 'unknown',
        language_confidence: 0,
        document_location: 'unknown',
        expected_location: 'unknown',
        location_match: false,
        error_type: 'classification_error',
        error_message: error.message,
        classification_confidence: 0,
        reasoning: `Classification failed due to error: ${error.message}`,
        schema_field_analysis: {
          fields_found: [],
          fields_missing: [],
          total_fields_found: 0,
          expense_identification_reasoning: 'Classification failed due to system error',
        },
      };
    }
  }

  private async buildClassificationPrompt(
    markdownContent: string,
    expectedCountry: string,
    expenseSchema: any
  ): Promise<string> {
    // Create schema field descriptions for the prompt
    let schemaFieldsDescription = "";
    for (const [fieldName, fieldInfo] of Object.entries(expenseSchema?.properties || {})) {
      const title = (fieldInfo as any)?.title || fieldName;
      const description = (fieldInfo as any)?.description || "";
      schemaFieldsDescription += `\n**${fieldName}** (${title}):\n${description}\n`;
    }

    // Get prompt from Langfuse (no fallback)
    return await this.getPromptTemplate(
      'file-classification-user-prompt',
      {
        schemaFieldsDescription,
        markdownContent,
        expectedCountry: expectedCountry || "Not specified"
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
