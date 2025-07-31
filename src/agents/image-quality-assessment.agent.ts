import { Anthropic } from '@llamaindex/anthropic';
import { ImageQualityAssessmentSchema, type ImageQualityAssessment } from '../schemas/expense-schemas';
import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { BedrockLlmService } from '../utils/bedrockLlm';

export class ImageQualityAssessmentAgent {
  private readonly logger = new Logger(ImageQualityAssessmentAgent.name);
  private llm: any;
  private currentProvider: 'bedrock' | 'anthropic';

  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock') {
    this.currentProvider = provider;

    if (provider === 'bedrock') {
      this.llm = new BedrockLlmService();
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    }
  }

  async assessImageQuality(imagePath: string): Promise<ImageQualityAssessment> {
    this.logger.log(`🤖 Starting LLM-based quality assessment for: ${path.basename(imagePath)}`);

    try {
      // Get image info for context
      const imageInfo = this.getImageInfo(imagePath);

      // For now, simulate quality assessment based on file properties
      // TODO: Implement actual vision-based assessment when LlamaIndex TS vision API is stable
      const response = await this.llm.chat({
        messages: [
          {
            role: 'user',
            content: `Simulate a quality assessment for an expense document image. ${imageInfo}\n\n${this.createAssessmentPrompt()}`,
          },
        ],
      });

      // Parse the JSON response manually - handle different response formats
      let rawContent: string;

      // Parse the JSON response manually since structured output isn't working as expected
      if (typeof response.message.content === 'string') {
        rawContent = response.message.content;
      } else if (Array.isArray(response.message.content) && response.message.content.length > 0) {
        // Anthropic format: [{"type":"text","text":"actual JSON content"}]
        const firstItem = response.message.content[0];
        if (firstItem && firstItem.type === 'text' && firstItem.text) {
          rawContent = firstItem.text;
        } else {
          rawContent = JSON.stringify(response.message.content);
        }
      } else if (response.message.content && typeof response.message.content === 'object') {
        rawContent = JSON.stringify(response.message.content);
      } else {
        rawContent = String(response.message.content || '');
      }

      this.logger.debug(`Raw response type: ${typeof response.message.content}`);
      this.logger.debug(`Extracted content: ${rawContent.substring(0, 200)}...`);

      const parsedResult = this.parseJsonResponse(rawContent);
      const result = ImageQualityAssessmentSchema.parse(parsedResult);

      this.logger.log(`Image quality assessment completed: Score ${result.overall_quality_score}/10, Suitable: ${result.suitable_for_extraction}`);
      return result;

    } catch (error) {
      this.logger.error(`Image quality assessment failed: ${error.message}`);

      // Return fallback result
      return {
        blur_detection: this.createFallbackIssue('Blur assessment failed'),
        contrast_assessment: this.createFallbackIssue('Contrast assessment failed'),
        glare_identification: this.createFallbackIssue('Glare assessment failed'),
        water_stains: this.createFallbackIssue('Water stain assessment failed'),
        tears_or_folds: this.createFallbackIssue('Tear/fold assessment failed'),
        cut_off_detection: this.createFallbackIssue('Cut-off assessment failed'),
        missing_sections: this.createFallbackIssue('Missing section assessment failed'),
        obstructions: this.createFallbackIssue('Obstruction assessment failed'),
        overall_quality_score: 5,
        suitable_for_extraction: true, // Default to true to not block processing
      };
    }
  }

  private createFallbackIssue(description: string) {
    return {
      detected: false,
      severity_level: 'low' as const,
      confidence_score: 0.5,
      quantitative_measure: 0.0,
      description,
      recommendation: 'Manual review recommended due to assessment failure',
    };
  }

  private getMimeType(imagePath: string): string {
    const ext = path.extname(imagePath).toLowerCase();
    switch (ext) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.tiff':
      case '.tif':
        return 'image/tiff';
      default:
        return 'image/jpeg';
    }
  }

  private getImageInfo(imagePath: string): string {
    const stats = fs.statSync(imagePath);
    const sizeKB = Math.round(stats.size / 1024);
    const filename = path.basename(imagePath);

    return `Filename: ${filename}, Size: ${sizeKB}KB, Format: ${path.extname(imagePath)}`;
  }

  private createAssessmentPrompt(): string {
    return `You are an expert image quality analyst specializing in receipt and invoice document assessment. Your task is to thoroughly analyze the provided receipt/invoice image and assess its quality across multiple dimensions before OCR/data extraction processing.

ANALYSIS REQUIREMENTS:

1. **BLUR DETECTION**: Examine text sharpness, edge definition, and overall focus quality. Look for motion blur, camera shake, or out-of-focus areas that would impair text recognition.
   - Provide quantitative_measure: blur intensity (0.0=sharp, 1.0=extremely blurry)
   - Assess severity_level and confidence_score

2. **CONTRAST ASSESSMENT**: Evaluate the contrast between text and background. Check for adequate differentiation that enables clear text recognition.
   - Provide quantitative_measure: contrast ratio assessment (0.0=poor, 1.0=excellent)
   - Consider lighting conditions and background uniformity

3. **GLARE IDENTIFICATION**: Detect bright spots, reflections, or glare that obscure text or important document areas. Look for overexposed regions.
   - Provide quantitative_measure: percentage of image affected by glare (0.0-1.0)
   - Identify specific areas where glare impacts readability

4. **WATER STAIN DETECTION**: Identify water damage including discoloration, staining, warping effects, or color distortions that affect document readability.
   - Provide quantitative_measure: percentage of document affected (0.0-1.0)
   - Assess impact on text legibility

5. **TEARS OR FOLDS DETECTION**: Look for physical damage like tears, creases, folds, or wrinkles that may cause text distortion or information loss.
   - Provide quantitative_measure: severity of physical damage (0.0=none, 1.0=severe)
   - Count visible fold lines or tear areas

6. **CUT-OFF DETECTION**: Check if document edges are cut off or if the image frame excludes important document portions.
   - Provide quantitative_measure: percentage of document potentially cut off (0.0-1.0)
   - Identify which edges are affected

7. **MISSING SECTIONS**: Identify if parts of the receipt/invoice are missing, incomplete, or not captured in the image.
   - Provide quantitative_measure: estimated percentage of content missing (0.0-1.0)
   - Consider typical receipt structure

8. **OBSTRUCTIONS**: Detect any objects, fingers, shadows, or other elements that block or obscure document content.
   - Provide quantitative_measure: percentage of document obscured (0.0-1.0)
   - Identify types of obstructions

ASSESSMENT CRITERIA:
- For each quality issue, determine if it's detected (True/False)
- Assign severity_level: 'none', 'low', 'medium', 'high', 'critical'
- Provide confidence_score (0.0-1.0) for your detection confidence
- Include quantitative_measure for measurable aspects
- Provide a concise, factual description in one sentence
- Give practical recommendations
- Assign an overall quality score (1-10, where 10 is perfect quality)
- Determine if the image is suitable for OCR/data extraction

IMPORTANT GUIDELINES:
- Focus specifically on receipt/invoice characteristics (structured text, tables, line items, totals)
- Be thorough but practical in your assessment
- Consider the impact on automated text extraction systems
- Prioritize issues that would significantly impair data extraction accuracy
- Use quantitative measures to provide objective assessments where possible

CRITICAL: You MUST return a JSON object with EXACTLY this structure:
{
  "blur_detection": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "contrast_assessment": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "glare_identification": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "water_stains": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "tears_or_folds": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "cut_off_detection": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "missing_sections": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "obstructions": {
    "detected": boolean,
    "severity_level": "none|low|medium|high|critical",
    "confidence_score": number (0.0-1.0),
    "quantitative_measure": number,
    "description": "string",
    "recommendation": "string"
  },
  "overall_quality_score": number (1-10),
  "suitable_for_extraction": boolean
}

Do NOT use any other field names. Do NOT add extra fields. Return ONLY the JSON object.`;
  }

  private parseJsonResponse(content: string): any {
    try {
      // Remove markdown code blocks if present
      const cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      return JSON.parse(cleanContent);
    } catch (error) {
      this.logger.error('Failed to parse JSON response:', error);
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }

  formatAssessmentForWorkflow(assessment: ImageQualityAssessment, imagePath: string) {
    const modelUsed = this.currentProvider === 'bedrock' ? (process.env.BEDROCK_MODEL || 'eu.amazon.nova-pro-v1:0') : 'claude-3-5-sonnet-20241022';

    return {
      image_path: imagePath,
      assessment_method: 'LLM',
      model_used: modelUsed,
      timestamp: new Date().toISOString(),
      quality_score: assessment.overall_quality_score * 10, // Convert to 0-100 scale
      quality_level: this.getQualityLevel(assessment.overall_quality_score),
      suitable_for_extraction: assessment.suitable_for_extraction,
      ...assessment,
    };
  }

  private getQualityLevel(score: number): string {
    if (score >= 8) return 'excellent';
    if (score >= 6) return 'good';
    if (score >= 4) return 'fair';
    return 'poor';
  }
}
