import { Module } from "@nestjs/common";
import { ExpenseProcessingService } from "../../services/expense-processing.service";
import { ExpenseProcessingOptimizedService } from "../../services/expense-processing-optimized.service";
import { RateLimitMonitorService } from "../../services/rate-limit-monitor.service";
import { DocumentModule } from "../document/document.module";
import { LangfuseModule } from "../langfuse/langfuse.module";
import { UserManagementModule } from "../user-management/user-management.module";

@Module({
  imports: [
    // Import Document services (which now contains ProcessingService)
    DocumentModule,
    
    // Import Langfuse for tracing
    LangfuseModule,
    
    // Import User Management for UserSessionService
    UserManagementModule,
  ],
  providers: [ExpenseProcessingService, RateLimitMonitorService],
  exports: [ExpenseProcessingService, RateLimitMonitorService, DocumentModule],
})
export class ProcessingModule {}
