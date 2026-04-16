import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service.js';

@Module({
  providers: [ExtractionService],
  exports: [ExtractionService],
})
export class ExtractionModule {}
