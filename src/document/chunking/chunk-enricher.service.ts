import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NameDetectorService } from './name-detector.service.js';
import { SentenceTokenizerService } from './sentence-tokenizer.service.js';
import type { EnrichedChunk } from '../interfaces/enriched-chunk.interface.js';
import { DocumentFormat } from '../interfaces/document-format.enum.js';

export interface EnrichmentContext {
  userId: string;
  sourceFile: string | null;
  sourceFormat: DocumentFormat;
  dateHint: string | null;
  entryIndex: number;
  knownEntities: string[];
}

@Injectable()
export class ChunkEnricherService {
  constructor(
    private readonly names: NameDetectorService,
    private readonly tokenizer: SentenceTokenizerService,
  ) {}

  enrich(rawContent: string, context: EnrichmentContext): EnrichedChunk {
    const people = this.names.detectNames(rawContent, context.knownEntities);
    const headers: string[] = [];
    if (context.dateHint) headers.push(`Date: ${context.dateHint}`);
    if (context.sourceFile) headers.push(`Source: ${context.sourceFile}`);
    if (people.length > 0) headers.push(`People mentioned: ${people.join(', ')}`);
    const enrichedText =
      headers.length > 0 ? `[${headers.join(' | ')}]\n${rawContent}` : rawContent;

    return {
      id: randomUUID(),
      rawContent,
      enrichedText,
      metadata: {
        date: context.dateHint,
        sourceFile: context.sourceFile,
        sourceFormat: context.sourceFormat,
        people,
        entryIndex: context.entryIndex,
        tokenCount: this.tokenizer.estimateTokens(rawContent),
        overlapFrom: null,
        enrichedEmbeddingText: enrichedText,
        userId: context.userId,
      },
    };
  }
}
