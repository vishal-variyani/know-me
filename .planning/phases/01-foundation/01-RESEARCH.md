# Phase 1: Foundation - Research

**Researched:** 2026-04-15
**Domain:** NestJS 11 dev tooling, Docker Compose, pgvector HNSW migrations, env validation
**Confidence:** HIGH (stack and patterns verified against npm registry, official docs, and authoritative sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Use `supabase/postgres` as the Postgres image — matches Supabase cloud environment exactly; pgvector is pre-bundled; migrations via `supabase db push` will behave identically locally and in production
- **D-02:** Lean setup — postgres + redis only; no Supabase Studio, no GoTrue, no Realtime services; DB managed via psql or any Postgres client

### Claude's Discretion
- Vitest smoke test structure (whether to convert existing `app.controller.spec.ts` or create a new dedicated DI smoke test; what assertions prove NestJS DI resolves with SWC)
- Exact Postgres port mapping and Redis version pin in docker-compose.yml
- Volume names and healthcheck configuration for docker-compose.yml
- Env validation implementation — plain if-checks vs declarative schema; format of startup error message
- TypeScript strict scope — INFRA-03 requires `noImplicitAny: true`; any additional strict flags should be added only if the existing scaffold compiles cleanly under them
- Migration file naming convention and directory structure under `supabase/migrations/`
- RLS helper function style (using `auth.uid()` vs explicit `user_id` parameter in policies)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | Remove Jest scaffold (jest, ts-jest, @types/jest, jest config block) and replace with Vitest 2.x + unplugin-swc + @swc/core | Confirmed removable packages; Vitest 2.1.9 is latest stable 2.x; unplugin-swc 1.5.9 auto-reads tsconfig |
| INFRA-02 | `vitest.config.ts` with SWC plugin emitting `decoratorMetadata: true` — NestJS DI resolves in tests | unplugin-swc reads `emitDecoratorMetadata` from tsconfig.json automatically; no separate .swcrc needed |
| INFRA-03 | `tsconfig.json` updated to `noImplicitAny: true` | Flag is `false` in existing scaffold; existing minimal scaffold should compile cleanly with it flipped |
| INFRA-04 | Docker Compose with Supabase PostgreSQL + pgvector AND Redis | `supabase/postgres` image includes pgvector (extension must be CREATE EXTENSION'd); Redis 7.2+ Alpine for BullMQ |
| INFRA-05 | `main.ts` uses `IoAdapter` from `@nestjs/platform-socket.io` | `app.useWebSocketAdapter(new IoAdapter(app))` pattern confirmed; packages at v11.1.19 |
| INFRA-06 | Env validation before `NestFactory.create()` — throws on missing vars | Synchronous guard pattern confirmed; 9 required vars documented |
| INFRA-07 | `@nestjs/config` with `ConfigModule.forRoot({ isGlobal: true })` | Package at 4.0.4; confirmed global config pattern |
| DB-01 | `conversations` table with RLS scoped to `user_id` | Standard Postgres RLS pattern; `USING (user_id = auth.uid())` |
| DB-02 | `conversation_messages` table with RLS scoped to `user_id` | Same RLS pattern |
| DB-03 | `message_embeddings` table with `embedding vector(1536)` and HNSW index | `CREATE INDEX ... USING hnsw ... WITH (m=16, ef_construction=64)` confirmed syntax |
| DB-04 | `people` table with `aliases text[]`, `facts jsonb`, RLS scoped to `user_id` | Standard Postgres column types |
| DB-05 | `memory_entries` table with HNSW index; `supersedes uuid NULL` FK | Complex table; HNSW syntax confirmed |
| DB-06 | `search_user_memories` function with `iterative_scan = relaxed_order` and `ef_search = 40` | `SET LOCAL` inside function body confirmed; pgvector 0.8.0 introduced iterative_scan |
| DB-07 | B-tree index on `user_id` for all tables | Standard `CREATE INDEX ... ON ... (user_id)` |
</phase_requirements>

---

## Summary

Phase 1 establishes the complete development infrastructure for a NestJS 11 conversational memory backend. It touches four non-overlapping areas: test toolchain migration (Jest to Vitest with SWC), Docker Compose for local Postgres+pgvector+Redis, Supabase CLI migrations for five tables with vector search capabilities, and application bootstrap hardening (env validation + WebSocket adapter).

The test migration is the most nuanced task. Vitest 2.x (latest stable: 2.1.9) changed the default pool to `forks` and broke `singleThread` in pool options — the correct current pattern uses `pool: 'forks'` or `pool: 'threads'` explicitly. The `unplugin-swc` plugin (1.5.9) auto-reads `emitDecoratorMetadata` from the existing `tsconfig.json`, meaning no separate `.swcrc` file is needed. The Jest scaffold removal requires purging both `devDependencies` and the `jest` config block from `package.json`, plus deleting `test/jest-e2e.json`.

The pgvector HNSW migration pattern is well-established. The `search_user_memories` function should use `SET LOCAL hnsw.iterative_scan = 'relaxed_order'` and `SET LOCAL hnsw.ef_search = 40` inside a transaction-scoped function body, with an explicit `user_id` parameter to enforce user isolation at the function level (not relying solely on RLS, which can be bypassed by service-role key). pgvector 0.8.0+ is required for iterative_scan; the `supabase/postgres` image ships pgvector 0.8.0.

**Primary recommendation:** Use `unplugin-swc` with `pool: 'forks'` for Vitest; the plugin auto-inherits decorator metadata from tsconfig, making no `.swcrc` needed. Use explicit `user_id` parameter in `search_user_memories` rather than relying solely on `auth.uid()` — this project connects via service role key which bypasses RLS.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Test execution | CI / Dev machine | — | No runtime tier; pure toolchain |
| Database schema + migrations | Database | — | DDL lives in supabase/migrations; applied via CLI |
| Local services (Postgres, Redis) | Docker (local) | — | docker-compose.yml provides both; no cloud dependency for development |
| Env validation | API / Backend (bootstrap) | — | Must run before NestFactory creates any service |
| WebSocket adapter wiring | API / Backend (bootstrap) | — | IoAdapter registered in main.ts before app.listen |
| pgvector HNSW search function | Database | — | Postgres function encapsulates ef_search tuning and user isolation |

---

## Standard Stack

### Core (Phase 1)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 2.1.9 | Test runner replacing Jest | Vite-native; ESM-first; Jest-compatible API; 2.x is stable LTS-equivalent |
| unplugin-swc | 1.5.9 | SWC transform plugin for Vitest | Required because esbuild (Vitest default) does not support `emitDecoratorMetadata`; NestJS DI depends on it |
| @swc/core | 1.15.26 | SWC compiler core | Peer dependency of unplugin-swc |
| @nestjs/config | 4.0.4 | Config/env management | Official NestJS package; `ConfigService.getOrThrow()` is the project standard |
| @nestjs/platform-socket.io | 11.1.19 | Socket.io adapter for NestJS | Official adapter; provides `IoAdapter` class |
| @nestjs/websockets | 11.1.19 | WebSocket abstractions | Peer dep of platform-socket.io |
| socket.io | 4.8.3 | WebSocket transport | Transitive dep via platform-socket.io |
| supabase (CLI) | 2.91.1 | Migration management | `supabase db push --db-url` applies migrations to local or remote Postgres |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @vitest/coverage-v8 | 4.1.4 | Coverage reporting | When coverage runs are needed (not required in Phase 1) |
| vite-tsconfig-paths | latest | Resolve `@/` path aliases in Vitest | Only if tsconfig path aliases are added |

### Packages to REMOVE (Jest scaffold)

All of the following are currently in `devDependencies` and must be removed:

```
jest          @types/jest      ts-jest
```

Also remove the `jest` config block from `package.json` and delete `test/jest-e2e.json`.

The `test:debug` and `test:e2e` scripts in `package.json` reference Jest internals — update or remove them.

**Version verification:** All versions confirmed via `npm view` against registry on 2026-04-15. [VERIFIED: npm registry]

### Installation

```bash
# Remove Jest
pnpm remove jest @types/jest ts-jest

# Install Vitest + SWC
pnpm add -D vitest@2.1.9 unplugin-swc @swc/core @vitest/coverage-v8

# Install NestJS Config + WebSockets
pnpm add @nestjs/config @nestjs/websockets @nestjs/platform-socket.io

# Install Supabase CLI (dev only)
pnpm add -D supabase
```

---

## Architecture Patterns

### System Architecture Diagram

```
Dev machine
│
├─ pnpm test ──────────────────────────────────────────────────────────►
│                                                                       │
│   vitest.config.ts                                           Vitest runner
│       └── plugins: [swc.vite()]                                       │
│               └── reads tsconfig.json                                 │
│                   (emitDecoratorMetadata:true)                        │
│                                                                       ▼
│                                                         Test files (*.spec.ts)
│                                                          @nestjs/testing module
│                                                          NestJS DI resolves via
│                                                          SWC-emitted metadata
│
├─ docker compose up -d ───────────────────────────────────────────────►
│                                                                       │
│   docker-compose.yml                                     supabase/postgres:15.x
│       ├── db: supabase/postgres                          (pgvector 0.8.0 bundled)
│       └── redis: redis:7.2-alpine                                     │
│                                                          redis:7.2-alpine
│
├─ supabase db push --db-url <url> ───────────────────────────────────►
│                                                                       │
│   supabase/migrations/                                   Postgres DB
│       ├── 0001_conversations.sql                                      │
│       ├── 0002_messages.sql                              5 tables created
│       ├── 0003_embeddings.sql                           HNSW indexes applied
│       ├── 0004_people.sql                               B-tree indexes applied
│       ├── 0005_memory_entries.sql                       RLS enabled + policies
│       └── 0006_search_functions.sql                     search_user_memories fn
│
└─ pnpm start ─────────────────────────────────────────────────────────►
    │
    main.ts                                                Bootstrap sequence
        │                                                               │
        ├── validateEnv()  ←── throws before NestFactory.create()      │
        │   (9 required vars)                                           │
        ├── NestFactory.create(AppModule)                               │
        │   └── AppModule imports ConfigModule.forRoot({isGlobal:true}) │
        └── app.useWebSocketAdapter(new IoAdapter(app))                 │
            └── app.listen(3000)                         Socket.io clients can connect
```

### Recommended Project Structure (post-Phase-1)

```
know-me/
├── src/
│   ├── app.module.ts          # imports ConfigModule globally
│   └── main.ts                # validateEnv() + IoAdapter + listen
├── supabase/
│   ├── config.toml            # created by supabase init
│   └── migrations/
│       ├── 20260415000001_conversations.sql
│       ├── 20260415000002_conversation_messages.sql
│       ├── 20260415000003_message_embeddings.sql
│       ├── 20260415000004_people.sql
│       ├── 20260415000005_memory_entries.sql
│       └── 20260415000006_search_functions.sql
├── test/
│   └── app.e2e-spec.ts        # converted to Vitest (remove jest-e2e.json)
├── docker-compose.yml
├── vitest.config.ts
├── tsconfig.json              # noImplicitAny: true
└── .env.example               # all 9 required vars documented
```

### Pattern 1: Vitest Config with unplugin-swc for NestJS

**What:** Configure Vitest to use SWC for TypeScript compilation so `emitDecoratorMetadata` is preserved — required for NestJS DI container to resolve constructor parameter types.

**When to use:** Any NestJS project using Vitest. esbuild (Vitest default) does NOT support `emitDecoratorMetadata`.

**Why `pool: 'forks'`:** Vitest 2.x changed the default to `forks` for stability. The old `poolOptions.threads.singleThread` option was broken in Vitest 2.x. `forks` is the safe default for Node.js server-side code.

```typescript
// vitest.config.ts
// Source: https://blog.ablo.ai/jest-to-vitest-in-nestjs + npm:unplugin-swc README
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',        // Vitest 2.x default; stable for NestJS
  },
  plugins: [
    swc.vite({
      // unplugin-swc auto-reads emitDecoratorMetadata and experimentalDecorators
      // from tsconfig.json — no .swcrc needed
      module: { type: 'nodenext' },  // match tsconfig "module": "nodenext"
    }),
  ],
});
```

**Key insight:** `unplugin-swc` maps `tsconfig.compilerOptions.emitDecoratorMetadata` → `jsc.transform.decoratorMetadata` and `experimentalDecorators` → `jsc.transform.legacyDecorator` automatically. [VERIFIED: npm:unplugin-swc README via WebFetch]

### Pattern 2: NestJS DI Smoke Test (Vitest)

**What:** Convert the existing `app.controller.spec.ts` to Vitest syntax. The existing test is structurally identical to a Vitest test — only the import path changes (no `@types/jest` needed when `globals: true` is set in vitest.config.ts).

```typescript
// src/app.controller.spec.ts
// After migration — identical structure, Jest globals work via vitest globals:true
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  it('should return "Hello World!"', () => {
    expect(appController.getHello()).toBe('Hello World!');
  });
});
```

If `NestFactory.create` (or `Test.createTestingModule`) throws, it means SWC metadata is not being emitted — the test failure itself diagnoses the DI problem.

### Pattern 3: Env Validation Before Bootstrap

**What:** Synchronous guard that reads `process.env` before NestFactory is called. Throws with the name of the missing variable.

**When to use:** Required by INFRA-06. Must be a synchronous check (cannot be async) because it runs before any NestJS bootstrapping.

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

const REQUIRED_ENV_VARS = [
  'ANTHROPIC_MODEL',
  'OPENAI_EXTRACTION_MODEL',
  'OPENAI_EMBEDDING_MODEL',
  'EMBEDDING_DIMS',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL',
  'REDIS_HOST',
  'REDIS_PORT',
] as const;

function validateEnv(): void {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      throw new Error(
        `[Bootstrap] Missing required environment variable: ${key}`
      );
    }
  }
}

