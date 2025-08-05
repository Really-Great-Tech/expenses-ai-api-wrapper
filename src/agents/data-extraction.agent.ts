import { Anthropic } from '@llamaindex/anthropic';
import { ExpenseDataSchema, type ExpenseData } from '../schemas/expense-schemas';
import { Logger } from '@nestjs/common';
import { BedrockLlmService } from '../utils/bedrockLlm';

export class DataExtractionAgent {
  private readonly logger = new Logger(DataExtractionAgent.name);
  private llm: any;
  constructor(provider: 'bedrock' | 'anthropic' = 'bedrock') {
    this.logger.log(`Initializing DataExtractionAgent with provider: ${provider}`);

    if (provider === 'bedrock') {
      this.llm = new BedrockLlmService();
    } else {
      this.llm = new Anthropic({
        apiKey: process.env.ANTHROPIC_KEY,
        model: 'claude-3-5-sonnet-20241022',
      });
    }
  }

  async extractData(
    markdownContent: string,
    complianceRequirements: any // Note: No longer used for schema definition, kept for API compatibility
  ): Promise<ExpenseData> {
    try {
      this.logger.log('Starting data extraction with standard receipt/invoice schema');

      const prompt = this.buildExtractionPrompt(markdownContent);

      const response = await this.llm.chat({
        messages: [
          {
            role: 'system',
            content: `Persona: You are a meticulous and highly accurate data extraction AI. You specialize in parsing unstructured text from expense documents and structuring it into a precise JSON format. Your primary function is to identify and extract data points from the receipt text based on your understanding of standard receipt/invoice schemas.

Task: Your goal is to extract all relevant fields from the provided RECEIPT TEXT using your knowledge of standard receipt and invoice structures. You should identify and extract comprehensive information that would be useful for expense management and compliance purposes.

INPUTS:
1. RECEIPT TEXT (MARKDOWN):
This is the raw text from the document that needs to be analyzed and from which you should extract all relevant information.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Parse the JSON response manually since structured output isn't working as expected
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
      const result = ExpenseDataSchema.parse(parsedResult);

      this.logger.log(`Data extraction completed: ${Object.keys(result).length} fields extracted`);

      return result;
    } catch (error) {
      this.logger.error('Data extraction failed:', error);
      
      // Return minimal fallback result
      return {
        vendor_name: 'extraction_failed',
        notes: `Error: ${error.message}`,
      };
    }
  }

  private buildExtractionPrompt(markdownContent: string): string {
    return `RECEIPT TEXT (MARKDOWN):
${markdownContent}

INSTRUCTIONS:
Analyze: Carefully read the RECEIPT TEXT to identify all available information.

Extract Standard Receipt/Invoice Fields: Based on your understanding of standard receipt and invoice structures, extract all relevant information that would be useful for expense management and compliance purposes, including but not limited to:

CORE FIELDS:
- Supplier/vendor information (name, address, contact details, VAT/tax numbers)
- Customer/recipient information (if present)
- Transaction details (date, time, invoice/receipt number, reference numbers)
- Financial information (total amount, currency, subtotals, taxes, discounts, tips)
- Payment information (method, card details if present)

DETAILED INFORMATION:
- Line items with their details (products/services, quantities, unit prices, total prices, categories)
- Tax-related information (rates, amounts, tax IDs, VAT numbers)
- Location information (country, city, address, table numbers, etc.)
- Contact information (phone, email, website, fax)
- Special notes, terms, conditions, or additional information
- Document type and classification
- Any other structured data present in the receipt

Format: Structure your findings into a single, valid JSON object.
Use descriptive snake_case field names that clearly indicate what the data represents.
If a field cannot be found in the text, its value in the output JSON MUST be null. Do not guess or invent data.
For dates, standardize the format to YYYY-MM-DD. If you cannot determine the year, assume the current year.
For amounts and rates, extract only the numerical value (e.g., 120.50, 19.0).
For currency, use the standard 3-letter ISO code (e.g., "EUR", "USD") if possible; otherwise, extract the symbol.
For line items, create an array of objects with details like item name, quantity, unit price, and total price.
Adapt field names to the type of receipt (restaurant, hotel, transport, retail, etc.) while maintaining consistency.

CRITICAL REQUIREMENT:
Your final output MUST BE ONLY a valid JSON object. Do not include any explanatory text, greetings, apologies, or markdown formatting like \`\`\`json before or after the JSON object.

EXAMPLE OUTPUT STRUCTURE:
Extract all relevant fields found in the receipt using descriptive field names. This example shows the structure and naming conventions:

{
  "country": "Germany",
  "supplier_name": "THE SUSHI CLUB",
  "supplier_address": "Mohrenstr.42, 10117 Berlin",
  "supplier_vat_number": "DE123456789",
  "supplier_phone": "+49 30 23 916 036",
  "supplier_email": "info@thesushiclub.de",
  "supplier_website": "WWW.TheSushiClub.de",
  "customer_name": null,
  "customer_address": null,
  "invoice_number": "INV-2019-001234",
  "receipt_number": "R-001234",
  "transaction_reference": "L0001 FRÜH",
  "currency": "EUR",
  "total_amount": 64.40,
  "subtotal": 54.12,
  "tax_amount": 10.28,
  "tax_rate": 19.0,
  "discount_amount": null,
  "tip_amount": null,
  "date_of_issue": "2019-02-05",
  "transaction_time": "23:10:54",
  "payment_method": "Credit Card",
  "card_last_four": "1234",
  "line_items": [
    {
      "description": "Miso Soup",
      "quantity": 1,
      "unit_price": 3.90,
      "total_price": 3.90,
      "category": "Food"
    },
    {
      "description": "Sushi Platter",
      "quantity": 2,
      "unit_price": 25.11,
      "total_price": 50.22,
      "category": "Food"
    }
  ],
  "receipt_type": "Restaurant Receipt",
  "document_type": "Rechnung",
  "table_number": "24",
  "server_name": null,
  "location_city": "Berlin",
  "location_country": "Germany",
  "special_notes": "TIP IS NOT INCLUDED",
  "terms_conditions": null,
  "business_registration_number": null
}`;
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
