import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { RetrievalService } from './retrieval.service.js';

@Module({
  imports: [EmbeddingModule, MemoryModule],
  providers: [RetrievalService],
  exports: [RetrievalService],
})
export class RetrievalModule {}
