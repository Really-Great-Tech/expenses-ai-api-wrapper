import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Langfuse } from "langfuse";
import type { LangfuseGenerationClient, LangfuseTraceClient } from "langfuse";
import * as fs from "fs";
import * as path from "path";
import * as mime from "mime-types";
import { PromptTemplate } from "../interfaces/prompt-management.interface";

export interface LangfuseTraceData {
  name: string;
  input?: any;
  output?: any;
  metadata?: Record<string, any>;
  tags?: string[];
  userId?: string;
  sessionId?: string;
  // New fields for hierarchical user system
  actualUserId?: string;
  jobId?: string;
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
  prompt?: any; // Add prompt object for linking
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
    complianceData?: any;
    extractedDataJson?: string;
    extractedData?: any;

    // ImageQualityAssessmentAgent inputs
    userPrompt?: string;
    imagePath?: string;
    imageInfo?: string;
    assessmentType?: string;

    // Legacy fields
    documentType?: string;
    filename?: string;
  };
  expectedOutput: {
    classification?: any;
    extraction?: any;
    compliance?: any;
    citations?: any;
    image_quality_assessment?: any;
  };
  metadata: {
    filename: string;
    processingComplexity: "simple" | "medium" | "complex";
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
      // Properly parse boolean from environment variable string
      const langfuseEnabledStr = this.configService.get<string>(
        "LANGFUSE_ENABLED",
        "false"
      );
      this.isEnabled = langfuseEnabledStr.toLowerCase() === "true";

      if (!this.isEnabled) {
        this.logger.log("Langfuse is disabled");
        return;
      }

      const secretKey = this.configService.get<string>("LANGFUSE_SECRET_KEY");
      const publicKey = this.configService.get<string>("LANGFUSE_PUBLIC_KEY");
      const baseUrl = this.configService.get<string>(
        "LANGFUSE_BASE_URL",
        "http://localhost:3001"
      );

      if (!secretKey || !publicKey) {
        this.logger.warn(
          "Langfuse credentials not provided, disabling Langfuse integration"
        );
        this.isEnabled = false;
        return;
      }

      this.langfuse = new Langfuse({
        secretKey,
        publicKey,
        baseUrl,
      });

      this.logger.log(
        `Langfuse initialized successfully with baseUrl: ${baseUrl}`
      );
    } catch (error) {
      this.logger.error("Failed to initialize Langfuse:", error);
      this.isEnabled = false;
    }
  }

  /**
   * Create a new trace for expense processing with hierarchical user support
   */
  createTrace(data: LangfuseTraceData): LangfuseTraceClient | null {
    if (!this.isEnabled || !this.langfuse) {
      return null;
    }

    try {
      // Use actualUserId as the primary userId for Langfuse grouping
      // This allows multiple jobs to be grouped under one actual user
      const effectiveUserId = data.actualUserId || data.userId;
      const effectiveSessionId = data.sessionId;

      // Enhanced metadata to include job-level information
      const enhancedMetadata = {
        ...data.metadata,
        // Hierarchical user information
        actual_user_id: data.actualUserId,
        job_id: data.jobId,
        legacy_user_id: data.userId, // Keep for backward compatibility
        // Trace grouping information
        trace_type: data.actualUserId ? 'hierarchical' : 'legacy',
        user_system_version: '2.0',
      };

      // Enhanced tags for better filtering and organization
      const enhancedTags = [
        ...(data.tags || []),
        // Add system tags
        data.actualUserId ? 'hierarchical-user' : 'legacy-user',
        data.jobId ? `job:${data.jobId}` : undefined,
        data.actualUserId ? `user:${data.actualUserId}` : undefined,
      ].filter(Boolean) as string[];

      return this.langfuse.trace({
        name: data.name,
        input: data.input,
        output: data.output,
        metadata: enhancedMetadata,
        tags: enhancedTags,
        userId: effectiveUserId, // This is what Langfuse uses for grouping
        sessionId: effectiveSessionId,
      });
    } catch (error) {
      this.logger.error("Failed to create trace:", error);
      return null;
    }
  }

  /**
   * Create a trace with automatic user session resolution
   */
  createTraceWithUserSession(
    data: Omit<LangfuseTraceData, 'actualUserId' | 'sessionId'>,
    jobId: string,
    userSessionService?: any // Import will be added later
  ): LangfuseTraceClient | null {
    if (!userSessionService) {
      // Fallback to regular trace creation
      return this.createTrace(data);
    }

    try {
      // Get user information from job ID
      const jobMapping = userSessionService.getJobMapping(jobId);
      
      if (jobMapping) {
        // Create trace with hierarchical user information
        return this.createTrace({
          ...data,
          actualUserId: jobMapping.actualUserId,
          sessionId: jobMapping.sessionId,
          jobId: jobId,
          metadata: {
            ...data.metadata,
            job_filename: jobMapping.filename,
            job_country: jobMapping.country,
            job_icp: jobMapping.icp,
            job_created_at: jobMapping.createdAt.toISOString(),
          },
        });
      } else {
        // Fallback to legacy mode
        this.logger.warn(`No job mapping found for jobId: ${jobId}, using legacy trace creation`);
        return this.createTrace({
          ...data,
          userId: jobId, // Legacy behavior
        });
      }
    } catch (error) {
      this.logger.error("Failed to create trace with user session:", error);
      // Fallback to regular trace creation
      return this.createTrace(data);
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
        prompt: data.prompt, // Pass prompt object for linking
      });
    } catch (error) {
      this.logger.error("Failed to create generation:", error);
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
      this.logger.error("Failed to update generation:", error);
    }
  }

  /**
   * Add tags to an existing trace
   */
  addTagsToTrace(trace: LangfuseTraceClient | null, tags: string[]): void {
    if (!this.isEnabled || !trace || !tags.length) {
      return;
    }

    try {
      // Update trace with additional tags
      trace.update({
        tags: tags,
      });
    } catch (error) {
      this.logger.error("Failed to add tags to trace:", error);
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
      this.logger.error("Failed to finalize trace:", error);
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
      if (error.message?.includes("already exists")) {
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
      this.logger.log(
        `Added item to dataset '${datasetName}': ${item.metadata.filename}`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to add item to dataset '${datasetName}':`,
        error
      );
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
      this.logger.error("Failed to flush Langfuse data:", error);
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
      this.logger.error("Failed to score generation:", error);
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
      this.logger.error("Failed to create experiment run:", error);
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
      this.logger.log(
        `Experiment result logged for run ${runId}: ${datasetItemId}`
      );
    } catch (error) {
      this.logger.error("Failed to log experiment result:", error);
    }
  }

  /**
   * Add file attachment to a trace
   */
  async addTraceAttachment(
    trace: LangfuseTraceClient | null,
    filePath: string,
    options: {
      name?: string;
      description?: string;
      maxSizeMB?: number;
    } = {}
  ): Promise<boolean> {
    if (!this.isEnabled || !this.langfuse || !trace || !filePath) {
      return false;
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`File not found for attachment: ${filePath}`);
        return false;
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      const maxSizeMB = options.maxSizeMB || 10; // Default 10MB limit

      // Check file size
      if (fileSizeMB > maxSizeMB) {
        this.logger.warn(
          `File too large for attachment: ${fileSizeMB.toFixed(2)}MB > ${maxSizeMB}MB`
        );
        return false;
      }

      // Read and encode file
      const fileBuffer = fs.readFileSync(filePath);
      const base64Content = fileBuffer.toString("base64");

      // Get file info
      const fileName = options.name || path.basename(filePath);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const fileExtension = path.extname(filePath);

      // Create attachment data
      const attachmentData = {
        name: fileName,
        contentType: mimeType,
        data: base64Content,
        metadata: {
          originalPath: filePath,
          fileSize: stats.size,
          fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
          extension: fileExtension,
          description: options.description || `Attached file: ${fileName}`,
          uploadedAt: new Date().toISOString(),
        },
      };

      // Add attachment to trace
      // Note: Langfuse attachment API might vary, this is a generic approach
      const currentMetadata = (trace as any).metadata || {};
      (trace as any).update({
        metadata: {
          ...currentMetadata,
          attachments: [...(currentMetadata.attachments || []), attachmentData],
        },
      });

      this.logger.log(
        `File attached to trace: ${fileName} (${fileSizeMB.toFixed(2)}MB)`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to attach file to trace: ${error.message}`,
        error
      );
      return false;
    }
  }

  async getPrompt(
    name: string,
    fallbackPrompt?: string,
    options?: {
      version?: number;
      label?: string;
      type?: "text" | "chat";
    }
  ): Promise<PromptTemplate> {
    if (!this.isEnabled) {
      return this.createFallbackPrompt(fallbackPrompt || "");
    }

    try {
      // Handle text and chat prompts separately due to TypeScript overloads
      if (options?.type === "chat") {
        const prompt = await this.langfuse.getPrompt(name, options?.version, {
          label: options?.label || "production",
          type: "chat",
        });
        this.logger.debug(`Successfully fetched chat prompt: ${name}`);
        return prompt;
      } else {
        const prompt = await this.langfuse.getPrompt(name, options?.version, {
          label: options?.label || "production",
          type: "text",
        });
        this.logger.debug(`Successfully fetched text prompt: ${name}`);
        return prompt;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch prompt ${name}, using fallback: ${error.message}`
      );
      return this.createFallbackPrompt(fallbackPrompt || "");
    }
  }

  /**
   * Add file attachment to a generation
   */
  async addGenerationAttachment(
    generation: LangfuseGenerationClient | null,
    filePath: string,
    options: {
      name?: string;
      description?: string;
      maxSizeMB?: number;
    } = {}
  ): Promise<boolean> {
    if (!this.isEnabled || !this.langfuse || !generation || !filePath) {
      return false;
    }

    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        this.logger.warn(`File not found for attachment: ${filePath}`);
        return false;
      }

      // Get file stats
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      const maxSizeMB = options.maxSizeMB || 5; // Default 5MB limit for generations

      // Check file size
      if (fileSizeMB > maxSizeMB) {
        this.logger.warn(
          `File too large for generation attachment: ${fileSizeMB.toFixed(2)}MB > ${maxSizeMB}MB`
        );
        return false;
      }

      // Read and encode file
      const fileBuffer = fs.readFileSync(filePath);
      const base64Content = fileBuffer.toString("base64");

      // Get file info
      const fileName = options.name || path.basename(filePath);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const fileExtension = path.extname(filePath);

      // Create attachment data
      const attachmentData = {
        name: fileName,
        contentType: mimeType,
        data: base64Content,
        metadata: {
          originalPath: filePath,
          fileSize: stats.size,
          fileSizeMB: parseFloat(fileSizeMB.toFixed(2)),
          extension: fileExtension,
          description: options.description || `Attached file: ${fileName}`,
          uploadedAt: new Date().toISOString(),
        },
      };

      // Add attachment to generation metadata
      const currentMetadata = (generation as any).metadata || {};
      (generation as any).update({
        metadata: {
          ...currentMetadata,
          attachments: [...(currentMetadata.attachments || []), attachmentData],
        },
      });

      this.logger.log(
        `File attached to generation: ${fileName} (${fileSizeMB.toFixed(2)}MB)`
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to attach file to generation: ${error.message}`,
        error
      );
      return false;
    }
  }

  async createPrompt(config: {
    name: string;
    type: "text" | "chat";
    prompt: string | any[];
    labels?: string[];
    config?: any;
  }): Promise<void> {
    if (!this.isEnabled) {
      this.logger.warn("Langfuse not enabled, skipping prompt creation");
      return;
    }

    try {
      // Handle text and chat prompts separately due to TypeScript overloads
      if (config.type === "chat") {
        await this.langfuse.createPrompt({
          name: config.name,
          type: "chat",
          prompt: config.prompt as any[],
          labels: config.labels,
          config: config.config,
        });
      } else {
        await this.langfuse.createPrompt({
          name: config.name,
          type: "text",
          prompt: config.prompt as string,
          labels: config.labels,
          config: config.config,
        });
      }
      this.logger.log(`Successfully created/updated prompt: ${config.name}`);
    } catch (error) {
      this.logger.error(`Failed to create prompt ${config.name}:`, error);
      throw error;
    }
  }

  /**
   * Get file info without attaching (for validation)
   */
  getFileInfo(filePath: string): {
    exists: boolean;
    size?: number;
    sizeMB?: number;
    mimeType?: string;
    extension?: string;
    name?: string;
  } {
    try {
      if (!fs.existsSync(filePath)) {
        return { exists: false };
      }

      const stats = fs.statSync(filePath);
      const sizeMB = stats.size / (1024 * 1024);

      return {
        exists: true,
        size: stats.size,
        sizeMB: parseFloat(sizeMB.toFixed(2)),
        mimeType: mime.lookup(filePath) || "application/octet-stream",
        extension: path.extname(filePath),
        name: path.basename(filePath),
      };
    } catch (error) {
      this.logger.error(`Failed to get file info: ${error.message}`);
      return { exists: false };
    }
  }

  /**
   * Create trace with file attachment
   */
  async createTraceWithAttachment(
    data: LangfuseTraceData,
    filePath: string,
    attachmentOptions: {
      name?: string;
      description?: string;
      maxSizeMB?: number;
    } = {}
  ): Promise<LangfuseTraceClient | null> {
    // Create the trace first
    const trace = this.createTrace(data);

    if (trace && filePath) {
      // Add the attachment
      await this.addTraceAttachment(trace, filePath, attachmentOptions);
    }

    return trace;
  }

  private createFallbackPrompt(prompt: string): PromptTemplate {
    return {
      compile: (variables: Record<string, any>) => {
        let compiledPrompt = prompt;
        for (const [key, value] of Object.entries(variables)) {
          const placeholder = `{{${key}}}`;
          compiledPrompt = compiledPrompt.replace(
            new RegExp(placeholder, "g"),
            String(value)
          );
        }
        return compiledPrompt;
      },
      prompt,
      config: {},
    };
  }
}
