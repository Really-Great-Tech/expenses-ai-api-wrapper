import { Injectable, Logger } from '@nestjs/common';
import { OpenAI } from '@llamaindex/openai';
import { Anthropic } from '@llamaindex/anthropic';
import { PageMarkdown, PageAnalysisResult } from '../types/invoice-splitter.types';

@Injectable()
export class InvoiceSplitterAgent {
  private readonly logger = new Logger(InvoiceSplitterAgent.name);
  private llm: any;

  constructor() {
    // Get provider from environment variable
    const provider = process.env.SPLITTER_LLM_PROVIDER || process.env.LLM_PROVIDER || 'anthropic';
    
    if (provider === 'anthropic') {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    } else {
      this.llm = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4o',
      });
    }
    
    this.logger.log(`Initialized InvoiceSplitterAgent with ${provider} LLM provider`);
  }

  async analyzePages(pageMarkdowns: PageMarkdown[]): Promise<PageAnalysisResult> {
    try {
      this.logger.log(`Starting invoice analysis for ${pageMarkdowns.length} pages`);

      const prompt = this.buildPageAnalysisPrompt(pageMarkdowns);

      const response = await this.llm.chat({
        messages: [
          {
            role: 'system',
            content: `You are an expert document analyst specializing in invoice detection and page boundary identification. Your task is to analyze document pages and determine which pages belong to which invoice. You have deep expertise in understanding invoice structures, document formatting, and multi-page invoice patterns.

Your analysis should be precise and methodical:
1. Look for clear invoice boundaries like new invoice numbers, different vendors, separate totals
2. Understand that invoices can span multiple pages
3. Identify continuation pages that belong to previous invoices
4. Consider document flow and logical groupings
5. Provide high confidence scores for clear separations and lower for ambiguous cases

Always respond with valid JSON only - no explanations or markdown formatting.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse the JSON response
      let rawContent: string;
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

      this.logger.debug(`Raw response: ${rawContent.substring(0, 300)}...`);

      const parsedResult = this.parseJsonResponse(rawContent);
      
      // Validate the structure
      if (!parsedResult.totalInvoices || !Array.isArray(parsedResult.pageGroups)) {
        throw new Error('Invalid response structure from LLM');
      }

      this.logger.log(`Invoice analysis completed: ${parsedResult.totalInvoices} invoices detected`);

      return parsedResult as PageAnalysisResult;
    } catch (error) {
      this.logger.error('Invoice analysis failed:', error);
      
      // Return fallback: treat all pages as single invoice
      return {
        totalInvoices: 1,
        pageGroups: [
          {
            invoiceNumber: 1,
            pages: pageMarkdowns.map(p => p.pageNumber),
            confidence: 0.3,
            reasoning: `Analysis failed (${error.message}), treating as single invoice`
          }
        ]
      };
    }
  }

  private buildPageAnalysisPrompt(pages: PageMarkdown[]): string {
    const pagesContent = pages.map(page => 
      `=== PAGE ${page.pageNumber} ===\n${page.content.substring(0, 2000)}${page.content.length > 2000 ? '...' : ''}\n`
    ).join('\n');

    return `Analyze these PDF pages to determine which pages belong to which invoice.

DOCUMENT PAGES:
${pagesContent}

INSTRUCTIONS:
1. Identify separate invoices across these pages
2. Group consecutive pages that belong to the same invoice
3. Look for clear invoice boundaries: new invoice numbers, different vendors, separate totals
4. Handle continuation pages (pages without headers that continue previous invoice)

GROUPING RULES:
- Pages with same invoice number belong together
- Pages with same vendor/company belong together  
- Continuation pages (just line items, no header) belong to previous invoice
- New invoice headers always start a new group
- Consider date continuity and amount consistency
- Look for formatting breaks, different layouts, or clear document separators

CONFIDENCE SCORING:
- 0.9-1.0: Clear separate invoices with distinct headers/totals
- 0.7-0.8: Likely separate invoices with some shared elements
- 0.5-0.6: Possible separate invoices, unclear boundaries
- 0.0-0.4: Probably single invoice or very unclear structure

RESPONSE FORMAT (valid JSON only):
{
  "totalInvoices": 2,
  "pageGroups": [
    {
      "invoiceNumber": 1,
      "pages": [1, 2],
      "confidence": 0.95,
      "reasoning": "Pages 1-2: Invoice #INV-001 from Company A, includes header and items"
    },
    {
      "invoiceNumber": 2,
      "pages": [3, 4, 5], 
      "confidence": 0.88,
      "reasoning": "Pages 3-5: Invoice #INV-002 from Company B, multi-page with continuation"
    }
  ]
}

CRITICAL: Respond with ONLY the JSON object. No explanations, markdown formatting, or additional text.`;
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
}
