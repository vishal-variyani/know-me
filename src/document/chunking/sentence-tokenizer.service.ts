import { Injectable } from '@nestjs/common';
import nlp from 'compromise';
import type { Sentence } from '../interfaces/sentence.interface.js';

@Injectable()
export class SentenceTokenizerService {
  splitIntoSentences(text: string): Sentence[] {
    const trimmed = text.trim();
    if (!trimmed) return [];
    const raw = nlp(trimmed).sentences().out('array') as string[];
    const out: Sentence[] = [];
    let searchOffset = 0;
    for (const part of raw) {
      const sentenceText = part.trim();
      if (!sentenceText) continue;
      const offset = trimmed.indexOf(sentenceText, searchOffset);
      const start = offset >= 0 ? offset : searchOffset;
      out.push({
        text: sentenceText,
        startOffset: start,
        endOffset: start + sentenceText.length,
        tokenCount: this.estimateTokens(sentenceText),
      });
      searchOffset = start + sentenceText.length;
    }
    return out;
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
