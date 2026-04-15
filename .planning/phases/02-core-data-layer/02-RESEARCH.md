# Phase 2: Core Data Layer - Research

**Researched:** 2026-04-15
**Domain:** NestJS DI patterns for raw pg Pool, LangChain OpenAI embeddings, pgvector Node.js type registration, NLP proper noun extraction
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMBED-01 | `EmbeddingModule` exports `EmbeddingService` wrapping `OpenAIEmbeddings` with model from `OPENAI_EMBEDDING_MODEL` env var, `dimensions: 1536` | `@langchain/openai` `OpenAIEmbeddings` constructor accepts `model` and `dimensions` params; `ConfigService.getOrThrow()` provides env vars at construction time |
| EMBED-02 | `EmbeddingService.embed(text): Promise<number[]>` returns 1536-dim vector | `embedQuery(text)` on `OpenAIEmbeddings` returns `Promise<number[]>` — direct passthrough |
| EMBED-03 | `EMBEDDING_DIMS` env var validated against 1536 at startup | `OnModuleInit.onModuleInit()` is the correct hook; throws synchronously if mismatch detected at initialization |
| MEM-01 | `MemoryModule` exports `MemoryService` and `PeopleService` | Standard NestJS `exports` array pattern on a single module |
| MEM-02 | `MemoryService.searchSimilar()` calls `search_user_memories` Postgres function only | `pool.query('SELECT * FROM search_user_memories($1, $2, $3)', [userId, pgvector.toSql(vector), topK])` pattern; never uses raw `<=>` |
| MEM-03 | `MemoryService.upsertMemoryEntry()` with 0.90 cosine similarity dedup guard | Two-step: (1) `searchSimilar(userId, vector, 1)` → check similarity >= 0.90; (2) INSERT or UPDATE; `confidence` column is `double precision` with CHECK constraint 0.0–1.0 |
| MEM-04 | `PeopleService.detectNames(text): string[]` | `compromise` library `nlp(text).people().out('array')` returns person name strings |
| MEM-05 | `PeopleService.lookupByNames(names, userId)` direct SQL SELECT from people | Parameterized `WHERE user_id = $1 AND (name = ANY($2::text[]) OR aliases && $3::text[])` |
| MEM-06 | Every MemoryService and PeopleService method enforces `user_id` filter | Structural: all queries include `WHERE user_id = $1` as first WHERE clause; never optional |
</phase_requirements>

---

## Summary

Phase 2 delivers three injectable services that form the shared backbone for both runtime paths (chat path in Phase 3 and extraction pipeline in Phase 4). All three services consume the raw `pg` Pool injected via a `@Global()` `DatabaseModule`, along with `ConfigService` from the already-global `ConfigModule` established in Phase 1.

The `EmbeddingService` is a thin wrapper around LangChain's `OpenAIEmbeddings`, adding NestJS DI wiring and a startup dimension-validation guard. The `MemoryService` performs all database operations for the three core tables (`conversations`, `conversation_messages`, `memory_entries`) and implements the 0.90 cosine similarity deduplication gate using the `search_user_memories` Postgres function established in Phase 1. The `PeopleService` provides name extraction via the `compromise` NLP library and direct SQL lookups against the `people` table.

The critical cross-cutting concern is **user isolation**: every query must include `WHERE user_id = $1` as a non-negotiable filter. The `pgvector` npm package must be registered against the pg Pool connection via the `pool.on('connect', ...)` hook so vector parameters serialize correctly.

