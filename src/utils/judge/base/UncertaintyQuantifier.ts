import { LLM } from 'llamaindex';
import { UQResult, ProgressCallback } from '../types';

export abstract class UncertaintyQuantifier {
  protected llm?: LLM;
  protected systemPrompt: string;
  protected maxCallsPerMin?: number;
  protected postprocessor?: (text: string) => string;
  protected progressCallback?: ProgressCallback;

  constructor(options: {
    llm?: LLM;
    systemPrompt?: string;
    maxCallsPerMin?: number;
    postprocessor?: (text: string) => string;
  } = {}) {
    this.llm = options.llm;
    this.systemPrompt = options.systemPrompt || "You are a helpful assistant.";
    this.maxCallsPerMin = options.maxCallsPerMin;
    this.postprocessor = options.postprocessor;
  }

  protected async generateResponses(
    prompts: string[],
    count: number = 1,
    temperature?: number
  ): Promise<{ responses: string[]; logprobs?: any[] }> {
    if (!this.llm) {
      throw new Error("LLM must be provided to generate responses.");
    }

    const responses: string[] = [];
    const logprobs: any[] = [];

    try {
      for (let i = 0; i < prompts.length; i++) {
        if (this.progressCallback) {
          this.progressCallback(i, prompts.length, "Generating responses...");
        }

        for (let j = 0; j < count; j++) {
          const response = await this.llm.complete({
            prompt: prompts[i],
            ...(temperature !== undefined && { temperature })
          });
          
          responses.push(response.text);
          logprobs.push(response.raw || null);

          // Simple rate limiting
          if (this.maxCallsPerMin && j < count - 1) {
            await this.delay(60000 / this.maxCallsPerMin);
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to generate responses: ${error}`);
    }

    return { responses, logprobs };
  }

  protected async generateOriginalResponses(prompts: string[]): Promise<string[]> {
    const { responses } = await this.generateResponses(prompts, 1);
    
    if (this.postprocessor) {
      return responses.map(r => this.postprocessor!(r));
    }
    
    return responses;
  }

  protected async generateCandidateResponses(
    prompts: string[],
    numResponses: number,
    samplingTemperature: number = 1.0
  ): Promise<string[][]> {
    const { responses } = await this.generateResponses(
      prompts,
      numResponses,
      samplingTemperature
    );

    const sampledResponses: string[][] = [];
    for (let i = 0; i < prompts.length; i++) {
      const start = i * numResponses;
      const end = (i + 1) * numResponses;
      let responseBatch = responses.slice(start, end);
      
      if (this.postprocessor) {
        responseBatch = responseBatch.map(r => this.postprocessor!(r));
      }
      
      sampledResponses.push(responseBatch);
    }

    return sampledResponses;
  }

  protected delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public setProgressCallback(callback: ProgressCallback): void {
    this.progressCallback = callback;
  }

  abstract generateAndScore(
    prompts: string[],
    numResponses?: number,
    showProgressBars?: boolean
  ): Promise<UQResult>;

  abstract score(
    prompts: string[],
    responses: string[],
    sampledResponses?: string[][],
    showProgressBars?: boolean
  ): Promise<UQResult>;
}
