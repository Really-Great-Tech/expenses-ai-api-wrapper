import { Module } from "@nestjs/common";
import { ExpenseProcessingService } from "../../services/expense-processing.service";
import { ExpenseProcessingOptimizedService } from "../../services/expense-processing-optimized.service";
import { DocumentModule } from "../document/document.module";
import { LangfuseModule } from "../langfuse/langfuse.module";

@Module({
  imports: [
    // Import Document services (which now contains ProcessingService)
    DocumentModule,
    
    // Import Langfuse for tracing
    LangfuseModule,
  ],
  providers: [ExpenseProcessingService],
  exports: [ExpenseProcessingService, DocumentModule],
})
export class ProcessingModule {}