**Primary recommendation:** Use `@Global()` `DatabaseModule` with a `PG_POOL` injection token (Symbol), `pgvector.registerTypes(client)` in the pool's `connect` event, and `compromise` for name extraction — avoid heavier NLP libraries.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Embedding (text → vector) | API/Backend (`EmbeddingService`) | — | OpenAI API call; never in browser tier; shared by both runtime paths |
| Embedding dimension validation | API/Backend (`EmbeddingService.onModuleInit`) | — | Must fail at startup before accepting requests |
| pg Pool management | API/Backend (`DatabaseModule`) | — | Connection pool is a singleton; `@Global()` prevents duplicate instantiation |
| pgvector type registration | API/Backend (`DatabaseModule`) | — | Must run on each pool connection before any vector query |
| Memory CRUD (conversations, messages) | API/Backend (`MemoryService`) | Database/Storage | Service owns the query logic; DB owns the schema constraints |
| Memory similarity search | Database/Storage (`search_user_memories` fn) | API/Backend (`MemoryService`) | HNSW search with `SET LOCAL` params must live in Postgres function; service is the caller only |
| Memory upsert + dedup gate | API/Backend (`MemoryService.upsertMemoryEntry`) | Database/Storage | 0.90 threshold logic lives at the service layer; DB stores the result |
| People name extraction | API/Backend (`PeopleService`) | — | In-process NLP; never a DB or browser concern |
| People lookup by name | API/Backend (`PeopleService`) | Database/Storage | Direct SQL SELECT with `user_id` filter |
| User isolation enforcement | API/Backend (all service query methods) | Database/Storage (RLS) | RLS is defense-in-depth; explicit `WHERE user_id = $1` in every query is the primary control |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | 8.20.0 | Raw PostgreSQL client; Pool for connection management | Established in Phase 1 via DATABASE_URL env var; no ORM overhead; required for pgvector type registration |
| `pgvector` | 0.2.1 | Registers vector type with pg; serializes `number[]` to SQL vector literal | Without this, passing 1536-dim arrays as query params fails type coercion |
| `@langchain/openai` | 1.4.4 | `OpenAIEmbeddings` with `text-embedding-3-small` 1536-dim support | Project-standard LLM integration library; `dimensions` param supported from `text-embedding-3` class |
| `@langchain/core` | 1.1.40 | Peer dependency of `@langchain/openai` | Auto-installed as peer; provides `Embeddings` interface |
| `compromise` | 14.15.0 | NLP library for person name extraction (`detectNames`) | Ships bundled TypeScript types (`types/three.d.ts`); browser-weight but node-compatible; `nlp(text).people().out('array')` is the one-liner needed |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/pg` | 8.20.0 | TypeScript types for pg Pool, QueryResult, PoolClient | Add as devDependency for type safety on pool queries |
| `openai` | 6.34.0 | Underlying OpenAI SDK (auto-installed as `@langchain/openai` dep) | Do not import directly; used by LangChain internally |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `compromise` | Regex-only (capital word heuristic) | Regex `/\b[A-Z][a-z]+\b/g` is fragile (sentence-start false positives, initials, titles). compromise is 22KB gzipped and ships TS types — the correct tradeoff for NLP that needs to not embarrass itself |
| `compromise` | `wink-nlp` | wink-nlp is more accurate but requires a model download (~15MB); overkill for v1 |
| `@langchain/openai` `embedQuery` | Direct OpenAI SDK `client.embeddings.create()` | `embedQuery` returns `number[]` directly; direct SDK requires unwrapping `.data[0].embedding`; LangChain is already the project-standard integration layer |
| Raw `pg` Pool | `@nestjs/typeorm` or `drizzle-orm` | Phase 1 decision (locked): raw `pg` Pool matches Supabase cloud exactly; avoids ORM migration divergence |

**Installation:**
```bash
pnpm add pg pgvector @langchain/openai @langchain/core compromise
pnpm add -D @types/pg
```

**Version verification:** [VERIFIED: npm registry — 2026-04-15]
- `pg@8.20.0` — verified
- `pgvector@0.2.1` — verified
- `@langchain/openai@1.4.4` — verified
- `@langchain/core@1.1.40` — verified
- `compromise@14.15.0` — verified

---

## Architecture Patterns

### System Architecture Diagram

```
Bootstrap (main.ts)
     │ validateEnv() [Phase 1]
     ▼
AppModule
  ├─ ConfigModule (Global, Phase 1) ──────────────────────────┐
  ├─ DatabaseModule (@Global)                                  │
  │    └─ PG_POOL provider (useFactory)                       │
  │         ├─ pool.on('connect', pgvector.registerTypes)     │
  │         └─ Pool({ connectionString: DATABASE_URL })       │
  │                                                            │
  ├─ EmbeddingModule ──────────────────────────────────────── │ ──► exports EmbeddingService
  │    └─ EmbeddingService                                    │
  │         ├─ inject ConfigService ◄──────────────────────── ┘
  │         ├─ onModuleInit(): validate EMBEDDING_DIMS == 1536
  │         ├─ OpenAIEmbeddings({ model, dimensions: 1536 })
  │         └─ embed(text) → embedQuery(text) → number[1536]
  │
  └─ MemoryModule ─────────────────────────────────────────────► exports MemoryService, PeopleService
       ├─ inject PG_POOL (from DatabaseModule @Global)
       │
       ├─ MemoryService
       │    ├─ createConversation(userId) → INSERT conversations
       │    ├─ addMessage(conversationId, userId, role, content) → INSERT conversation_messages
       │    ├─ saveMessageEmbedding(messageId, userId, vector) → INSERT message_embeddings
       │    ├─ searchSimilar(userId, vector, topK)
       │    │       → SELECT search_user_memories($1, $2::vector, $3)
       │    │       → MemorySearchResult[]
       │    └─ upsertMemoryEntry(fact, vector, userId)
       │         ├─ searchSimilar(userId, vector, 1) → check similarity >= 0.90
       │         ├─ if match: UPDATE last_reinforced_at, confidence += delta
       │         └─ if no match: INSERT memory_entries
       │
       └─ PeopleService
            ├─ detectNames(text)
            │       → nlp(text).people().out('array')
            │       → string[]
            ├─ lookupByNames(names, userId)
            │       → SELECT WHERE user_id = $1 AND (name = ANY($2) OR aliases && $2)
            │       → PersonRow[]
            └─ upsertPerson(name, userId, facts)
                    → INSERT ... ON CONFLICT (user_id, name) DO UPDATE
