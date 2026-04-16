import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { EascChunkingService } from './chunking/easc-chunking.service.js';

export interface ProcessDocumentParams {
  text: string;
  userId: string;
  filename: string | null;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    private readonly chunker: EascChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly extractionService: ExtractionService,
    private readonly memoryService: MemoryService,
  ) {}

  async processUpload(params: ProcessDocumentParams): Promise<{ status: 'accepted' }> {
    const chunks = await this.chunker.chunk({
      text: params.text,
      userId: params.userId,
      filename: params.filename,
    });
    if (chunks.length === 0) return { status: 'accepted' };

    const vectors = await this.embeddingService.embedBatch(
      chunks.map((c) => c.enrichedText),
    );

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await this.memoryService.storeDocumentChunk({
        userId: params.userId,
        content: chunk.rawContent,
        embedding: vectors[i] ?? [],
        metadata: chunk.metadata as unknown as Record<string, unknown>,
        enrichedEmbeddingText: chunk.enrichedText,
      });
      await this.extractionService.enqueue(chunk.rawContent, params.userId, 'document');
    }

    this.logger.log(
      `Document upload processed userId=${params.userId} chunks=${chunks.length}`,
    );
    return { status: 'accepted' };
  }
}
