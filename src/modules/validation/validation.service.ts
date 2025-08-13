import { Injectable, Logger } from "@nestjs/common";
import { DocumentService } from "../document/document.service";

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(private documentService: DocumentService) {}

  /**
   * Run LLM-as-judge validation on a specific job
   */
  async validateJobResults(jobId: string): Promise<any> {
    this.logger.log(`🔍 Starting LLM-as-judge validation for job: ${jobId}`);
    
    try {
      const result = await this.documentService.validateJobResults(jobId);
      this.logger.log(`✅ LLM-as-judge validation completed for job: ${jobId}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ LLM validation failed for job ${jobId}:`, error);
      throw error;
    }
  }

  /**
   * Run LLM-as-judge validation on all completed jobs (batch validation)
   */
  async validateAllCompletedJobs(): Promise<any> {
    this.logger.log('🚀 Starting batch LLM-as-judge validation for all completed jobs');
    
    try {
      const result = await this.documentService.validateAllCompletedJobs();
      this.logger.log(`✅ Batch LLM-as-judge validation completed: ${result.validation_summary?.successful_validations}/${result.validation_summary?.total_files_processed} successful`);
      return result;
    } catch (error) {
      this.logger.error('❌ Batch LLM validation failed:', error);
      throw error;
    }
  }

  /**
   * Get validation health status
   */
  async getValidationHealth(): Promise<any> {
    try {
      // Check if validation system is available
      const health = await this.documentService.getHealthStatus();
      
      return {
        service: "LLM-as-Judge Validation Service",
        status: "healthy",
        timestamp: new Date().toISOString(),
        validation_available: true,
        document_service_health: health.status
      };
    } catch (error) {
      this.logger.error("Validation health check failed:", error);
      return {
        service: "LLM-as-Judge Validation Service",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        validation_available: false,
        error: error.message
      };
    }
  }
}