import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LlmService } from './llm.service.js';

describe('LlmService', () => {
  let service: LlmService;
  let mockConfigService: { getOrThrow: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockConfigService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'ANTHROPIC_MODEL') return 'claude-sonnet-4-20250514';
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('streamResponse', () => {
    it('yields string tokens from mocked ChatAnthropic.stream()', async () => {
      async function* makeChunks(contents: string[]) {
        for (const c of contents) yield { content: c };
      }

      const mockLlm = {
        stream: vi.fn().mockReturnValue(makeChunks(['Hello', ' ', 'world'])),
      };
      (service as unknown as { llm: unknown }).llm = mockLlm;

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['Hello', ' ', 'world']);
    });

    it('handles AIMessageChunk.content as MessageContentComplex[] — filters non-text chunks', async () => {
      async function* makeChunks() {
        yield { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 'x' }] };
      }

      const mockLlm = {
        stream: vi.fn().mockReturnValue(makeChunks()),
      };
      (service as unknown as { llm: unknown }).llm = mockLlm;

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

      const mockLlm = {
        stream: vi.fn().mockReturnValue(makeChunks()),
      };
      (service as unknown as { llm: unknown }).llm = mockLlm;

      const signal = new AbortController().signal;
      const collected: string[] = [];
      for await (const token of service.streamResponse([], signal)) {
        collected.push(token);
      }

      expect(collected).toEqual(['real']);
    });
  });

  describe('onModuleInit', () => {
    it('reads ANTHROPIC_MODEL from ConfigService.getOrThrow', () => {
      service.onModuleInit();
      expect(mockConfigService.getOrThrow).toHaveBeenCalledWith('ANTHROPIC_MODEL');
    });
  });
});
