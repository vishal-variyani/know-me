import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people/people.service.js';
import type { MemoryContext } from './retrieval.types.js';

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly peopleService: PeopleService,
  ) {}

  async retrieve(text: string, userId: string): Promise<MemoryContext> {
    const [vector, people] = await Promise.all([
      this.embeddingService.embed(text),
      // Arm 2: named-entity — detectNames is synchronous; lookupByNames is async
      this.peopleService.lookupByNames(
        this.peopleService.detectNames(text),
        userId,
      ),
    ]);
    const [memories, chunks] = await Promise.all([
      this.memoryService.searchSimilar(userId, vector, 5),
      this.memoryService.searchRelevantEmbeddings(userId, vector, 5),
    ]);
    this.logger.debug(
      `retrieve userId=${userId} memories=${memories.length} chunks=${chunks.length} people=${people.length}`,
    );
    return { memories, chunks, people };
  }
}
