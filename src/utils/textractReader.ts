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
    // Initialize Textract client with credentials
    this.textractClient = new TextractClient({
      region: region || process.env.AWS_REGION || 'us-east-1',
      credentials: accessKeyId && secretAccessKey ? {
        accessKeyId,
        secretAccessKey,
      } : undefined, // Use default credential chain if not provided
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

      // Read file
      const fileBuffer = fs.readFileSync(filePath);
      
      // Determine which Textract API to use based on config
      const featureTypes = config.featureTypes || [];
      let blocks: Block[] = [];

      if (featureTypes.length > 0) {
        // Use AnalyzeDocument for advanced features (tables, forms, etc.)
        const analyzeCommand = new AnalyzeDocumentCommand({
          Document: {
            Bytes: fileBuffer,
          },
          FeatureTypes: featureTypes as FeatureType[],
        });

        const analyzeResponse = await this.textractClient.send(analyzeCommand);
        blocks = analyzeResponse.Blocks || [];
      } else {
        // Use DetectDocumentText for simple text extraction
        const detectCommand = new DetectDocumentTextCommand({
          Document: {
            Bytes: fileBuffer,
          },
        });

        const detectResponse = await this.textractClient.send(detectCommand);
        blocks = detectResponse.Blocks || [];
      }

      // Convert blocks to markdown
      const markdownContent = this.convertBlocksToMarkdown(blocks);

      console.log(
        `Document parsed successfully with Textract. Content length: ${markdownContent.length} characters`
      );

      return {
        success: true,
        data: markdownContent,
      };
    } catch (error) {
      console.error("Error parsing document with Textract:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      };
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
