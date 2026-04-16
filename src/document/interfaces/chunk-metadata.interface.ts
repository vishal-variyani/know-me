import { DocumentFormat } from './document-format.enum.js';

export interface ChunkMetadata {
  date: string | null;
  sourceFile: string | null;
  sourceFormat: DocumentFormat;
  people: string[];
  entryIndex: number;
  tokenCount: number;
  overlapFrom: string | null;
  enrichedEmbeddingText: string;
  userId: string;
}
