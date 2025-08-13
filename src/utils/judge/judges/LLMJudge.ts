import { LLM } from 'llamaindex';
import { UncertaintyQuantifier } from '../base/UncertaintyQuantifier';
import { JudgeResponse, ScoringTemplate } from '../types';

const KEYWORDS_TO_SCORES_DICT: Record<number, string[]> = {
  0.0: ["incorrect", "not correct", "not right", "wrong"],
  0.5: ["not sure", "not certain", "unsure", "uncertain"],
  1.0: ["correct", "right"]
};

const LIKERT_TO_SCORES_DICT: Record<number, string[]> = {
  0.0: ["1", "completely incorrect", "not correct"],
  0.25: ["2", "mostly incorrect", "somewhat correct"],
  0.5: ["3", "partially correct", "moderately correct"],
  0.75: ["4", "mostly correct", "very correct"],
  1.0: ["5", "completely correct", "highly correct"]
};

const CONTINUOUS_SCORE_INSTRUCTION = `
How likely is the above answer to be correct? Analyze the answer and give your confidence in this answer between 0 (lowest) and 100 (highest), with 100 being certain the answer is correct, and 0 being certain the answer is incorrect. THE CONFIDENCE RATING YOU PROVIDE MUST BE BETWEEN 0 and 100. ONLY RETURN YOUR NUMERICAL SCORE WITH NO SURROUNDING TEXT OR EXPLANATION.

# Example 1
## Data to analyze
Question: Who was the first president of the United States?, Proposed Answer: Benjamin Franklin.

## Your response
4 (highly certain the proposed answer is incorrect)

# Example 2
## Data to analyze
Question: What is 2+2?, Proposed Answer: 4

## Your response
99 (highly certain the proposed answer is correct)
`;

const LIKERT_SCORE_INSTRUCTION = `
You are a fair assessment expert evaluating the CORRECTNESS of an answer to a question.
Your task is to score the answer on a scale from 1 to 5, with 5 being the highest:
1 - Completely incorrect: The answer is entirely wrong or irrelevant.
2 - Mostly incorrect: The answer contains significant errors or misconceptions.
3 - Partially correct: The answer has some correct elements but also contains errors.
4 - Mostly correct: The answer is largely accurate with only minor errors or omissions.
5 - Completely correct: The answer is fully accurate and comprehensive.
Give only the numerical score (1-5) with no explanation.
`;

const CHOICES_2_CLASS = '"Correct", "Incorrect"';
const CHOICES_3_CLASS = CHOICES_2_CLASS + ', or "I am not sure"';

function createCategoricalInstruction(choices: string): string {
  return `Your task is to look at the question and answer provided and determine if the answer is correct. You are to respond with ONLY one of: ${choices}. YOUR ANSWER MUST ONLY CONTAIN ONE OF ${choices}. DO NOT ANSWER THE QUESTION AGAIN. ONLY DETERMINE IF THE ANSWER TO THE QUESTION IS ${choices}.`;
}

const TEMPLATE_TO_INSTRUCTION: Record<string, string> = {
  continuous: CONTINUOUS_SCORE_INSTRUCTION,
  true_false_uncertain: createCategoricalInstruction(CHOICES_3_CLASS),
  true_false: createCategoricalInstruction(CHOICES_2_CLASS),
  likert: LIKERT_SCORE_INSTRUCTION
};

export class LLMJudge extends UncertaintyQuantifier {
  private scoringTemplate: string;
  private templateQuestionAnswer: string;
  private keywordsToScoresDict: Record<number, string[]>;
  private instruction: string = '';

  constructor(options: {
    llm: LLM;
    maxCallsPerMin?: number;
    scoringTemplate?: string;
    systemPrompt?: string;
    templateQuestionAnswer?: string;
    keywordsToScoresDict?: Record<number, string[]>;
  }) {
    super({
      llm: options.llm,
      systemPrompt: options.systemPrompt,
      maxCallsPerMin: options.maxCallsPerMin
    });

    this.scoringTemplate = options.scoringTemplate || 'true_false_uncertain';
    this.templateQuestionAnswer = options.templateQuestionAnswer || '';
    this.keywordsToScoresDict = options.keywordsToScoresDict || {};

    this.validateInputs();
  }

