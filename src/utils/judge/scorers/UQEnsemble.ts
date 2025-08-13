import { LLM } from 'llamaindex';
import { UncertaintyQuantifier } from '../base/UncertaintyQuantifier';
import { LLMJudge } from '../judges/LLMJudge';
import { LLMPanel } from './LLMPanel';
import { Tuner } from '../utils/Tuner';
import { UQResult, ScorerComponent, GraderFunction, EnsembleConfig, TuningResult } from '../types';

export class UQEnsemble extends UncertaintyQuantifier {
  private scorers: ScorerComponent[] = [];
  private weights: number[];
  private thresh: number;
  private samplingTemperature: number;
  private useBest: boolean;
  private tuner: Tuner;
  private judges: LLMJudge[];
  private llmPanel?: LLMPanel;
  private componentNames: string[];
  private componentScores: Record<string, number[]> = {};
  private currentResponses: string[] = [];

  constructor(options: {
    llm?: LLM;
    scorers?: ScorerComponent[];
    systemPrompt?: string;
    maxCallsPerMin?: number;
    postprocessor?: (text: string) => string;
    weights?: number[];
    thresh?: number;
    samplingTemperature?: number;
    useBest?: boolean;
  } = {}) {
    super({
      llm: options.llm,
      systemPrompt: options.systemPrompt,
      maxCallsPerMin: options.maxCallsPerMin,
      postprocessor: options.postprocessor
    });

    this.thresh = options.thresh || 0.5;
    this.weights = options.weights || [];
    this.samplingTemperature = options.samplingTemperature || 1.0;
    this.useBest = options.useBest !== undefined ? options.useBest : true;
    this.tuner = new Tuner();
    this.judges = [];
    this.componentNames = [];

    this.validateAndSetupComponents(options.scorers);
    this.validateWeights();
  }

  private validateAndSetupComponents(scorers?: ScorerComponent[]): void {
    if (!scorers || scorers.length === 0) {
      // Default BS Detector ensemble
      if (!this.llm) {
        throw new Error("LLM must be provided for default ensemble");
      }
      this.scorers = [this.llm];
      this.judges = [new LLMJudge({ llm: this.llm })];
      this.componentNames = ['judge_1'];
      this.weights = [1.0];
      return;
    }

    this.scorers = scorers;
    let judgeCount = 0;

    for (let i = 0; i < scorers.length; i++) {
      const scorer = scorers[i];
      
      if (typeof scorer === 'string') {
        // Named scorer (would be black-box or white-box in original)
        this.componentNames.push(scorer);
      } else if (scorer instanceof LLMJudge) {
        judgeCount++;
        this.judges.push(scorer);
        this.componentNames.push(`judge_${judgeCount}`);
      } else {
        // Assume it's an LLM instance
        judgeCount++;
        const judge = new LLMJudge({ llm: scorer as LLM });
        this.judges.push(judge);
        this.componentNames.push(`judge_${judgeCount}`);
      }
    }

    if (this.judges.length > 0) {
      this.llmPanel = new LLMPanel({ judges: this.judges });
    }
  }

  private validateWeights(): void {
    if (this.weights.length === 0) {
      this.weights = new Array(this.componentNames.length).fill(1 / this.componentNames.length);
    } else if (this.weights.length !== this.componentNames.length) {
      throw new Error("Must have same number of weights as components");
    }

    this.weights = this.tuner.getNormalizedWeights(this.weights);
  }

  async generateAndScore(
    prompts: string[],
    numResponses: number = 5,
    showProgressBars: boolean = true
  ): Promise<UQResult> {
    if (this.progressCallback) {
      this.progressCallback(0, prompts.length, "🤖 Generation");
    }

    const responses = await this.generateOriginalResponses(prompts);
    
    // For ensemble, we might need sampled responses for consistency scoring
    let sampledResponses: string[][] | undefined;
    if (numResponses > 1) {
      sampledResponses = await this.generateCandidateResponses(
        prompts,
        numResponses,
        this.samplingTemperature
      );
    }

    return this.score(prompts, responses, sampledResponses, showProgressBars);
  }

  async score(
    prompts: string[],
    responses: string[],
    sampledResponses?: string[][],
    showProgressBars: boolean = true
  ): Promise<UQResult> {
    if (this.progressCallback) {
      this.progressCallback(0, this.componentNames.length, "📈 Scoring");
    }

    this.componentScores = {};
    this.currentResponses = responses; // Store current responses for grading

    // Score with LLM judges if available
    if (this.llmPanel) {
      const judgeResults = await this.llmPanel.score(prompts, responses, sampledResponses, showProgressBars);
      
      // Extract individual judge scores
      for (const componentName of this.componentNames) {
        if (componentName.startsWith('judge_') && judgeResults.data[componentName]) {
          this.componentScores[componentName] = judgeResults.data[componentName];
        }
      }
    }

    // Handle other named scorers (placeholder for black-box/white-box)
    for (const componentName of this.componentNames) {
      if (!componentName.startsWith('judge_')) {
        // Placeholder for black-box or white-box scorers
        this.componentScores[componentName] = new Array(responses.length).fill(0.5);
      }
    }

    return this.constructResult(prompts, responses, sampledResponses);
  }

