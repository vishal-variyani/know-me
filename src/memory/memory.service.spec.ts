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

  describe('getRecentMessages', () => {
    it('calls pool.query with correct SQL and params', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.getRecentMessages('conv-123', 10);

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/FROM conversation_messages/);
      expect(sql).toMatch(/WHERE conversation_id = \$1/);
      expect(sql).toMatch(/ORDER BY created_at DESC/);
      expect(sql).toMatch(/LIMIT \$2/);
      expect(params[0]).toBe('conv-123');
      expect(params[1]).toBe(10);
    });

    it('reverses DB result to chronological order', async () => {
      const dbRows = [
        { id: '3', conversation_id: 'conv-1', user_id: 'u1', role: 'assistant' as const, content: 'c', created_at: new Date() },
        { id: '2', conversation_id: 'conv-1', user_id: 'u1', role: 'user' as const, content: 'b', created_at: new Date() },
        { id: '1', conversation_id: 'conv-1', user_id: 'u1', role: 'user' as const, content: 'a', created_at: new Date() },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: dbRows });

      const result = await service.getRecentMessages('conv-1', 10);

      expect(result.map((r) => r.id)).toEqual(['1', '2', '3']);
    });

    it('returns empty array when no messages found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.getRecentMessages('conv-empty', 10);

      expect(result).toEqual([]);
    });
  });

  describe('getConversationHistoryPage', () => {
    it('queries with user scoping + keyset predicate and returns chronological messages', async () => {
      const rows = [
        {
          id: '30000000-0000-0000-0000-000000000003',
          conversation_id: 'conv-1',
          user_id: 'u1',
          role: 'assistant' as const,
          content: 'c',
          created_at: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          id: '20000000-0000-0000-0000-000000000002',
          conversation_id: 'conv-1',
          user_id: 'u1',
          role: 'user' as const,
          content: 'b',
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows });

      const result = await service.getConversationHistoryPage(
        'conv-1',
        'u1',
        10,
        new Date('2026-01-04T00:00:00.000Z'),
        '40000000-0000-0000-0000-000000000004',
      );

      const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/WHERE conversation_id = \$1/);
      expect(sql).toMatch(/AND user_id = \$2/);
      expect(sql).toMatch(/\(created_at, id\) < \(\$3::timestamptz, \$4::uuid\)/);
      expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/);
      expect(params[4]).toBe(11); // fetch limit + 1

      expect(result.messages.map((r) => r.id)).toEqual([
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000003',
      ]);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toEqual({
        beforeCreatedAt: '2026-01-02T00:00:00.000Z',
        beforeId: '20000000-0000-0000-0000-000000000002',
      });
    });

    it('sets hasMore and trims to requested limit', async () => {
      const rows = [
        {
          id: '30000000-0000-0000-0000-000000000003',
          conversation_id: 'conv-1',
          user_id: 'u1',
          role: 'assistant' as const,
          content: 'c',
          created_at: new Date('2026-01-03T00:00:00.000Z'),
        },
        {
          id: '20000000-0000-0000-0000-000000000002',
          conversation_id: 'conv-1',
          user_id: 'u1',
          role: 'user' as const,
          content: 'b',
          created_at: new Date('2026-01-02T00:00:00.000Z'),
        },
        {
          id: '10000000-0000-0000-0000-000000000001',
          conversation_id: 'conv-1',
          user_id: 'u1',
          role: 'user' as const,
          content: 'a',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows });

      const result = await service.getConversationHistoryPage('conv-1', 'u1', 2);
      const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];

      expect(result.messages.map((r) => r.id)).toEqual([
        '20000000-0000-0000-0000-000000000002',
        '30000000-0000-0000-0000-000000000003',
      ]);
      expect(sql).toMatch(/WHERE conversation_id = \$1/);
      expect(sql).toMatch(/AND user_id = \$2/);
      expect(sql).not.toMatch(/\(created_at, id\) < /);
      expect(params[2]).toBe(3); // limit + 1
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toEqual({
        beforeCreatedAt: '2026-01-02T00:00:00.000Z',
        beforeId: '20000000-0000-0000-0000-000000000002',
      });
    });
  });
});
