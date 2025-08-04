import { DocumentReader, DocumentReaderType, DocumentReaderConfig, ApiResponse } from './types';
import { LlamaParseApiService } from './llamaParseReader';
import { TextractApiService } from './textractReader';

/**
 * Factory class for creating document readers
 */
export class DocumentReaderFactory {
  /**
   * Create a document reader based on the specified type
   * @param type The type of document reader to create
   * @param apiKey The API key for the document reader
   * @returns A document reader instance
   */
  static createReader(type: string, apiKey: string): DocumentReader {
    switch (type.toLowerCase()) {
      case DocumentReaderType.LLAMAPARSE:
        return new LlamaParseApiService(apiKey);
      case DocumentReaderType.TEXTRACT:
        return new TextractApiService(apiKey);
      default:
        throw new Error(`Unsupported document reader type: ${type}`);
    }
  }

  /**
   * Get the default document reader based on environment configuration
   * @param overrideType Optional reader type to override environment configuration
   * @returns A document reader instance
   */
  static getDefaultReader(overrideType?: string): DocumentReader {
    const readerType = overrideType || process.env.DOCUMENT_READER || DocumentReaderType.LLAMAPARSE;
    
    switch (readerType.toLowerCase()) {
      case DocumentReaderType.LLAMAPARSE:
        const llamaParseApiKey = process.env.LLAMAINDEX_API_KEY;
        if (!llamaParseApiKey) {
          throw new Error('LLAMAINDEX_API_KEY not found in environment variables');
        }
        return new LlamaParseApiService(llamaParseApiKey);
      
      case DocumentReaderType.TEXTRACT:
        // For Textract, we use service-specific AWS credentials from environment variables
        const textractAccessKeyId = process.env.TEXTRACT_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
        const textractSecretAccessKey = process.env.TEXTRACT_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
        const textractRegion = process.env.TEXTRACT_AWS_REGION || process.env.AWS_REGION;

        if (!textractAccessKeyId || !textractSecretAccessKey || !textractRegion) {
          throw new Error('Textract AWS credentials not found in environment variables');
        }

        return new TextractApiService(textractAccessKeyId, textractSecretAccessKey, textractRegion);
      
      default:
        throw new Error(`Unsupported document reader type: ${readerType}`);
    }
  }
}
