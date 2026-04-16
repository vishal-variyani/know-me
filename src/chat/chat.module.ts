import { Module } from '@nestjs/common';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { LlmModule } from '../llm/llm.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { RetrievalModule } from '../retrieval/retrieval.module.js';

@Module({
  imports: [RetrievalModule, LlmModule, ExtractionModule, MemoryModule],
})
export class ChatModule {}
