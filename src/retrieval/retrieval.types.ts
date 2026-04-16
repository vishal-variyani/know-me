import type { MemorySearchResult, PersonRow } from '../memory/memory.types.js';

export interface MemoryContext {
  memories: MemorySearchResult[];
  people: PersonRow[];
}
