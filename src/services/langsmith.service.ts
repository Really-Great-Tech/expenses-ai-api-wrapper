import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'langsmith';
import { RunTree } from 'langsmith';
import { PromptTemplate } from '../interfaces/prompt-management.interface';

export interface LangSmithTraceData {
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  tags?: string[];
  userId?: string;
  sessionId?: string;
}

export interface LangSmithGenerationData {
  name: string;
  input?: any;
  output?: any;
  model?: string;
  modelParameters?: Record<string, any>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, any>;
  startTime?: Date;
  endTime?: Date;
  promptName?: string;
  promptCommitHash?: string;
}

export interface ExpenseDatasetItem {
  input: {
    // FileClassificationAgent inputs
    schemaFieldsDescription?: string;
    markdownContent?: string;
    expectedCountry?: string;
    
    // DataExtractionAgent inputs  
    country?: string;
    
    // IssueDetectionAgent inputs
    expenseTaxonomyDescription?: string | any;
    receiptType?: string;
    icp?: string;
    complianceDataJson?: string;
    
    // CitationGeneratorAgent inputs
    extractedData?: any;
    
    // ImageQualityAssessmentAgent inputs
    imagePath?: string;
  };
  expected_output: {
    // FileClassificationAgent outputs
    classification?: any;
    
    // DataExtractionAgent outputs
    extractedData?: any;
    
    // IssueDetectionAgent outputs
    validation_result?: any;
    
    // CitationGeneratorAgent outputs
    citations?: any;
    
    // ImageQualityAssessmentAgent outputs
    quality_assessment?: any;
  };
  metadata: {
    filename: string;
    processingComplexity: 'simple' | 'medium' | 'complex';
    language: string;
    documentReader: string;
    processingTime?: number;
  };
}

@Injectable()
export class LangSmithService implements OnModuleInit {
  private readonly logger = new Logger(LangSmithService.name);
  private langsmith: Client | null = null;
  private isEnabled: boolean = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      // Debug: Log all LangSmith environment variables
      this.logger.debug('🔍 LangSmith Environment Variables:');
      this.logger.debug(`  LANGSMITH_ENABLED: ${this.configService.get<string>('LANGSMITH_ENABLED', 'not set')}`);
      this.logger.debug(`  LANGSMITH_API_KEY: ${this.configService.get<string>('LANGSMITH_API_KEY') ? 'SET (length: ' + this.configService.get<string>('LANGSMITH_API_KEY').length + ')' : 'NOT SET'}`);
      this.logger.debug(`  LANGSMITH_PROJECT: ${this.configService.get<string>('LANGSMITH_PROJECT', 'not set')}`);
      this.logger.debug(`  LANGSMITH_ENDPOINT: ${this.configService.get<string>('LANGSMITH_ENDPOINT', 'not set')}`);
      this.logger.debug(`  LANGSMITH_TRACING: ${this.configService.get<string>('LANGSMITH_TRACING', 'not set')}`);

      // Properly parse boolean from environment variable string
      const langsmithEnabledStr = this.configService.get<string>('LANGSMITH_ENABLED', 'false');
      this.isEnabled = langsmithEnabledStr.toLowerCase() === 'true';

      this.logger.log(`🚀 LangSmith initialization starting... Enabled: ${this.isEnabled}`);

      if (!this.isEnabled) {
        this.logger.warn('❌ LangSmith is disabled - set LANGSMITH_ENABLED=true to enable');
        return;
      }

      const apiKey = this.configService.get<string>('LANGSMITH_API_KEY');
      const endpoint = this.configService.get<string>('LANGSMITH_ENDPOINT', 'https://api.smith.langchain.com');
      const project = this.configService.get<string>('LANGSMITH_PROJECT', 'expense-processing-default');

      if (!apiKey) {
        this.logger.error('❌ LangSmith API key not provided, disabling LangSmith integration');
        this.logger.error('   Please set LANGSMITH_API_KEY in your .env file');
        this.isEnabled = false;
        return;
      }

