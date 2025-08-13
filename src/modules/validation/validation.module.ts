import { Module } from '@nestjs/common';
import { ValidationController } from './validation.controller';
import { ValidationService } from './validation.service';
import { DocumentModule } from '../document/document.module';

@Module({
  imports: [
    // Import DocumentModule to access DocumentService
    DocumentModule,
  ],
  controllers: [ValidationController],
  providers: [ValidationService],
  exports: [ValidationService],
})
export class ValidationModule {}