---
phase: 02-core-data-layer
plan: 02
subsystem: database
tags: [nestjs, pg, pgvector, memory, vector-search, tdd, vitest]

# Dependency graph
requires:
  - phase: 02-01
    provides: PG_POOL Symbol injection token, @Global() DatabaseModule with pg Pool + pgvector type registration

provides:
  - MemoryService with CRUD methods (createConversation, addMessage, saveMessageEmbedding)
  - MemoryService.searchSimilar() delegating to search_user_memories Postgres function
  - MemoryService.upsertMemoryEntry() with 0.90 cosine similarity dedup gate (UPDATE vs INSERT)
  - memory.types.ts shared interfaces (MemorySearchResult, PersonRow, ConversationRow, ConversationMessageRow)
  - MemoryModule shell exporting MemoryService (PeopleService added in plan 03)

affects: [02-03-people-service, 03-chat-path, 04-extraction-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "@Inject(PG_POOL) for Symbol token injection — mandatory for non-class injection tokens"
    - "searchSimilar delegates to Postgres function search_user_memories — never raw <=> SQL"
    - "upsertMemoryEntry: similarity >= 0.90 triggers UPDATE (reinforce), < 0.90 triggers INSERT (new fact)"
    - "LEAST(confidence + 0.05, 1.0) guard prevents CHECK constraint violation on confidence column"
    - "pgvector.toSql(vector) wraps all vector parameters — 3 occurrences (saveMessageEmbedding, searchSimilar, upsertMemoryEntry INSERT)"
    - "user_id = $1 always first parameter in all parameterized queries"

key-files:
  created:
    - src/memory/memory.types.ts
    - src/memory/memory.service.ts
    - src/memory/memory.service.spec.ts
    - src/memory/memory.module.ts
  modified: []

key-decisions:
  - "searchSimilar calls search_user_memories Postgres function — never constructs raw pgvector <=> SQL at service layer"
  - "similarity threshold is 0.90 (>= check) — similarity field is already 1 - cosine_distance, not raw cosine distance"
  - "LEAST(confidence + 0.05, 1.0) is required — confidence column has CHECK (confidence BETWEEN 0.0 AND 1.0) constraint"
  - "MemoryModule exported MemoryService only in this plan — PeopleService intentionally deferred to plan 03"

patterns-established:
  - "Pattern: Symbol token injection via @Inject(PG_POOL) — required for non-class NestJS providers"
  - "Pattern: Postgres function delegation for vector search — service layer never writes raw vector SQL"
  - "Pattern: upsertMemoryEntry dedup gate — searchSimilar(userId, vector, 1) first, then branch on similarity >= 0.90"

requirements-completed: [MEM-01, MEM-02, MEM-03]

# Metrics
duration: 2min
completed: 2026-04-15
---

# Phase 02 Plan 02: MemoryService Summary

**MemoryService with pg Pool injection, searchSimilar via search_user_memories Postgres function, and upsertMemoryEntry 0.90 cosine similarity dedup gate (UPDATE last_reinforced_at + LEAST confidence guard vs INSERT)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-15T20:15:07Z
- **Completed:** 2026-04-15T20:16:35Z
- **Tasks:** 2 (Task 1: types, Task 2: TDD with 3 commits — test, feat, merged)
- **Files modified:** 4 created

## Accomplishments

- memory.types.ts defines 4 shared interfaces (MemorySearchResult, PersonRow, ConversationRow, ConversationMessageRow) with correct column types matching Phase 1 migrations — zero imports, pure interface file
- MemoryService implements all 5 methods: createConversation, addMessage, saveMessageEmbedding, searchSimilar (Postgres function delegation), upsertMemoryEntry (dedup gate with LEAST guard)
- All 22 tests pass — 7 new memory service tests covering both upsert branches, exact 0.90 boundary, topK=1 enforcement, and searchSimilar param validation

## Task Commits

Each task was committed atomically:

1. **Task 1: memory.types.ts — shared interface contracts** - `cad8633` (feat)
2. **Task 2 RED: failing tests for MemoryService** - `a194924` (test)
3. **Task 2 GREEN: MemoryService + MemoryModule implementation** - `4aef9e4` (feat)

_Note: Task 2 is TDD — test commit (RED) precedes implementation commit (GREEN)_

## Files Created/Modified

- `src/memory/memory.types.ts` — 4 shared interfaces: MemorySearchResult, PersonRow, ConversationRow, ConversationMessageRow; no imports
- `src/memory/memory.service.ts` — MemoryService with @Inject(PG_POOL), all CRUD methods, searchSimilar delegating to search_user_memories, upsertMemoryEntry with 0.90 dedup gate
- `src/memory/memory.service.spec.ts` — 7 unit tests covering searchSimilar params, upsertMemoryEntry both paths, exact boundary, topK=1 enforcement
- `src/memory/memory.module.ts` — MemoryModule shell exporting MemoryService (PeopleService added in plan 03)

## Decisions Made

- searchSimilar calls `search_user_memories($1, $2, $3)` Postgres function — enforces user_id isolation inside the function and at the caller. Raw `<=>` SQL is forbidden at the service layer.
- similarity >= 0.90 threshold: the `similarity` column from search_user_memories is already `1 - cosine_distance` (not raw distance), so threshold check is `>= 0.90` not `<= 0.10`.
- `LEAST(confidence + 0.05, 1.0)` is mandatory — the confidence column has `CHECK (confidence BETWEEN 0.0 AND 1.0)`; omitting the guard causes a Postgres error on well-reinforced memories.
- MemoryModule exports only MemoryService for now — PeopleService stub would be misleading; plan 03 owns that integration.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None — all verification checks passed on first implementation attempt.

## User Setup Required

None - no external service configuration required beyond env vars already present from Phase 1.

## Known Stubs

None — no stubs or placeholders introduced. MemoryModule is wired to MemoryService. The note "PeopleService will be added in plan 03" is an intentional deferral documented in the plan, not a stub.

## Threat Surface Scan

No new threat surface beyond the plan's threat model. All threat mitigations implemented:

- T-02-02-01 (Elevation of Privilege): Every query passes user_id as $1; searchSimilar enforces user_id inside search_user_memories Postgres function; unit tests verify userId is params[0].
- T-02-02-02 (Injection): All queries use parameterized $N placeholders; pgvector.toSql() serializes vectors safely; no string interpolation of user-supplied values.
- T-02-02-05 (DoS / confidence overflow): LEAST(confidence + 0.05, 1.0) prevents CHECK constraint violation.

## TDD Gate Compliance

RED gate: `a194924` — `test(02-02)` commit with failing tests (memory.service.ts absent)
GREEN gate: `4aef9e4` — `feat(02-02)` commit with passing implementation

Both gates satisfied. No REFACTOR pass needed — code is clean as written.

## Next Phase Readiness

- PeopleService (02-03) can use `@Inject(PG_POOL)` with same pattern, import PersonRow from memory.types.ts
- RetrievalService (Phase 3) can inject MemoryService via MemoryModule import
- ExtractionProcessor (Phase 4) can call upsertMemoryEntry directly
- No blockers for Phase 2 plan 03

---
*Phase: 02-core-data-layer*
*Completed: 2026-04-15*
