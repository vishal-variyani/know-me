import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import type { BaseMessage } from '@langchain/core/messages';

/**
 * Reason a primary-tier failure triggered (or would trigger) the fallback model.
 * Exported for testability; also used in structured logs.
 */
export type FallbackReason = 'timeout' | 'rate_limit' | 'api_error';

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
        const text = extractText(chunk);
        if (!text) continue;
        didYieldFromPrimary = true;
        yield text;
      }
      return;
    } catch (primaryError) {
      // Never fall back mid-stream — tokens already went to the client.
      if (didYieldFromPrimary) {
        throw primaryError;
      }
      // Never fall back on user-initiated cancellation.
      if (isUserAbort(primaryError, signal)) {
        throw primaryError;
      }

      const reason = classifyFallbackReason(primaryError);
      if (reason === null) {
        // Non-fallbackable error (e.g. 401/403/400/programmer error).
        this.logger.error(
          `Primary chat model failed with non-fallbackable error: ${describeError(primaryError)}`,
        );
        throw primaryError;
      }

      this.logger.warn(
        `Primary chat model failed (reason=${reason}: ${describeError(primaryError)}); switching to fallback model`,
      );
    }

    const fallbackStream = await this.fallbackLlm.stream(messages, { signal });
    for await (const chunk of fallbackStream) {
      const text = extractText(chunk);
      if (text) yield text;
    }
  }
}

function extractText(chunk: { content: unknown }): string {
  const { content } = chunk;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c): c is { type: 'text'; text: string } =>
          typeof c === 'object' &&
          c !== null &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string',
      )
      .map((c) => c.text)
      .join('');
  }
  return '';
}

/**
 * Returns true when the error was caused by the caller aborting via `signal`,
 * which must never trigger fallback.
 */
function isUserAbort(err: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    const code = (err as { code?: string }).code;
    if (code === 'ABORT_ERR') return true;
  }
  return false;
}

/**
 * Classify whether a primary-tier error should trigger the fallback model.
 *
 * Fallback triggers only on:
 *   - timeout    (request/socket timeouts, 408)
 *   - rate_limit (HTTP 429)
 *   - api_error  (HTTP 5xx from the provider)
 *
 * Returns null for anything else (auth, validation, unknown) — those
 * surface to the caller without swapping models.
 */
export function classifyFallbackReason(err: unknown): FallbackReason | null {
  if (!(err instanceof Error)) return null;

  const status =
    (err as { status?: number }).status ??
    (err as { response?: { status?: number } }).response?.status;

  if (typeof status === 'number') {
    if (status === 408) return 'timeout';
    if (status === 429) return 'rate_limit';
    if (status >= 500 && status <= 599) return 'api_error';
    // Any other HTTP status (400/401/403/404/...) => do not fall back.
    return null;
  }

  // No HTTP status on the error — infer from code / message.
  const code = (err as { code?: string }).code;
  const timeoutCodes = new Set([
    'ETIMEDOUT',
    'ESOCKETTIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
  ]);
  if (code && timeoutCodes.has(code)) return 'timeout';

  const msg = (err.message ?? '').toLowerCase();
  if (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout')
  ) {
    return 'timeout';
  }
  if (msg.includes('rate limit') || msg.includes('rate_limit')) {
    return 'rate_limit';
  }

  return null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const status = (err as { status?: number }).status;
    const code = (err as { code?: string }).code;
    const bits = [err.name, err.message];
    if (status) bits.push(`status=${status}`);
    if (code) bits.push(`code=${code}`);
    return bits.join(' | ');
  }
  return String(err);
}
