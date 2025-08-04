import { Anthropic } from '@llamaindex/anthropic';
import { CitationResultSchema, type CitationResult } from '../schemas/expense-schemas';
import { Logger } from '@nestjs/common';
import { BedrockLlmService } from '../utils/bedrockLlm';

export class CitationGeneratorAgent {
  private readonly logger = new Logger(CitationGeneratorAgent.name);
  private llm: any;
  
  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock') {
    this.logger.log(`Initializing CitationGeneratorAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      // Use Nova Micro for citations - better for structured output
      const citationModel = process.env.CITATION_MODEL || 'amazon.nova-micro-v1:0';
      this.llm = new BedrockLlmService({ modelId: citationModel });
      this.logger.log(`Using model for citations: ${citationModel}`);
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    }
  }

  async generateCitations(
    extractedData: any,
    extractionRequirements: string,
    markdownContent: string,
    filename: string
  ): Promise<CitationResult> {
    try {
      this.logger.log(`Starting citation generation for ${filename}`);

      // Process citations in batches to handle context window limitations
      const fieldEntries = Object.entries(extractedData);
      const batchSize = 8; // Process 8 fields at a time
      const allCitations: any = {};
      let totalFieldsAnalyzed = 0;
      let fieldsWithFieldCitations = 0;
      let fieldsWithValueCitations = 0;
      let totalConfidence = 0;

      this.logger.log(`Processing ${fieldEntries.length} fields in batches of ${batchSize}`);

      for (let i = 0; i < fieldEntries.length; i += batchSize) {
        const batch = fieldEntries.slice(i, i + batchSize);
        const batchData = Object.fromEntries(batch);
        
        this.logger.debug(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(fieldEntries.length / batchSize)} with ${batch.length} fields`);

        const batchResult = await this.processCitationBatch(
          batchData,
          extractionRequirements,
          markdownContent,
          batch.length
        );

        // Merge batch results
        Object.assign(allCitations, batchResult.citations);
        totalFieldsAnalyzed += batchResult.metadata.total_fields_analyzed;
        fieldsWithFieldCitations += batchResult.metadata.fields_with_field_citations;
        fieldsWithValueCitations += batchResult.metadata.fields_with_value_citations;
        totalConfidence += batchResult.metadata.average_confidence * batchResult.metadata.total_fields_analyzed;
      }

      const averageConfidence = totalFieldsAnalyzed > 0 ? totalConfidence / totalFieldsAnalyzed : 0;

      const result: CitationResult = {
        citations: allCitations,
        metadata: {
          total_fields_analyzed: totalFieldsAnalyzed,
          fields_with_field_citations: fieldsWithFieldCitations,
          fields_with_value_citations: fieldsWithValueCitations,
          average_confidence: averageConfidence,
        },
      };

      this.logger.log(`Citation generation completed: ${result.metadata.total_fields_analyzed} fields analyzed across ${Math.ceil(fieldEntries.length / batchSize)} batches`);

      return result;
    } catch (error) {
      this.logger.error('Citation generation failed:', error);
      
      // Return fallback result
      return {
        citations: {},
        metadata: {
          total_fields_analyzed: 0,
          fields_with_field_citations: 0,
          fields_with_value_citations: 0,
          average_confidence: 0.0,
        },
      };
    }
  }

  private async processCitationBatch(
    batchData: any,
    extractionRequirements: string,
    markdownContent: string,
    expectedFields: number
  ): Promise<CitationResult> {
    const prompt = this.buildCitationPrompt(
      batchData,
      extractionRequirements,
      markdownContent
    );

    const response = await this.llm.chat({
      messages: [
        {
          role: 'system',
          content: `You are a citation expert specializing in finding where extracted data fields and their values appear in source documents.

Your task is to analyze structured output from data extraction and find TWO types of citations for each field:

1. FIELD CITATION: Where does this field name/concept appear in the source?
   - Check extraction requirements for field_type definitions
   - Check markdown for field labels, headers, form fields
   - Look for: "Total:", "Supplier Name:", table headers, section labels, etc.

2. VALUE CITATION: Where does this exact value appear in the source?
   - Find exact matches in markdown text
   - Handle fuzzy matches for dates, numbers, currencies
   - Consider context and formatting variations
   - Look for values near field labels or in structured sections

ANALYSIS APPROACH:
- Use semantic understanding to match field concepts even with different wording
- Handle variations in formatting (dates, currencies, numbers)
- Assess confidence based on match quality and context
- Provide surrounding context for validation

CRITICAL REQUIREMENTS:
- Analyze ALL ${expectedFields} fields provided in the structured output
- Provide accurate citations with proper confidence scores
- Use semantic understanding to match field concepts
- Handle formatting variations appropriately
- Ensure all fields are properly populated according to the structured output format

CRITICAL: You MUST return a JSON object with EXACTLY this structure and field names:
{
  "citations": {
    "field_name": {
      "field_citation": {
        "source_text": "exact_text_from_source",
        "confidence": number (0.0-1.0),
        "source_location": "requirements|markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      },
      "value_citation": {
        "source_text": "exact_text_from_source",
        "confidence": number (0.0-1.0),
        "source_location": "requirements|markdown",
        "context": "surrounding_text_for_validation",
        "match_type": "exact|fuzzy|contextual"
      }
    }
  },
  "metadata": {
    "total_fields_analyzed": number,
    "fields_with_field_citations": number,
    "fields_with_value_citations": number,
    "average_confidence": number (0.0-1.0)
  }
}

Do NOT use any other field names. Do NOT add extra fields. Return ONLY the JSON object.`,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    let rawContent = '';

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

    const parsedResult = this.parseJsonResponse(rawContent);
    return CitationResultSchema.parse(parsedResult);
  }

  private buildCitationPrompt(
    extractedData: any,
    extractionRequirements: string,
    markdownContent: string
  ): string {
    return `STRUCTURED OUTPUT (JSON):
${JSON.stringify(extractedData, null, 2)}

EXTRACTION REQUIREMENTS (JSON):
${extractionRequirements}

MARKDOWN TEXT:
${markdownContent}

Analyze the structured output and find field and value citations in the source documents.`;
  }

  private parseJsonResponse(content: string): any {
    try {
      // Simple cleanup for Claude models - they produce clean JSON
      let cleanContent = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();

      // Find JSON start and end
      const jsonStart = cleanContent.indexOf('{');
      const jsonEnd = cleanContent.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanContent = cleanContent.substring(jsonStart, jsonEnd + 1);
      }

      return JSON.parse(cleanContent);
    } catch (error) {
      this.logger.error('Failed to parse JSON response:', error);
      this.logger.error(`Content preview: ${content.substring(0, 500)}...`);
      throw new Error(`Invalid JSON response: ${error.message}`);
    }
  }
}
