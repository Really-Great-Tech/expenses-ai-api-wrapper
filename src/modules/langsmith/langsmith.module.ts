import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LangSmithService } from '../../services/langsmith.service';
import { LangSmithController } from './langsmith.controller';

@Module({
  imports: [ConfigModule],
  controllers: [LangSmithController],
  providers: [LangSmithService],
  exports: [LangSmithService],
})
export class LangSmithModule {}
