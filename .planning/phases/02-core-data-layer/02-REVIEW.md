---
phase: 02-core-data-layer
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/app.module.ts
  - src/database/database.constants.ts
  - src/database/database.module.ts
  - src/embedding/embedding.module.ts
  - src/embedding/embedding.service.spec.ts
  - src/embedding/embedding.service.ts
  - src/main.ts
  - src/memory/memory.module.ts
  - src/memory/memory.service.spec.ts
  - src/memory/memory.service.ts
  - src/memory/memory.types.ts
  - src/memory/people.service.spec.ts
  - src/memory/people.service.ts
  - supabase/migrations/20260415000007_people_unique_name.sql
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The core data layer is well-structured: clean module boundaries, parameterised queries throughout (no injection risk), pgvector used correctly via `pgvector.toSql`, and the `search_user_memories` DB function uses `SET LOCAL` to prevent HNSW parameter leakage across pool connections. The upsert similarity threshold logic is clearly expressed and well-tested.

One critical issue was found: the `pg` Pool has no idle-client error handler, which can crash the Node process on unexpected DB errors. Four warnings cover unguarded `rows[0]` accesses, a type-safety gap that lets invalid `fact_type` values through to a DB constraint check, and a missing null check in `EmbeddingService`. Two info items flag minor style/design concerns.

---

## Critical Issues

### CR-01: pg Pool has no error handler — idle client errors crash the process

**File:** `src/database/database.module.ts:14`
**Issue:** The `pg` Pool emits an `error` event when a pooled (idle) client encounters a backend error (e.g., DB restart, network reset). In Node.js, an unhandled `error` event on an `EventEmitter` throws an uncaught exception and crashes the process. The pool is created but only a `connect` handler is registered; no `error` handler is attached. This is a documented sharp edge in the `node-postgres` docs.

**Fix:**
```typescript
const pool = new Pool({
  connectionString: config.getOrThrow<string>('DATABASE_URL'),
});

pool.on('connect', (client) => {
  pgvector.registerTypes(client);
});

// Required: prevents idle-client errors from crashing the process.
// The Logger instance is not available inside useFactory directly;
// use console.error or pass a logger reference.
pool.on('error', (err) => {
  console.error('[DatabaseModule] Idle pg client error', err);
});

return pool;
```

---

## Warnings

### WR-01: `rows[0]` accessed without guard in MemoryService — can return undefined at runtime

**File:** `src/memory/memory.service.ts:27` and `src/memory/memory.service.ts:41`
**Issue:** `createConversation` returns `result.rows[0]` typed as `ConversationRow`, and `addMessage` returns `result.rows[0]` typed as `ConversationMessageRow`. Both INSERT statements include a `RETURNING` clause, so under normal conditions this is fine. However, if the query somehow yields no rows (e.g., RLS policy blocks the return, or a future schema change removes the RETURNING clause), `rows[0]` is `undefined` and callers receive `undefined` where a concrete type is expected — a silent type lie that causes downstream crashes.

**Fix:**
```typescript
async createConversation(userId: string, title?: string): Promise<ConversationRow> {
  const result = await this.pool.query<ConversationRow>(/* ... */);
  const row = result.rows[0];
  if (!row) throw new Error(`[MemoryService] createConversation returned no row for userId=${userId}`);
  return row;
}
```
Apply the same pattern to `addMessage` (line 41) and `PeopleService.upsertPerson` (line 47, see WR-02).

---

### WR-02: `rows[0]` accessed without guard in PeopleService.upsertPerson

**File:** `src/memory/people.service.ts:47`
**Issue:** Same pattern as WR-01. The INSERT ... ON CONFLICT ... RETURNING query should always return a row, but the `rows[0]` access is unguarded. If the RETURNING clause yields no result (RLS, future schema drift), the method returns `undefined` despite a `PersonRow` return type.