      this.logger.log('🔧 Creating LangSmith client...');
      this.langsmith = new Client({
        apiKey,
        apiUrl: endpoint,
      });

      // Set environment variables for traceable functions
      process.env.LANGSMITH_API_KEY = apiKey;
      process.env.LANGSMITH_TRACING = 'true';
      process.env.LANGSMITH_PROJECT = project;
      process.env.LANGSMITH_ENDPOINT = endpoint;

      this.logger.log('🌍 Set process environment variables for LangSmith:');
      this.logger.log(`   process.env.LANGSMITH_API_KEY: ${process.env.LANGSMITH_API_KEY ? 'SET' : 'NOT SET'}`);
      this.logger.log(`   process.env.LANGSMITH_TRACING: ${process.env.LANGSMITH_TRACING}`);
      this.logger.log(`   process.env.LANGSMITH_PROJECT: ${process.env.LANGSMITH_PROJECT}`);
      this.logger.log(`   process.env.LANGSMITH_ENDPOINT: ${process.env.LANGSMITH_ENDPOINT}`);

      this.logger.log(`✅ LangSmith initialized successfully!`);
      this.logger.log(`   📡 Endpoint: ${endpoint}`);
      this.logger.log(`   📁 Project: ${project}`);
      this.logger.log(`   🔑 API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
    } catch (error) {
      this.logger.error('❌ Failed to initialize LangSmith:', error);
      this.logger.error('   Stack trace:', error.stack);
      this.isEnabled = false;
    }
  }

  /**
   * Create a new trace for expense processing
   */
  async createTrace(data: LangSmithTraceData): Promise<RunTree | null> {
    this.logger.debug(`🔍 LangSmith createTrace called - Enabled: ${this.isEnabled}, Client: ${!!this.langsmith}`);

    if (!this.isEnabled || !this.langsmith) {
      this.logger.warn('❌ LangSmith trace creation skipped - service not enabled or client not initialized');
      return null;
    }

    try {
      const projectName = this.configService.get<string>('LANGSMITH_PROJECT', 'expense-processing-default');

      this.logger.log(`🚀 Creating LangSmith trace: "${data.name}"`);
      this.logger.debug(`   📁 Project: ${projectName}`);
      this.logger.debug(`   🏷️  Tags: ${JSON.stringify(data.tags)}`);
      this.logger.debug(`   📊 Input keys: ${Object.keys(data.input || {}).join(', ')}`);

      const runTree = new RunTree({
        name: data.name,
        inputs: data.input,
        run_type: 'chain',
        client: this.langsmith,
        project_name: projectName,
        tags: data.tags,
        extra: {
          metadata: {
            ...data.metadata,
            userId: data.userId,
            sessionId: data.sessionId,
          }
        }
      });

      this.logger.debug(`✅ RunTree created with ID: ${runTree.id}`);

      // Post the run to start it and wait for completion
      try {
        await runTree.postRun();
        this.logger.log(`✅ LangSmith trace posted successfully: ${data.name} (ID: ${runTree.id})`);
        this.logger.log(`   🔗 Trace URL: https://smith.langchain.com/o/default/projects/p/${projectName}/r/${runTree.id}`);
      } catch (postError) {
        this.logger.error(`❌ Failed to post LangSmith trace "${data.name}":`, postError);
        this.logger.error('   Error details:', postError.message);
        // Return null if posting fails, as the trace won't be visible in LangSmith
        return null;
      }