async function bootstrap() {
  validateEnv(); // throws before NestFactory.create if any var missing

  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

[CITED: NestJS docs ConfigModule validation pattern + WebSocket adapter pattern]

### Pattern 4: Docker Compose (lean — Postgres + Redis only)

**What:** Two-service compose file per D-02. Uses `supabase/postgres` image for pgvector parity with production.

```yaml
# docker-compose.yml
services:
  db:
    image: supabase/postgres:15.14.1.107
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.2-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
  redisdata:
```

[ASSUMED] The exact `supabase/postgres` tag `15.14.1.107` is the latest stable per the GitHub repo at research time; verify with `docker pull supabase/postgres --dry-run` or check Docker Hub tags before use.

### Pattern 5: pgvector Extension Enable (migration prerequisite)

pgvector is bundled in `supabase/postgres` but must be enabled before vector columns can be created:

```sql
-- Must be the FIRST migration or in a preamble
CREATE EXTENSION IF NOT EXISTS vector;
```

### Pattern 6: HNSW Index Creation

```sql
-- Source: https://github.com/pgvector/pgvector (verified)
-- m=16 and ef_construction=64 are the defaults AND the required values per DB-03/DB-05

CREATE INDEX CONCURRENTLY idx_message_embeddings_vector
  ON message_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX CONCURRENTLY idx_memory_entries_vector
  ON memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

Note: `CONCURRENTLY` is optional in a fresh migration but is best practice for production.

### Pattern 7: search_user_memories Postgres Function

```sql
-- Source: pgvector docs + pgvector 0.8.0 release notes
-- iterative_scan requires pgvector >= 0.8.0 (included in supabase/postgres 15.x)
CREATE OR REPLACE FUNCTION search_user_memories(
  p_user_id   uuid,
  p_embedding vector(1536),
  p_top_k     integer DEFAULT 5
)
RETURNS TABLE (
  id                uuid,
  content           text,
  fact_type         text,
  confidence        float,
  last_reinforced_at timestamptz,
  similarity        float
)
LANGUAGE plpgsql
SECURITY INVOKER   -- runs as caller; service-role key bypasses RLS anyway
AS $$
BEGIN
  -- Set query-time HNSW parameters for this function call only
  SET LOCAL hnsw.ef_search = 40;
  SET LOCAL hnsw.iterative_scan = 'relaxed_order';

  RETURN QUERY
    SELECT
      me.id,
      me.content,
      me.fact_type::text,
      me.confidence,
      me.last_reinforced_at,
      1 - (me.embedding <=> p_embedding) AS similarity
    FROM memory_entries me
    WHERE
      me.user_id = p_user_id
      AND me.is_active = true
    ORDER BY me.embedding <=> p_embedding
    LIMIT p_top_k;
END;
$$;
```

**Critical note on SECURITY INVOKER vs SECURITY DEFINER:** Because this app connects via service-role key (which bypasses RLS), both options are equivalent at runtime. `SECURITY INVOKER` is the safer default — it does not elevate privileges. The explicit `WHERE me.user_id = p_user_id` clause enforces user isolation at the function level regardless. [CITED: Supabase RLS docs + pgvector GitHub]

### Pattern 8: RLS Policies

The app uses service-role key, which bypasses RLS. The CONTEXT.md notes "RLS helper function style (using `auth.uid()` vs explicit `user_id` parameter)" is Claude's discretion. For this use case, `auth.uid()` is irrelevant because the service-role key caller is not authenticated via Supabase Auth.

**Recommended approach:** Enable RLS on all tables (for defence-in-depth), but write policies that also support future direct client access:

```sql
-- Enable RLS (required even if service-role bypasses it)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- Policy for future direct client access (not used by service-role)
CREATE POLICY "users_own_conversations"
  ON conversations
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

### Anti-Patterns to Avoid

- **Using esbuild with NestJS decorators:** esbuild does not support `emitDecoratorMetadata`. Without SWC, `Test.createTestingModule().compile()` silently creates services with `undefined` injected deps instead of throwing, making bugs hard to trace.
- **`singleThread: true` in Vitest 2.x:** This option is silently ignored in Vitest 2.x (GitHub issue #6090). Use `pool: 'forks'` instead.
- **`supabase start` for lean local dev:** `supabase start` pulls the entire Supabase stack (Studio, GoTrue, Realtime, etc). Per D-02, the plan is docker-compose directly. Use `supabase db push --db-url` to apply migrations to the docker-compose postgres.
- **`SECURITY DEFINER` search function without explicit user_id param:** A SECURITY DEFINER function that reads user context from session variables can be trivially exploited if called without the variable set. Always pass `p_user_id` as an explicit parameter.
- **Using `SET` (session-level) instead of `SET LOCAL` (transaction-level):** Session-level `SET` persists across connection pool reuse, contaminating subsequent queries. Always use `SET LOCAL` inside function bodies.
- **`CREATE EXTENSION vector` in a migration that creates vector columns:** The extension must be enabled before any `vector` column type is referenced. Use a separate preamble migration or ensure extension creation is the first statement.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript transform for tests | Custom tsc wrapper | `unplugin-swc` | SWC handles decorator metadata; esbuild does not; custom wrappers miss edge cases |
| Config validation | Custom env parsing class | Plain if-checks in validateEnv() | Schema libraries (Joi, Zod) add deps for something trivially solved with a loop; INFRA-06 requires throwing with the var name — a loop does this in 8 lines |
| WebSocket adapter | Custom ws server | `IoAdapter` from `@nestjs/platform-socket.io` | NestJS gateway decorators only work with official adapters |
| Vector index management | Hand-crafted SQL with raw cosine math | pgvector `<=>` operator + HNSW index | HNSW provides O(log n) ANN search; hand-rolled sequential scan is O(n) |
| Migration tracking | Custom migration table | `supabase db push` | Supabase CLI handles idempotent tracking via `supabase_migrations.schema_migrations` |

**Key insight:** In this phase, simplicity beats cleverness. The env validation loop, the IoAdapter one-liner, and the supabase CLI are all the "complex" solution already solved by existing tooling.

---

## Common Pitfalls

### Pitfall 1: Vitest Tests Pass Without SWC Actually Working
**What goes wrong:** NestJS `Test.createTestingModule().compile()` may succeed but return a module where injected dependencies are `undefined` because decorator metadata was not emitted — no error is thrown at compile time.
**Why it happens:** Without `emitDecoratorMetadata`, TypeScript erases constructor parameter type information. NestJS DI falls back silently to `undefined` for unresolved types in some configurations.
**How to avoid:** Write the smoke test to actually call a service method that depends on a provider (e.g., `appController.getHello()`) — this will fail if DI is broken. Don't just assert the module compiles.
**Warning signs:** Provider appears in the module but calling a method returns `undefined` or throws "Cannot read properties of undefined".

### Pitfall 2: `supabase db push` Requires Docker Even for Remote Targets
**What goes wrong:** `supabase db push --db-url` starts a local ephemeral Postgres container to diff schemas before pushing. On a machine without Docker, the command fails even though the target is a remote database.
**Why it happens:** The Supabase CLI uses Docker to run a shadow database for the diff process.
**How to avoid:** Verify `docker compose version` works before using `supabase db push`. Since Docker is not currently available on this machine, migrations can alternatively be applied with `psql -f migration.sql` directly.
**Warning signs:** Error messages referencing "shadow database" or Docker daemon not running.

### Pitfall 3: pgvector Extension Not Loaded Before Vector Column Migration
**What goes wrong:** `CREATE TABLE ... (embedding vector(1536))` fails with "type vector does not exist".
**Why it happens:** pgvector is bundled but not pre-loaded in `supabase/postgres`. The extension must be explicitly enabled.
**How to avoid:** The first migration (or a preamble SQL block) must be `CREATE EXTENSION IF NOT EXISTS vector;`. Run this before any table that uses `vector` type.
**Warning signs:** Migration fails on the line defining the vector column, not on the index creation.

### Pitfall 4: `iterative_scan` Requires pgvector >= 0.8.0
**What goes wrong:** `SET LOCAL hnsw.iterative_scan = 'relaxed_order'` throws "unrecognized configuration parameter" on older pgvector.
**Why it happens:** `iterative_scan` was added in pgvector 0.8.0 (released 2024-10-30). Older Supabase images may ship 0.7.x.
**How to avoid:** Use `supabase/postgres:15.14.1.107` or later — this ships pgvector 0.8.0. Verify with `SELECT extversion FROM pg_extension WHERE extname = 'vector';` after migration.
**Warning signs:** SQL error on `SET LOCAL hnsw.iterative_scan`; extversion shows `0.7.x`.

### Pitfall 5: Jest Config Block Left in package.json
**What goes wrong:** Even after removing jest from devDependencies, the `jest` config block in package.json causes confusion. Some IDEs and CI runners pick it up and attempt to use Jest.
**Why it happens:** NestJS scaffold places jest config inline in package.json rather than a separate file.
**How to avoid:** Remove the entire `"jest": { ... }` block from package.json. Also remove the scripts: `test:watch` (jest --watch), `test:cov` (jest --coverage), `test:debug` (ts-node + jest), `test:e2e` (jest --config). Replace with vitest equivalents.
**Warning signs:** `pnpm test` works but `pnpm test:watch` fails with "jest: command not found".

### Pitfall 6: tsconfig `module: nodenext` + Vitest
**What goes wrong:** With `"module": "nodenext"`, ES module resolution is strict. Some Vitest config patterns that work with CommonJS `require()` break under NodeNext.
**Why it happens:** NodeNext requires explicit `.js` extensions on relative imports and enforces ESM semantics.
**How to avoid:** Pass `module: { type: 'nodenext' }` to `swc.vite()` options in vitest.config.ts to match the existing tsconfig. This is non-default but matches the project's existing tsconfig.
**Warning signs:** "Cannot find module" errors with relative imports that are missing `.js` extensions.

---

## Code Examples

### Complete vitest.config.ts

```typescript
// Source: https://blog.ablo.ai/jest-to-vitest-in-nestjs (verified pattern)
// + unplugin-swc README (auto-reads tsconfig)
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    pool: 'forks',
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
  },
  plugins: [
    swc.vite({
      module: { type: 'nodenext' }, // match tsconfig.json "module": "nodenext"
    }),
  ],
});
```

### Updated package.json scripts

```json
{
  "scripts": {
    "build": "nest build",
    "format": "prettier --write \"src/**/*.ts\" \"test/**/*.ts\"",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage"
  }
}
```

### ConfigModule.forRoot in AppModule

```typescript
// Source: https://github.com/nestjs/docs.nestjs.com (verified)
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,   // makes ConfigService injectable everywhere without re-importing
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

### supabase init and db push workflow

```bash
# Initialize supabase directory (creates supabase/config.toml)
npx supabase init

# Apply migrations to local docker-compose postgres
npx supabase db push --db-url "postgresql://postgres:postgres@localhost:5432/postgres"

# Verify pgvector loaded
psql postgresql://postgres:postgres@localhost:5432/postgres \
  -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"

# Verify tables exist
psql postgresql://postgres:postgres@localhost:5432/postgres -c "\d"
```

### Enabling pgvector (migration preamble)

```sql
-- 20260415000000_enable_extensions.sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";  -- for uuid_generate_v4() if used
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ts-jest for NestJS tests | unplugin-swc + Vitest | 2023–2024 | Much faster test execution; no more ts-jest config complexity |
| IVFFlat indexes for pgvector | HNSW indexes | pgvector 0.5.0+ | Better recall, no need to specify lists or probes; HNSW is now the recommended default |
| `pool: 'threads', singleThread: true` in Vitest | `pool: 'forks'` | Vitest 2.0 | `singleThread` was silently broken in v2; `forks` is the stable default |
| Session-level `SET hnsw.ef_search` | `SET LOCAL hnsw.ef_search` inside function | pgvector 0.8.0 best practice | Prevents parameter leakage across connection pool reuse |

**Deprecated/outdated:**
- `ts-jest`: Replaced by `unplugin-swc` for SWC-based transformation. Still works but significantly slower.
- `@types/jest`: No longer needed when Vitest `globals: true` is set; remove from devDependencies.
- `ivfflat` indexes: IVFFlat requires `VACUUM ANALYZE` and probe tuning; HNSW is better for this use case.
- `poolOptions.threads.singleThread`: Silently ignored in Vitest 2.x (issue #6090); use `pool: 'forks'` instead.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `supabase/postgres:15.14.1.107` is the latest stable tag that includes pgvector 0.8.0 | Pattern 4: Docker Compose | Wrong tag may result in pgvector < 0.8.0 and `iterative_scan` failure; verify with `docker pull` and `SELECT extversion` |
| A2 | `module: { type: 'nodenext' }` in swc.vite() options is the correct way to match tsconfig `"module": "nodenext"` | Pattern 1: Vitest Config | Wrong module type could cause import resolution failures; test run will reveal immediately |
| A3 | The existing minimal scaffold (`AppController`, `AppService`) compiles cleanly with `noImplicitAny: true` | INFRA-03 | If implicit any errors exist in the scaffold, they must be fixed before proceeding to later phases |

---

## Open Questions (RESOLVED)

1. **Docker availability on target machine**
   - What we know: `docker` is not available in the current shell environment (PATH does not include Docker CLI)
   - What's unclear: Is Docker Desktop installed but not in PATH? Is this a CI/dev machine without Docker?
   - Recommendation: Have developer verify `docker compose version` before starting Plan 01-02. If Docker is unavailable, migrations can be applied via direct psql against any accessible Postgres.
   - RESOLVED: Plan 01-02 Task 1 includes a Docker-unavailable fallback note; Plan 01-03 Task 2 provides Option B (direct psql path). Developer checkpoint gates the schema push.

2. **supabase/postgres tag to pin**
   - What we know: Repo shows latest as `15.14.1.107`; pgvector 0.8.0 is included in 15.x builds
   - What's unclear: Docker Hub may have a more recent patch tag
   - Recommendation: At docker-compose authoring time, check `docker pull supabase/postgres` to confirm the latest tag. Pin an explicit tag — do not use `latest`.
   - RESOLVED: Plans pin `supabase/postgres:15.14.1.107` explicitly in docker-compose.yml.

3. **supabase init requirement**
   - What we know: `supabase db push --db-url` requires a `supabase/` directory initialized by `supabase init`
   - What's unclear: Whether `supabase init` must be run first or if the migrations directory can be created manually
   - Recommendation: Run `npx supabase init` as the first step of Plan 01-03; it creates `supabase/config.toml` and `supabase/migrations/` directory.
   - RESOLVED: Plan 01-03 Task 1 runs `pnpm exec supabase init --force 2>/dev/null || true` as its first step.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All plans | ✓ | v22.18.0 | — |
| pnpm | All plans | ✓ | 10.33.0 | — |
| Docker + Docker Compose | Plan 01-02 | ✗ | — | Apply migrations via psql directly; run Postgres natively |
| supabase CLI | Plan 01-03 | ✗ | — | Install via `pnpm add -D supabase` (npm package wraps binary) |
| psql | Plan 01-03 (verify) | ✗ | — | Use any Postgres client (TablePlus, DBeaver, etc.) |

**Missing dependencies with no fallback:**
- Docker is required to run `docker compose up -d` for Plan 01-02. If Docker Desktop is not installed on the developer machine, it must be installed before Plan 01-02 can execute. There is no code-only fallback for running Postgres + Redis locally.

**Missing dependencies with fallback:**
- supabase CLI: installable as a dev dependency via pnpm (`pnpm add -D supabase`); this is the intended installation method for local-only CLI tools.
- psql: migrations can be verified via any Postgres client or via the supabase CLI itself (`supabase db push` reports applied migrations).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 |
| Config file | `vitest.config.ts` (Wave 0 gap — does not exist yet) |
| Quick run command | `pnpm test` (runs `vitest run`) |
| Full suite command | `pnpm test` (same in Phase 1; only unit/smoke tests exist) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INFRA-01 | No jest references in package.json | manual audit | `grep -r "jest" package.json tsconfig.json` | N/A |
| INFRA-02 | NestJS DI resolves in Vitest with SWC | unit/smoke | `pnpm test` | ❌ Wave 0 — convert `src/app.controller.spec.ts` |
| INFRA-03 | noImplicitAny: true compiles without errors | build check | `pnpm build` | N/A |
| INFRA-04 | Docker containers healthy | smoke/manual | `docker compose ps` | N/A |
| INFRA-05 | Socket.io client can connect | manual smoke | Connect with socket.io-client | N/A |
| INFRA-06 | Missing env var throws descriptive error | unit | `pnpm test` | ❌ Wave 0 — add `src/main.spec.ts` for validateEnv |
| INFRA-07 | ConfigService injectable | unit (covered by INFRA-02 smoke) | `pnpm test` | ❌ Wave 0 |
| DB-01–07 | Tables + indexes + function exist | manual SQL | `\d` in psql + `SELECT extversion` | N/A |

### Sampling Rate
- **Per task commit:** `pnpm test`
- **Per wave merge:** `pnpm test && pnpm build`
- **Phase gate:** `pnpm test` green + `pnpm build` clean + `docker compose ps` shows healthy + `supabase db push` applies without errors

### Wave 0 Gaps
- [ ] `vitest.config.ts` — must exist before any `pnpm test` invocation
- [ ] `src/app.controller.spec.ts` — convert from Jest to Vitest (remove `@types/jest` import, rely on vitest globals)
- [ ] `src/main.spec.ts` (optional but recommended) — test `validateEnv()` throws with specific missing var name

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in Phase 1 |
| V3 Session Management | No | No sessions in Phase 1 |
| V4 Access Control | Partial | RLS on all 5 tables; service-role key bypasses by design |
| V5 Input Validation | Partial | Env var presence check at bootstrap |
| V6 Cryptography | No | No crypto operations in Phase 1 |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential leakage via .env committed to git | Information Disclosure | Add `.env` to `.gitignore`; provide `.env.example` with all 9 var names and placeholder values |
| RLS disabled on table | Elevation of Privilege | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` in every migration |
| SECURITY DEFINER function leaking cross-user data | Elevation of Privilege | Use `SECURITY INVOKER` + explicit `WHERE user_id = p_user_id` parameter; never rely on session context |
| pgvector index scan returning wrong-user results | Tampering | Explicit `WHERE me.user_id = p_user_id` in `search_user_memories` — not delegated to RLS |

---

## Sources

### Primary (HIGH confidence)
- `/vitest-dev/vitest` (Context7) — vitest config, pool options, migration guide
- `https://github.com/pgvector/pgvector` — HNSW index syntax, ef_search, iterative_scan
- `https://github.com/nestjs/docs.nestjs.com` (Context7) — ConfigModule, IoAdapter, WebSockets
- `https://v2.vitest.dev/guide/migration` — Vitest 2.0 breaking changes (pool defaults, singleThread)
- npm registry (`npm view`) — all package versions verified 2026-04-15

### Secondary (MEDIUM confidence)
- `https://blog.ablo.ai/jest-to-vitest-in-nestjs` — vitest.config.ts pattern for NestJS + SWC; verified against unplugin-swc README
- `https://www.postgresql.org/about/news/pgvector-080-released-2952/` — iterative_scan introduced in 0.8.0
- `https://github.com/supabase/postgres` — supabase/postgres image supports PG 15 and 17; pgvector 0.8.0 bundled (extension requires explicit CREATE EXTENSION)
- `https://supabase.com/docs/reference/cli/supabase-db-push` — `--db-url` flag for external postgres

### Tertiary (LOW confidence)
- `supabase/postgres` exact latest Docker Hub tag — verify at authoring time; A1 in Assumptions Log

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all package versions verified against npm registry on 2026-04-15
- Architecture: HIGH — patterns verified from official NestJS and pgvector docs
- Pitfalls: HIGH — several sourced from open GitHub issues (Vitest #6090) and official docs warnings
- Docker image tag: LOW — supabase/postgres exact tag needs runtime verification

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (packages move fast; re-verify vitest and supabase/postgres tag before use)
