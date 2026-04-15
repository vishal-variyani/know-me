import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

const EXPECTED_DIMS = 1536;

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private embeddings!: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const model = this.config.getOrThrow<string>('OPENAI_EMBEDDING_MODEL');
    const dims = parseInt(this.config.getOrThrow<string>('EMBEDDING_DIMS'), 10);

    if (dims !== EXPECTED_DIMS) {
      throw new Error(
        `[EmbeddingService] EMBEDDING_DIMS mismatch: expected ${EXPECTED_DIMS}, got ${dims}`,
      );
    }

    this.embeddings = new OpenAIEmbeddings({
      model,
      dimensions: EXPECTED_DIMS,
    });

    this.logger.log(`EmbeddingService initialized with model=${model} dims=${EXPECTED_DIMS}`);
  }

  async embed(text: string): Promise<number[]> {
    if (!this.embeddings) {
      throw new Error('[EmbeddingService] embeddings not initialized — was onModuleInit called?');
    }
    return this.embeddings.embedQuery(text);
  }
}
