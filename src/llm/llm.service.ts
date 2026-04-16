import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private llm!: ChatOpenAI;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const model = this.config.getOrThrow<string>('OPENAI_CHAT_MODEL');
    this.llm = new ChatOpenAI({ model, temperature: 0, streaming: true });
    this.logger.log(`LlmService initialized with model=${model}`);
  }

  async *streamResponse(
    messages: BaseMessage[],
    signal: AbortSignal,
  ): AsyncIterable<string> {
    if (!this.llm) {
      throw new Error('[LlmService] llm not initialized — was onModuleInit called?');
    }
    const stream = await this.llm.stream(messages, { signal });
    for await (const chunk of stream) {
      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : chunk.content
              .filter(
                (c): c is { type: 'text'; text: string } => c.type === 'text',
              )
              .map((c) => c.text)
              .join('');
      if (text) yield text;
    }
  }
}
