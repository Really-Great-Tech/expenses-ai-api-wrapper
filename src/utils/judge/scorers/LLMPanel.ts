import { LLM } from 'llamaindex';
import { UncertaintyQuantifier } from '../base/UncertaintyQuantifier';
import { LLMJudge } from '../judges/LLMJudge';
import { UQResult } from '../types';

export class LLMPanel extends UncertaintyQuantifier {
  private judges: LLMJudge[];
  private scoringTemplates: string[];

  constructor(options: {
    judges: (LLMJudge | LLM)[];
    llm?: LLM;
    systemPrompt?: string;
    maxCallsPerMin?: number;
    scoringTemplates?: string[];
  }) {
    super({
      llm: options.llm,
      systemPrompt: options.systemPrompt,
      maxCallsPerMin: options.maxCallsPerMin
    });

    this.scoringTemplates = options.scoringTemplates || 
      new Array(options.judges.length).fill('true_false_uncertain');

    if (this.scoringTemplates.length !== options.judges.length) {
      throw new Error("Length of scoringTemplates must equal length of judges");
    }

    this.judges = options.judges.map((judge, index) => {
      if (judge instanceof LLMJudge) {
        return judge;
      } else {
        // Assume it's an LLM and create an LLMJudge
        return new LLMJudge({
          llm: judge as LLM,
          maxCallsPerMin: options.maxCallsPerMin,
          scoringTemplate: this.scoringTemplates[index]
        });
      }
    });
  }

  async generateAndScore(
    prompts: string[],
    numResponses?: number,
    showProgressBars?: boolean
  ): Promise<UQResult> {
    if (this.progressCallback) {
      this.progressCallback(0, prompts.length, "Generating responses...");
    }

    const responses = await this.generateOriginalResponses(prompts);
    return this.score(prompts, responses, undefined, showProgressBars);
  }

  async score(
    prompts: string[],
    responses: string[],
    sampledResponses?: string[][],
    showProgressBars?: boolean
  ): Promise<UQResult> {
    const data: any = {
      prompts,
      responses
    };

    const scoresLists: number[][] = [];
    
    for (let judgeIndex = 0; judgeIndex < this.judges.length; judgeIndex++) {
      if (this.progressCallback) {
        this.progressCallback(
          judgeIndex,
          this.judges.length,
          `Scoring with judge ${judgeIndex + 1}...`
        );
      }

      const judge = this.judges[judgeIndex];
      const judgeResult = await judge.judgeResponses(prompts, responses);
      
      scoresLists.push(judgeResult.scores);
      data[`judge_${judgeIndex + 1}`] = judgeResult.scores;
    }

    // Compute aggregated scores
    const avgScores: number[] = [];
    const maxScores: number[] = [];
    const minScores: number[] = [];
    const medianScores: number[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const scoreSet = scoresLists.map(scores => scores[i]);
      
      avgScores.push(scoreSet.reduce((a, b) => a + b, 0) / scoreSet.length);
      maxScores.push(Math.max(...scoreSet));
      minScores.push(Math.min(...scoreSet));
      
      // Calculate median
      const sorted = [...scoreSet].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      medianScores.push(
        sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid]
      );
    }

    data.avg = avgScores;
    data.max = maxScores;
    data.min = minScores;
    data.median = medianScores;

    const result: UQResult = {
      data,
      metadata: {
        num_judges: this.judges.length
      }
    };

    return result;
  }
}
