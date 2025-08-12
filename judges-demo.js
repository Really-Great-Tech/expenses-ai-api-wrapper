const { config } = require('dotenv');
config(); // Load environment variables from .env file


// OpenAI-compatible LLM wrapper
class OpenAIWrapper {
  constructor(apiKey, model = 'gpt-3.5-turbo', name = '') {
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = 0.7;
    this.name = name || model;
  }

  async complete({ prompt, temperature }) {
    const temp = temperature !== undefined ? temperature : this.temperature;
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: temp,
          max_tokens: 500
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const text = data.choices[0]?.message?.content || '';
      
      return { 
        text: text.trim(),
        raw: data
      };
    } catch (error) {
      console.error(`${this.name} API Error:`, error.message);
      throw error;
    }
  }
}

// Sample math dataset (simplified version of GSM8K)
const mathDataset = [
  {
    question: "Janet has 16 chickens. She gets 2 eggs per day from each chicken. If she eats 3 eggs for breakfast every morning and bakes a cake that requires 4 eggs every day, how many eggs does she have left over each day?",
    answer: "21"
  },
  {
    question: "Josh decides to try flipping a house. He buys a house for $80,000 and then puts in $50,000 in repairs. This increased the value of the house by 150%. How much profit did he make?",
    answer: "65000"
  },
  {
    question: "James decides to run 3 sprints 3 times a week. He runs 60 meters each sprint. How many meters does he run a week?",
    answer: "540"
  },
  {
    question: "Every day, Wendi feeds each of her chickens three cups of mixed chicken feed, containing seeds, mealworms and vegetables. She gives the chickens their feed in three separate meals. How many cups of feed does each chicken get per meal?",
    answer: "1"
  },
  {
    question: "Kylar went to the store to buy glasses for his new apartment. One glass costs $5, but every second glass costs only 60% of the price. Kylar wants to buy 16 glasses. How much does he need to pay for them?",
    answer: "64"
  },
  {
    question: "Toulouse has twice as many sheep as Charleston. Charleston has 4 times as many sheep as Seattle. How many sheep does Toulouse have if Seattle has 20 sheep?",
    answer: "160"
  },
  {
    question: "Carla is downloading a 200 GB file. Normally she can download 2 GB per minute, but 40% of the way through the download, Windows forces a restart to install updates, which takes 20 minutes. Then Carla has to restart the download from the beginning. How long does it take to download the file?",
    answer: "160"
  },
  {
    question: "John drives for 3 hours at a speed of 60 mph and then turns around and drives back to his starting point at a speed of 50 mph. How long does his return trip take?",
    answer: "3.6"
  },
  {
    question: "Dana borrows 4 books from the library. She reads the first book in 2 hours, the second book in 3 hours, the third book in 4 hours, and the fourth book in 5 hours. What's the average time it takes her to read a book?",
    answer: "3.5"
  },
  {
    question: "Sam's grade on his algebra test was 3 points higher than his grade on his geometry test. His geometry test grade was 2 points higher than his history test grade. If his history test grade was 85, what was his algebra test grade?",
    answer: "90"
  }
];

// Math answer postprocessor (simplified)
function mathPostprocessor(response) {
  // Extract numbers from the response
  const numbers = response.match(/\d+\.?\d*/g);
  if (!numbers || numbers.length === 0) {
    return null;
  }
  
  // Return the last number found (often the final answer)
  return numbers[numbers.length - 1];
}

// Compute metrics
function computeMetrics(predictions, truths) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  
  for (let i = 0; i < predictions.length; i++) {
    const pred = predictions[i];
    const truth = truths[i];
    
    if (pred && truth) tp++;
    else if (pred && !truth) fp++;
    else if (!pred && truth) fn++;
    else tn++;
  }
  
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = (2 * precision * recall) / (precision + recall) || 0;
  
  return { precision, recall, f1 };
}

// Find optimal threshold
function findOptimalThreshold(scores, correctIndicators, objective = 'f1') {
  let bestThreshold = 0.5;
  let bestScore = 0;
  
  // Try thresholds from 0.1 to 0.9
  for (let thresh = 0.1; thresh <= 0.9; thresh += 0.05) {
    const predictions = scores.map(s => s >= thresh);
    const metrics = computeMetrics(predictions, correctIndicators);
    
    let score;
    switch (objective) {
      case 'f1':
        score = metrics.f1;
        break;
      case 'precision':
        score = metrics.precision;
        break;
      case 'recall':
        score = metrics.recall;
        break;
      default:
        score = metrics.f1;
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestThreshold = thresh;
    }
  }
  
  return bestThreshold;
}

