import type {
  MemorySearchResult,
  MessageEmbeddingHit,
  PersonRow,
} from '../memory/memory.types.js';

export interface MemoryContext {
  memories: MemorySearchResult[];
  chunks: MessageEmbeddingHit[];
  people: PersonRow[];
}
