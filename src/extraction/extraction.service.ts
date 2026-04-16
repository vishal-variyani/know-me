import { Injectable, Logger } from '@nestjs/common';
import type { ExtractionJobPayload } from './extraction.types.js';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async enqueue(
    text: string,
    userId: string,
    sourceType: 'conversation' | 'document',
  ): Promise<void> {
    // Stub: Phase 4 replaces this with a real BullMQ queue push
    this.logger.debug(
      `[ExtractionService stub] enqueue userId=${userId} sourceType=${sourceType} textLen=${text.length}`,
    );
  }

  // Signature only — plan 04-04 implements the body
  async runGraph(
    _payload: ExtractionJobPayload,
    _correlationId: string,
  ): Promise<void> {
    throw new Error('ExtractionService.runGraph not yet implemented');
  }
}
