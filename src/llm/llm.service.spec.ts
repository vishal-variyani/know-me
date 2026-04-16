import { vi } from 'vitest';

// Mock ChatOpenAI before importing LlmService so the constructor never reads env vars
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

  describe('streamResponse', () => {
    it('yields string tokens from mocked ChatOpenAI.stream()', async () => {
      async function* makeChunks(contents: string[]) {
        for (const c of contents) yield { content: c };
      }

      primaryLlm.stream.mockReturnValue(makeChunks(['Hello', ' ', 'world']));

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['Hello', ' ', 'world']);
      expect(fallbackLlm.stream).not.toHaveBeenCalled();
    });

    it('handles AIMessageChunk.content as MessageContentComplex[] — filters non-text chunks', async () => {
      async function* makeChunks() {
        yield { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'x' }] };
      }

      primaryLlm.stream.mockReturnValue(makeChunks());

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['hi']);
    });

    it('skips empty string tokens', async () => {
      async function* makeChunks() {
        yield { content: '' };
        yield { content: 'real' };
      }

      primaryLlm.stream.mockReturnValue(makeChunks());

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['real']);
    });

    it('falls back when primary model fails before emitting output', async () => {
      async function* fallbackChunks() {
        yield { content: 'fallback' };
      }

      primaryLlm.stream.mockRejectedValue(new Error('primary down'));
      fallbackLlm.stream.mockReturnValue(fallbackChunks());

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['fallback']);
      expect(fallbackLlm.stream).toHaveBeenCalledTimes(1);
    });

    it('does not fall back after primary already emitted output', async () => {
      async function* primaryChunksThenError() {
        yield { content: 'partial' };
        throw new Error('primary mid-stream failure');
      }

      primaryLlm.stream.mockReturnValue(primaryChunksThenError());

      const signal = new AbortController().signal;
      const stream = service.streamResponse([], signal);

      await expect(stream.next()).resolves.toEqual({
        done: false,
        value: 'partial',
      });
      await expect(stream.next()).rejects.toThrow('primary mid-stream failure');
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
