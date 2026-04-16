import { Injectable } from '@nestjs/common';
import { NameDetectorService } from './name-detector.service.js';
import { SentenceTokenizerService } from './sentence-tokenizer.service.js';
import type { EnrichedChunk } from '../interfaces/enriched-chunk.interface.js';

@Injectable()
export class EntityOverlapService {
  constructor(
    private readonly names: NameDetectorService,
    private readonly tokenizer: SentenceTokenizerService,
  ) {}

  applyOverlap(chunks: EnrichedChunk[], knownEntities: string[]): EnrichedChunk[] {
    const result = chunks.map((c) => ({ ...c, metadata: { ...c.metadata } }));
    for (let i = 0; i < result.length - 1; i++) {
      const lastSentence = this.getLastSentence(result[i].rawContent);
      const firstSentence = this.getFirstSentence(result[i + 1].rawContent);
      if (!lastSentence || !firstSentence) continue;

      const left = this.names.detectNames(lastSentence, knownEntities);
      const right = this.names.detectNames(firstSentence, knownEntities);
      const overlap = left.some((name) => right.includes(name));
      if (!overlap) continue;

      const nextRaw = `${lastSentence} ${result[i + 1].rawContent}`.trim();
      result[i + 1] = {
        ...result[i + 1],
        rawContent: nextRaw,
        metadata: {
          ...result[i + 1].metadata,
          overlapFrom: result[i].id,
          tokenCount: this.tokenizer.estimateTokens(nextRaw),
        },
      };
    }
    return result;
  }

  private getLastSentence(text: string): string | null {
    const sentences = this.tokenizer.splitIntoSentences(text);
    return sentences.length > 0 ? sentences[sentences.length - 1].text : null;
  }

  private getFirstSentence(text: string): string | null {
    const sentences = this.tokenizer.splitIntoSentences(text);
    return sentences.length > 0 ? sentences[0].text : null;
  }
}
