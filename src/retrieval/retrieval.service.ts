import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people/people.service.js';
import type { MemoryContext } from './retrieval.types.js';

const RETRIEVAL_TOP_K = 5;

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly peopleService: PeopleService,
  ) {}

  async retrieve(text: string, userId: string): Promise<MemoryContext> {
    const detectedNames = this.peopleService.detectNames(text);
    const [vector, people] = await Promise.all([
      this.embeddingService.embed(text),
      this.peopleService.lookupByNames(detectedNames, userId),
    ]);
    const [memories, chunks] = await Promise.all([
      this.memoryService.searchSimilar(userId, vector, RETRIEVAL_TOP_K),
      this.memoryService.searchRelevantEmbeddings(userId, vector, RETRIEVAL_TOP_K),
    ]);
    this.logger.debug(
      `retrieve userId=${userId} memories=${memories.length} chunks=${chunks.length} people=${people.length}`,
    );
    return { memories, chunks, people };
  }
}
