import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private primaryLlm!: ChatOpenAI;
  private fallbackLlm!: ChatOpenAI;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const primaryApiKey = this.config.getOrThrow<string>('OPENAI_API_KEY');
    const primaryModel = this.config.getOrThrow<string>('OPENAI_CHAT_MODEL');
    const fallbackApiKey = this.config.getOrThrow<string>(
      'OPENAI_FALLBACK_API_KEY',
    );
    const fallbackModel = this.config.getOrThrow<string>(
      'OPENAI_FALLBACK_CHAT_MODEL',
    );

    this.primaryLlm = new ChatOpenAI({
      apiKey: primaryApiKey,
      model: primaryModel,
      temperature: 0,
      streaming: true,
    });
    this.fallbackLlm = new ChatOpenAI({
      apiKey: fallbackApiKey,
      model: fallbackModel,
      temperature: 0,
      streaming: true,
    });
    this.logger.log(
      `LlmService initialized with primary=${primaryModel} fallback=${fallbackModel}`,
    );
  }

  async *streamResponse(
    messages: BaseMessage[],
    signal: AbortSignal,
  ): AsyncIterable<string> {
    if (!this.primaryLlm || !this.fallbackLlm) {
      throw new Error(
        '[LlmService] LLM clients not initialized — was onModuleInit called?',
      );
    }

    let didYieldFromPrimary = false;

    try {
      const stream = await this.primaryLlm.stream(messages, { signal });
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
        if (!text) continue;
        didYieldFromPrimary = true;
        yield text;
      }
      return;
    } catch (primaryError) {
      if (didYieldFromPrimary) {
        throw primaryError;
      }

      this.logger.warn(
        'Primary chat model failed before any output; retrying with fallback model',
      );
    }

    const fallbackStream = await this.fallbackLlm.stream(messages, { signal });
    for await (const chunk of fallbackStream) {
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
