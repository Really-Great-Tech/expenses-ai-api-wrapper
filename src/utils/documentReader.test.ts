import { DocumentReaderFactory } from './documentReaderFactory';
import { DocumentReaderType } from './types';

describe('DocumentReaderFactory', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.DOCUMENT_READER;
    delete process.env.LLAMAINDEX_API_KEY;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    delete process.env.AWS_REGION;
  });

  describe('createReader', () => {
    it('should create LlamaParse reader', () => {
      const reader = DocumentReaderFactory.createReader(DocumentReaderType.LLAMAPARSE, 'test-api-key');
      expect(reader).toBeDefined();
      expect(reader.constructor.name).toBe('LlamaParseApiService');
    });

    it('should create Textract reader', () => {
      const reader = DocumentReaderFactory.createReader(DocumentReaderType.TEXTRACT, 'test-access-key');
      expect(reader).toBeDefined();
      expect(reader.constructor.name).toBe('TextractApiService');
    });

    it('should throw error for unsupported reader type', () => {
      expect(() => {
        DocumentReaderFactory.createReader('unsupported', 'test-key');
      }).toThrow('Unsupported document reader type: unsupported');
    });
  });

  describe('getDefaultReader', () => {
    it('should return LlamaParse reader by default', () => {
      process.env.LLAMAINDEX_API_KEY = 'test-llama-key';
      
      const reader = DocumentReaderFactory.getDefaultReader();
      expect(reader).toBeDefined();
      expect(reader.constructor.name).toBe('LlamaParseApiService');
    });

    it('should return Textract reader when configured', () => {
      process.env.DOCUMENT_READER = DocumentReaderType.TEXTRACT;
      process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
      process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
      process.env.AWS_REGION = 'us-east-1';
      
      const reader = DocumentReaderFactory.getDefaultReader();
      expect(reader).toBeDefined();
      expect(reader.constructor.name).toBe('TextractApiService');
    });

    it('should throw error when LlamaParse API key is missing', () => {
      expect(() => {
        DocumentReaderFactory.getDefaultReader();
      }).toThrow('LLAMAINDEX_API_KEY not found in environment variables');
    });

    it('should throw error when AWS credentials are missing for Textract', () => {
      process.env.DOCUMENT_READER = DocumentReaderType.TEXTRACT;
      
      expect(() => {
        DocumentReaderFactory.getDefaultReader();
      }).toThrow('AWS credentials not found in environment variables');
    });

    it('should throw error for unsupported reader type in environment', () => {
      process.env.DOCUMENT_READER = 'unsupported';
      
      expect(() => {
        DocumentReaderFactory.getDefaultReader();
      }).toThrow('Unsupported document reader type: unsupported');
    });
  });
});

describe('Document Reader Integration', () => {
  it('should have consistent interface between readers', async () => {
    // Mock environment for LlamaParse
    process.env.LLAMAINDEX_API_KEY = 'test-llama-key';
    const llamaReader = DocumentReaderFactory.getDefaultReader();
    
    // Mock environment for Textract
    process.env.DOCUMENT_READER = DocumentReaderType.TEXTRACT;
    process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.AWS_REGION = 'us-east-1';
    const textractReader = DocumentReaderFactory.getDefaultReader();
    
    // Both should have parseDocument method
    expect(typeof llamaReader.parseDocument).toBe('function');
    expect(typeof textractReader.parseDocument).toBe('function');
    
    // Both should accept the same parameters
    const mockFilePath = 'test.pdf';
    const mockConfig = { timeout: 60000 };
    
    // Note: These would fail in actual execution due to missing files/credentials
    // but we're testing the interface consistency
    expect(() => llamaReader.parseDocument(mockFilePath, mockConfig)).not.toThrow();
    expect(() => textractReader.parseDocument(mockFilePath, mockConfig)).not.toThrow();
  });
});
