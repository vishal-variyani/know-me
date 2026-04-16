import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ExtractionService } from './extraction.service.js';
import type { ExtractionJobPayload } from './extraction.types.js';

@Processor('extraction', { concurrency: 3 })
export class ExtractionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExtractionProcessor.name);

  constructor(private readonly extractionService: ExtractionService) {
    super();
  }

  async process(job: Job<ExtractionJobPayload>): Promise<void> {
    const correlationId = job.id ?? 'unknown';
    this.logger.debug(
      `[${correlationId}] Processing job attempt=${job.attemptsMade} sourceType=${job.data.sourceType}`,
    );
    await this.extractionService.runGraph(job.data, correlationId);
    this.logger.debug(`[${correlationId}] Job complete`);
  }
}
