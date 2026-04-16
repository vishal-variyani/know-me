import { Injectable, Logger } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people.service.js';
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
    const [memories, people] = await Promise.all([
      // Arm 1: semantic — embed text → cosine top-5
      this.embeddingService
        .embed(text)
        .then((vec) => this.memoryService.searchSimilar(userId, vec, 5)),
      // Arm 2: named-entity — detectNames is synchronous; lookupByNames is async
      this.peopleService.lookupByNames(
        this.peopleService.detectNames(text),
        userId,
      ),
    ]);
    this.logger.debug(
      `retrieve userId=${userId} memories=${memories.length} people=${people.length}`,
    );
    return { memories, people };
  }
}
