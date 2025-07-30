import * as fs from "fs";
import {
  TextractClient,
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
  Block,
  Relationship,
  FeatureType
} from "@aws-sdk/client-textract";
import { DocumentReader, DocumentReaderConfig, TextractConfig, ApiResponse } from "./types";

/**
 * AWS Textract service for document text extraction
 */
export class TextractApiService implements DocumentReader {
  private textractClient: TextractClient;
  private parseCache = new Map<string, { result: Promise<ApiResponse<string>>; timestamp: number }>();
  private cacheTimeout = 10 * 60 * 1000; // 10 minutes cache

  constructor(accessKeyId?: string, secretAccessKey?: string, region?: string) {
    const awsRegion = region || process.env.AWS_REGION || 'us-east-1';
    console.log(`🌍 Initializing Textract client for region: ${awsRegion}`);

    const credentials = accessKeyId && secretAccessKey ? {
      accessKeyId,
      secretAccessKey,
    } : undefined; // Use default credential chain if not provided

    // Initialize Textract client
    this.textractClient = new TextractClient({
      region: awsRegion,
      credentials,
    });
  }

  /**
   * Parse document using AWS Textract
   */
  async parseDocument(
    filePath: string,
    config: TextractConfig = {}
  ): Promise<ApiResponse<string>> {
    // Create cache key based on file path and config
    const cacheKey = `${filePath}_${JSON.stringify(config)}`;
    const now = Date.now();

    // Clean expired cache entries
    for (const [key, entry] of this.parseCache.entries()) {
      if (now - entry.timestamp > this.cacheTimeout) {
        this.parseCache.delete(key);
      }
    }

    // Check if we have a cached result for this file
    const cachedEntry = this.parseCache.get(cacheKey);
    if (cachedEntry) {
      console.log(`Using cached result for document: ${filePath}`);
      return await cachedEntry.result;
    }

    // Create the parsing promise
    const parsePromise = this.performTextractParsing(filePath, config);
    
    // Cache the promise immediately to prevent duplicate calls
    this.parseCache.set(cacheKey, {
      result: parsePromise,
      timestamp: now,
    });

    return await parsePromise;
  }

