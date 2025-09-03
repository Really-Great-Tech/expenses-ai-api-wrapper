import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue, Job } from "bull";
import { ConfigService } from "@nestjs/config";
import { ExpenseProcessingService } from "../../services/expense-processing.service";
import { EnhancedDocumentProcessingService } from "../../services/enhanced-document-processing.service";
import { UserSessionService } from "../../services/user-session.service";
import * as fs from "fs";
import * as path from "path";
import {
  DocumentProcessingData,
  ProcessingStatus,
  ProcessingMetrics,
  QUEUE_NAMES,
  JOB_TYPES,
} from "../../types";

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.EXPENSE_PROCESSING)
    private expenseQueue: Queue,
    private configService: ConfigService,
    private expenseProcessingService: ExpenseProcessingService,
    private enhancedDocumentProcessingService: EnhancedDocumentProcessingService,
    private userSessionService: UserSessionService,
  ) {}

  async queueDocumentProcessing(request: {
    file: Express.Multer.File;
    userId: string;
    country: string;
    icp: string;
    documentReader?: string;
    actualUserId?: string; // For backward compatibility, but now same as userId
    useEnhancedProcessing?: boolean; // New option for invoice splitting workflow
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
      clientId?: string;
    };
  }): Promise<{ jobId: string; status: string; userId: string; sessionId: string; processingMode: string }> {
    try {
      const { file, userId, country, icp, documentReader, useEnhancedProcessing, metadata } = request;
      
      // Determine processing mode
      const shouldUseEnhanced = useEnhancedProcessing ?? await this.enhancedDocumentProcessingService.shouldUseInvoiceSplitting(file);
      const processingMode = shouldUseEnhanced ? 'enhanced-with-splitting' : 'standard';
      
      this.logger.log(`Processing mode determined: ${processingMode} for file: ${file.originalname}`);
      
      // NEW: Always use hierarchical user system (no more legacy mode)
      const jobInfo = await this.userSessionService.createJobForUser(
        userId, // userId is now the actual user ID
        file.originalname,
        country,
        icp,
        metadata
      );
      
      const jobId = jobInfo.jobId;
      const sessionId = jobInfo.sessionId;
      
      this.logger.log(`Created filename-based job ${jobId} for user ${userId} in session ${sessionId} (${processingMode})`);
      const uploadPath = this.configService.get("UPLOAD_PATH", "./uploads");

      // Ensure upload directory exists
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      // Save file to permanent location
      const fileName = `${jobId}_${file.originalname}`;
      const filePath = path.join(uploadPath, fileName);

      // Ensure upload directory exists
      if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
      }

      // Handle file path - check if file.path exists (from multer temp storage)
      let sourceFilePath = file.path;

      if (!sourceFilePath) {
        // If no temp path, file might be in buffer - save it directly
        if (file.buffer) {
          this.logger.log(`Saving file buffer to ${filePath}`);
          fs.writeFileSync(filePath, file.buffer);
        } else {
          throw new Error('No file path or buffer available from uploaded file');
        }
      } else {
        // Move file from temp location to permanent location
        this.logger.log(`Moving file from ${sourceFilePath} to ${filePath}`);

        try {
          // Ensure temp file exists
          if (!fs.existsSync(sourceFilePath)) {
            throw new Error(`Temp file not found: ${sourceFilePath}`);
          }

          fs.renameSync(sourceFilePath, filePath);
          this.logger.log(`File successfully moved to ${filePath}`);
        } catch (error) {
          this.logger.error(`Failed to move file: ${error.message}`);
          throw new Error(`Failed to save uploaded file: ${error.message}`);
        }
      }

      const jobData: DocumentProcessingData = {
        jobId,
        filePath,
        fileName: file.originalname,
        userId: userId, // Now always the actual user ID
        country,
        icp,
        documentReader: documentReader || "llamaparse",
        uploadedAt: new Date(),
        // Hierarchical user information
        actualUserId: userId, // Same as userId now
        sessionId,
        legacyUserId: undefined, // No longer needed
        // Enhanced processing options
        processingMode,
        useEnhancedProcessing: shouldUseEnhanced,
      };

      // Add job to expense processing queue
      const job = await this.expenseQueue.add(
        JOB_TYPES.PROCESS_DOCUMENT,
        jobData,
        {
          jobId,
          delay: 0,
          attempts: this.configService.get("MAX_RETRY_ATTEMPTS", 3),
          backoff: {
            type: "exponential",
            delay: 2000,
          },
        }
      );

      this.logger.log(
        `Document processing job queued: ${jobId} for file: ${fileName}`
      );

      return {
        jobId,
        status: "queued",
        userId: userId, // Return the user ID
        sessionId,
        processingMode,
      };
    } catch (error) {
      this.logger.error("Failed to queue document processing:", error);
      throw error;
    }
  }

  async getProcessingStatus(jobId: string): Promise<ProcessingStatus | null> {
    try {
      // Get all jobs from the expense queue
      const allJobs = await this.expenseQueue.getJobs([
        "waiting",
        "active",
        "completed",
        "failed",
      ]);

      // Find the main document processing job
      const documentJob = allJobs.find(
        (job) =>
          job.data.jobId === jobId && job.name === JOB_TYPES.PROCESS_DOCUMENT
      );

      if (!documentJob) {
        return null;
      }

      // Since all processing is now done in one job, we just need to check the main job
      const jobProgress = documentJob.progress();
      const isCompleted = documentJob.finishedOn !== null;
      const isActive = documentJob.processedOn !== null && !isCompleted;

      // Calculate progress based on job progress
      const progressValue = typeof jobProgress === "number" ? jobProgress : 0;
      const progress = {
        fileClassification: progressValue >= 25,
        dataExtraction: progressValue >= 50,
        issueDetection: progressValue >= 75,
        citationGeneration: progressValue >= 90,
      };

      // Collect results from the single job
      const results: any = {};
      if (documentJob.finishedOn && documentJob.returnvalue) {
        const jobResult = documentJob.returnvalue;
        if (jobResult.data) {
          // Return the complete expense processing result
          Object.assign(results, jobResult.data);
        }
      }

      const status: ProcessingStatus = {
        jobId,
        status: this.getOverallStatus(documentJob, []),
        progress,
        results: Object.keys(results).length > 0 ? results : undefined,
        error: documentJob.failedReason || undefined,
        createdAt: new Date(documentJob.timestamp),
        updatedAt: new Date(documentJob.processedOn || documentJob.timestamp),
      };

      return status;
    } catch (error) {
      this.logger.error(
        `Failed to get processing status for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  private getOverallStatus(
    mainJob: Job,
    relatedJobs: Job[]
  ): ProcessingStatus["status"] {
    if (mainJob.failedReason || relatedJobs.some((job) => job.failedReason)) {
      return "failed";
    }

    if (mainJob.finishedOn && relatedJobs.every((job) => job.finishedOn)) {
      return "completed";
    }

    if (mainJob.processedOn || relatedJobs.some((job) => job.processedOn)) {
      return "active";
    }

    return "waiting";
  }

  async getProcessingResults(jobId: string): Promise<any | null> {
    try {
      const status = await this.getProcessingStatus(jobId);

      if (!status || status.status !== "completed") {
        return null;
      }

      return status.results;
    } catch (error) {
      this.logger.error(
        `Failed to get processing results for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  async getComplianceResults(jobId: string): Promise<any | null> {
    try {
      const status = await this.getProcessingStatus(jobId);

      if (!status || status.status !== "completed") {
        return null;
      }

      const results = status.results;
      if (!results) {
        return null;
      }

      // Extract only the required fields
      const filteredResults = {
        classification: results.classification || null,
        extraction: results.extraction || null,
        compliance: {
          validation_result: {
            is_valid: results.compliance?.validation_result?.is_valid || false,
            issues_count: 0,
            issues: []
          }
        }
      };

      // Copy existing compliance issues, excluding the field column
      if (results.compliance?.validation_result?.issues) {
        filteredResults.compliance.validation_result.issues = 
          results.compliance.validation_result.issues.map((issue: any) => {
            const { field, ...issueWithoutField } = issue;
            return issueWithoutField;
          });
      }

      // Process image quality assessment data and add new issues
      if ((results as any).image_quality_assessment) {
        const imageQualityData = (results as any).image_quality_assessment;
        let currentIndex = filteredResults.compliance.validation_result.issues.length + 1;

        // Define the image quality categories to check
        const imageCategories = [
          'blur_detection',
          'contrast_assessment',
          'glare_identification',
          'water_stains',
          'tears_or_folds',
          'cut_off_detection',
          'missing_sections',
          'obstructions'
        ];

        for (const category of imageCategories) {
          if (imageQualityData[category]) {
            const categoryData = imageQualityData[category];
            const detected = categoryData.detected || false;
            const severity = (categoryData.severity_level || '').toLowerCase();

            // Only include if detected is true and severity is high or medium
            if (detected && (severity === 'high' || severity === 'medium')) {
              // Format category name for display
              const categoryDisplay = category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

              filteredResults.compliance.validation_result.issues.push({
                issue_type: `Image related | ${categoryDisplay}`,
                description: categoryData.description || '',
                recommendation: categoryData.recommendation || '',
                knowledge_base_reference: '',
            
              });
              currentIndex++;
            }
          }
        }
      }

      // Update issues count
      filteredResults.compliance.validation_result.issues_count = 
        filteredResults.compliance.validation_result.issues.length;

      return filteredResults;
    } catch (error) {
      this.logger.error(
        `Failed to get compliance results for job ${jobId}:`,
        error
      );
      throw error;
    }
  }

  /**
   * NEW: Run LLM-as-judge validation on completed job results
   */
  async validateJobResults(jobId: string): Promise<any> {
    try {
      // Get the completed job results
      const results = await this.getProcessingResults(jobId);
      
      if (!results) {
        throw new Error("Job not found or not completed");
      }

      // Check if we have the required data for validation
      if (!results.compliance || !results.extraction || !results.classification) {
        throw new Error("Job results incomplete - missing compliance, extraction, or classification data");
      }

      // Extract metadata
      const country = results.metadata?.country || "Unknown";
      const icp = results.metadata?.icp || "Unknown";
      const receiptType = results.classification?.expense_type || "All";
      const filename = results.metadata?.filename || `job_${jobId}`;

      this.logger.log(`🔍 Starting LLM-as-judge validation for job ${jobId} (${filename})`);

      // Get compliance data - we need to reconstruct this from the results
      // In a real scenario, this would be stored or retrieved from the original processing
      const complianceData = {}; // This would need to be the original compliance rules used

      // Run LLM-as-judge validation
      const validationResult = await this.expenseProcessingService.validateComplianceResults(
        results.compliance,
        country,
        receiptType,
        icp,
        complianceData,
        results.extraction,
        filename
      );

      this.logger.log(`✅ LLM-as-judge validation completed for job ${jobId} with confidence: ${validationResult?.overall_score || 0}`);

      return {
        jobId,
        validation_result: validationResult,
        metadata: {
          country,
          icp,
          receiptType,
          filename,
          validated_at: new Date().toISOString(),
          original_issues_count: results.compliance?.validation_result?.issues?.length || 0,
        }
      };

    } catch (error) {
      this.logger.error(`❌ LLM validation failed for job ${jobId}:`, error);
      throw new Error(`LLM validation failed: ${error.message}`);
    }
  }

  /**
   * NEW: Run LLM-as-judge validation on all completed jobs (batch validation)
   */
  async validateAllCompletedJobs(): Promise<any> {
    try {
      this.logger.log('🚀 Starting batch LLM-as-judge validation for all completed jobs');

      // Get all completed jobs
      const allJobs = await this.listJobs({
        status: 'completed',
        limit: 1000,
        offset: 0
      });

      if (!allJobs.jobs || allJobs.jobs.length === 0) {
        throw new Error('No completed jobs found for validation');
      }

      this.logger.log(`📊 Found ${allJobs.jobs.length} completed jobs for batch validation`);

      const batchStartTime = Date.now();
      const validationResults = [];
      let successfulValidations = 0;
      let failedValidations = 0;
      let totalConfidenceScore = 0;
      const reliabilityDistribution = { high: 0, medium: 0, low: 0 };

      // Process each completed job
      for (const job of allJobs.jobs) {
        try {
          this.logger.log(`🔍 Validating job: ${job.jobId}`);
          
          const validationStart = Date.now();
          const validationResult = await this.validateJobResults(job.jobId);
          const validationTime = (Date.now() - validationStart) / 1000;

          // Extract key metrics
          const overallScore = validationResult.validation_result?.overall_score || 0;
          const reliability = validationResult.validation_result?.overall_reliability || 'unknown';
          
          // Update statistics
          successfulValidations++;
          totalConfidenceScore += overallScore;
          
          if (reliability === 'high') reliabilityDistribution.high++;
          else if (reliability === 'medium') reliabilityDistribution.medium++;
          else if (reliability === 'low') reliabilityDistribution.low++;

          validationResults.push({
            jobId: job.jobId,
            filename: validationResult.metadata?.filename || job.jobId,
            overall_score: overallScore,
            overall_reliability: reliability,
            validation_time_seconds: parseFloat(validationTime.toFixed(1)),
            status: 'completed'
          });

          this.logger.log(`✅ Validation completed for ${job.jobId} - Score: ${overallScore}, Reliability: ${reliability}`);

        } catch (error) {
          failedValidations++;
          this.logger.error(`❌ Validation failed for job ${job.jobId}:`, error);
          
          validationResults.push({
            jobId: job.jobId,
            filename: job.jobId,
            overall_score: 0,
            overall_reliability: 'error',
            validation_time_seconds: 0,
            status: 'failed',
            error: error.message
          });
        }
      }

      const totalValidationTime = (Date.now() - batchStartTime) / 1000;
      const averageConfidenceScore = successfulValidations > 0 ? totalConfidenceScore / successfulValidations : 0;

      // Create batch validation summary
      const batchSummary = {
        validation_summary: {
          total_files_processed: allJobs.jobs.length,
          successful_validations: successfulValidations,
          failed_validations: failedValidations,
          total_validation_time_seconds: parseFloat(totalValidationTime.toFixed(1)),
          average_confidence_score: parseFloat(averageConfidenceScore.toFixed(3)),
          reliability_distribution: reliabilityDistribution,
          batch_completed_at: new Date().toISOString()
        },
        individual_results: validationResults,
        output_directory: './validation_results',
        summary_file: './validation_results/batch_validation_summary.json'
      };

      // Save batch summary to file
      await this.saveBatchValidationSummary(batchSummary);

      this.logger.log(`🎯 Batch validation completed: ${successfulValidations}/${allJobs.jobs.length} successful in ${totalValidationTime.toFixed(1)}s`);
      
      return batchSummary;

    } catch (error) {
      this.logger.error('❌ Batch validation failed:', error);
      throw new Error(`Batch validation failed: ${error.message}`);
    }
  }

  /**
   * Save batch validation summary to file
   */
  private async saveBatchValidationSummary(summary: any): Promise<void> {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Create validation_results directory if it doesn't exist
      const validationDir = path.join(process.cwd(), 'validation_results');
      if (!fs.existsSync(validationDir)) {
        fs.mkdirSync(validationDir, { recursive: true });
      }

      // Save batch summary
      const summaryPath = path.join(validationDir, 'batch_validation_summary.json');
      fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

      this.logger.log(`📄 Batch validation summary saved to: ${summaryPath}`);
    } catch (error) {
      this.logger.error('Failed to save batch validation summary:', error);
      // Don't throw error - saving is optional
    }
  }

  async listJobs(filters: {
    status?: string;
    userId?: string;
    limit: number;
    offset: number;
  }): Promise<{ jobs: ProcessingStatus[]; total: number }> {
    try {
      const { status, userId, limit, offset } = filters;

      // Get jobs from expense processing queue
      const allStates = ["waiting", "active", "completed", "failed", "delayed"];
      const states = status ? [status] : allStates;

      const jobs = await this.expenseQueue.getJobs(
        states as any,
        offset,
        offset + limit - 1
      );

      // Filter for document processing jobs only
      const documentJobs = jobs.filter(
        (job) => job.name === JOB_TYPES.PROCESS_DOCUMENT
      );

      // Filter by userId if provided
      const filteredJobs = userId
        ? documentJobs.filter((job) => job.data.userId === userId)
        : documentJobs;

      // Convert to ProcessingStatus
      const statusPromises = filteredJobs.map((job) =>
        this.getProcessingStatus(job.data.jobId)
      );
      const statuses = (await Promise.all(statusPromises)).filter(
        Boolean
      ) as ProcessingStatus[];

      // Get total count
      const totalCounts = await this.expenseQueue.getJobCounts();
      const total = Object.values(totalCounts).reduce(
        (sum: number, count: number) => sum + count,
        0
      );

      return {
        jobs: statuses,
        total,
      };
    } catch (error) {
      this.logger.error("Failed to list jobs:", error);
      throw error;
    }
  }

  async cancelJob(jobId: string): Promise<boolean> {
    try {
      // Get all jobs related to this jobId
      const allJobs = await this.expenseQueue.getJobs(["waiting", "active"]);
      const relatedJobs = allJobs.filter((job) => job.data.jobId === jobId);

      if (relatedJobs.length === 0) {
        return false;
      }

      // Cancel all related jobs
      for (const job of relatedJobs) {
        await job.remove();
      }

      this.logger.log(
        `Job ${jobId} and ${relatedJobs.length} related jobs cancelled successfully`
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to cancel job ${jobId}:`, error);
      throw error;
    }
  }

  async getProcessingMetrics(): Promise<ProcessingMetrics> {
    try {
      const counts = await this.expenseQueue.getJobCounts();

      const queueHealth: ProcessingMetrics["queueHealth"] = {
        [QUEUE_NAMES.EXPENSE_PROCESSING]: {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
        },
      };

      const totalJobs = Object.values(counts).reduce(
        (sum: number, count: number) => sum + count,
        0
      );
      const completedJobs = counts.completed || 0;
      const failedJobs = counts.failed || 0;

      // Calculate average processing time (simplified)
      const recentCompletedJobs = await this.expenseQueue.getJobs(
        ["completed"],
        0,
        99
      );
      const processingTimes = recentCompletedJobs
        .filter((job) => job.finishedOn && job.processedOn)
        .map((job) => job.finishedOn! - job.processedOn!);

      const averageProcessingTime =
        processingTimes.length > 0
          ? processingTimes.reduce((sum, time) => sum + time, 0) /
            processingTimes.length
          : 0;

      return {
        totalJobs,
        completedJobs,
        failedJobs,
        averageProcessingTime,
        queueHealth,
      };
    } catch (error) {
      this.logger.error("Failed to get processing metrics:", error);
      throw error;
    }
  }

  async getHealthStatus(): Promise<any> {
    try {
      const metrics = await this.getProcessingMetrics();

      return {
        service: "Document Processing Service",
        status: "healthy",
        timestamp: new Date().toISOString(),
        metrics,
        queues: {
          [QUEUE_NAMES.EXPENSE_PROCESSING]:
            await this.expenseQueue.getJobCounts(),
        },
      };
    } catch (error) {
      this.logger.error("Health check failed:", error);
      return {
        service: "Document Processing Service",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}
