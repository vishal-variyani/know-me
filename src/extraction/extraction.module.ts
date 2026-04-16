import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ExtractionService } from './extraction.service.js';
import { ExtractionProcessor } from './extraction.processor.js';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'extraction' }),
    EmbeddingModule,
    MemoryModule,
  ],
  providers: [ExtractionService, ExtractionProcessor],
  exports: [ExtractionService],
})
export class ExtractionModule {}
