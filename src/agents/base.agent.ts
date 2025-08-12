import { Logger } from '@nestjs/common';
import { LangfuseService } from '../services/langfuse.service';
import { LangSmithService } from '../services/langsmith.service';
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
    protected readonly langfuseService?: LangfuseService,
    protected readonly langsmithService?: LangSmithService
  ) {}

  /**
   * Get a prompt template from LangSmith - HARD SWITCH FROM LANGFUSE
   * Complete migration to LangSmith prompt management
   */
  protected async getPromptTemplate(
    promptName: string,
    variables?: Record<string, any>
  ): Promise<string> {
    if (!this.langsmithService) {
      throw new Error('LangSmithService is required for prompt management');
    }

    try {
      // Get prompt from LangSmith (hard switch from Langfuse)
      const promptResult = await this.langsmithService.pullPrompt(promptName);

      if (!promptResult) {
        throw new Error(`Prompt ${promptName} not found in LangSmith`);
      }

      const { prompt: promptTemplate, metadata: promptMetadata } = promptResult;

      // Debug logging for prompt retrieval
      this.logger.debug(`📋 Retrieved prompt from LangSmith: ${promptName}`);
      this.logger.debug(`📋 Prompt is string: ${typeof promptTemplate === 'string'}, has template: ${!!promptTemplate.template}, has invoke: ${typeof promptTemplate.invoke === 'function'}`);

      if (promptMetadata.commitHash) {
        this.logger.debug(`🔗 Commit hash: ${promptMetadata.commitHash}`);
      }

      // Store prompt info for trace association (using LangSmith's metadata)
      this.lastPromptInfo = {
        name: promptName,
        version: 1, // LangSmith handles versioning internally
        config: {
          commitHash: promptMetadata.commitHash,
          source: 'langsmith'
        }
      };

      // Compile prompt with variables - handle LangSmith prompt formats
      let compiled: string;

      if (typeof promptTemplate === 'string') {
        // Check if the string is actually a serialized LangChain object
        if (promptTemplate.startsWith('{"lc":1,"type":"constructor"')) {
          this.logger.debug(`🔧 Detected serialized LangChain object, parsing...`);
          try {
            const parsedTemplate = JSON.parse(promptTemplate);
            if (parsedTemplate.kwargs && parsedTemplate.kwargs.template) {
              this.logger.debug(`✅ Extracted template from serialized LangChain object`);
              compiled = parsedTemplate.kwargs.template;
              Object.entries(variables || {}).forEach(([key, value]) => {
                const regex = new RegExp(`\\{${key}\\}`, 'g');
                compiled = compiled.replace(regex, String(value));
              });
            } else {
              this.logger.error(`❌ Serialized object missing template property`);
              compiled = promptTemplate;
            }
          } catch (parseError) {
            this.logger.error(`❌ Failed to parse serialized LangChain object:`, parseError);
            compiled = promptTemplate;
          }
        } else {
          // Simple string template (most common from LangSmith)
          this.logger.debug(`🔧 Processing string template`);
          compiled = promptTemplate;
          Object.entries(variables || {}).forEach(([key, value]) => {
            const regex = new RegExp(`\\{${key}\\}`, 'g');
            compiled = compiled.replace(regex, String(value));
          });
        }
      } else if (typeof promptTemplate.invoke === 'function') {
        // Try to invoke the prompt if it's a LangChain prompt object
        try {
          this.logger.debug(`🔧 Attempting to invoke LangChain prompt with variables: ${Object.keys(variables || {}).join(', ')}`);
          const invokedPrompt = await promptTemplate.invoke(variables || {});
          if (typeof invokedPrompt === 'string') {
            compiled = invokedPrompt;
          } else if (invokedPrompt.content) {
            compiled = invokedPrompt.content;
          } else if (Array.isArray(invokedPrompt)) {
            compiled = invokedPrompt.map((msg: any) => `${msg.role || 'user'}: ${msg.content || msg}`).join('\n\n');
          } else {
            compiled = JSON.stringify(invokedPrompt);
          }
          this.logger.debug(`✅ Successfully invoked LangChain prompt`);
        } catch (invokeError) {
          this.logger.warn(`❌ Failed to invoke LangSmith prompt:`, invokeError);
          // If invoke fails, try to extract template and process manually
          if (promptTemplate.template) {
            this.logger.debug(`🔧 Fallback: Using template property for manual substitution`);
            compiled = promptTemplate.template;
            Object.entries(variables || {}).forEach(([key, value]) => {
              const regex = new RegExp(`\\{${key}\\}`, 'g');
              compiled = compiled.replace(regex, String(value));
            });
          } else {
            this.logger.error(`❌ No template property found, using string conversion`);
            compiled = String(promptTemplate);
          }
        }
      } else if (promptTemplate.template) {
        // PromptTemplate format
        this.logger.debug(`🔧 Processing template property`);
        compiled = promptTemplate.template;
        Object.entries(variables || {}).forEach(([key, value]) => {
          const regex = new RegExp(`\\{${key}\\}`, 'g');
          compiled = compiled.replace(regex, String(value));
        });
      } else if (promptTemplate.messages) {
        // ChatPromptTemplate format - convert to string
        this.logger.debug(`🔧 Processing messages array`);
        const messages = promptTemplate.messages.map((message: any) => {
          let content = message.content || '';
          Object.entries(variables || {}).forEach(([key, value]) => {
            const regex = new RegExp(`\\{${key}\\}`, 'g');
            content = content.replace(regex, String(value));
          });
          return `${message.role || 'user'}: ${content}`;
        });
        compiled = messages.join('\n\n');
      } else {
        // Fallback: convert to string and try variable substitution
        this.logger.error(`❌ Unknown prompt format, using string conversion fallback`);
        compiled = String(promptTemplate);
        Object.entries(variables || {}).forEach(([key, value]) => {
          const regex = new RegExp(`\\{${key}\\}`, 'g');
          compiled = compiled.replace(regex, String(value));
        });
      }

      this.logger.debug(`✅ Successfully compiled prompt '${promptName}' from LangSmith`);
      this.logger.debug(`📝 Final compiled prompt preview: ${compiled.substring(0, 500)}...`);
      return compiled;
    } catch (error) {
      this.logger.error(`Failed to get prompt ${promptName} from LangSmith: ${error.message}`);
      throw new Error(`Prompt ${promptName} is required but not available in LangSmith`);
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
   * Get the last prompt info (public accessor)
   */
  public getLastPromptInfo(): PromptInfo | undefined {
    return this.lastPromptInfo;
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
