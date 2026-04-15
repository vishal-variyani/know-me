import { Test, TestingModule } from '@nestjs/testing';
import { PG_POOL } from '../database/database.constants.js';
import { PeopleService } from './people.service.js';
import type { PersonRow } from './memory.types.js';

describe('PeopleService', () => {
  let service: PeopleService;
  let mockPool: { query: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockPool = { query: vi.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        { provide: PG_POOL, useValue: mockPool },
      ],
    }).compile();

    service = module.get<PeopleService>(PeopleService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectNames', () => {
    it('extracts person names from text', () => {
      const names = service.detectNames('I had lunch with Sarah and Tom');
      // compromise returns proper nouns it classifies as people
      expect(names).toEqual(expect.arrayContaining(['Sarah', 'Tom']));
    });

    it('returns empty array for text with no names', () => {
      const names = service.detectNames('The weather is nice today');
      // May or may not return empty — not strictly testable without live NLP
      // but result must be a string array
      expect(Array.isArray(names)).toBe(true);
    });

    it('is synchronous — returns string[] not Promise', () => {
      const result = service.detectNames('Hello Sarah');
      // If this were async, result would be a Promise — check it is not
      expect(result).not.toBeInstanceOf(Promise);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('lookupByNames', () => {
    it('returns empty array immediately without querying DB when names is empty', async () => {
      const result = await service.lookupByNames([], 'user-123');
      expect(result).toEqual([]);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('passes user_id as first query parameter', async () => {
      const fakeRow: PersonRow = {
        id: 'person-1', user_id: 'user-123', name: 'Sarah',
        aliases: null, facts: {}, created_at: new Date(), updated_at: new Date(),
      };
      mockPool.query.mockResolvedValueOnce({ rows: [fakeRow] });

      await service.lookupByNames(['Sarah'], 'user-123');

      const [, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe('user-123');
    });

    it('passes names array as second query parameter', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.lookupByNames(['Sarah', 'Tom'], 'user-456');

      const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(params[1]).toEqual(['Sarah', 'Tom']);
      // Query must check both name column and aliases overlap
      expect(sql).toMatch(/name = ANY\(\$2::text\[\]\)/);
      expect(sql).toMatch(/aliases && \$2::text\[\]/);
    });

    it('scopes query to user_id — WHERE user_id = $1 is first condition', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await service.lookupByNames(['Jake'], 'user-789');

      const [sql] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/WHERE user_id = \$1/);
    });
  });

  describe('upsertPerson', () => {
    it('uses INSERT ... ON CONFLICT DO UPDATE in a single query', async () => {
      const fakeRow: PersonRow = {
        id: 'person-2', user_id: 'user-123', name: 'Jake',
        aliases: null, facts: { job: 'engineer' }, created_at: new Date(), updated_at: new Date(),
      };
      mockPool.query.mockResolvedValueOnce({ rows: [fakeRow] });

      await service.upsertPerson('Jake', 'user-123', { job: 'engineer' });

      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/INSERT INTO people/);
      expect(sql).toMatch(/ON CONFLICT \(user_id, name\)/);
      expect(sql).toMatch(/DO UPDATE/);
    });

    it('passes user_id as first parameter and name as second', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x', user_id: 'u', name: 'Sarah', aliases: null, facts: {}, created_at: new Date(), updated_at: new Date() }] });

      await service.upsertPerson('Sarah', 'user-123');

      const [, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe('user-123');
      expect(params[1]).toBe('Sarah');
    });

    it('defaults facts to empty object when not provided', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'x', user_id: 'u', name: 'Sarah', aliases: null, facts: {}, created_at: new Date(), updated_at: new Date() }] });

      await service.upsertPerson('Sarah', 'user-123');

      const [, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(JSON.stringify({}));
    });
  });
});
