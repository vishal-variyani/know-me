import { Test, TestingModule } from '@nestjs/testing';
import { PG_POOL } from '../database/database.constants.js';
import { MemoryService } from './memory.service.js';
import type { MemorySearchResult } from './memory.types.js';

describe('MemoryService', () => {
  let service: MemoryService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockPool = { query: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: PG_POOL, useValue: mockPool },
      ],
    }).compile();

    service = module.get<MemoryService>(MemoryService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('searchSimilar', () => {
    it('calls search_user_memories function with userId, pgvector.toSql(vector), and topK', async () => {
      const fakeVector = new Array(1536).fill(0.1);
      const fakeRows: MemorySearchResult[] = [
        {
          id: 'abc',
          content: 'I love coffee',
          fact_type: 'preference',
          confidence: 0.9,
          last_reinforced_at: new Date(),
          similarity: 0.95,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: fakeRows });

      const result = await service.searchSimilar('user-123', fakeVector, 5);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/search_user_memories\(\$1,\s*\$2,\s*\$3\)/);
      expect(params[0]).toBe('user-123');
      // pgvector.toSql converts number[] to '[0.1,0.1,...]' format
      expect(typeof params[1]).toBe('string');
      expect(params[2]).toBe(5);
      expect(result).toEqual(fakeRows);
    });

    it('returns empty array when no rows found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const result = await service.searchSimilar(
        'user-123',
        new Array(1536).fill(0),
        5,
      );
      expect(result).toEqual([]);
    });
  });

  describe('upsertMemoryEntry', () => {
    const vector = new Array(1536).fill(0.5);

    it('INSERT path: inserts new row when searchSimilar returns empty array', async () => {
      // First call: searchSimilar → empty
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      // Second call: INSERT
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.upsertMemoryEntry(
        'I love coffee',
        vector,
        'user-123',
        'preference',
        'conversation',
      );

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [insertSql] = mockPool.query.mock.calls[1] as [string, unknown[]];
      expect(insertSql).toMatch(/INSERT INTO memory_entries/);
      expect(insertSql).not.toMatch(/UPDATE/);
    });

    it('INSERT path: inserts new row when top similarity < 0.90', async () => {
      const lowSimilarityResult: MemorySearchResult[] = [
        {
          id: 'old-id',
          content: 'I like tea',
          fact_type: 'preference',
          confidence: 0.7,
          last_reinforced_at: new Date(),
          similarity: 0.85,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: lowSimilarityResult });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.upsertMemoryEntry(
        'I love coffee',
        vector,
        'user-123',
        'preference',
        'conversation',
      );

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [insertSql] = mockPool.query.mock.calls[1] as [string, unknown[]];
      expect(insertSql).toMatch(/INSERT INTO memory_entries/);
    });

    it('UPDATE path: updates last_reinforced_at and confidence when similarity >= 0.90', async () => {
      const highSimilarityResult: MemorySearchResult[] = [
        {
          id: 'existing-id',
          content: 'I love coffee',
          fact_type: 'preference',
          confidence: 0.8,
          last_reinforced_at: new Date(),
          similarity: 0.95,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: highSimilarityResult });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.upsertMemoryEntry(
        'I really love coffee',
        vector,
        'user-123',
        'preference',
        'conversation',
      );

      expect(mockPool.query).toHaveBeenCalledTimes(2);
      const [updateSql, updateParams] = mockPool.query.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(updateSql).toMatch(/UPDATE memory_entries/);
      expect(updateSql).toMatch(/last_reinforced_at = NOW\(\)/);
      expect(updateSql).toMatch(/LEAST\(confidence \+ 0\.05, 1\.0\)/);
      expect(updateParams[0]).toBe('existing-id');
    });

    it('UPDATE path fires at exact 0.90 threshold boundary', async () => {
      const exactThreshold: MemorySearchResult[] = [
        {
          id: 'boundary-id',
          content: 'same fact',
          fact_type: 'preference',
          confidence: 0.5,
          last_reinforced_at: new Date(),
          similarity: 0.9,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: exactThreshold });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.upsertMemoryEntry(
        'same fact',
        vector,
        'user-123',
        'preference',
        'conversation',
      );

      const [updateSql] = mockPool.query.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toMatch(/UPDATE memory_entries/);
    });

    it('searchSimilar is always called with topK=1 regardless of content', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.upsertMemoryEntry(
        'any content',
        vector,
        'user-456',
        'belief',
        'document',
      );

      const [searchSql, searchParams] = mockPool.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(searchSql).toMatch(/search_user_memories\(\$1,\s*\$2,\s*\$3\)/);
      expect(searchParams[0]).toBe('user-456');
      expect(searchParams[2]).toBe(1);
    });
  });
});
