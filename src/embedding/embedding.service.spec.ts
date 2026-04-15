import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmbeddingService } from './embedding.service.js';

describe('EmbeddingService', () => {
  let service: EmbeddingService;
  let mockConfigService: { getOrThrow: ReturnType<typeof vi.fn> };

  function buildModule(dims: string, model = 'text-embedding-3-small') {
    mockConfigService = {
      getOrThrow: vi.fn((key: string) => {
        if (key === 'OPENAI_EMBEDDING_MODEL') return model;
        if (key === 'EMBEDDING_DIMS') return dims;
        throw new Error(`Unexpected config key: ${key}`);
      }),
    };
    return Test.createTestingModule({
      providers: [
        EmbeddingService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
  }

  describe('onModuleInit', () => {
    it('does not throw when EMBEDDING_DIMS=1536', async () => {
      const module = await buildModule('1536');
      service = module.get<EmbeddingService>(EmbeddingService);
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('throws with exact message when EMBEDDING_DIMS != 1536', async () => {
      const module = await buildModule('999');
      service = module.get<EmbeddingService>(EmbeddingService);
      expect(() => service.onModuleInit()).toThrow(
        '[EmbeddingService] EMBEDDING_DIMS mismatch: expected 1536, got 999',
      );
    });

    it('throws with exact message when EMBEDDING_DIMS=512', async () => {
      const module = await buildModule('512');
      service = module.get<EmbeddingService>(EmbeddingService);
      expect(() => service.onModuleInit()).toThrow(
        '[EmbeddingService] EMBEDDING_DIMS mismatch: expected 1536, got 512',
      );
    });
  });

  describe('embed', () => {
    it('calls embedQuery and returns result', async () => {
      const module = await buildModule('1536');
      service = module.get<EmbeddingService>(EmbeddingService);
      service.onModuleInit();

      const fakeVector = Array.from({ length: 1536 }, (_, i) => i * 0.001);
      const mockEmbedQuery = vi.fn().mockResolvedValue(fakeVector);
      // Access private embeddings for test injection
      (service as unknown as { embeddings: { embedQuery: typeof mockEmbedQuery } }).embeddings = {
        embedQuery: mockEmbedQuery,
      };

      const result = await service.embed('hello');
      expect(mockEmbedQuery).toHaveBeenCalledWith('hello');
      expect(result).toBe(fakeVector);
      expect(result).toHaveLength(1536);
    });
  });
});
