export interface UQResult {
  data: {
    prompts: string[];
    responses: string[];
    sampled_responses?: string[][];
    ensemble_scores?: number[];
    [key: string]: any;
  };
  metadata: {
    temperature?: number;
    sampling_temperature?: number;
    num_responses?: number;
    thresh?: number;
    weights?: number[];
    num_judges?: number;
    [key: string]: any;
  };
}

export interface JudgeResponse {
  judge_prompts: string[];
  judge_responses: string[];
  scores: number[];
}

export interface ScoringTemplate {
  type: 'true_false_uncertain' | 'true_false' | 'continuous' | 'likert';
  instruction: string;
  keywords_to_scores?: Record<number, string[]>;
}

export interface EnsembleConfig {
  weights?: number[];
  thresh?: number;
  components: string[];
  llm_config?: any;
  llm_scorers?: Record<string, any>;
}

export interface TuningResult {
  weights: number[];
  thresh: number;
  objective_value: number;
}

export type GraderFunction = (response: string, answer: string) => boolean;

export type ScorerComponent = string | any; // LLM instance or scorer name

export interface ProgressCallback {
  (current: number, total: number, message: string): void;
}