  /**
   * Perform the actual document parsing using Textract
   */
  private async performTextractParsing(
    filePath: string,
    config: TextractConfig
  ): Promise<ApiResponse<string>> {
    try {
      console.log(`Parsing document with Textract: ${filePath}`);

      // Check if file exists
      if (!fs.existsSync(filePath)) {
        return {
          success: false,
          error: `File not found: ${filePath}`,
        };
      }

      // Read file and get diagnostic information
      const fileBuffer = fs.readFileSync(filePath);
      const fileStats = fs.statSync(filePath);

      // Log diagnostic information
      console.log(`📄 File diagnostics for ${filePath}:`);
      console.log(`   Size: ${fileStats.size} bytes (${(fileStats.size / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`   Buffer length: ${fileBuffer.length}`);
      console.log(`   File extension: ${filePath.split('.').pop()}`);

      // Check file size limits (Textract limit is 10MB for synchronous)
      const maxSizeBytes = 10 * 1024 * 1024; // 10MB
      if (fileStats.size > maxSizeBytes) {
        return {
          success: false,
          error: `File too large for Textract: ${(fileStats.size / 1024 / 1024).toFixed(2)}MB (max: 10MB)`,
        };
      }

      // Detect file type by header
      const fileHeader = fileBuffer.slice(0, 8);
      const headerString = fileHeader.toString('binary');
      const fileExtension = filePath.split('.').pop()?.toLowerCase() || '';

      let fileType = 'unknown';
      let isValidFormat = false;

      // Check for PDF
      if (headerString.startsWith('%PDF')) {
        fileType = 'pdf';
        isValidFormat = true;
        const pdfVersion = fileBuffer.slice(0, 8).toString();
        console.log(`   File type: PDF`);
        console.log(`   PDF version: ${pdfVersion}`);
      }
      // Check for PNG
      else if (fileHeader[0] === 0x89 && fileHeader[1] === 0x50 && fileHeader[2] === 0x4E && fileHeader[3] === 0x47) {
        fileType = 'png';
        isValidFormat = true;
        console.log(`   File type: PNG image`);
      }
      // Check for JPEG
      else if (fileHeader[0] === 0xFF && fileHeader[1] === 0xD8 && fileHeader[2] === 0xFF) {
        fileType = 'jpeg';
        isValidFormat = true;
        console.log(`   File type: JPEG image`);
      }
      // Check for TIFF
      else if ((fileHeader[0] === 0x49 && fileHeader[1] === 0x49 && fileHeader[2] === 0x2A && fileHeader[3] === 0x00) ||
               (fileHeader[0] === 0x4D && fileHeader[1] === 0x4D && fileHeader[2] === 0x00 && fileHeader[3] === 0x2A)) {
        fileType = 'tiff';
        isValidFormat = true;
        console.log(`   File type: TIFF image`);
      }
      else {
        console.log(`   File type: Unknown (header: ${Array.from(fileHeader.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ')})`);
      }

      if (!isValidFormat) {
        return {
          success: false,
          error: `Unsupported file format: Expected PDF, PNG, JPEG, or TIFF. Detected: ${fileType}`,
        };
      }

      // Estimate page count based on file type
      let estimatedPages = 1;
      let isMultiPage = false;

      if (fileType === 'pdf') {
        // For PDFs, estimate page count from content
        const content = fileBuffer.toString('binary');
        const pageMatches = content.match(/\/Type\s*\/Page[^s]/g);
        estimatedPages = pageMatches ? pageMatches.length : 1;
        isMultiPage = estimatedPages > 1;

        console.log(`   Estimated pages: ${estimatedPages}`);

        if (estimatedPages > 100) {
          console.log(`   ⚠️ High page count detected (${estimatedPages} pages)`);
        }
      } else {
        // Images are always single page
        console.log(`   Pages: 1 (image file)`);
      }

      console.log(`   Processing method: ${isMultiPage ? 'SPLIT (multi-page PDF)' : 'DIRECT (single-page)'}`);

      // Route to appropriate processing method
      if (isMultiPage) {
        return await this.processMultiPageDocumentBySplitting(fileBuffer, filePath, config, estimatedPages);
      } else {
        return await this.processSinglePageDocument(fileBuffer, config);
      }

    } catch (error) {
      console.error("❌ Error parsing document with Textract:", error);

      // Enhanced error reporting
      let errorMessage = "Unknown error occurred";
      let errorCode = "UNKNOWN";

      if (error instanceof Error) {
        errorMessage = error.message;

        // Check for specific AWS Textract error types
        if (error.message.includes("unsupported document format")) {
          errorCode = "UNSUPPORTED_FORMAT";
          console.error(`🚫 UNSUPPORTED_FORMAT: The PDF format is not supported by Textract`);
          console.error(`   Common causes:`);
          console.error(`   - Encrypted or password-protected PDF`);
          console.error(`   - Corrupted PDF file`);
          console.error(`   - Non-standard PDF structure`);
          console.error(`   - PDF version incompatibility`);
        } else if (error.message.includes("InvalidParameterException")) {
          errorCode = "INVALID_PARAMETER";
          console.error(`🚫 INVALID_PARAMETER: Invalid request parameters`);
        } else if (error.message.includes("ProvisionedThroughputExceededException")) {
          errorCode = "THROTTLED";
          console.error(`🚫 THROTTLED: Textract rate limit exceeded`);
        } else if (error.message.includes("InternalServerError")) {
          errorCode = "INTERNAL_ERROR";
          console.error(`🚫 INTERNAL_ERROR: AWS Textract internal error`);
        }
      }

      return {
        success: false,
        error: `${errorCode}: ${errorMessage}`,
      };
    }
  }

  /**
   * Process single-page documents using synchronous APIs
   */
  private async processSinglePageDocument(
    fileBuffer: Buffer,
    config: TextractConfig
  ): Promise<ApiResponse<string>> {
    try {
      // Determine which Textract API to use based on config
      const featureTypes = config.featureTypes || [];
      let blocks: Block[] = [];

      console.log(`   Using Textract API: ${featureTypes.length > 0 ? 'AnalyzeDocument' : 'DetectDocumentText'}`);
      console.log(`   Feature types: ${featureTypes.join(', ') || 'none'}`);

      if (featureTypes.length > 0) {
        // Use AnalyzeDocument for advanced features (tables, forms, etc.)
        const analyzeCommand = new AnalyzeDocumentCommand({
          Document: {
            Bytes: fileBuffer,
          },
          FeatureTypes: featureTypes as FeatureType[],
        });

        console.log(`   Sending AnalyzeDocument request to Textract...`);
        const analyzeResponse = await this.textractClient.send(analyzeCommand);
        blocks = analyzeResponse.Blocks || [];
        console.log(`   ✅ AnalyzeDocument successful, received ${blocks.length} blocks`);
      } else {
        // Use DetectDocumentText for simple text extraction
        const detectCommand = new DetectDocumentTextCommand({
          Document: {
            Bytes: fileBuffer,
          },
        });

        console.log(`   Sending DetectDocumentText request to Textract...`);
        const detectResponse = await this.textractClient.send(detectCommand);
        blocks = detectResponse.Blocks || [];
        console.log(`   ✅ DetectDocumentText successful, received ${blocks.length} blocks`);
      }

      // Convert blocks to markdown
      const markdownContent = this.convertBlocksToMarkdown(blocks);

      console.log(
        `Single-page document parsed successfully. Content length: ${markdownContent.length} characters`
      );

      return {
        success: true,
        data: markdownContent,
      };
    } catch (error) {
      console.error("❌ Error in single-page processing:", error);
      throw error; // Re-throw to be handled by main error handler
    }
  }

  /**
   * Process multi-page documents by splitting into individual pages
   */
  private async processMultiPageDocumentBySplitting(
    fileBuffer: Buffer,
    filePath: string,
    config: TextractConfig,
    pageCount: number
  ): Promise<ApiResponse<string>> {
    try {
      console.log(`   📄 Processing ${pageCount}-page document by splitting into individual pages`);

      // Step 1: Split PDF into individual pages
      const pageBuffers = await this.splitPdfIntoPages(fileBuffer);
      console.log(`   ✂️ PDF split into ${pageBuffers.length} pages`);

      // Step 2: Process each page individually
      const pageResults: string[] = [];

      for (let i = 0; i < pageBuffers.length; i++) {
        console.log(`   📄 Processing page ${i + 1}/${pageBuffers.length}...`);

        try {
          const pageResult = await this.processSinglePageDocument(pageBuffers[i], config);

          if (pageResult.success && pageResult.data) {
            pageResults.push(`\n## Page ${i + 1}\n\n${pageResult.data}`);
            console.log(`   ✅ Page ${i + 1} processed successfully (${pageResult.data.length} chars)`);
          } else {
            const errorMsg = 'error' in pageResult ? pageResult.error : 'Unknown error';
            console.log(`   ⚠️ Page ${i + 1} failed: ${errorMsg}`);
            pageResults.push(`\n## Page ${i + 1}\n\n*[Page processing failed: ${errorMsg}]*`);
          }
        } catch (pageError) {
          console.log(`   ❌ Page ${i + 1} error: ${pageError.message}`);
          pageResults.push(`\n## Page ${i + 1}\n\n*[Page processing error: ${pageError.message}]*`);
        }
      }

      // Step 3: Combine all page results
      const combinedContent = pageResults.join('\n');

      console.log(
        `Multi-page document processed successfully. Total content length: ${combinedContent.length} characters`
      );

      return {
        success: true,
        data: combinedContent,
      };
    } catch (error) {
      console.error("❌ Error in multi-page splitting processing:", error);
      throw error; // Re-throw to be handled by main error handler
    }
  }

  /**
   * Split PDF into individual page buffers using pdf-lib
   */
  private async splitPdfIntoPages(pdfBuffer: Buffer): Promise<Buffer[]> {
    try {
      // Import pdf-lib dynamically
      const { PDFDocument } = await import('pdf-lib');

      console.log(`   📄 Loading PDF for splitting...`);

      // Load the PDF document
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pageCount = pdfDoc.getPageCount();

      console.log(`   📄 Splitting PDF with ${pageCount} pages`);

      const pageBuffers: Buffer[] = [];

      for (let i = 0; i < pageCount; i++) {
        console.log(`   ✂️ Extracting page ${i + 1}/${pageCount}...`);

        // Create new PDF with single page
        const newPdf = await PDFDocument.create();
        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
        newPdf.addPage(copiedPage);

        // Convert to buffer
        const pdfBytes = await newPdf.save();
        pageBuffers.push(Buffer.from(pdfBytes));
      }

      console.log(`   ✂️ Successfully split into ${pageBuffers.length} individual pages`);
      return pageBuffers;

    } catch (error) {
      console.error(`   ❌ Error splitting PDF:`, error);
      throw new Error(`Failed to split PDF: ${error.message}`);
    }
  }

  /**
   * Convert Textract blocks to markdown format
   */
  private convertBlocksToMarkdown(blocks: Block[]): string {
    const lines: string[] = [];
    const tables: Map<string, Block[]> = new Map();
    
    // Group blocks by type
    const lineBlocks = blocks.filter(block => block.BlockType === 'LINE');
    const tableBlocks = blocks.filter(block => block.BlockType === 'TABLE');
    const cellBlocks = blocks.filter(block => block.BlockType === 'CELL');
    
    // Process line blocks first (regular text)
    lineBlocks.forEach(block => {
      if (block.Text) {
        lines.push(block.Text);
      }
    });

    // Process tables
    tableBlocks.forEach(table => {
      if (table.Id) {
        const tableCells = this.getTableCells(table, cellBlocks, blocks);
        const tableMarkdown = this.convertTableToMarkdown(tableCells);
        if (tableMarkdown) {
          lines.push('');
          lines.push(tableMarkdown);
          lines.push('');
        }
      }
    });

    return lines.join('\n');
  }

  /**
   * Get table cells for a specific table
   */
  private getTableCells(table: Block, cellBlocks: Block[], allBlocks: Block[]): Block[][] {
    const cells: Block[][] = [];
    
    if (!table.Relationships) return cells;

    // Find cells related to this table
    const tableCellIds = table.Relationships
      .filter(rel => rel.Type === 'CHILD')
      .flatMap(rel => rel.Ids || []);

    const tableCells = cellBlocks.filter(cell => 
      tableCellIds.includes(cell.Id || '')
    );

    // Group cells by row and column
    const cellMap = new Map<string, Block>();
    tableCells.forEach(cell => {
      if (cell.RowIndex !== undefined && cell.ColumnIndex !== undefined) {
        const key = `${cell.RowIndex}-${cell.ColumnIndex}`;
        cellMap.set(key, cell);
      }
    });

    // Convert to 2D array
    const maxRow = Math.max(...tableCells.map(cell => cell.RowIndex || 0));
    const maxCol = Math.max(...tableCells.map(cell => cell.ColumnIndex || 0));

    for (let row = 1; row <= maxRow; row++) {
      const rowCells: Block[] = [];
      for (let col = 1; col <= maxCol; col++) {
        const cell = cellMap.get(`${row}-${col}`);
        if (cell) {
          rowCells.push(cell);
        }
      }
      if (rowCells.length > 0) {
        cells.push(rowCells);
      }
    }

    return cells;
  }

  /**
   * Convert table cells to markdown table format
   */
  private convertTableToMarkdown(cells: Block[][]): string {
    if (cells.length === 0) return '';

    const rows: string[] = [];
    
    cells.forEach((row, rowIndex) => {
      const cellTexts = row.map(cell => {
        // Get text from cell relationships
        const cellText = this.getCellText(cell);
        return cellText.replace(/\|/g, '\\|'); // Escape pipe characters
      });
      
      rows.push(`| ${cellTexts.join(' | ')} |`);
      
      // Add header separator after first row
      if (rowIndex === 0) {
        const separator = cellTexts.map(() => '---').join(' | ');
        rows.push(`| ${separator} |`);
      }
    });

    return rows.join('\n');
  }

  /**
   * Extract text content from a cell block
   */
  private getCellText(cell: Block): string {
    if (cell.Text) {
      return cell.Text;
    }
    
    // If no direct text, try to get from relationships
    if (cell.Relationships) {
      const childTexts: string[] = [];
      cell.Relationships.forEach(rel => {
        if (rel.Type === 'CHILD' && rel.Ids) {
          // In a real implementation, you'd need to look up these IDs in the blocks array
          // For now, we'll return empty string
        }
      });
      return childTexts.join(' ');
    }
    
    return '';
  }
}

// Factory function for easy instantiation
export function createTextractService(
  accessKeyId?: string, 
  secretAccessKey?: string, 
  region?: string
): TextractApiService {
  return new TextractApiService(accessKeyId, secretAccessKey, region);
}
