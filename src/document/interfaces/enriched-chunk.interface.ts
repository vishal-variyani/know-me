import type { ChunkMetadata } from './chunk-metadata.interface.js';

export interface EnrichedChunk {
  id: string;
  rawContent: string;
  enrichedText: string;
  metadata: ChunkMetadata;
}
