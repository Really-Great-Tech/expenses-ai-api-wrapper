import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Langfuse } from 'langfuse';
import type { 
  LangfuseGenerationClient, 
  LangfuseTraceClient
} from 'langfuse';

export interface LangfuseTraceData {
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  tags?: string[];
  userId?: string;
  sessionId?: string;
}

export interface LangfuseGenerationData {
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
}

export interface ExpenseDatasetItem {
  input: {
    markdownContent: string;
    country: string;
    documentType?: string;
    filename: string;
  };
  expectedOutput: {
    classification?: any;
    extraction?: any;
    compliance?: any;
    citations?: any;
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
export class LangfuseService implements OnModuleInit {
  private readonly logger = new Logger(LangfuseService.name);
  private langfuse: Langfuse | null = null;
  private isEnabled: boolean = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      this.isEnabled = this.configService.get<boolean>('LANGFUSE_ENABLED', false);
      
      if (!this.isEnabled) {
        this.logger.log('Langfuse is disabled');
        return;
      }

      const secretKey = this.configService.get<string>('LANGFUSE_SECRET_KEY');
      const publicKey = this.configService.get<string>('LANGFUSE_PUBLIC_KEY');
      const baseUrl = this.configService.get<string>('LANGFUSE_BASE_URL', 'http://localhost:3001');

      if (!secretKey || !publicKey) {
        this.logger.warn('Langfuse credentials not provided, disabling Langfuse integration');
        this.isEnabled = false;
        return;
      }

      this.langfuse = new Langfuse({
        secretKey,
        publicKey,
        baseUrl,
      });

      this.logger.log(`Langfuse initialized successfully with baseUrl: ${baseUrl}`);
    } catch (error) {
      this.logger.error('Failed to initialize Langfuse:', error);
      this.isEnabled = false;
    }
  }

  /**
   * Create a new trace for expense processing
   */
  createTrace(data: LangfuseTraceData): LangfuseTraceClient | null {
    if (!this.isEnabled || !this.langfuse) {
      return null;
    }

    try {
      return this.langfuse.trace({
        name: data.name,
        input: data.input,
        output: data.output,
        metadata: data.metadata,
        tags: data.tags,
        userId: data.userId,
        sessionId: data.sessionId,
      });
    } catch (error) {
      this.logger.error('Failed to create trace:', error);
      return null;
    }
  }

  /**
   * Create a generation within a trace
   */
  createGeneration(
    trace: LangfuseTraceClient | null,
    data: LangfuseGenerationData
  ): LangfuseGenerationClient | null {
    if (!this.isEnabled || !this.langfuse || !trace) {
      return null;
    }

    try {
      return trace.generation({
        name: data.name,
        input: data.input,
        output: data.output,
        model: data.model,
        modelParameters: data.modelParameters,
        usage: data.usage,
        metadata: data.metadata,
        startTime: data.startTime,
        endTime: data.endTime,
      });
    } catch (error) {
      this.logger.error('Failed to create generation:', error);
      return null;
    }
  }

  /**
   * Update generation with completion data
   */
  updateGeneration(
    generation: LangfuseGenerationClient | null,
    data: Partial<LangfuseGenerationData>
  ): void {
    if (!this.isEnabled || !generation) {
      return;
    }

    try {
      generation.update({
        output: data.output,
        usage: data.usage,
        endTime: data.endTime,
        metadata: data.metadata,
      });
    } catch (error) {
      this.logger.error('Failed to update generation:', error);
    }
  }

  /**
   * Finalize trace with completion data
   */
  finalizeTrace(
    trace: LangfuseTraceClient | null,
    output?: any,
    metadata?: Record<string, any>
  ): void {
    if (!this.isEnabled || !trace) {
      return;
    }

    try {
      trace.update({
        output,
        metadata,
      });
    } catch (error) {
      this.logger.error('Failed to finalize trace:', error);
    }
  }

  /**
   * Create or get a dataset for expense processing
   */
  async createDataset(name: string, description?: string): Promise<boolean> {
    if (!this.isEnabled || !this.langfuse) {
      return false;
    }

    try {
      const datasetRequest = {
        name,
        description: description || `Dataset for ${name} experiments`,
      };

      await this.langfuse.createDataset(datasetRequest);
      this.logger.log(`Dataset '${name}' created successfully`);
      return true;
    } catch (error) {
      // Dataset might already exist, which is fine
      if (error.message?.includes('already exists')) {
        this.logger.log(`Dataset '${name}' already exists`);
        return true;
      }
      this.logger.error(`Failed to create dataset '${name}':`, error);
      return false;
    }
  }

  /**
   * Add item to dataset
   */
  async addDatasetItem(
    datasetName: string,
    item: ExpenseDatasetItem
  ): Promise<boolean> {
    if (!this.isEnabled || !this.langfuse) {
      return false;
    }

    try {
      const datasetItem = {
        datasetName,
        input: item.input,
        expectedOutput: item.expectedOutput,
        metadata: item.metadata,
      };

      await this.langfuse.createDatasetItem(datasetItem);
      this.logger.log(`Added item to dataset '${datasetName}': ${item.metadata.filename}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to add item to dataset '${datasetName}':`, error);
      return false;
    }
  }

  /**
   * Flush pending traces and generations
   */
  async flush(): Promise<void> {
    if (!this.isEnabled || !this.langfuse) {
      return;
    }

    try {
      await this.langfuse.flushAsync();
    } catch (error) {
      this.logger.error('Failed to flush Langfuse data:', error);
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
    if (!this.isEnabled || !this.langfuse) {
      return;
    }

    try {
      await this.langfuse.score({
        traceId: generationId,
        name,
        value,
        comment,
      });
    } catch (error) {
      this.logger.error('Failed to score generation:', error);
    }
  }

  /**
   * Get health status
   */
  getHealthStatus(): { enabled: boolean; connected: boolean } {
    return {
      enabled: this.isEnabled,
      connected: this.langfuse !== null,
    };
  }

  /**
   * Create experiment run
   */
  async createExperimentRun(
    experimentName: string,
    datasetName: string,
    promptName: string,
    promptVersion?: number
  ): Promise<string | null> {
    if (!this.isEnabled || !this.langfuse) {
      return null;
    }

    try {
      // Note: This is a simplified version. In a real implementation,
      // you'd use Langfuse's experiment API when it's available
      const runId = `${experimentName}-${Date.now()}`;
      this.logger.log(`Created experiment run: ${runId}`);
      return runId;
    } catch (error) {
      this.logger.error('Failed to create experiment run:', error);
      return null;
    }
  }

  /**
   * Log experiment result
   */
  async logExperimentResult(
    runId: string,
    datasetItemId: string,
    result: any,
    metrics?: Record<string, number>
  ): Promise<void> {
    if (!this.isEnabled || !this.langfuse) {
      return;
    }

    try {
      // This would typically be handled by Langfuse's experiment API
      this.logger.log(`Experiment result logged for run ${runId}: ${datasetItemId}`);
    } catch (error) {
      this.logger.error('Failed to log experiment result:', error);
    }
  }
}
