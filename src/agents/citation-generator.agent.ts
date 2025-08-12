import { Anthropic } from '@llamaindex/anthropic';
import { CitationResultSchema, type CitationResult } from '../schemas/expense-schemas';
import { LangfuseService } from '../services/langfuse.service';
import { LangSmithService } from '../services/langsmith.service';
import type { LangfuseTraceClient, LangfuseGenerationClient } from 'langfuse';
import { BedrockLlmService } from '../utils/bedrockLlm';
import { BaseAgent } from './base.agent';

// Citation JSON Schema for LangSmith prompt template
const CITATION_SCHEMA = {
  "citations": {
    "field_name": {
      "field_citation": {
        "source_text": "exact_text_from_source",
        "confidence": 0.95,
        "source_location": "markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      },
      "value_citation": {
        "source_text": "exact_text_from_source",
        "confidence": 0.95,
        "source_location": "markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      }
    }
  },
  "metadata": {
    "total_fields_analyzed": 10,
    "fields_with_field_citations": 8,
    "fields_with_value_citations": 9,
    "average_confidence": 0.87
  }
};

export class CitationGeneratorAgent extends BaseAgent {
  private llm: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock', langfuseService?: LangfuseService, langsmithService?: LangSmithService) {
    super(langfuseService, langsmithService);
    this.currentProvider = provider;
    this.logger.log(`Initializing CitationGeneratorAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      // Use Nova Micro for citations - better for structured output
      const citationModel = process.env.CITATION_MODEL || 'amazon.nova-micro-v1:0';
      this.llm = new BedrockLlmService({ modelId: citationModel });
      this.logger.log(`Using model for citations: ${citationModel}`);
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
      return process.env.CITATION_MODEL || 'amazon.nova-micro-v1:0';
    } else {
      // Direct Anthropic usage
      return 'claude-3-5-sonnet-20241022';
    }
  }

  async generateCitations(
    extractedData: any,
    markdownContent: string,
    filename: string,
    parentTrace?: LangfuseTraceClient,
    langsmithParentTrace?: any
  ): Promise<CitationResult> {
    const startTime = new Date();
    let trace: LangfuseTraceClient | null = null;
    let generation: LangfuseGenerationClient | null = null;
    let langsmithGeneration: any = null;

    try {
      this.logger.log(`Starting citation generation for ${filename}`);

      // Get prompt first to have version info
      const samplePrompt = await this.getPromptTemplate('citation-generation-prompt', {
        extractedDataJson: JSON.stringify(extractedData, null, 2),
        markdownContent,
        jsonSchema: JSON.stringify(CITATION_SCHEMA, null, 2)
      });
      const promptInfo = { ...this.lastPromptInfo! };

      // Create Langfuse trace with exact prompt inputs (will be populated from first batch)
      let traceInput = {
        filename,
        extractedFieldsCount: Object.keys(extractedData).length,
        markdownContentLength: markdownContent.length,
      };

      if (parentTrace) {
        // Create as a span within parent trace (DISABLED - hard switch to LangSmith)
        generation = null; // Disabled Langfuse generation creation
        // generation = this.langfuseService?.createGeneration(parentTrace, {
        //   name: 'citation-generation',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'CitationGeneratorAgent',
        //     provider: this.currentProvider,
        //     filename,
        //     fieldsCount: Object.keys(extractedData).length,
        //   },
        // }) || null;

        // Create parallel LangSmith generation with prompt metadata
        if (langsmithParentTrace) {
          langsmithGeneration = await this.langsmithService?.createGeneration(langsmithParentTrace, {
            name: 'citation-generation',
            input: traceInput,
            model: this.getActualModelUsed(),
            startTime,
            promptName: 'citation-generation-prompt',
            promptCommitHash: this.lastPromptInfo?.config?.commitHash,
            metadata: {
              agent: 'CitationGeneratorAgent',
              provider: this.currentProvider,
              filename,
              fieldsCount: Object.keys(extractedData).length,
            },
          }) || null;
        }
      } else {
        // Create standalone trace (DISABLED - hard switch to LangSmith)
        trace = null; // Disabled Langfuse trace creation
        generation = null; // Disabled Langfuse generation creation
        // trace = this.langfuseService?.createTrace({
        //   name: 'citation-generation',
        //   input: traceInput,
        //   metadata: {
        //     agent: 'CitationGeneratorAgent',
        //     provider: this.currentProvider,
        //     filename,
        //     fieldsCount: Object.keys(extractedData).length,
        //   },
        //   tags: ['citation-generation', 'expense-processing'],
        // }) || null;

        // // Create generation within trace
        // generation = this.langfuseService?.createGeneration(trace, {
        //   name: 'citation-generation-llm-call',
        //   input: traceInput,
        //   model: this.getActualModelUsed(),
        //   startTime,
        //   metadata: {
        //     agent: 'CitationGeneratorAgent',
        //     provider: this.currentProvider,
        //   },
        // }) || null;
      }

      // Process citations in batches to handle context window limitations
      const fieldEntries = Object.entries(extractedData);
      const batchSize = 8; // Process 8 fields at a time
      const allCitations: any = {};
      let totalFieldsAnalyzed = 0;
      let fieldsWithFieldCitations = 0;
      let fieldsWithValueCitations = 0;
      let totalConfidence = 0;
      let promptVersionTags: string[] = [];

      this.logger.log(`Processing ${fieldEntries.length} fields in batches of ${batchSize}`);

      for (let i = 0; i < fieldEntries.length; i += batchSize) {
        const batch = fieldEntries.slice(i, i + batchSize);
        const batchData = Object.fromEntries(batch);
        
        this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(fieldEntries.length / batchSize)} with ${batch.length} fields`);

        const batchResult = await this.processCitationBatch(
          batchData,
          markdownContent,
          batch.length
        );

        // Merge batch results
        Object.assign(allCitations, batchResult.citations);
        totalFieldsAnalyzed += batchResult.metadata.total_fields_analyzed;
        fieldsWithFieldCitations += batchResult.metadata.fields_with_field_citations;
        fieldsWithValueCitations += batchResult.metadata.fields_with_value_citations;
        totalConfidence += batchResult.metadata.average_confidence * batchResult.metadata.total_fields_analyzed;
        
        // Collect prompt tags and update trace input from first batch
        if (i === 0 && this.lastPromptInfo) {
          promptVersionTags = this.getPromptVersionTags();
          
          // Update trace input with actual prompt data from first batch
          const firstBatchPromptInput = {
            extractedDataJson: JSON.stringify(batchData, null, 2),
            markdownContent
          };
          
          // Update the trace input to show exact prompt inputs
          if (trace) {
            trace.update({
              input: firstBatchPromptInput
            });
          }
          if (generation) {
            generation.update({
              input: firstBatchPromptInput
            });
          }
        }
      }

      const averageConfidence = totalFieldsAnalyzed > 0 ? totalConfidence / totalFieldsAnalyzed : 0;

      const result: CitationResult = {
        citations: allCitations,
        metadata: {
          total_fields_analyzed: totalFieldsAnalyzed,
          fields_with_field_citations: fieldsWithFieldCitations,
          fields_with_value_citations: fieldsWithValueCitations,
          average_confidence: averageConfidence,
        },
      };

      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      // Update Langfuse generation with results
      this.langfuseService?.updateGeneration(generation, {
        output: result,
        usage: {
          // Estimate based on batch processing
          promptTokens: Math.floor((markdownContent.length * Math.ceil(fieldEntries.length / batchSize)) / 4),
          completionTokens: Math.floor((JSON.stringify(allCitations).length) / 4),
          totalTokens: Math.floor((markdownContent.length * Math.ceil(fieldEntries.length / batchSize) + JSON.stringify(allCitations).length) / 4),
        },
        endTime,
        metadata: {
          duration_seconds: (duration / 1000).toFixed(1),
          success: true,
          totalFieldsAnalyzed: result.metadata.total_fields_analyzed,
          batchesProcessed: Math.ceil(fieldEntries.length / batchSize),
          filename,
          modelUsed: this.getActualModelUsed(),
          provider: this.currentProvider,
          // Include prompt metadata from last batch (representative)
          prompt: this.getPromptMetadata(),
        },
      });

      // Update parallel LangSmith generation with results
      if (langsmithGeneration) {
        await this.langsmithService?.updateGeneration(langsmithGeneration, {
          output: result,
          usage: {
            promptTokens: Math.floor((markdownContent.length * Math.ceil(fieldEntries.length / batchSize)) / 4),
            completionTokens: Math.floor((JSON.stringify(allCitations).length) / 4),
            totalTokens: Math.floor((markdownContent.length * Math.ceil(fieldEntries.length / batchSize) + JSON.stringify(allCitations).length) / 4),
          },
          endTime,
          metadata: {
            duration_seconds: (duration / 1000).toFixed(1),
            success: true,
            totalFieldsAnalyzed: result.metadata.total_fields_analyzed,
            batchesProcessed: Math.ceil(fieldEntries.length / batchSize),
            filename,
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
          citation_result: result,
          processing_time_ms: duration,
          success: true,
        }, {
          duration_ms: duration,
          success: true,
          totalFieldsAnalyzed: result.metadata.total_fields_analyzed,
          promptVersionTags: promptVersionTags,
        });
      }

      this.logger.log(`Citation generation completed: ${result.metadata.total_fields_analyzed} fields analyzed across ${Math.ceil(fieldEntries.length / batchSize)} batches in ${duration}ms`);

      return result;
    } catch (error) {
      const endTime = new Date();
      const duration = endTime.getTime() - startTime.getTime();

      this.logger.error('Citation generation failed:', error);

      // Update Langfuse with error
      this.langfuseService?.updateGeneration(generation, {
        output: null,
        endTime,
        metadata: {
          duration_ms: duration,
          success: false,
          error: error.message,
          filename,
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
        citations: {},
        metadata: {
          total_fields_analyzed: 0,
          fields_with_field_citations: 0,
          fields_with_value_citations: 0,
          average_confidence: 0.0,
        },
      };
    }
  }

  private async processCitationBatch(
    batchData: any,
    markdownContent: string,
    expectedFields: number
  ): Promise<CitationResult> {
    const combinedPrompt = await this.getPromptTemplate('citation-generation-prompt', {
      extractedDataJson: JSON.stringify(batchData, null, 2),
      markdownContent,
      jsonSchema: JSON.stringify(CITATION_SCHEMA, null, 2)
    });
    const promptInfo = { ...this.lastPromptInfo! };

    // Generate prompt version tags (will be used in main method)
    const promptVersionTags = this.getPromptVersionTags();

    const response = await this.llm.chat({
      messages: [
        {
          role: 'user',
          content: combinedPrompt,
        },
      ],
    });

    let rawContent = '';

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

    const parsedResult = this.parseJsonResponse(rawContent);
    return CitationResultSchema.parse(parsedResult);
  }


  private parseJsonResponse(content: string): any {
    try {
      // Simple cleanup for Claude models - they produce clean JSON
      let cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      // Find JSON start and end
      const jsonStart = cleanContent.indexOf('{');
      const jsonEnd = cleanContent.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
      }

      return JSON.parse(cleanContent);
    } catch (error) {
      this.logger.error('Failed to parse JSON response:', error);
      this.logger.error(`Content preview: ${content.substring(0, 500)}...`);
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }
}
