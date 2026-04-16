import { Test, TestingModule } from '@nestjs/testing';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people/people.service.js';
import { RetrievalService } from './retrieval.service.js';
import type { MemorySearchResult, PersonRow } from '../memory/memory.types.js';

describe('RetrievalService', () => {
  let service: RetrievalService;
  let mockEmbeddingService: {
    embed: ReturnType<typeof vi.fn>;
  };
  let mockMemoryService: {
    searchSimilar: ReturnType<typeof vi.fn>;
    searchRelevantEmbeddings: ReturnType<typeof vi.fn>;
  };
  let mockPeopleService: {
    detectNames: ReturnType<typeof vi.fn>;
    lookupByNames: ReturnType<typeof vi.fn>;
  };

  const fakeMemory: MemorySearchResult = {
    id: 'mem-1',
    content: 'Sarah likes coffee',
    fact_type: 'preference',
    confidence: 0.9,
    last_reinforced_at: new Date(),
    similarity: 0.85,
  };

  const fakePerson: PersonRow = {
    id: 'person-1',
    user_id: 'user-123',
    name: 'Sarah',
    aliases: null,
    facts: { job: 'engineer' },
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    mockEmbeddingService = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    mockMemoryService = {
      searchSimilar: vi.fn().mockResolvedValue([fakeMemory]),
      searchRelevantEmbeddings: vi.fn().mockResolvedValue([]),
    };
    mockPeopleService = {
      detectNames: vi.fn().mockReturnValue(['Sarah']),
      lookupByNames: vi.fn().mockResolvedValue([fakePerson]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        { provide: EmbeddingService, useValue: mockEmbeddingService },
        { provide: MemoryService, useValue: mockMemoryService },
        { provide: PeopleService, useValue: mockPeopleService },
      ],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('retrieve', () => {
    it('calls embed and detectNames with the input text, then searchSimilar and lookupByNames', async () => {
      await service.retrieve('Hello Sarah', 'user-123');

      expect(mockEmbeddingService.embed).toHaveBeenCalledWith('Hello Sarah');
      expect(mockPeopleService.detectNames).toHaveBeenCalledWith('Hello Sarah');
      expect(mockMemoryService.searchSimilar).toHaveBeenCalledWith(
        'user-123',
        [0.1, 0.2, 0.3],
        5,
      );
      expect(mockPeopleService.lookupByNames).toHaveBeenCalledWith(
        ['Sarah'],
        'user-123',
      );
    });

    it('returns MemoryContext with both memories and people populated', async () => {
      const result = await service.retrieve('Hello Sarah', 'user-123');

      expect(result).toEqual({
        memories: [fakeMemory],
        chunks: [],
        people: [fakePerson],
      });
    });

    it('calls lookupByNames with empty array when detectNames returns no names — no error thrown', async () => {
      mockPeopleService.detectNames.mockReturnValue([]);
      mockPeopleService.lookupByNames.mockResolvedValue([]);

      const result = await service.retrieve('The weather is nice', 'user-123');

      expect(mockPeopleService.lookupByNames).toHaveBeenCalledWith(
        [],
        'user-123',
      );
      expect(result.people).toEqual([]);
    });

    it('both retrieval arms start concurrently — lookupByNames called before embed resolves', async () => {
      // Track call order using a shared order array
      const callOrder: string[] = [];

      // embed is delayed — resolves after a tick
      mockEmbeddingService.embed.mockImplementation(
        () =>
          new Promise<number[]>((resolve) => {
            setImmediate(() => {
              callOrder.push('embed-resolved');
              resolve([]);
            });
          }),
      );

      // searchSimilar resolves immediately with empty
      mockMemoryService.searchSimilar.mockResolvedValue([]);

      // lookupByNames records its call immediately (synchronous detectNames + async lookup)
      mockPeopleService.detectNames.mockImplementation(() => {
        callOrder.push('detectNames-called');
        return ['Sarah'];
      });
      mockPeopleService.lookupByNames.mockImplementation(
        (names: string[], userId: string) => {
          callOrder.push('lookupByNames-called');
          return Promise.resolve([fakePerson]);
        },
      );

      await service.retrieve('Hello Sarah', 'user-123');

      // detectNames is synchronous and called before Promise.all awaits embed
      expect(callOrder.indexOf('detectNames-called')).toBeLessThan(
        callOrder.indexOf('embed-resolved'),
      );
      // lookupByNames started before embed resolved (both arms ran concurrently)
      expect(callOrder.indexOf('lookupByNames-called')).toBeLessThan(
        callOrder.indexOf('embed-resolved'),
      );
    });
  });
});
