import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MulterModule } from '@nestjs/platform-express';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { ExpenseProcessingService } from '../../services/expense-processing.service';
import { EnhancedDocumentProcessingService } from '../../services/enhanced-document-processing.service';
import { UserSessionService } from '../../services/user-session.service';
import { ExpenseProcessor } from '../processing/processors/expense.processor';
import { ProcessingService } from '../processing/services/processing.service';
import { LangfuseModule } from '../langfuse/langfuse.module';
import { InvoiceSplitterModule } from '../invoice-splitter/invoice-splitter.module';

import { QUEUE_NAMES } from '../../types';
import * as multer from 'multer';
import * as path from 'path';

@Module({
  imports: [
    // Import Langfuse for tracing
    LangfuseModule,

    // Import Invoice Splitter for enhanced processing
    InvoiceSplitterModule,

    // Register the queue with proper configuration and processor
    BullModule.registerQueue({
      name: QUEUE_NAMES.EXPENSE_PROCESSING,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 5,
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 2000,
        },
        // 10 minute timeout for all processing jobs
        timeout: 10 * 60 * 1000, // 600,000ms = 10 minutes
      },
    }),

    // Configure file upload
    MulterModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        storage: multer.diskStorage({
          destination: (req, file, cb) => {
            const uploadPath = configService.get('UPLOAD_PATH', './uploads');
            cb(null, uploadPath);
          },
          filename: (req, file, cb) => {
            // Generate unique filename
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
          },
        }),
        fileFilter: (req, file, cb) => {
          // Accept PDF files and common image formats
          const allowedMimes = [
            'application/pdf',
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/bmp',
            'image/tiff',
            'image/webp'
          ];
          
          if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
          } else {
            cb(new Error('Only PDF and image files are allowed'), false);
          }
        },
        limits: {
          fileSize: 50 * 1024 * 1024, // 50MB limit
        },
      }),
      inject: [ConfigService],
    }),

    // Rate limiting
    ThrottlerModule.forRoot([{
      ttl: 60000, // 1 minute
      limit: 10, // 10 requests per minute per IP
    }]),
  ],
  controllers: [DocumentController],
  providers: [
    DocumentService,
    ExpenseProcessingService,
    EnhancedDocumentProcessingService,
    UserSessionService,
    ExpenseProcessor,
    ProcessingService
  ],
  exports: [
    DocumentService,
    EnhancedDocumentProcessingService,
    UserSessionService,
    ProcessingService
  ],
})
export class DocumentModule {}
