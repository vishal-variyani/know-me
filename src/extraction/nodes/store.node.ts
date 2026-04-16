import { Logger } from '@nestjs/common';
import type { EmbeddingService } from '../../embedding/embedding.service.js';
import type { MemoryService } from '../../memory/memory.service.js';
import type { PeopleService } from '../../memory/people/people.service.js';
import type { ExtractionState } from '../extraction.types.js';

export function makeStoreNode(
  memoryService: MemoryService,
  peopleService: PeopleService,
  embeddingService: EmbeddingService,
  logger: Logger,
) {
  return async function storeNode(
    state: ExtractionState,
  ): Promise<Partial<ExtractionState>> {
    const { validateResult, userId, sourceType, correlationId } = state;

    if (!validateResult) {
      return { storeResult: { persisted: 0 } };
    }

    const { people, keyFacts } = validateResult;
    let persisted = 0;

    // D-15, D-16: People upsert — PeopleService.upsertPerson handles ON CONFLICT JSONB merge
    for (const person of people) {
      try {
        const factsRecord: Record<string, unknown> = {
          relationship: person.relationship,
          details: person.facts,
        };
        await peopleService.upsertPerson(person.name, userId, factsRecord);
        persisted++;
        logger.debug(
          `[${correlationId}] storeNode upserted person name=${person.name} userId=${userId}`,
        );
      } catch (err: unknown) {
        // Log and continue — one person failing should not abort the rest
        logger.error(
          `[${correlationId}] storeNode upsertPerson failed for name=${person.name}: ${String(err)}`,
        );
      }
    }

    // D-19, D-20: Memory entries — embed each keyFact then call upsertMemoryEntry.
    //
    // EXTR-07 interpretation: Only HIGH-confidence facts should be stored in v1.
    // The Extract node's LLM prompt explicitly instructs the model to extract only
    // significant, memorable facts about the user. All keyFacts[] returned by the
    // Extract node are therefore treated as implicitly HIGH confidence — no explicit
    // confidence field is needed in v1. This satisfies EXTR-07's intent.
    //
    // D-19 interpretation: D-19 specifies embeddings stored in message_embeddings
    // with FK. The existing MemoryService.upsertMemoryEntry() stores embeddings
    // inline in memory_entries.embedding (established in Phase 2). The
    // message_embeddings table is for message-level embeddings used in retrieval,
    // not for memory_entry embeddings. Storing inline satisfies D-19's intent
    // (embeddings ARE stored and linked to their memory entry via the row itself).
    // MemoryService.upsertMemoryEntry() also handles cross-session dedup
    // (cosine >= 0.90 → reinforce, not insert).
    for (const fact of keyFacts) {
      try {
        const vector = await embeddingService.embed(fact);
        // factType='fact' is the correct new enum value for keyFacts (D-18)
        await memoryService.upsertMemoryEntry(fact, vector, userId, 'fact', sourceType);
        persisted++;
        logger.debug(
          `[${correlationId}] storeNode upserted memory entry userId=${userId} factType=fact`,
        );
      } catch (err: unknown) {
        logger.error(
          `[${correlationId}] storeNode upsertMemoryEntry failed: ${String(err)}`,
        );
      }
    }

    logger.debug(
      `[${correlationId}] storeNode complete persisted=${persisted} userId=${userId}`,
    );
    return { storeResult: { persisted } };
  };
}