  async tune(options: {
    prompts: string[];
    groundTruthAnswers: string[];
    graderFunction?: GraderFunction;
    numResponses?: number;
    weightsObjective?: string;
    threshBounds?: [number, number];
    threshObjective?: string;
    nTrials?: number;
    stepSize?: number;
    fscoreBeta?: number;
    showProgressBars?: boolean;
  }): Promise<UQResult> {
    const {
      prompts,
      groundTruthAnswers,
      graderFunction,
      numResponses = 5,
      weightsObjective = 'roc_auc',
      threshBounds = [0, 1],
      threshObjective = 'fbeta_score',
      nTrials = 100,
      stepSize = 0.01,
      fscoreBeta = 1,
      showProgressBars = true
    } = options;

    // Generate and score responses
    await this.generateAndScore(prompts, numResponses, showProgressBars);

    // Grade responses
    const correctIndicators = this.gradeResponses(
      groundTruthAnswers,
      this.currentResponses, // Use the actual responses
      graderFunction
    );

    // Tune parameters
    const tuningResult = this.tuneFromGraded(correctIndicators, {
      weightsObjective,
      threshBounds,
      threshObjective,
      nTrials,
      stepSize,
      fscoreBeta,
      showProgressBars
    });

    return tuningResult;
  }

  tuneFromGraded(
    correctIndicators: boolean[],
    options: {
      weightsObjective?: string;
      threshBounds?: [number, number];
      threshObjective?: string;
      nTrials?: number;
      stepSize?: number;
      fscoreBeta?: number;
      showProgressBars?: boolean;
    } = {}
  ): UQResult {
    if (Object.keys(this.componentScores).length === 0) {
      throw new Error("Must run score() method before tuning parameters");
    }

    const scoreLists = Object.values(this.componentScores);
    const tuningResult = this.tuner.tuneParams({
      scoreLists,
      correctIndicators,
      weightsObjective: options.weightsObjective,
      threshBounds: options.threshBounds,
      threshObjective: options.threshObjective,
      nTrials: options.nTrials,
      stepSize: options.stepSize,
      fscore_beta: options.fscoreBeta
    });

    this.weights = tuningResult.weights;
    this.thresh = tuningResult.thresh;

    this.printEnsembleWeights();

    return this.constructResult();
  }

  saveConfig(path: string): void {
    const config: EnsembleConfig = {
      weights: this.weights,
      thresh: this.thresh,
      components: this.componentNames,
      // Note: LLM serialization would need more sophisticated handling in a real implementation
    };

    // In a browser environment, you might use localStorage or IndexedDB
    // For Node.js, you'd use fs.writeFileSync
    console.log('Config to save:', JSON.stringify(config, null, 2));
  }

  static loadConfig(path: string, llm?: LLM): UQEnsemble {
    // Placeholder for loading configuration
    // In a real implementation, this would read from file system or storage
    throw new Error("Configuration loading not yet implemented");
  }

  printEnsembleWeights(): void {
    console.log('\n=== Optimized Ensemble Weights ===');
    const weightData = this.componentNames.map((name, i) => ({
      scorer: name,
      weight: this.weights[i].toFixed(4)
    })).sort((a, b) => parseFloat(b.weight) - parseFloat(a.weight));

    weightData.forEach(({ scorer, weight }) => {
      console.log(`${scorer.padEnd(25)} ${weight.padStart(15)}`);
    });
    console.log('=====================================\n');
  }

  private gradeResponses(
    groundTruthAnswers: string[],
    responses: string[],
    graderFunction?: GraderFunction
  ): boolean[] {
    if (graderFunction) {
      return responses.map((response, i) => 
        graderFunction(response, groundTruthAnswers[i])
      );
    } else {
      // Default simple string matching (placeholder)
      return responses.map((response, i) => 
        response.toLowerCase().includes(groundTruthAnswers[i].toLowerCase())
      );
    }
  }

  private constructResult(
    prompts?: string[],
    responses?: string[],
    sampledResponses?: string[][]
  ): UQResult {
    const data: any = {
      prompts: prompts || [],
      responses: responses || [],
      sampled_responses: sampledResponses || []
    };

    // Compute ensemble scores
    if (Object.keys(this.componentScores).length > 0) {
      const scoreLists = this.componentNames.map(name => this.componentScores[name] || []);
      data.ensemble_scores = this.tuner.getEnsembleScores(this.weights, scoreLists);
    }

    // Add component scores
    Object.assign(data, this.componentScores);

    const result: UQResult = {
      data,
      metadata: {
        thresh: this.thresh,
        weights: [...this.weights],
        sampling_temperature: this.samplingTemperature,
        num_responses: sampledResponses ? sampledResponses[0]?.length : 1
      }
    };

    return result;
  }
}