**Fix:**
```typescript
const result = await this.pool.query<PersonRow>(/* ... */);
const row = result.rows[0];
if (!row) throw new Error(`[PeopleService] upsertPerson returned no row for name=${name}`);
return row;
```

---

### WR-03: `factType` parameter is `string` instead of the constrained union type

**File:** `src/memory/memory.service.ts:74`
**Issue:** The `memory_entries` table enforces a CHECK constraint allowing only `'preference' | 'relationship' | 'event' | 'belief' | 'goal' | 'habit'` for `fact_type`. The `upsertMemoryEntry` method accepts `factType: string`, losing this constraint at the TypeScript level. An invalid value will reach PostgreSQL and throw a constraint violation error that is harder to diagnose than a compile-time type error.

The same valid union is partially captured in `MemorySearchResult.fact_type: string` (memory.types.ts:4) — that result field can remain `string` since it comes from DB, but the input should be typed.

**Fix:**
```typescript
// In memory.types.ts, add:
export type FactType = 'preference' | 'relationship' | 'event' | 'belief' | 'goal' | 'habit';

// In memory.service.ts line 74:
async upsertMemoryEntry(
  content: string,
  vector: number[],
  userId: string,
  factType: FactType,            // was: string
  sourceType: 'conversation' | 'document',
): Promise<void>
```

---

### WR-04: EmbeddingService.embed is callable before onModuleInit runs — throws uninformative error

**File:** `src/embedding/embedding.service.ts:32`
**Issue:** `this.embeddings` is declared with the definite-assignment assertion (`!`) and initialised only in `onModuleInit`. If `onModuleInit` has not been called (e.g., when `EmbeddingService` is obtained via `Test.createTestingModule(...).compile()` without calling `service.onModuleInit()`) and `embed()` is invoked, the call fails with `TypeError: Cannot read properties of undefined (reading 'embedQuery')`. This is tested correctly in the spec file, but a defensive guard in production code is safer.

This is lower-severity than CR-01 because NestJS guarantees `onModuleInit` runs before any request handler, but the `!` assertion suppresses TypeScript's guard completely.

**Fix:**
```typescript
async embed(text: string): Promise<number[]> {
  if (!this.embeddings) {
    throw new Error('[EmbeddingService] embeddings not initialized — was onModuleInit called?');
  }
  return this.embeddings.embedQuery(text);
}
```

---

## Info

### IN-01: UPDATE path in upsertMemoryEntry does not refresh the stored embedding or content

**File:** `src/memory/memory.service.ts:81-88`
**Issue:** When a near-duplicate memory is reinforced (similarity >= 0.90), only `last_reinforced_at` and `confidence` are updated. The stored `embedding` and `content` remain unchanged. If the reinforcing text is meaningfully different (e.g., "I love coffee" vs "I really love espresso" at 0.91 similarity), the stored content drifts from reality over many reinforcements. This is a design decision but worth flagging explicitly — if the intent is "always keep the most recent phrasing," the UPDATE should also set `content = $2, embedding = $3`.

No code change required if the current behaviour is intentional. If updating is desired:
```sql
UPDATE memory_entries
SET last_reinforced_at = NOW(),
    confidence = LEAST(confidence + 0.05, 1.0),
    content = $2,
    embedding = $3,
    updated_at = NOW()
WHERE id = $1
```

---

### IN-02: facts shallow-merge in upsertPerson may silently discard nested keys

**File:** `src/memory/people.service.ts:43`
**Issue:** The SQL `facts = people.facts || EXCLUDED.facts` is a PostgreSQL jsonb top-level merge. If a caller passes `{ job: { title: 'Engineer', company: 'Acme' } }` and a later call passes `{ job: { company: 'BigCo' } }`, the stored result will be `{ job: { company: 'BigCo' } }` — the nested `title` key is lost. This is a known limitation of `||` on jsonb. For the current use case (flat key-value facts) this is likely fine, but callers should be aware that nested objects are replaced, not merged.

No change required unless deep-merge semantics are needed. Consider a code comment on the method to document the merge behaviour.

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
