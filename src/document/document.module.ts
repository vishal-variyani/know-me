import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module.js';
import { ExtractionModule } from '../extraction/extraction.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ChunkEnricherService } from './chunking/chunk-enricher.service.js';
import { EascChunkingService } from './chunking/easc-chunking.service.js';
import { EntityOverlapService } from './chunking/entity-overlap.service.js';
import { NameDetectorService } from './chunking/name-detector.service.js';
import { SemanticSplitterService } from './chunking/semantic-splitter.service.js';
import { SentenceTokenizerService } from './chunking/sentence-tokenizer.service.js';
import { StructuralSplitterService } from './chunking/structural-splitter.service.js';
import { DocumentService } from './document.service.js';

@Module({
  imports: [EmbeddingModule, ExtractionModule, MemoryModule],
  providers: [
    DocumentService,
    EascChunkingService,
    StructuralSplitterService,
    SemanticSplitterService,
    ChunkEnricherService,
    EntityOverlapService,
    NameDetectorService,
    SentenceTokenizerService,
  ],
  exports: [DocumentService],
})
export class DocumentModule {}