// Compute filtered accuracy
function computeFilteredAccuracy(scores, correctIndicators, threshold) {
  const filteredData = scores.map((score, i) => ({
    score,
    correct: correctIndicators[i]
  })).filter(item => item.score >= threshold);
  
  if (filteredData.length === 0) return { accuracy: 0, sampleSize: 0 };
  
  const accuracy = filteredData.reduce((sum, item) => sum + (item.correct ? 1 : 0), 0) / filteredData.length;
  return { accuracy, sampleSize: filteredData.length };
}

async function judgesDemo() {
  console.log('🎯 UQLM TypeScript - LLM Judges Demo');
  console.log('=====================================\n');
  
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not found in environment variables');
    process.exit(1);
  }

  // 1. Set up LLMs and prompts
  console.log('1️⃣  Setting up LLMs and preparing prompts...\n');
  
  const MATH_INSTRUCTION = "When you solve this math problem only return the answer with no additional text.\n";
  
  // Create different LLM judges (using different models/temperatures to simulate diversity)
  const originalLLM = new OpenAIWrapper(process.env.OPENAI_API_KEY, 'gpt-3.5-turbo', 'GPT-3.5-Original');
  originalLLM.temperature = 1; // Higher temperature for original responses
  
  const judge1 = new OpenAIWrapper(process.env.OPENAI_API_KEY, 'gpt-3.5-turbo', 'GPT-3.5-Judge1');
  judge1.temperature = 0.2; // Lower temperature for more consistent judging
  
  const judge2 = new OpenAIWrapper(process.env.OPENAI_API_KEY, 'gpt-4o-mini', 'GPT-4o-Mini-Judge2');
  judge2.temperature = 0.3;
  
  const judge3 = new OpenAIWrapper(process.env.OPENAI_API_KEY, 'gpt-3.5-turbo', 'GPT-3.5-Judge3');
  judge3.temperature = 0.1;
  
  const prompts = mathDataset.map(item => MATH_INSTRUCTION + item.question);
  
  console.log(`📊 Dataset: ${mathDataset.length} math problems`);
  console.log(`🤖 Judges: ${judge1.name}, ${judge2.name}, ${judge3.name}\n`);

  // 2. Create LLM Panel and generate responses
  console.log('2️⃣  Creating LLM Panel and generating responses...\n');
  
  const panel = new LLMPanel({
    judges: [judge1, judge2, judge3],
    llm: originalLLM,
    scoringTemplates: ['continuous', 'continuous', 'continuous'] // All judges use continuous scoring (0-100)
  });

  console.log('Generating responses and confidence scores...');
  const result = await panel.generateAndScore(prompts);
  
  console.log(`✅ Generated ${result.data.responses.length} responses`);
  console.log(`📈 Computed scores from ${Object.keys(result.data).filter(k => k.startsWith('judge_')).length} judges\n`);

  // Display sample results
  console.log('📝 Sample Results:');
  console.log('-'.repeat(80));
  for (let i = 0; i < Math.min(3, result.data.prompts.length); i++) {
    console.log(`Question ${i + 1}: ${mathDataset[i].question.substring(0, 60)}...`);
    console.log(`Generated Answer: ${result.data.responses[i]}`);
    console.log(`Expected Answer: ${mathDataset[i].answer}`);
    console.log(`Judge Scores: J1=${(result.data.judge_1[i] * 100).toFixed(1)}%, J2=${(result.data.judge_2[i] * 100).toFixed(1)}%, J3=${(result.data.judge_3[i] * 100).toFixed(1)}%`);
    console.log(`Average Score: ${(result.data.avg[i] * 100).toFixed(1)}%`);
    console.log('-'.repeat(80));
  }

  // 3. Evaluate performance
  console.log('\n3️⃣  Evaluating Hallucination Detection Performance...\n');
  
  // Grade responses against correct answers
  const responseCorrect = result.data.responses.map((response, i) => {
    const extractedAnswer = mathPostprocessor(response);
    const expectedAnswer = mathDataset[i].answer;
    return extractedAnswer === expectedAnswer;
  });
  
  const baselineAccuracy = responseCorrect.reduce((sum, correct) => sum + (correct ? 1 : 0), 0) / responseCorrect.length;
  console.log(`📊 Baseline LLM Accuracy: ${(baselineAccuracy * 100).toFixed(1)}%\n`);

  // 3.1 Filtered accuracy evaluation
  console.log('📈 Filtered Accuracy Analysis:');
  console.log('-'.repeat(60));
  
  const scorerNames = ['judge_1', 'judge_2', 'judge_3', 'avg'];
  const displayNames = ['GPT-3.5-Judge1', 'GPT-4o-Mini-Judge2', 'GPT-3.5-Judge3', 'Average'];
  
  console.log('Threshold | ' + displayNames.map(name => name.substring(0, 12).padEnd(12)).join(' | '));
  console.log('-'.repeat(60));
  
  for (let thresh = 0.5; thresh <= 0.9; thresh += 0.1) {
    const accuracies = scorerNames.map(scorer => {
      const { accuracy, sampleSize } = computeFilteredAccuracy(result.data[scorer], responseCorrect, thresh);
      return `${(accuracy * 100).toFixed(1)}%(${sampleSize})`.padEnd(12);
    });
    console.log(`${thresh.toFixed(1)}       | ${accuracies.join(' | ')}`);
  }
  console.log('-'.repeat(60));

  // 3.2 Precision, Recall, F1-Score analysis
  console.log('\n📊 Hallucination Detection Performance:');
  console.log('-'.repeat(80));
  
  const split = Math.floor(result.data.responses.length / 2);
  const metrics = { Precision: [], Recall: [], 'F1-score': [] };
  const optimalThresholds = [];
  
  for (const scorer of scorerNames) {
    const scores = result.data[scorer];
    const tuneScores = scores.slice(0, split);
    const tuneCorrect = responseCorrect.slice(0, split);
    
    // Find optimal threshold on first half
    const optimalThresh = findOptimalThreshold(tuneScores, tuneCorrect, 'f1');
    optimalThresholds.push(optimalThresh);
    
    // Evaluate on second half
    const evalScores = scores.slice(split);
    const evalCorrect = responseCorrect.slice(split);
    const predictions = evalScores.map(s => s >= optimalThresh);
    
    const evalMetrics = computeMetrics(predictions, evalCorrect);
    metrics.Precision.push(evalMetrics.precision);
    metrics.Recall.push(evalMetrics.recall);
    metrics['F1-score'].push(evalMetrics.f1);
  }
  
  // Display results table
  const header = 'Metrics'.padEnd(15) + displayNames.map(name => name.substring(0, 15).padEnd(15)).join('');
  console.log('='.repeat(header.length));
  console.log(header);
  console.log('-'.repeat(header.length));
  
  Object.keys(metrics).forEach(metric => {
    const values = metrics[metric].map(val => val.toFixed(3).padEnd(15)).join('');
    console.log(`${metric.padEnd(15)}${values}`);
  });
  
  console.log('-'.repeat(header.length));
  const thresholds = optimalThresholds.map(thresh => thresh.toFixed(3).padEnd(15)).join('');
  console.log(`${'Optimal Thresh'.padEnd(15)}${thresholds}`);
  console.log('='.repeat(header.length));

  // 4. Summary insights
  console.log('\n🔍 Key Insights:');
  console.log(`• Best performing judge: ${displayNames[metrics['F1-score'].indexOf(Math.max(...metrics['F1-score']))]}`);
  console.log(`• Highest F1-score: ${Math.max(...metrics['F1-score']).toFixed(3)}`);
  console.log(`• Average confidence correlation with correctness: ${(responseCorrect.map((correct, i) => correct === (result.data.avg[i] > 0.5) ? 1 : 0).reduce((a, b) => a + b, 0) / responseCorrect.length * 100).toFixed(1)}%`);
  
  console.log('\n✅ Demo completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   • Tested ${mathDataset.length} math problems`);
  console.log(`   • Used ${scorerNames.length - 1} different LLM judges + ensemble average`);
  console.log(`   • Baseline accuracy: ${(baselineAccuracy * 100).toFixed(1)}%`);
  console.log(`   • Best judge F1-score: ${Math.max(...metrics['F1-score']).toFixed(3)}`);
  console.log(`   • Demonstrates effective hallucination detection using LLM-as-a-Judge approach`);
}

// Run the demo
judgesDemo().catch(console.error);
