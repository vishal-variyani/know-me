import { Injectable, Logger } from '@nestjs/common';
import { StructuralSplitterService } from './structural-splitter.service.js';
import { SemanticSplitterService } from './semantic-splitter.service.js';
import {
  ChunkEnricherService,
  type EnrichmentContext,
} from './chunk-enricher.service.js';
import { EntityOverlapService } from './entity-overlap.service.js';
import type { EnrichedChunk } from '../interfaces/enriched-chunk.interface.js';
import { DocumentFormat } from '../interfaces/document-format.enum.js';
import { MemoryService } from '../../memory/memory.service.js';

export interface ChunkRequest {
  text: string;
  userId: string;
  filename: string | null;
  format?: DocumentFormat;
}

@Injectable()
export class EascChunkingService {
  private readonly logger = new Logger(EascChunkingService.name);

  constructor(
    private readonly structural: StructuralSplitterService,
    private readonly semantic: SemanticSplitterService,
    private readonly enricher: ChunkEnricherService,
    private readonly overlap: EntityOverlapService,
    private readonly memoryService: MemoryService,
  ) {}

  async chunk(request: ChunkRequest): Promise<EnrichedChunk[]> {
    const knownEntities = await this.memoryService.listKnownPeopleNames(request.userId);
    const format =
      request.format ??
      this.structural.detectFormat(request.text, request.filename ?? undefined);
    const rawSegments = this.structural.split(request.text, format);
    const chunks: EnrichedChunk[] = [];

    for (const segment of rawSegments) {
      const semanticallySplit = await this.semantic.splitSegment(segment.text);
      const context: EnrichmentContext = {
        userId: request.userId,
        sourceFile: request.filename,
        sourceFormat: format,
        dateHint: segment.dateHint,
        entryIndex: segment.entryIndex,
        knownEntities,
      };
      chunks.push(...semanticallySplit.map((piece) => this.enricher.enrich(piece, context)));
    }

    const withOverlap = this.overlap.applyOverlap(chunks, knownEntities);
    this.logger.debug(
      `EASC chunking produced chunks=${withOverlap.length} format=${format}`,
    );
    return withOverlap;
  }
}