```

### Recommended Project Structure

```
src/
├─ database/
│   ├─ database.module.ts        # @Global() module with PG_POOL provider
│   └─ database.constants.ts     # export const PG_POOL = Symbol('PG_POOL')
├─ embedding/
│   ├─ embedding.module.ts       # exports EmbeddingService
│   └─ embedding.service.ts      # wraps OpenAIEmbeddings, OnModuleInit dim check
└─ memory/
    ├─ memory.module.ts          # exports MemoryService, PeopleService
    ├─ memory.service.ts         # CRUD + searchSimilar + upsertMemoryEntry
    ├─ people.service.ts         # detectNames + lookupByNames + upsertPerson
    └─ memory.types.ts           # MemorySearchResult, PersonRow, ConversationRow interfaces
```

### Pattern 1: DatabaseModule with @Global() and PG_POOL Symbol Token

**What:** A globally-scoped NestJS module providing a `pg.Pool` instance under a Symbol injection token. The pool registers `pgvector` types on every new connection.

**When to use:** When multiple modules need raw DB access without re-importing a module. `@Global()` combined with `exports: [PG_POOL]` means all downstream modules just declare `@Inject(PG_POOL)` in their constructor.

```typescript
// Source: [VERIFIED: docs.nestjs.com global modules + context7 /nestjs/docs.nestjs.com]
// src/database/database.constants.ts
export const PG_POOL = Symbol('PG_POOL');