      return runTree;
    } catch (error) {
      this.logger.error(`❌ Failed to create LangSmith trace "${data.name}":`, error);
      this.logger.error('   Error details:', error.message);
      return null;
    }
  }

  /**
   * Create a generation within a trace
   */
  async createGeneration(
    trace: RunTree | null,
    data: LangSmithGenerationData
  ): Promise<RunTree | null> {
    this.logger.debug(`🔍 LangSmith createGeneration called - Enabled: ${this.isEnabled}, Client: ${!!this.langsmith}, Trace: ${!!trace}`);

    if (!this.isEnabled || !this.langsmith || !trace) {
      this.logger.warn('❌ LangSmith generation creation skipped - service not enabled, client not initialized, or no parent trace');
      return null;
    }

    try {
      this.logger.log(`🚀 Creating LangSmith generation: "${data.name}" under trace: ${trace.id}`);
      this.logger.debug(`   🤖 Model: ${data.model}`);
      this.logger.debug(`   📊 Input keys: ${Object.keys(data.input || {}).join(', ')}`);

      const generation = trace.createChild({
        name: data.name,
        inputs: data.input,
        run_type: 'llm',
        extra: {
          metadata: {
            ...data.metadata,
            model: data.model,
            modelParameters: data.modelParameters,
            // Enhanced prompt linking metadata
            prompt_name: data.promptName,
            prompt_commit_hash: data.promptCommitHash,
            prompt_source: 'langsmith',
            prompt_linked: true,
          }
        },
        tags: data.promptName ? [`prompt:${data.promptName}`] : undefined
      });

      this.logger.debug(`✅ Generation created with ID: ${generation.id}`);

      // Post the generation to start it and wait for completion
      try {
        await generation.postRun();
        this.logger.log(`✅ LangSmith generation posted successfully: ${data.name} (ID: ${generation.id})`);
      } catch (postError) {
        this.logger.error(`❌ Failed to post LangSmith generation "${data.name}":`, postError);
        this.logger.error('   Error details:', postError.message);
        // Return null if posting fails, as the generation won't be visible in LangSmith
        return null;
      }

      return generation;
    } catch (error) {
      this.logger.error(`❌ Failed to create LangSmith generation "${data.name}":`, error);
      this.logger.error('   Error details:', error.message);
      return null;
    }
  }

  /**
   * Update generation with completion data
   */
  async updateGeneration(
    generation: RunTree | null,
    data: Partial<LangSmithGenerationData>
  ): Promise<void> {
    if (!this.isEnabled || !generation) {
      return;
    }

    try {
      this.logger.debug(`🔄 Updating LangSmith generation: ${generation.id}`);

      // End the generation with outputs and usage data
      generation.end({
        outputs: data.output,
        usage: data.usage ? {
          prompt_tokens: data.usage.promptTokens,
          completion_tokens: data.usage.completionTokens,
          total_tokens: data.usage.totalTokens,
        } : undefined,
      });

      // Patch the run to update it and wait for completion
      try {
        await generation.patchRun();
        this.logger.log(`✅ LangSmith generation updated successfully: ${generation.id}`);
      } catch (patchError) {
        this.logger.error(`❌ Failed to update LangSmith generation ${generation.id}:`, patchError);
        this.logger.error('   Error details:', patchError.message);
      }
    } catch (error) {
      this.logger.error('❌ Failed to update LangSmith generation:', error);
      this.logger.error('   Error details:', error.message);
    }
  }

  /**
   * Update trace tags (e.g., to add prompt versions after agents run)
   */
  async updateTraceTags(trace: RunTree | null, additionalTags: string[]): Promise<void> {
    if (!this.isEnabled || !trace) {
      return;
    }

    try {
      // Add new tags to existing tags
      const currentTags = trace.tags || [];
      const newTags = [...currentTags, ...additionalTags];
      trace.tags = newTags;

      this.logger.debug(`🏷️ Updated trace tags: ${JSON.stringify(newTags)}`);
    } catch (error) {
      this.logger.error('❌ Failed to update trace tags:', error);
    }
  }

  /**
   * Pull a prompt from LangSmith with enhanced metadata tracking
   */
  async pullPrompt(promptName: string, tag?: string, owner?: string): Promise<{ prompt: any; metadata: { name: string; commitHash?: string } } | null> {
    if (!this.isEnabled || !this.langsmith) {
      this.logger.warn('❌ LangSmith prompt retrieval skipped - service not enabled or client not initialized');
      return null;
    }

    try {
      // Handle owner/prompt-name format for LangSmith
      let fullPromptName: string;

      if (owner) {
        // Explicit owner provided
        fullPromptName = tag ? `${owner}/${promptName}:${tag}` : `${owner}/${promptName}`;
      } else if (promptName.includes('/')) {
        // Owner already included in prompt name
        fullPromptName = tag ? `${promptName}:${tag}` : promptName;
      } else {
        // Try to get owner from environment or use prompt name as-is
        const defaultOwner = process.env.LANGSMITH_OWNER || process.env.LANGSMITH_USER;
        if (defaultOwner) {
          fullPromptName = tag ? `${defaultOwner}/${promptName}:${tag}` : `${defaultOwner}/${promptName}`;
        } else {
          // Fallback to prompt name without owner (will likely fail)
          fullPromptName = tag ? `${promptName}:${tag}` : promptName;
          this.logger.warn(`⚠️ No LangSmith owner specified. Set LANGSMITH_OWNER env var or include owner in prompt name (owner/prompt-name)`);
        }
      }

      this.logger.log(`🔍 Pulling prompt from LangSmith: "${fullPromptName}"`);
      this.logger.debug(`🔍 Debug info:`);
      this.logger.debug(`   - Original prompt name: "${promptName}"`);
      this.logger.debug(`   - Owner parameter: "${owner}"`);
      this.logger.debug(`   - LANGSMITH_OWNER env: "${process.env.LANGSMITH_OWNER}"`);
      this.logger.debug(`   - LANGSMITH_USER env: "${process.env.LANGSMITH_USER}"`);
      this.logger.debug(`   - Final full prompt name: "${fullPromptName}"`);

      let prompt;
      try {
        prompt = await this.langsmith._pullPrompt(fullPromptName);
      } catch (error) {
        this.logger.warn(`❌ Failed to pull prompt with owner prefix: ${error.message}`);

        // Try without owner prefix as fallback
        if (fullPromptName.includes('/')) {
          const promptNameOnly = promptName; // Use original prompt name without owner
          this.logger.log(`🔄 Retrying without owner prefix: "${promptNameOnly}"`);
          try {
            prompt = await this.langsmith._pullPrompt(promptNameOnly);
            this.logger.log(`✅ Successfully pulled prompt without owner prefix`);
          } catch (fallbackError) {
            this.logger.error(`❌ Fallback also failed: ${fallbackError.message}`);
            throw error; // Throw original error
          }
        } else {
          throw error;
        }
      }

      if (prompt) {
        // Extract commit hash if available
        let commitHash: string | undefined;
        try {
          // Try to get commit info from the prompt object
          if (prompt.metadata?.commit_hash) {
            commitHash = prompt.metadata.commit_hash;
          } else if (prompt.commit_hash) {
            commitHash = prompt.commit_hash;
          }
        } catch (e) {
          // Commit hash extraction failed, continue without it
        }

        this.logger.log(`✅ Successfully pulled prompt: ${fullPromptName}`);
        this.logger.debug(`📋 Prompt type: ${prompt.constructor?.name || 'unknown'}`);
        if (commitHash) {
          this.logger.debug(`🔗 Commit hash: ${commitHash}`);
        }

        return {
          prompt,
          metadata: {
            name: promptName,
            commitHash
          }
        };
      } else {
        this.logger.warn(`⚠️ Prompt not found: ${fullPromptName}`);
        return null;
      }
    } catch (error) {
      this.logger.error(`❌ Failed to pull prompt "${promptName}":`, error);
      this.logger.error('   Error details:', error.message);
      return null;
    }
  }

  /**
   * Finalize trace with completion data
   */
  async finalizeTrace(
    trace: RunTree | null,
    output?: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    this.logger.debug(`🔍 LangSmith finalizeTrace called - Enabled: ${this.isEnabled}, Trace: ${!!trace}`);

    if (!this.isEnabled || !trace) {
      this.logger.warn('❌ LangSmith trace finalization skipped - service not enabled or no trace');
      return;
    }

    try {
      this.logger.log(`🏁 Finalizing LangSmith trace: ${trace.id}`);
      this.logger.debug(`   📊 Output keys: ${Object.keys(output || {}).join(', ')}`);
      this.logger.debug(`   📋 Metadata keys: ${Object.keys(metadata || {}).join(', ')}`);

      trace.end({
        outputs: output,
        extra: metadata ? { metadata } : undefined,
      });

      // Patch the run to update it and wait for completion
      try {
        await trace.patchRun();
        this.logger.log(`✅ LangSmith trace finalized successfully: ${trace.id}`);

        // Get the project name for the URL
        const projectName = this.configService.get<string>('LANGSMITH_PROJECT', 'expense-processing-default');
        this.logger.log(`   🔗 Final Trace URL: https://smith.langchain.com/o/default/projects/p/${projectName}/r/${trace.id}`);
      } catch (patchError) {
        this.logger.error(`❌ Failed to finalize LangSmith trace ${trace.id}:`, patchError);
        this.logger.error('   Error details:', patchError.message);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to finalize LangSmith trace:`, error);
      this.logger.error('   Error details:', error.message);
    }
  }

  /**
   * Flush pending traces and generations
   */
  async flush(): Promise<void> {
    this.logger.debug(`🔍 LangSmith flush called - Enabled: ${this.isEnabled}, Client: ${!!this.langsmith}`);

    if (!this.isEnabled || !this.langsmith) {
      this.logger.warn('❌ LangSmith flush skipped - service not enabled or client not initialized');
      return;
    }

    try {
      this.logger.log('🚿 Flushing LangSmith data...');
      await this.langsmith.flush();
      this.logger.log('✅ LangSmith data flushed successfully');
    } catch (error) {
      this.logger.error('❌ Failed to flush LangSmith data:', error);
      this.logger.error('   Error details:', error.message);
    }
  }

  /**
   * Score a generation
   */
  async scoreGeneration(
    generationId: string,
    name: string,
    value: number,
    comment?: string
  ): Promise<void> {
    if (!this.isEnabled || !this.langsmith) {
      return;
    }

    try {
      await this.langsmith.createFeedback(
        generationId,
        name,
        {
          score: value,
          comment,
        }
      );
    } catch (error) {
      this.logger.error('Failed to score LangSmith generation:', error);
    }
  }

  /**
   * Get prompt template (placeholder for compatibility)
   */
  async getPrompt(name: string, _version?: number): Promise<PromptTemplate | null> {
    // LangSmith doesn't have the same prompt management as Langfuse
    // This is a placeholder for compatibility with existing code
    this.logger.warn(`LangSmith prompt management not implemented for: ${name}`);
    return null;
  }

  /**
   * Create dataset (placeholder for compatibility)
   */
  async createDataset(name: string, description?: string): Promise<any> {
    if (!this.isEnabled || !this.langsmith) {
      return null;
    }

    try {
      return await this.langsmith.createDataset(name, {
        description,
      });
    } catch (error) {
      this.logger.error('Failed to create LangSmith dataset:', error);
      return null;
    }
  }

  /**
   * Add item to dataset (placeholder for compatibility)
   */
  async addDatasetItem(datasetId: string, item: ExpenseDatasetItem): Promise<void> {
    if (!this.isEnabled || !this.langsmith) {
      return;
    }

    try {
      await this.langsmith.createExample({
        dataset_id: datasetId,
        inputs: item.input,
        outputs: item.expected_output,
        metadata: item.metadata,
      });
    } catch (error) {
      this.logger.error('Failed to add LangSmith dataset item:', error);
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(): { enabled: boolean; connected: boolean } {
    return {
      enabled: this.isEnabled,
      connected: this.langsmith !== null,
    };
  }
}
