import { Module } from '@nestjs/common';
import { InvoiceSplitterController } from './invoice-splitter.controller';
import { InvoiceSplitterService } from './invoice-splitter.service';
import { InvoiceSplitterAgent } from './agents/invoice-splitter.agent';

@Module({
  controllers: [InvoiceSplitterController],
  providers: [InvoiceSplitterService, InvoiceSplitterAgent],
  exports: [InvoiceSplitterService],
})
export class InvoiceSplitterModule {}
