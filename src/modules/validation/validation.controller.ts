import {
  Controller,
  Post,
  Param,
  HttpStatus,
  HttpException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from "@nestjs/swagger";
import { ValidationService } from "./validation.service";
import {
  ErrorResponseDto,
} from "../document/dto";

@ApiTags("LLM-as-Judge Validation")
@Controller("validation")
export class ValidationController {
  constructor(private readonly validationService: ValidationService) {}

  @Post("validate/:jobId")
  @ApiOperation({
    summary: "Run LLM-as-judge validation on a completed job",
    description: "Execute LLM-as-judge validation on the compliance results of a completed expense processing job. This uses multiple LLM judges to validate the AI's compliance analysis across 6 dimensions: factual grounding, knowledge base adherence, compliance accuracy, issue categorization, recommendation validity, and hallucination detection."
  })
  @ApiParam({
    name: "jobId",
    description: "Job ID of completed expense processing job to validate",
    example: "job_123456789"
  })
  @ApiResponse({
    status: 200,
    description: "LLM validation completed successfully",
    schema: {
      example: {
        success: true,
        message: "LLM-as-judge validation completed successfully",
        data: {
          jobId: "user123",
          validation_result: {
            overall_score: 0.85,
            overall_reliability: "high",
            dimensional_results: {
              factual_grounding: {
                confidence_score: 0.9,
                reliability_level: "high",
                issues: [],
                summary: "All facts properly grounded in source data"
              },
              knowledge_base_adherence: {
                confidence_score: 0.8,
                reliability_level: "high", 
                issues: ["Minor citation formatting inconsistency"],
                summary: "Good adherence to knowledge base with minor issues"
              }
            }
          },
          metadata: {
            country: "Germany",
            icp: "Global People",
            receiptType: "invoice",
            filename: "expense_receipt.pdf",
            validated_at: "2025-01-15T10:30:00Z"
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: "Job not found or not completed",
    type: ErrorResponseDto
  })
  @ApiResponse({
    status: 400,
    description: "LLM validation not available or job results incomplete",
    type: ErrorResponseDto
  })
  @ApiResponse({
    status: 500,
    description: "LLM validation failed",
    type: ErrorResponseDto
  })
  async validateJobResults(@Param("jobId") jobId: string) {
    try {
      // Run LLM-as-judge validation using the validation service
      const validationResult = await this.validationService.validateJobResults(jobId);
      
      return {
        success: true,
        message: "LLM-as-judge validation completed successfully",
        data: validationResult
      };

    } catch (error) {
      if (error.message.includes("Job not found")) {
        throw new HttpException(
          "Job not found or not completed",
          HttpStatus.NOT_FOUND
        );
      }
      if (error.message.includes("incomplete") || error.message.includes("missing")) {
        throw new HttpException(
          error.message,
          HttpStatus.BAD_REQUEST
        );
      }
      throw new HttpException(
        `LLM validation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post("validate-batch")
  @ApiOperation({
    summary: "Run LLM-as-judge validation on all completed jobs",
    description: "Execute batch LLM-as-judge validation on all completed expense processing jobs in the system. This processes all files that have completed the main processing pipeline and generates comprehensive validation reports with statistics."
  })
  @ApiResponse({
    status: 200,
    description: "Batch validation completed successfully",
    schema: {
      example: {
        success: true,
        message: "Batch LLM-as-judge validation completed successfully",
        data: {
          validation_summary: {
            total_files_processed: 14,
            successful_validations: 12,
            failed_validations: 2,
            total_validation_time_seconds: 180.5,
            average_confidence_score: 0.82,
            reliability_distribution: {
              high: 8,
              medium: 3,
              low: 1
            }
          },
          individual_results: [
            {
              filename: "expense_receipt_1.pdf",
              overall_score: 0.85,
              overall_reliability: "high",
              validation_time_seconds: 12.3,
              status: "completed"
            },
            {
              filename: "expense_receipt_2.pdf", 
              overall_score: 0.72,
              overall_reliability: "medium",
              validation_time_seconds: 15.1,
              status: "completed"
            }
          ],
          output_directory: "./validation_results",
          summary_file: "./validation_results/batch_validation_summary.json"
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: "No completed jobs found for validation",
    type: ErrorResponseDto
  })
  @ApiResponse({
    status: 500,
    description: "Batch validation failed",
    type: ErrorResponseDto
  })
  async validateAllJobs() {
    try {
      // Run batch validation using the validation service
      const batchResult = await this.validationService.validateAllCompletedJobs();
      
      return {
        success: true,
        message: "Batch LLM-as-judge validation completed successfully",
        data: batchResult
      };

    } catch (error) {
      if (error.message.includes("No completed jobs found")) {
        throw new HttpException(
          "No completed jobs found for validation",
          HttpStatus.BAD_REQUEST
        );
      }
      throw new HttpException(
        `Batch validation failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}