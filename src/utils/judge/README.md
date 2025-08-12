# UQLM TypeScript

TypeScript implementation of UQLM (Uncertainty Quantification for Language Models) using LlamaIndex, focusing on LLM-as-a-Judge Scorers and Ensemble Scorers.

## Features

This TypeScript version includes only the core components requested:

- **LLM-as-a-Judge Scorers**: Use language models to evaluate response correctness
- **Ensemble Scorers**: Combine multiple scoring methods with weighted aggregation

### Key Components

1. **LLMJudge**: Individual LLM-based scoring with multiple templates
2. **LLMPanel**: Aggregate multiple LLM judges with voting mechanisms
3. **UQEnsemble**: Ensemble scorer with automated tuning capabilities
4. **Tuner**: Optimization utilities for ensemble weights and thresholds

## Installation

```bash
npm install uqlm-ts llamaindex
```

## Quick Start

```typescript
import { UQEnsemble, LLMJudge } from 'uqlm-ts';
import { OpenAI } from 'llamaindex';

// Initialize LLM
const llm = new OpenAI({ model: 'gpt-4' });

// Create ensemble with default judge
const ensemble = new UQEnsemble({
  llm: llm,
  scorers: [llm], // Will create default LLMJudge
  weights: [1.0],
  thresh: 0.5
});

// Generate and score responses
const prompts = ["What is the capital of France?"];
const result = await ensemble.generateAndScore(prompts, 5);

console.log("Ensemble scores:", result.data.ensemble_scores);
console.log("Judge scores:", result.data.judge_1);
```

## Usage Examples

### Using Individual LLM Judge

```typescript
import { LLMJudge } from 'uqlm-ts';
import { OpenAI } from 'llamaindex';

const judge = new LLMJudge({
  llm: new OpenAI({ model: 'gpt-4' }),
  scoringTemplate: 'continuous', // Options: 'true_false', 'true_false_uncertain', 'continuous', 'likert'
});

const prompts = ["What is 2+2?"];
const responses = ["4"];

const judgeResult = await judge.judgeResponses(prompts, responses);
console.log("Scores:", judgeResult.scores); // [0.99] (normalized 0-1)
```

### Using LLM Panel (Multiple Judges)

```typescript
import { LLMPanel } from 'uqlm-ts';
import { OpenAI } from 'llamaindex';

const panel = new LLMPanel({
  judges: [
    new OpenAI({ model: 'gpt-4' }),
    new OpenAI({ model: 'gpt-3.5-turbo' })
  ],
  scoringTemplates: ['continuous', 'likert']
});

const result = await panel.generateAndScore(prompts);
console.log("Average scores:", result.data.avg);
console.log("Max scores:", result.data.max);
console.log("Min scores:", result.data.min);
```

### Ensemble Tuning

```typescript
// Tune ensemble weights based on ground truth
const tuningResult = await ensemble.tune({
  prompts: ["What is the capital of France?", "What is 2+2?"],
  groundTruthAnswers: ["Paris", "4"],
  weightsObjective: 'roc_auc',
  threshObjective: 'fbeta_score',
  nTrials: 100
});

console.log("Optimized weights:", tuningResult.metadata.weights);
console.log("Optimized threshold:", tuningResult.metadata.thresh);
```

### Custom Grader Function

```typescript
const customGrader = (response: string, answer: string): boolean => {
  return response.toLowerCase().includes(answer.toLowerCase());
};

const result = await ensemble.tune({
  prompts: prompts,
  groundTruthAnswers: answers,
  graderFunction: customGrader
});
```

## Scoring Templates

### Available Templates

1. **`true_false`**: Binary correct/incorrect classification
2. **`true_false_uncertain`**: Three-way classification (correct/incorrect/uncertain)
3. **`continuous`**: Confidence score from 0-100 (normalized to 0-1)
4. **`likert`**: 5-point Likert scale (normalized to 0-1)

### Template Instructions

Each template comes with predefined prompts optimized for that scoring method:

- **Continuous**: "How likely is the above answer to be correct? Give confidence between 0-100..."
- **Likert**: "Score the answer on a scale from 1-5 where 1 is completely incorrect..."
- **True/False**: "Determine if the answer is correct. Respond with only 'Correct' or 'Incorrect'..."

## API Reference

### UQEnsemble

Main ensemble class combining multiple scoring methods.

```typescript
constructor(options: {
  llm?: LLM;
  scorers?: ScorerComponent[];
  weights?: number[];
  thresh?: number;
  samplingTemperature?: number;
  useBest?: boolean;
})
```

**Methods:**
- `generateAndScore(prompts, numResponses?, showProgressBars?)`: Generate responses and compute scores
- `score(prompts, responses, sampledResponses?, showProgressBars?)`: Score existing responses
- `tune(options)`: Optimize ensemble weights and threshold
- `tuneFromGraded(correctIndicators, options?)`: Tune from pre-graded responses
- `saveConfig(path)`: Save ensemble configuration
- `printEnsembleWeights()`: Display current weights

### LLMJudge

Individual LLM-based scorer.

```typescript
constructor(options: {
  llm: LLM;
  scoringTemplate?: string;
  maxCallsPerMin?: number;
  systemPrompt?: string;
})
```

**Methods:**
- `judgeResponses(prompts, responses, retries?)`: Score responses for correctness

### LLMPanel

Panel of multiple LLM judges with aggregation.

```typescript
constructor(options: {
  judges: (LLMJudge | LLM)[];
  scoringTemplates?: string[];
  maxCallsPerMin?: number;
})
```

**Methods:**
- `generateAndScore(prompts, numResponses?, showProgressBars?)`: Generate and score with panel
- `score(prompts, responses, sampledResponses?, showProgressBars?)`: Score with panel

### Tuner

Optimization utilities for ensemble tuning.

**Methods:**
- `tuneParams(options)`: Optimize weights and threshold
- `getEnsembleScores(weights, scoreLists)`: Compute weighted ensemble scores
- `getNormalizedWeights(weights)`: Normalize weights to sum to 1

## Progress Callbacks

Set progress callbacks to monitor long-running operations:

```typescript
ensemble.setProgressCallback((current, total, message) => {
  console.log(`${message}: ${current}/${total}`);
});
```

## Configuration Management

Save and load ensemble configurations:

```typescript
// Save configuration
ensemble.saveConfig('ensemble-config.json');

// Load configuration (placeholder - implementation needed)
const loadedEnsemble = UQEnsemble.loadConfig('ensemble-config.json', llm);
```

## Error Handling

The library includes comprehensive error handling:

```typescript
try {
  const result = await ensemble.generateAndScore(prompts);
} catch (error) {
  console.error('Ensemble scoring failed:', error.message);
}
```

## Performance Considerations

- Use `maxCallsPerMin` to respect API rate limits
- Set `showProgressBars: false` for headless environments
- Consider `samplingTemperature` for response diversity
- Use appropriate `numResponses` count for consistency estimation

## License

Apache License 2.0

## Changes from Original

This TypeScript implementation focuses on the core LLM-as-a-Judge and Ensemble functionality while maintaining the essential API patterns from the original Python UQLM library. Key changes:

1. **TypeScript**: Full type safety and modern JavaScript features
2. **LlamaIndex**: Native integration with LlamaIndex ecosystem
3. **Focused Scope**: Only LLM judges and ensemble methods (no black-box/white-box scorers)
4. **Modern Architecture**: Promise-based async APIs throughout
5. **Simplified Configuration**: Streamlined setup and usage patterns

## Contributing

This is a focused implementation. For additional features or bug reports, please follow the contribution guidelines.
