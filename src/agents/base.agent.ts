import { Logger } from '@nestjs/common';
import { LangfuseService } from '../services/langfuse.service';
import { PromptTemplate } from '../interfaces/prompt-management.interface';

/**
 * Interface for storing prompt information for trace association
 */
interface PromptInfo {
  name: string;
  version?: number;
  config?: any;
}

/**
 * Base class for all agents with prompt management capabilities
 */
export abstract class BaseAgent {
  protected readonly logger = new Logger(this.constructor.name);
  protected lastPromptInfo?: PromptInfo;

  constructor(
    protected readonly langfuseService?: LangfuseService
  ) {}

  /**
   * Get a prompt template from Langfuse - NO FALLBACKS
   * Complete migration to Langfuse prompt management
   */
  protected async getPromptTemplate(
    promptName: string,
    variables?: Record<string, any>
  ): Promise<string> {
    if (!this.langfuseService) {
      throw new Error('LangfuseService is required for prompt management');
    }

    try {
      // Get prompt from Langfuse (no fallback)
      const promptTemplate = await this.langfuseService.getPrompt(promptName);

      if (!promptTemplate) {
        throw new Error(`Prompt ${promptName} not found in Langfuse`);
      }

      // Debug logging for prompt retrieval
      this.logger.debug(`📋 Retrieved prompt from Langfuse: ${promptName}`);
      this.logger.debug(`📋 Prompt version: ${promptTemplate.version || 'unknown'}`);
      this.logger.debug(`📋 Prompt config: ${JSON.stringify(promptTemplate.config || {})}`);
      
      // Store prompt info for trace association
      this.lastPromptInfo = {
        name: promptName,
        version: promptTemplate.version,
        config: promptTemplate.config
      };

      // Compile prompt with variables
      const compiled = promptTemplate.compile(variables || {});
      return typeof compiled === 'string' ? compiled : String(compiled);
    } catch (error) {
      this.logger.error(`Failed to get prompt ${promptName} from Langfuse: ${error.message}`);
      throw new Error(`Prompt ${promptName} is required but not available in Langfuse`);
    }
  }

  /**
   * Link a prompt to a Langfuse generation for metrics tracking
   */
  protected async linkPromptToGeneration(
    promptName: string,
    generation: any,
    variables?: Record<string, any>
  ): Promise<void> {
    try {
      if (!this.langfuseService || !generation) return;

      // Get the prompt template for linking
      const promptTemplate = await this.langfuseService.getPrompt(promptName);
      
      // Note: Prompt linking will be handled during generation creation
      // The Langfuse SDK handles prompt linking automatically when prompt is passed during generation creation
    } catch (error) {
      this.logger.warn(`Failed to link prompt ${promptName} to generation: ${error.message}`);
    }
  }

  /**
   * Compile a fallback prompt with variables (for when Langfuse is unavailable)
   */
  private compileFallbackPrompt(prompt: string, variables: Record<string, any>): string {
    let compiledPrompt = prompt;
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      compiledPrompt = compiledPrompt.replace(new RegExp(placeholder, 'g'), String(value));
    }
    return compiledPrompt;
  }

  /**
   * Get prompt metadata for trace association
   */
  protected getPromptMetadata(): Record<string, any> {
    if (!this.lastPromptInfo) {
      return {};
    }

    return {
      promptName: this.lastPromptInfo.name,
      promptVersion: this.lastPromptInfo.version || 'unknown',
      promptConfig: this.lastPromptInfo.config || {}
    };
  }

  /**
   * Generate prompt version tags for traces
   */
  protected getPromptVersionTags(): string[] {
    if (!this.lastPromptInfo) {
      return [];
    }

    const tags: string[] = [];
    const version = this.lastPromptInfo.version ? String(this.lastPromptInfo.version) : 'unknown';
    
    // Add prompt-specific version tag
    tags.push(`${this.lastPromptInfo.name}-v${version}`);
    
    // Add general version tag if version is known
    if (version !== 'unknown') {
      tags.push(`prompt-v${version}`);
    }

    return tags;
  }

  /**
   * Generate all prompt version tags from multiple prompts used in an agent
   */
  protected getAllPromptVersionTags(promptInfos: PromptInfo[]): string[] {
    const tags: string[] = [];
    const versions = new Set<string>();

    for (const promptInfo of promptInfos) {
      const version = promptInfo.version ? String(promptInfo.version) : 'unknown';
      
      // Add prompt-specific version tag
      tags.push(`${promptInfo.name}-v${version}`);
      
      // Collect unique versions
      if (version !== 'unknown') {
        versions.add(version);
      }
    }

    // Add general version tags for unique versions
    versions.forEach(version => {
      tags.push(`prompt-v${version}`);
    });

    return tags;
  }

  /**
   * Create a prompt template object for backward compatibility
   */
  protected createPromptTemplate(prompt: string): PromptTemplate {
    return {
      compile: (variables: Record<string, any>) => {
        return this.compileFallbackPrompt(prompt, variables);
      },
      prompt,
      config: {}
    };
  }
}