  async judgeResponses(
    prompts: string[],
    responses: string[],
    retries: number = 5
  ): Promise<JudgeResponse> {
    const concatenatedQA = prompts.map((prompt, i) => 
      this.templateQuestionAnswer.replace('{0}', prompt).replace('{1}', responses[i])
    );

    const judgeResponses: string[] = [];
    const scores: number[] = [];

    for (let i = 0; i < concatenatedQA.length; i++) {
      if (this.progressCallback) {
        this.progressCallback(i, concatenatedQA.length, "Judging responses...");
      }

      const response = await this.llm!.complete({
        prompt: concatenatedQA[i],
      });

      judgeResponses.push(response.text);
      let score = this.extractSingleAnswer(response.text);

      // Retry logic for failed score extraction
      let retryCount = 0;
      while (score === null && retryCount < retries) {
        retryCount++;
        const retryResponse = await this.llm!.complete({
          prompt: concatenatedQA[i],
        });
        judgeResponses[i] = retryResponse.text;
        score = this.extractSingleAnswer(retryResponse.text);
      }

      scores.push(score || 0);
    }

    return {
      judge_prompts: concatenatedQA,
      judge_responses: judgeResponses,
      scores
    };
  }

  private validateInputs(): void {
    if (this.scoringTemplate in TEMPLATE_TO_INSTRUCTION) {
      this.instruction = TEMPLATE_TO_INSTRUCTION[this.scoringTemplate];
      this.templateQuestionAnswer = this.createDefaultTemplateQuestionAnswer();
      
      if (this.scoringTemplate === 'likert') {
        this.keywordsToScoresDict = { ...LIKERT_TO_SCORES_DICT };
      } else {
        this.keywordsToScoresDict = { ...KEYWORDS_TO_SCORES_DICT };
      }

      if (this.scoringTemplate === 'true_false') {
        delete this.keywordsToScoresDict[0.5]; // Remove uncertain option
      }
    } else {
      throw new Error(
        "scoring_template must be one of 'true_false_uncertain', 'true_false', 'continuous', 'likert'"
      );
    }
  }

  private createDefaultTemplateQuestionAnswer(): string {
    const qaText = "Question: {0}, Proposed Answer: {1}. ";
    return qaText + this.instruction;
  }

  private extractSingleAnswer(response: string): number | null {
    if (!response) {
      return null;
    }

    if (this.scoringTemplate === 'continuous') {
      const score = response.replace(/[^\d]/g, '');
      if (score.length > 0) {
        const numScore = parseFloat(score);
        if (numScore >= 0 && numScore <= 100) {
          return numScore / 100.0; // normalize to 0-1
        }
      }
    } else if (this.scoringTemplate === 'likert') {
      const cleanResponse = response.trim().toLowerCase();
      if (cleanResponse.length === 1 && /[1-5]/.test(cleanResponse)) {
        return (parseInt(cleanResponse) - 1) / 4.0; // Normalize to 0-1
      }
      
      for (const [score, keywords] of Object.entries(this.keywordsToScoresDict)) {
        if (keywords.some(keyword => cleanResponse.includes(keyword))) {
          return parseFloat(score);
        }
      }
    } else if (['true_false_uncertain', 'true_false'].includes(this.scoringTemplate)) {
      const lowerResponse = response.toLowerCase();
      for (const [score, keywords] of Object.entries(this.keywordsToScoresDict)) {
        if (keywords.some(keyword => lowerResponse.includes(keyword))) {
          return parseFloat(score);
        }
      }
    }

    return null;
  }

  // Implement abstract methods from UncertaintyQuantifier
  async generateAndScore(
    prompts: string[],
    numResponses?: number,
    showProgressBars?: boolean
  ): Promise<any> {
    throw new Error('LLMJudge does not support generateAndScore. Use judgeResponses instead.');
  }

  async score(
    prompts: string[],
    responses: string[],
    sampledResponses?: string[][],
    showProgressBars?: boolean
  ): Promise<any> {
    return this.judgeResponses(prompts, responses);
  }
}