// src/database/database.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
import { PG_POOL } from './database.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });
        // Register vector type on each new client before first query
        pool.on('connect', (client) => {
          pgvector.registerTypes(client);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
```

### Pattern 2: EmbeddingService with OnModuleInit Dimension Validation

**What:** `OnModuleInit` runs after all providers are resolved. Dimension mismatch throws before the first request can reach the service — satisfies EMBED-03.

**When to use:** Any validation that requires injected services (here: `ConfigService`) but must block app startup if it fails.

```typescript
// Source: [VERIFIED: docs.nestjs.com lifecycle events + context7 /nestjs/docs.nestjs.com]
// src/embedding/embedding.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

const EXPECTED_DIMS = 1536;

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private embeddings!: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const model = this.config.getOrThrow<string>('OPENAI_EMBEDDING_MODEL');
    const dims = parseInt(this.config.getOrThrow<string>('EMBEDDING_DIMS'), 10);

    if (dims !== EXPECTED_DIMS) {
      throw new Error(
        `[EmbeddingService] EMBEDDING_DIMS mismatch: expected ${EXPECTED_DIMS}, got ${dims}`,
      );
    }

    this.embeddings = new OpenAIEmbeddings({
      model,
      dimensions: EXPECTED_DIMS,
    });

    this.logger.log(`EmbeddingService initialized with model=${model} dims=${EXPECTED_DIMS}`);
  }

  async embed(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}
```

### Pattern 3: MemoryService — searchSimilar via Postgres function

**What:** Delegates HNSW cosine search to the `search_user_memories` Postgres function established in Phase 1. The function handles `SET LOCAL hnsw.ef_search` and `SET LOCAL hnsw.iterative_scan` — the service never touches raw `<=>` SQL.

**When to use:** Any time memory retrieval is needed. Pass `pgvector.toSql(vector)` as the embedding parameter.

```typescript
// Source: [VERIFIED: pgvector/pgvector-node README + live schema inspection 2026-04-15]
// src/memory/memory.service.ts (partial)
import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
import { PG_POOL } from '../database/database.constants.js';

export interface MemorySearchResult {
  id: string;
  content: string;
  fact_type: string;
  confidence: number;
  last_reinforced_at: Date;
  similarity: number;
}

@Injectable()
export class MemoryService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async searchSimilar(
    userId: string,
    vector: number[],
    topK: number,
  ): Promise<MemorySearchResult[]> {
    const result = await this.pool.query<MemorySearchResult>(
      `SELECT id, content, fact_type, confidence, last_reinforced_at, similarity
       FROM search_user_memories($1, $2, $3)`,
      [userId, pgvector.toSql(vector), topK],
    );
    return result.rows;
  }
}
```

### Pattern 4: MemoryService — upsertMemoryEntry with 0.90 dedup gate

**What:** Checks similarity of the incoming vector against existing entries. If the top match has `similarity >= 0.90`, it reinforces the existing entry rather than inserting a duplicate.

**When to use:** Any time a new memory fact is to be persisted (extraction pipeline, Phase 4).

```typescript
// Source: [ASSUMED — pattern derived from requirements MEM-03 + live schema inspection]
// src/memory/memory.service.ts (partial)
async upsertMemoryEntry(
  content: string,
  vector: number[],
  userId: string,
  factType: string,
  sourceType: 'conversation' | 'document',
): Promise<void> {
  const similar = await this.searchSimilar(userId, vector, 1);

  if (similar.length > 0 && similar[0].similarity >= 0.90) {
    // Reinforce existing entry — do not insert duplicate
    await this.pool.query(
      `UPDATE memory_entries
       SET last_reinforced_at = NOW(),
           confidence = LEAST(confidence + 0.05, 1.0),
           updated_at = NOW()
       WHERE id = $1`,
      [similar[0].id],
    );
  } else {
    // Insert new entry
    await this.pool.query(
      `INSERT INTO memory_entries
         (user_id, content, embedding, fact_type, source_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, content, pgvector.toSql(vector), factType, sourceType],
    );
  }
}
```

### Pattern 5: PeopleService — detectNames via compromise

**What:** `compromise` identifies person names through its POS tagger. `.people().out('array')` returns a deduplicated `string[]` of recognized person names.

**When to use:** Before any `lookupByNames` call. Operates on raw conversation text.

```typescript
// Source: [VERIFIED: compromise GitHub README + npm package bundled types]
// src/memory/people.service.ts (partial)
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import nlp from 'compromise';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants.js';

@Injectable()
export class PeopleService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  detectNames(text: string): string[] {
    // compromise nlp(text).people().out('array') returns string[]
    // of recognized person names; deduplication is built in
    return nlp(text).people().out('array') as string[];
  }

  async lookupByNames(names: string[], userId: string): Promise<PersonRow[]> {
    if (names.length === 0) return [];
    const result = await this.pool.query<PersonRow>(
      `SELECT id, user_id, name, aliases, facts, created_at, updated_at
       FROM people
       WHERE user_id = $1
         AND (name = ANY($2::text[]) OR aliases && $2::text[])`,
      [userId, names],
    );
    return result.rows;
  }
}

export interface PersonRow {
  id: string;
  user_id: string;
  name: string;
  aliases: string[] | null;
  facts: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
```

### Pattern 6: Injecting PG_POOL into a service using Symbol token

**What:** Symbol injection tokens require `@Inject(PG_POOL)` in the constructor — TypeScript cannot infer a Symbol at compile time. This is the established NestJS pattern for non-class providers.

```typescript
// Source: [VERIFIED: context7 /nestjs/docs.nestjs.com custom providers]
constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
```

### Anti-Patterns to Avoid

- **Raw `<=>` SQL at service layer:** Never write `ORDER BY embedding <=> $1` in TypeScript service code. The `search_user_memories` function handles HNSW parameter settings (`SET LOCAL`) that must be in the same transaction as the query. Bypassing the function breaks the isolation guarantee.
- **`pool.query()` without `user_id` parameter:** Every query on `conversations`, `conversation_messages`, `message_embeddings`, `memory_entries`, and `people` must include `WHERE user_id = $1`. RLS is defense-in-depth only (service-role key bypasses RLS).
- **Instantiating `OpenAIEmbeddings` in a constructor body:** The `OPENAI_EMBEDDING_MODEL` env var is only reliably available after `ConfigModule` initializes. Construct inside `onModuleInit()` to guarantee `ConfigService` is ready.
- **`pgvector.toSql()` omission:** Passing a raw `number[]` as a pg query parameter silently sends it as a text array `{1,2,3}` not as a vector literal. Always wrap with `pgvector.toSql(vector)`.
- **Skipping `pool.on('connect', pgvector.registerTypes):`** Without type registration, pg cannot deserialize vector query results back to `number[]` — results arrive as raw strings.
- **`confidence` increment without LEAST guard:** The `confidence` column has a `CHECK (confidence BETWEEN 0.0 AND 1.0)` constraint. Always use `LEAST(confidence + delta, 1.0)` in UPDATE statements.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Person name extraction from text | Custom regex `/(Mr\|Mrs\|Dr)?\s+[A-Z][a-z]+(\s+[A-Z][a-z]+)*/g` | `compromise` `nlp(text).people().out('array')` | Regex has ~30 edge cases (sentence-start capitals, acronyms, multi-word names, titles, possessives). compromise handles all of them with a POS tagger |
| Vector parameter serialization | `'[' + vector.join(',') + ']'` | `pgvector.toSql(vector)` | pg wire format for vectors requires specific literal formatting; `toSql` produces the correct format; hand-rolled formatting silently produces wrong results |
| HNSW search parameters | `SET hnsw.ef_search = 40` in application code | `search_user_memories()` Postgres function | `SET LOCAL` must be in the same transaction scope as the search; application-level SET would pollute the connection |
| OpenAI embeddings dimension validation | Embed a probe string and check `result.length` at startup | `onModuleInit()` checking `EMBEDDING_DIMS` env var against constant | Probe-based validation costs a real API call on every startup; env var check is instantaneous and deterministic |
| Connection pool | `new Client()` per query | `pg.Pool` in `DatabaseModule` | Pool reuse is essential for pgvector type registration to persist across queries; each `new Client()` would require re-registration |

**Key insight:** The most dangerous hand-roll in this phase is custom vector serialization. The silent failure mode (wrong format → postgres type coercion error at runtime, not compile time) makes it very hard to detect. Use `pgvector.toSql()` unconditionally.

---

## Common Pitfalls

### Pitfall 1: pgvector Types Not Registered on Pool Connections
**What goes wrong:** Vector query results arrive as raw strings like `"[0.12,0.34,...]"` instead of `number[]`. Or INSERT fails with `invalid input syntax for type vector`.
**Why it happens:** `pgvector.registerTypes(client)` must be called on each pool client individually. Calling it once on a single `Client` instance does not affect Pool-acquired clients.
**How to avoid:** Register in the pool's `connect` event: `pool.on('connect', (client) => pgvector.registerTypes(client))` — fires for every new connection checked out of the pool.
**Warning signs:** `typeof result.rows[0].embedding === 'string'` in tests; "invalid input syntax for type vector" Postgres error.

### Pitfall 2: EmbeddingService `this.embeddings` Used Before `onModuleInit`
**What goes wrong:** `embed()` throws `Cannot read properties of undefined (reading 'embedQuery')` because `this.embeddings` was initialized to `undefined!`.
**Why it happens:** If `embed()` is called during a lifecycle hook earlier than `onModuleInit` (e.g., during a module factory), the service is not yet ready.
**How to avoid:** Only call `embed()` from request handlers or lifecycle hooks that fire after `onModuleInit` (i.e., `onApplicationBootstrap` or later). Do not call `embed()` from `useFactory` providers.
**Warning signs:** TypeScript `!` non-null assertion on `embeddings` field with no initialization guard.

### Pitfall 3: Cosine Similarity Direction (Distance vs. Similarity)
**What goes wrong:** The 0.90 dedup threshold comparison fires incorrectly — either too aggressively (blocking distinct facts) or not at all (allowing duplicates).
**Why it happens:** pgvector's `<=>` operator returns **cosine distance** (0 = identical, 2 = opposite). The `search_user_memories` function returns `1 - (embedding <=> p_embedding)` as `similarity` (1 = identical, -1 = opposite). The threshold check in `upsertMemoryEntry` must compare `similarity >= 0.90`, not `distance <= 0.10`.
**How to avoid:** Always use the `similarity` column from `search_user_memories` (already converted from distance). Never apply the threshold to raw `<=>` output.
**Warning signs:** Test case with identical text inserts duplicate rows; threshold check math off by sign.

### Pitfall 4: `user_id` Filter Omission in people Aliases Query
**What goes wrong:** `lookupByNames` returns people from other users when names happen to collide.
**Why it happens:** The `aliases` overlap operator `&&` is easy to write without the `user_id = $1` clause when iterating.
**How to avoid:** Always write `WHERE user_id = $1` as the first condition in all queries. Code review checklist item.
**Warning signs:** Integration test with two users having a person named "Sarah" — one user's query returns the other user's Sarah.

### Pitfall 5: compromise ESM/CJS Interop with nodenext Module Resolution
**What goes wrong:** `import nlp from 'compromise'` fails at runtime with `ERR_REQUIRE_ESM` or `SyntaxError: The requested module 'compromise' does not provide an export named 'default'`.
**Why it happens:** `tsconfig.json` uses `"module": "nodenext"` and `"moduleResolution": "nodenext"`. compromise ships both ESM (`.js`) and CJS (`.cjs`) builds. The `nodenext` resolver picks the ESM build; some versions have interop issues.
**How to avoid:** Test the import during initial setup (`pnpm test` smoke test). If interop fails, use the namespace import: `import * as nlp from 'compromise'` or `const nlp = require('compromise')` inside a function. [ASSUMED — verify with actual import test; compromise v14 has historically had CJS/ESM split]
**Warning signs:** `pnpm test` fails with import error on compromise; NestJS startup error on the people.service module.

### Pitfall 6: `confidence` Column INCREMENT Violates CHECK Constraint
**What goes wrong:** `UPDATE memory_entries SET confidence = confidence + 0.05` throws `ERROR: new row violates check constraint "memory_entries_confidence_check"` when confidence is at 0.97 or higher.
**Why it happens:** The `confidence` column has `CHECK (confidence >= 0.0 AND confidence <= 1.0)`. Adding 0.05 to 0.97 = 1.02, which violates the constraint.
**How to avoid:** Always use `LEAST(confidence + 0.05, 1.0)` in UPDATE statements.
**Warning signs:** Any UPDATE of confidence without `LEAST()` guard; fails only on highly-reinforced memories.

---

## Code Examples

### DatabaseModule with pgvector type registration

```typescript
// Source: [VERIFIED: pgvector/pgvector-node README + context7 /nestjs/docs.nestjs.com]
// src/database/database.module.ts
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import pgvector from 'pgvector/pg';
import { PG_POOL } from './database.constants.js';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
        });
        pool.on('connect', (client) => {
          // Must be registered per-client for pgvector type coercion
          pgvector.registerTypes(client);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
```

### OpenAIEmbeddings with dimension validation

```typescript
// Source: [VERIFIED: context7 /websites/langchain OpenAIEmbeddings + docs.nestjs.com lifecycle]
// src/embedding/embedding.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';

@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(EmbeddingService.name);
  private embeddings!: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const model = this.config.getOrThrow<string>('OPENAI_EMBEDDING_MODEL');
    const dims = parseInt(this.config.getOrThrow<string>('EMBEDDING_DIMS'), 10);
    if (dims !== 1536) {
      throw new Error(
        `[EmbeddingService] EMBEDDING_DIMS mismatch: expected 1536, got ${dims}`,
      );
    }
    this.embeddings = new OpenAIEmbeddings({ model, dimensions: 1536 });
    this.logger.log(`Initialized model=${model} dims=1536`);
  }

  async embed(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }
}
```

### Calling search_user_memories Postgres function

```typescript
// Source: [VERIFIED: pgvector/pgvector-node README + live schema inspection 2026-04-15]
const result = await this.pool.query<MemorySearchResult>(
  `SELECT id, content, fact_type, confidence, last_reinforced_at, similarity
   FROM search_user_memories($1, $2, $3)`,
  [userId, pgvector.toSql(vector), topK],
);
```

### PeopleService detectNames

```typescript
// Source: [VERIFIED: compromise GitHub README — nlp().people().out('array')]
import nlp from 'compromise';

detectNames(text: string): string[] {
  return nlp(text).people().out('array') as string[];
}
```

### People upsert with ON CONFLICT

```typescript
// Source: [ASSUMED — ON CONFLICT (user_id, name) requires unique constraint on (user_id, name)]
// NOTE: Phase 1 migrations must be verified to have this unique constraint.
// If not present, the planner should add a migration in Wave 0.
await this.pool.query(
  `INSERT INTO people (user_id, name, facts)
   VALUES ($1, $2, $3)
   ON CONFLICT (user_id, name)
   DO UPDATE SET
     facts = people.facts || EXCLUDED.facts,
     updated_at = NOW()`,
  [userId, name, JSON.stringify(facts)],
);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@langchain/openai` v0.x (separate `embeddings` package) | `@langchain/openai` v1.x unified | Mid-2024 | Single package import; `OpenAIEmbeddings` is in `@langchain/openai` not a separate `@langchain/embeddings` package |
| pgvector type registration via `pg-types` hack | `pgvector.registerTypes(client)` | pgvector-node v0.2.x | Clean API; `pool.on('connect', ...)` pattern is the canonical approach |
| `compromise` v13.x with different API | `compromise` v14.x | 2023 | `nlp().people().out('array')` API has been stable in v14; v13 used different output methods |

**Deprecated/outdated:**
- `@langchain/embeddings` (separate package): Replaced by embedding classes in `@langchain/openai` directly. Do not install `@langchain/embeddings`.
- `embedDocuments()` for single texts: Use `embedQuery()` for a single `string → number[]`. `embedDocuments()` is for batches and returns `number[][]`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `upsertMemoryEntry` confidence increment delta of `+0.05` (clamped to 1.0) | Code Examples (Pattern 4) | Confidence behavior is functionally correct as long as LEAST guard is present; delta value is product decision, not a technical constraint |
| A2 | `people` table requires `UNIQUE (user_id, name)` constraint for `ON CONFLICT (user_id, name)` in `upsertPerson` | Code Examples | If this constraint does not exist in the Phase 1 migration, `ON CONFLICT` will throw a runtime error; planner must add a migration |
| A3 | compromise v14 ESM/CJS interop works under `"module": "nodenext"` tsconfig | Common Pitfalls #5 | If interop fails, need to test alternate import style or add `"compromise"` to `package.json` `imports` override |
| A4 | `nlp(text).people().out('array')` returns `string[]` with `.trim()`'d names without punctuation | Code Examples (Pattern 5) | If compromise returns names with surrounding whitespace or punctuation, `lookupByNames` query `name = ANY(...)` will fail silently (0 rows returned instead of error) |

---

## Open Questions (RESOLVED)

1. **Missing UNIQUE constraint on `people(user_id, name)`**
   - What we know: The Phase 1 migration for `people` does not show a `UNIQUE(user_id, name)` constraint in the live schema inspection (only `PRIMARY KEY` and B-tree `idx_people_user_id`).
   - What's unclear: Whether `upsertPerson` should use `ON CONFLICT (user_id, name)` (requires the constraint) or a manual SELECT-then-INSERT/UPDATE pattern.
   - Recommendation: Plan 02-03 should add a migration `20260415000007_people_unique_name.sql` adding `ALTER TABLE people ADD CONSTRAINT people_user_id_name_unique UNIQUE (user_id, name)` — or implement `upsertPerson` as SELECT-then-INSERT/UPDATE without relying on `ON CONFLICT`. The planner should decide which approach is preferred.

2. **compromise import style under nodenext**
   - What we know: `tsconfig.json` uses `"module": "nodenext"`. compromise v14 ships both ESM and CJS. The ESM build is the default under nodenext resolution.
   - What's unclear: Whether `import nlp from 'compromise'` works without additional config or requires `"compromise"` in tsconfig `paths` / package.json `imports`.
   - Recommendation: Plan 02-03 Wave 0 should include a 30-second smoke test: `node -e "import('compromise').then(m => console.log(typeof m.default))"` before writing PeopleService. If it fails, use `createRequire` CJS fallback.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All services | ✓ | v22.18.0 | — |
| pnpm | Package install | ✓ | 10.33.0 | — |
| Docker | DB + Redis | ✓ | 29.4.0 | — |
| PostgreSQL (via Docker) | MemoryService, PeopleService | ✓ | healthy (supabase/postgres:15.14.1.107) | — |
| pgvector extension | searchSimilar, upsertMemoryEntry | ✓ | 0.8.0 | — |
| Redis (via Docker) | Not needed until Phase 4 (BullMQ) | ✓ | redis:7.2-alpine healthy | — |
| HNSW indexes | search_user_memories fn | ✓ | Both idx_memory_entries_vector + idx_message_embeddings_vector live | — |
| search_user_memories fn | MemoryService.searchSimilar | ✓ | Verified in pg_proc | — |
| OPENAI_API_KEY | EmbeddingService (at runtime) | [ASSUMED] | Not verified — env var not in required list | Integration tests must mock; unit tests mock the service |

**Missing dependencies with no fallback:** None — all Phase 2 infrastructure dependencies are available.

**Missing dependencies with fallback:**
- `OPENAI_API_KEY`: Not listed in `REQUIRED_ENV_VARS` in main.ts. LangChain's `OpenAIEmbeddings` reads it from `process.env.OPENAI_API_KEY` automatically. The planner should add it to `REQUIRED_ENV_VARS` in main.ts and `.env.example`, or note it as a prerequisite.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm test` |
| Full suite command | `pnpm test:cov` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMBED-01 | EmbeddingModule is injectable; OpenAIEmbeddings constructed with correct model+dims | unit | `pnpm test -- src/embedding/embedding.service.spec.ts` | ❌ Wave 0 |
| EMBED-02 | `embed(text)` returns `number[]` (mock embedQuery) | unit | `pnpm test -- src/embedding/embedding.service.spec.ts` | ❌ Wave 0 |
| EMBED-03 | Startup throws when `EMBEDDING_DIMS !== 1536` | unit | `pnpm test -- src/embedding/embedding.service.spec.ts` | ❌ Wave 0 |
| MEM-01 | MemoryModule exports MemoryService and PeopleService | unit (module compile) | `pnpm test -- src/memory/memory.service.spec.ts` | ❌ Wave 0 |
| MEM-02 | `searchSimilar` calls `search_user_memories` fn SQL (not raw `<=>`) | unit (mock pool) | `pnpm test -- src/memory/memory.service.spec.ts` | ❌ Wave 0 |
| MEM-03 | `upsertMemoryEntry` inserts when similarity < 0.90; updates when >= 0.90 | unit (mock pool) | `pnpm test -- src/memory/memory.service.spec.ts` | ❌ Wave 0 |
| MEM-04 | `detectNames("I had lunch with Sarah and Tom")` returns `["Sarah", "Tom"]` | unit (real compromise) | `pnpm test -- src/memory/people.service.spec.ts` | ❌ Wave 0 |
| MEM-05 | `lookupByNames` SQL filters by user_id AND name/aliases | unit (mock pool) | `pnpm test -- src/memory/people.service.spec.ts` | ❌ Wave 0 |
| MEM-06 | All MemoryService/PeopleService queries include user_id filter (query string assert) | unit (mock pool) | `pnpm test -- src/memory/memory.service.spec.ts` `pnpm test -- src/memory/people.service.spec.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test` (full suite, 433ms baseline)
- **Per wave merge:** `pnpm test:cov`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/embedding/embedding.service.spec.ts` — covers EMBED-01, EMBED-02, EMBED-03
- [ ] `src/memory/memory.service.spec.ts` — covers MEM-01, MEM-02, MEM-03, MEM-06 (service side)
- [ ] `src/memory/people.service.spec.ts` — covers MEM-04, MEM-05, MEM-06 (people side)

All three spec files are new — no test infrastructure changes needed (vitest.config.ts already includes `src/**/*.spec.ts`).

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | userId injected from socket handshake (Phase 3); this phase receives userId as parameter |
| V3 Session Management | no | No session state in data layer services |
| V4 Access Control | yes | Explicit `WHERE user_id = $1` in every query; RLS as defense-in-depth |
| V5 Input Validation | yes | Parameterized pg queries (never string interpolation); `pgvector.toSql()` for vector params |
| V6 Cryptography | no | No cryptographic operations; embeddings are model outputs, not secrets |

### Known Threat Patterns for raw pg + NestJS

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via unparameterized query | Tampering | `pool.query(sql, [params])` — parameterized queries only; never string interpolation in SQL |
| Cross-user data leak via missing user_id filter | Information Disclosure | `WHERE user_id = $1` as mandatory first WHERE clause; unit tests assert query string includes user_id param |
| Vector dimension mismatch causing silent wrong results | Tampering | `onModuleInit` dimension validation throws on mismatch; `pgvector.toSql()` validates array type |
| pg Pool connection exhausted (DoS) | Denial of Service | `pg.Pool` default max=10; `connectionTimeoutMillis` to avoid indefinite blocking; not configured explicitly in this phase but monitored |

---

## Sources

### Primary (HIGH confidence)

- Context7 `/nestjs/docs.nestjs.com` — `@Global()` decorator, custom providers with `useFactory`, `OnModuleInit` lifecycle hook, `@Inject()` with Symbol tokens
- Context7 `/websites/langchain` — `OpenAIEmbeddings` constructor (`model`, `dimensions`), `embedQuery()` API, `embedDocuments()` vs `embedQuery()` distinction
- `pgvector/pgvector-node` GitHub README (fetched 2026-04-15) — `pgvector.registerTypes(client)`, `pool.on('connect', ...)` pattern, `pgvector.toSql(array)` usage
- `node-postgres.com/apis/pool` (fetched 2026-04-15) — `Pool` constructor, `pool.query()`, `connectionString` option
- Live database inspection (2026-04-15) — all 5 tables, both HNSW indexes, `search_user_memories` function body, `memory_entries` and `people` exact column types
- npm registry (2026-04-15) — package versions for pg, pgvector, @langchain/openai, @langchain/core, compromise

### Secondary (MEDIUM confidence)

- `compromise` GitHub README (via WebFetch 2026-04-15) — `.people().out('array')` API
- wanago.io NestJS raw pg tutorial — `CONNECTION_POOL` injection token pattern
- WebSearch NestJS custom provider pg patterns — confirmed Symbol token injection approach

### Tertiary (LOW confidence)

- `compromise` ESM/CJS interop under `"module": "nodenext"` — known category of issues with some ESM packages; not verified with a live import test

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all versions verified against npm registry 2026-04-15
- Architecture: HIGH — patterns sourced from official NestJS docs + live schema inspection
- Pitfalls: HIGH for DB/pgvector pitfalls (verified); MEDIUM for compromise import interop (assumed)

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable ecosystem; pgvector and LangChain APIs are stable)
