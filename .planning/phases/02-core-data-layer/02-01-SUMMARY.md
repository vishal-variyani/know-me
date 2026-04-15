---
phase: 02-core-data-layer
plan: 01
subsystem: database
tags: [nestjs, pg, pgvector, langchain, openai, embeddings, pool, injectable]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: NestJS scaffold, ConfigModule.forRoot with isGlobal:true, Vitest+SWC test runner

provides:
  - PG_POOL Symbol injection token (database.constants.ts)
  - "@Global() DatabaseModule with pg Pool provider; pgvector types registered on every pool connection"
  - EmbeddingModule exporting EmbeddingService
  - EmbeddingService.onModuleInit() — throws on EMBEDDING_DIMS != 1536
  - EmbeddingService.embed(text) — delegates to OpenAIEmbeddings.embedQuery(text)

affects: [02-02-memory-service, 02-03-people-service, 03-chat-path, 04-extraction-pipeline]

# Tech tracking
tech-stack:
  added:
    - pg (PostgreSQL client pool)
    - pgvector (vector type registration for pg)
    - "@langchain/openai (OpenAIEmbeddings)"
    - "@langchain/core"
    - compromise (NLP, installed for 02-03 use)
    - "@types/pg"
  patterns:
    - "@Global() DatabaseModule — downstream services inject PG_POOL without importing DatabaseModule"
    - "Pool provider via useFactory with ConfigService.getOrThrow (no fallbacks for DB URL)"
    - "pool.on('connect') hook for per-client pgvector type registration before first query"
    - "OnModuleInit for deferred initialization (not constructor) — ConfigService is ready at init"
    - "private embeddings! with non-null assertion — initialized in onModuleInit, never in constructor"
    - "All local imports use .js extension (tsconfig module: nodenext)"

key-files:
  created:
    - src/database/database.constants.ts
    - src/database/database.module.ts
    - src/embedding/embedding.service.ts
    - src/embedding/embedding.module.ts
    - src/embedding/embedding.service.spec.ts
  modified:
    - src/app.module.ts
    - package.json
    - pnpm-lock.yaml

key-decisions:
  - "PG_POOL as Symbol (not class) for injection token — prevents accidental class-based resolution, follows NestJS custom token convention"
  - "OnModuleInit (not constructor) for EmbeddingService initialization — ConfigService is not ready at construction time in some module resolution orders"
  - "private embeddings! non-null assertion — guarantees TypeScript correctness while deferring instantiation to init phase"
  - "EMBEDDING_DIMS validation at startup — fail-fast rather than silent wrong-dimension embeddings in production"
  - "No imports array in EmbeddingModule — ConfigService available globally via ConfigModule.forRoot({ isGlobal: true })"

patterns-established:
  - "Pattern: @Global() + Symbol token for pool injection — MemoryService/PeopleService inject PG_POOL directly"
  - "Pattern: OnModuleInit validation guard — strict env var checks at module init time, not at call site"
  - "Pattern: .js extensions on all local imports under nodenext module resolution"

requirements-completed: [EMBED-01, EMBED-02, EMBED-03]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 02 Plan 01: DatabaseModule + EmbeddingModule Summary

**@Global() pg Pool with per-connection pgvector type registration + EmbeddingService wrapping OpenAIEmbeddings with fail-fast EMBEDDING_DIMS=1536 validation at startup**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-15T20:11:30Z
- **Completed:** 2026-04-15T20:13:00Z
- **Tasks:** 2
- **Files modified:** 8 (5 created, 3 modified including package.json/lockfile)

## Accomplishments

- DatabaseModule is @Global() and exports PG_POOL Symbol — MemoryService and PeopleService can inject Pool without importing DatabaseModule
- pgvector types are registered on every new pool client via pool.on('connect') hook, preventing vector type coercion bypass
- EmbeddingService throws `[EmbeddingService] EMBEDDING_DIMS mismatch: expected 1536, got N` at startup if EMBEDDING_DIMS != 1536
- All 15 tests pass (11 pre-existing + 4 new embedding unit tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: DatabaseModule — global pg Pool with pgvector type registration** - `028bdf6` (feat)
2. **Task 2: EmbeddingService — OpenAIEmbeddings wrapper with OnModuleInit dimension validation** - `e8b94db` (feat)

## Files Created/Modified

- `src/database/database.constants.ts` — PG_POOL Symbol injection token
- `src/database/database.module.ts` — @Global() NestJS module providing pg Pool with pgvector type registration
- `src/embedding/embedding.service.ts` — EmbeddingService with OnModuleInit dims validation and embed() delegation
- `src/embedding/embedding.module.ts` — NestJS module exporting EmbeddingService
- `src/embedding/embedding.service.spec.ts` — 4 unit tests covering no-throw/throw scenarios and embed() delegation
- `src/app.module.ts` — Added DatabaseModule and EmbeddingModule to imports array
- `package.json` — Added pg, pgvector, @langchain/openai, @langchain/core, compromise, @types/pg
- `pnpm-lock.yaml` — Updated lock file

## Decisions Made

- Used Symbol for PG_POOL injection token (not a class) — NestJS convention for non-class providers, prevents accidental resolution
- OnModuleInit for EmbeddingService initialization — ConfigService is fully ready at init time; constructor injection is too early
- Non-null assertion `embeddings!` — TypeScript strict mode compliance; runtime safety guaranteed by OnModuleInit validation guard
- EmbeddingModule has no imports array — ConfigService flows from globally registered ConfigModule, no need to re-import

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — pgvector import `import pgvector from 'pgvector/pg'` verified working before writing module code.

## User Setup Required

None - no external service configuration required beyond env vars already covered by Phase 1 (.env.example includes DATABASE_URL, OPENAI_EMBEDDING_MODEL, EMBEDDING_DIMS).

## Known Stubs

None — no stubs or placeholders introduced. Both modules are fully wired.

## Threat Surface Scan

No new threat surface beyond what is documented in the plan's threat model. DATABASE_URL is consumed only via `config.getOrThrow` — not logged anywhere. No console.log present.

## Next Phase Readiness

- MemoryService (02-02) can inject `@Inject(PG_POOL) private readonly pool: Pool` directly — DatabaseModule is global
- PeopleService (02-03) same pattern
- Both services can call `embeddingService.embed(text)` by injecting EmbeddingService from EmbeddingModule
- No blockers for Phase 2 plans 02 and 03

---
*Phase: 02-core-data-layer*
*Completed: 2026-04-15*
