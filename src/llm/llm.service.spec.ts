import { vi } from 'vitest';

vi.mock('@langchain/openai', () => {
  const ChatOpenAI = vi.fn().mockImplementation(() => ({}));
  return { ChatOpenAI };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service.js';

describe('LlmService', () => {
  let service: LlmService;
  let mockConfigService: { getOrThrow: ReturnType<typeof vi.fn> };
  let primaryLlm: { stream: ReturnType<typeof vi.fn> };
  let fallbackLlm: { stream: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockConfigService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'OPENAI_CHAT_MODEL') return 'gpt-4o-mini';
        if (key === 'OPENAI_API_KEY') return 'primary-key';
        if (key === 'OPENAI_FALLBACK_CHAT_MODEL') return 'gpt-4o-mini-fallback';
        if (key === 'OPENAI_FALLBACK_API_KEY') return 'fallback-key';
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<LlmService>(LlmService);
    primaryLlm = { stream: vi.fn() };
    fallbackLlm = { stream: vi.fn() };
    (service as unknown as { primaryLlm: unknown }).primaryLlm = primaryLlm;
    (service as unknown as { fallbackLlm: unknown }).fallbackLlm = fallbackLlm;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  async function collect(iter: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const t of iter) out.push(t);
    return out;
  }

  async function* makeChunks(contents: Array<string | object>) {
    for (const c of contents) {
      yield typeof c === 'string' ? { content: c } : c;
    }
  }

  describe('streamResponse', () => {
    it('yields string tokens from mocked ChatOpenAI.stream()', async () => {
      primaryLlm.stream.mockReturnValue(makeChunks(['Hello', ' ', 'world']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );

      expect(tokens).toEqual(['Hello', ' ', 'world']);
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('handles AIMessageChunk.content as MessageContentComplex[] — filters non-text chunks', async () => {
      primaryLlm.stream.mockReturnValue(
        makeChunks([
          {
            content: [
              { type: 'text', text: 'hi' },
              { type: 'tool_use', id: 'x' },
            ],
          },
        ]),
      );

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['hi']);
    });

    it('skips empty string tokens', async () => {
      primaryLlm.stream.mockReturnValue(makeChunks(['', 'real']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['real']);
    });

    it('does not fall back after primary already emitted output', async () => {
      async function* primaryChunksThenError() {
        yield { content: 'partial' };
        throw Object.assign(new Error('boom'), { status: 500 });
      }
      primaryLlm.stream.mockReturnValue(primaryChunksThenError());

      const stream = service.streamResponse(
        [],
        new AbortController().signal,
      ) as AsyncGenerator<string>;

      await expect(stream.next()).resolves.toEqual({
        done: false,
        value: 'partial',
      });
      await expect(stream.next()).rejects.toThrow('boom');
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });
  });

  describe('fallback triggers', () => {
    it('falls back on timeout (HTTP 408)', async () => {
      primaryLlm.stream.mockRejectedValue(
        Object.assign(new Error('request timeout'), { status: 408 }),
      );
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
      expect(fallbackLlm.stream).toHaveBeenCalledTimes(1);
    });

    it('falls back on timeout (ETIMEDOUT code)', async () => {
      primaryLlm.stream.mockRejectedValue(
        Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      );
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
    });

    it('falls back on timeout (message mentions "timed out")', async () => {
      primaryLlm.stream.mockRejectedValue(new Error('Request timed out'));
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
    });

    it('falls back on rate limit (HTTP 429)', async () => {
      primaryLlm.stream.mockRejectedValue(
        Object.assign(new Error('Too Many Requests'), { status: 429 }),
      );
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
    });

    it('falls back on provider API error (HTTP 500)', async () => {
      primaryLlm.stream.mockRejectedValue(
        Object.assign(new Error('Internal Server Error'), { status: 500 }),
      );
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
    });

    it('falls back on provider API error (HTTP 503)', async () => {
      primaryLlm.stream.mockRejectedValue(
        Object.assign(new Error('Service Unavailable'), { status: 503 }),
      );
      fallbackLlm.stream.mockReturnValue(makeChunks(['fb']));

      const tokens = await collect(
        service.streamResponse([], new AbortController().signal),
      );
      expect(tokens).toEqual(['fb']);
    });
  });

  describe('non-fallbackable errors', () => {
    it('does NOT fall back on 401 Unauthorized', async () => {
      const err = Object.assign(new Error('Unauthorized'), { status: 401 });
      primaryLlm.stream.mockRejectedValue(err);

      await expect(
        collect(service.streamResponse([], new AbortController().signal)),
      ).rejects.toThrow('Unauthorized');
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('does NOT fall back on 400 Bad Request', async () => {
      const err = Object.assign(new Error('Bad Request'), { status: 400 });
      primaryLlm.stream.mockRejectedValue(err);

      await expect(
        collect(service.streamResponse([], new AbortController().signal)),
      ).rejects.toThrow('Bad Request');
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('does NOT fall back on generic unknown error without status/code', async () => {
      primaryLlm.stream.mockRejectedValue(new Error('something weird'));

      await expect(
        collect(service.streamResponse([], new AbortController().signal)),
      ).rejects.toThrow('something weird');
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('does NOT fall back on user AbortError', async () => {
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      primaryLlm.stream.mockRejectedValue(abortErr);

      await expect(
        collect(service.streamResponse([], new AbortController().signal)),
      ).rejects.toThrow('aborted');
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('does NOT fall back when signal is already aborted', async () => {
      primaryLlm.stream.mockRejectedValue(new Error('Internal Server Error'));
      const ctrl = new AbortController();
      ctrl.abort();

      await expect(
        collect(service.streamResponse([], ctrl.signal)),
      ).rejects.toThrow();
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    it('reads primary and fallback chat config from ConfigService.getOrThrow', () => {
      service.onModuleInit();
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('OPENAI_CHAT_MODEL');
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('OPENAI_API_KEY');
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith(
        'OPENAI_FALLBACK_CHAT_MODEL',
      );
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith(
        'OPENAI_FALLBACK_API_KEY',
      );
    });
  });
});
