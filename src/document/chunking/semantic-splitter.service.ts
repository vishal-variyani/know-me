import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from '../../embedding/embedding.service.js';
import { SentenceTokenizerService } from './sentence-tokenizer.service.js';
import type { Sentence } from '../interfaces/sentence.interface.js';

@Injectable()
export class SemanticSplitterService {
  private readonly similarityThreshold: number;
  private readonly minChunkTokens: number;
  private readonly hardCeilingTokens: number;

  constructor(
    config: ConfigService,
    private readonly embeddingService: EmbeddingService,
    private readonly tokenizer: SentenceTokenizerService,
  ) {
    this.similarityThreshold = Number(config.get('EASC_SIMILARITY_THRESHOLD') ?? 0.72);
    this.minChunkTokens = Number(config.get('EASC_MIN_CHUNK_TOKENS') ?? 80);
    this.hardCeilingTokens = Number(config.get('EASC_HARD_CEILING_TOKENS') ?? 400);
  }

  async splitSegment(segmentText: string): Promise<string[]> {
    const sentences = this.tokenizer.splitIntoSentences(segmentText);
    if (sentences.length <= 3) return [segmentText.trim()];
    const embeddings = await this.embeddingService.embedBatch(sentences.map((s) => s.text));
    const splitAt: number[] = [];
    for (let i = 0; i < embeddings.length - 1; i++) {
      if (this.cosine(embeddings[i], embeddings[i + 1]) < this.similarityThreshold) {
        splitAt.push(i + 1);
      }
    }

    const chunks = this.makeCandidates(sentences, splitAt);
    const merged: Sentence[][] = [];
    for (const chunk of chunks) {
      const tokens = chunk.reduce((s, c) => s + c.tokenCount, 0);
      if (tokens < this.minChunkTokens && merged.length > 0) {
        merged[merged.length - 1].push(...chunk);
      } else if (tokens > this.hardCeilingTokens && chunk.length > 1) {
        const mid = Math.floor(chunk.length / 2);
        merged.push(chunk.slice(0, mid), chunk.slice(mid));
      } else {
        merged.push(chunk);
      }
    }
    return merged.map((chunk) => chunk.map((s) => s.text).join(' '));
  }

  private makeCandidates(sentences: Sentence[], splitAt: number[]): Sentence[][] {
    const out: Sentence[][] = [];
    let cursor = 0;
    for (const idx of splitAt) {
      out.push(sentences.slice(cursor, idx));
      cursor = idx;
    }
    out.push(sentences.slice(cursor));
    return out.filter((chunk) => chunk.length > 0);
  }

  private cosine(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }
}
