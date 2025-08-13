import { TuningResult, GraderFunction } from '../types';

export interface ObjectiveMetric {
  (predictions: number[], truths: boolean[]): number;
}

export class Tuner {
  private computeEnsembleScores(weights: number[], scoreLists: number[][]): number[] {
    const numSamples = scoreLists[0].length;
    const ensembleScores: number[] = [];

    for (let i = 0; i < numSamples; i++) {
      let weightedSum = 0;
      for (let j = 0; j < scoreLists.length; j++) {
        weightedSum += weights[j] * scoreLists[j][i];
      }
      ensembleScores.push(weightedSum);
    }

    return ensembleScores;
  }

  private normalizeWeights(weights: number[]): number[] {
    const sum = weights.reduce((a, b) => a + b, 0);
    return weights.map(w => w / sum);
  }

  private rocAuc(predictions: number[], truths: boolean[]): number {
    const pairs = predictions.map((pred, i) => ({ pred, truth: truths[i] }))
      .sort((a, b) => b.pred - a.pred);

    let tp = 0, fp = 0;
    const positives = truths.filter(t => t).length;
    const negatives = truths.length - positives;

    if (positives === 0 || negatives === 0) return 0.5;

    let auc = 0;
    for (const pair of pairs) {
      if (pair.truth) {
        tp++;
      } else {
        fp++;
        auc += tp;
      }
    }

    return auc / (positives * negatives);
  }

  private accuracy(predictions: number[], truths: boolean[], threshold: number): number {
    let correct = 0;
    for (let i = 0; i < predictions.length; i++) {
      const predicted = predictions[i] >= threshold;
      if (predicted === truths[i]) correct++;
    }
    return correct / predictions.length;
  }

  private fBetaScore(predictions: number[], truths: boolean[], threshold: number, beta: number = 1): number {
    let tp = 0, fp = 0, fn = 0;
    
    for (let i = 0; i < predictions.length; i++) {
      const predicted = predictions[i] >= threshold;
      if (predicted && truths[i]) tp++;
      else if (predicted && !truths[i]) fp++;
      else if (!predicted && truths[i]) fn++;
    }

    if (tp === 0) return 0;
    
    const precision = tp / (tp + fp);
    const recall = tp / (tp + fn);
    
    if (precision + recall === 0) return 0;
    
    return (1 + beta * beta) * (precision * recall) / (beta * beta * precision + recall);
  }

  private getObjectiveFunction(objectiveName: string): ObjectiveMetric {
    switch (objectiveName) {
      case 'roc_auc':
        return this.rocAuc.bind(this);
      case 'accuracy_score':
        return (preds, truths) => this.accuracy(preds, truths, 0.5);
      case 'fbeta_score':
        return (preds, truths) => this.fBetaScore(preds, truths, 0.5, 1);
      default:
        throw new Error(`Unsupported objective: ${objectiveName}`);
    }
  }

  private optimizeWeights(
    scoreLists: number[][],
    correctIndicators: boolean[],
    objective: string,
    nTrials: number = 100
  ): number[] {
    const objectiveFn = this.getObjectiveFunction(objective);
    let bestWeights = new Array(scoreLists.length).fill(1 / scoreLists.length);
    let bestScore = -Infinity;

    // Simple random search optimization
    for (let trial = 0; trial < nTrials; trial++) {
      const weights = Array.from({ length: scoreLists.length }, () => Math.random());
      const normalizedWeights = this.normalizeWeights(weights);
      
      const ensembleScores = this.computeEnsembleScores(normalizedWeights, scoreLists);
      const score = objectiveFn(ensembleScores, correctIndicators);

      if (score > bestScore) {
        bestScore = score;
        bestWeights = normalizedWeights;
      }
    }

    return bestWeights;
  }

  private optimizeThreshold(
    predictions: number[],
    correctIndicators: boolean[],
    objective: string,
    bounds: [number, number] = [0, 1],
    stepSize: number = 0.01,
    beta: number = 1
  ): number {
    let bestThreshold = 0.5;
    let bestScore = -Infinity;

    for (let thresh = bounds[0]; thresh <= bounds[1]; thresh += stepSize) {
      let score: number;
      
      switch (objective) {
        case 'accuracy_score':
          score = this.accuracy(predictions, correctIndicators, thresh);
          break;
        case 'fbeta_score':
          score = this.fBetaScore(predictions, correctIndicators, thresh, beta);
          break;
        default:
          throw new Error(`Threshold optimization not supported for ${objective}`);
      }

      if (score > bestScore) {
        bestScore = score;
        bestThreshold = thresh;
      }
    }

    return bestThreshold;
  }

  tuneParams(options: {
    scoreLists: number[][];
    correctIndicators: boolean[];
    weightsObjective?: string;
    threshBounds?: [number, number];
    threshObjective?: string;
    nTrials?: number;
    stepSize?: number;
    fscore_beta?: number;
  }): TuningResult {
    const {
      scoreLists,
      correctIndicators,
      weightsObjective = 'roc_auc',
      threshBounds = [0, 1],
      threshObjective = 'fbeta_score',
      nTrials = 100,
      stepSize = 0.01,
      fscore_beta = 1
    } = options;

    // Optimize weights
    const optimizedWeights = this.optimizeWeights(
      scoreLists,
      correctIndicators,
      weightsObjective,
      nTrials
    );

    // Get ensemble scores with optimized weights
    const ensembleScores = this.computeEnsembleScores(optimizedWeights, scoreLists);

    // Optimize threshold
    const optimizedThresh = this.optimizeThreshold(
      ensembleScores,
      correctIndicators,
      threshObjective,
      threshBounds,
      stepSize,
      fscore_beta
    );

    // Calculate final objective value
    const finalScore = this.getObjectiveFunction(weightsObjective)(ensembleScores, correctIndicators);

    return {
      weights: optimizedWeights,
      thresh: optimizedThresh,
      objective_value: finalScore
    };
  }

  // Public methods that delegate to private implementations
  public getEnsembleScores(weights: number[], scoreLists: number[][]): number[] {
    return this.computeEnsembleScores(weights, scoreLists);
  }

  public getNormalizedWeights(weights: number[]): number[] {
    return this.normalizeWeights(weights);
  }
}
