import { Injectable, Logger } from '@nestjs/common';

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
}
