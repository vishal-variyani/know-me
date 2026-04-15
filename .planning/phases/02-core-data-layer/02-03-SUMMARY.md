---
phase: 02-core-data-layer
plan: 03
subsystem: memory
tags: [nestjs, pg, people, nlp, compromise, tdd, vitest, upsert, on-conflict]

# Dependency graph
requires:
  - phase: 02-01
    provides: PG_POOL Symbol injection token, @Global() DatabaseModule with pg Pool
  - phase: 02-02
    provides: PersonRow interface (memory.types.ts), MemoryModule shell, @Inject(PG_POOL) pattern

provides:
  - PeopleService.detectNames(text) — synchronous NLP via compromise .people().out('array')
  - PeopleService.lookupByNames(names, userId) — user-scoped SQL with name column + aliases array overlap
  - PeopleService.upsertPerson(name, userId, facts?) — single ON CONFLICT (user_id, name) DO UPDATE
  - UNIQUE constraint migration on people(user_id, name) — prerequisite for ON CONFLICT upsert
  - MemoryModule exporting both MemoryService and PeopleService
  - AppModule importing MemoryModule

affects: [03-chat-path, 04-extraction-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "compromise .people().out('array') for synchronous person name extraction from text"
    - "Empty-array short-circuit guard before pool.query in lookupByNames — no vacuous DB round-trip"
    - "WHERE user_id = $1 as first condition in all people queries — structural cross-user isolation"
    - "aliases && $2::text[] for Postgres array overlap (GIN index on aliases in Phase 1)"
    - "INSERT ... ON CONFLICT (user_id, name) DO UPDATE with jsonb merge (facts || EXCLUDED.facts)"
    - "JSON.stringify(facts) serializes JSONB parameter — no string interpolation of facts keys/values"

key-files:
  created:
    - supabase/migrations/20260415000007_people_unique_name.sql
    - src/memory/people.service.ts
    - src/memory/people.service.spec.ts
  modified:
    - src/memory/memory.module.ts
    - src/app.module.ts

key-decisions:
  - "detectNames is synchronous — compromise is a sync API; no async wrapper needed or wanted"
  - "lookupByNames empty-array guard returns [] before pool.query — prevents vacuous ANY($2) DB round-trip"
  - "facts || EXCLUDED.facts for jsonb merge — preserves existing facts while layering in new ones (not overwrite)"
  - "supabase db push deferred (CLI not in PATH) — migration file created; must be pushed before upsertPerson runs in production"

requirements-completed: [MEM-04, MEM-05, MEM-06]

# Metrics
duration: ~4min
completed: 2026-04-15
---

# Phase 02 Plan 03: PeopleService Summary

**PeopleService with compromise NLP detectNames, user-scoped SQL lookupByNames (name + aliases overlap), and single-query ON CONFLICT (user_id, name) DO UPDATE upsertPerson — completes Phase 2 data layer**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-15T20:15:30Z (worktree parallel execution)
- **Completed:** 2026-04-15T20:19:58Z
- **Tasks:** 3 (Task 0: migration, Task 1 TDD: 2 commits RED/GREEN, Task 2: wiring)
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- UNIQUE constraint migration `20260415000007_people_unique_name.sql` created — adds `people_user_id_name_unique UNIQUE (user_id, name)` enabling ON CONFLICT upsert
- PeopleService implements all three required methods with correct user_id scoping, aliases overlap detection, and single-query upsert
- 10 new unit tests added; full suite 32/32 passing
- MemoryModule now exports both MemoryService and PeopleService — Phase 3 RetrievalService can inject both
- AppModule imports MemoryModule — services are available application-wide

## Task Commits

Each task was committed atomically:

1. **Task 0: UNIQUE constraint migration** — `2e96473` (chore)
2. **Task 1 RED: failing PeopleService tests** — `b267ace` (test)
3. **Task 1 GREEN: PeopleService implementation** — `c8af68b` (feat)
4. **Task 2: Wire MemoryModule + AppModule** — `13281e8` (feat)

_Note: Task 1 is TDD — test commit (RED) precedes implementation commit (GREEN)_

## Files Created/Modified

- `supabase/migrations/20260415000007_people_unique_name.sql` — UNIQUE constraint DDL for people(user_id, name); must be pushed via `supabase db push` before upsertPerson runs in production
- `src/memory/people.service.ts` — PeopleService with @Inject(PG_POOL), detectNames (synchronous compromise NLP), lookupByNames (empty-array guard, user_id scoping, aliases overlap), upsertPerson (ON CONFLICT jsonb merge)
- `src/memory/people.service.spec.ts` — 10 unit tests covering all three methods, empty-array guard, user_id param position, query structure assertions
- `src/memory/memory.module.ts` — Added PeopleService to providers and exports arrays
- `src/app.module.ts` — Added MemoryModule to imports array

## Decisions Made

- `detectNames` is synchronous — compromise is a synchronous NLP library; no async wrapper needed
- `lookupByNames` empty-array guard returns `[]` before `pool.query` — prevents a vacuous `ANY($2)` DB call when no names were detected
- `facts || EXCLUDED.facts` jsonb merge — preserves existing person facts while layering in new ones; full overwrite would lose history
- Migration file created but `supabase db push` deferred — CLI not in PATH in this environment; noted as production prerequisite

## Deviations from Plan

**1. [Rule 3 - Blocking] supabase CLI not available**
- **Found during:** Task 0
- **Issue:** `supabase db push` returned `command not found: supabase`
- **Fix:** Created migration file as required; noted that `supabase db push` must be run before `upsertPerson` is exercised in production. Task 1 proceeded because the migration file's existence (not the pushed state) is what allows the unit tests to pass — unit tests mock the pool.
- **Impact:** No impact on unit tests; production deployment requires manual `supabase db push` before first use of upsertPerson

## TDD Gate Compliance

RED gate: `b267ace` — `test(02-03)` commit with failing tests (people.service.ts absent — import error confirmed)
GREEN gate: `c8af68b` — `feat(02-03)` commit with passing implementation (32/32 tests pass)

Both gates satisfied. No REFACTOR pass needed — implementation is clean as written.

## User Setup Required

Before using `upsertPerson` in production, run:
```bash
supabase db push
```
This applies migration `20260415000007_people_unique_name.sql` which adds the UNIQUE constraint required by ON CONFLICT.

## Known Stubs

None — all three PeopleService methods are fully implemented. No placeholder data, no TODO comments.

## Threat Surface Scan

All threat mitigations from the plan's threat register implemented:

- T-02-03-01 (cross-user people leak): `WHERE user_id = $1` is the first condition in lookupByNames; unit test `'scopes query to user_id — WHERE user_id = $1'` asserts this structurally.
- T-02-03-02 (lookupByNames injection): `$2::text[]` parameterization — pg handles array serialization; names never string-interpolated. Both `ANY($2::text[])` and `aliases && $2::text[]` are fully parameterized.
- T-02-03-03 (upsertPerson facts injection): `JSON.stringify(facts)` serializes to a JSON string inserted as jsonb literal. No interpolation of facts keys/values into SQL.
- T-02-03-04 (upsertPerson ON CONFLICT elevation): ON CONFLICT scoped to (user_id, name) unique constraint — user_id = $1 in INSERT VALUES prevents cross-user record collision.
- T-02-03-05 (detectNames disclosure): In-process NLP only; no data leaves server.
- T-02-03-06 (DoS large names array): Accepted — Phase 6 hardening concern.

No new threat surface introduced beyond the plan's threat model.

## Phase 2 Completion

Phase 2 data layer is now complete:

- [x] `EmbeddingService.embed("hello")` returns 1536-dim number[] — unit tested (plan 02-01)
- [x] Startup fails if `EMBEDDING_DIMS` != 1536 — unit tested (plan 02-01)
- [x] `MemoryService.searchSimilar()` calls search_user_memories — unit tested, no raw `<=>` SQL (plan 02-02)
- [x] `MemoryService.upsertMemoryEntry()` routes correctly at 0.90 threshold — unit tested (plan 02-02)
- [x] `PeopleService.detectNames("I had lunch with Sarah and Tom")` returns ["Sarah", "Tom"] — unit tested
- [x] `lookupByNames` scoped to user_id — unit tested
- [x] All services filter by user_id — structural enforcement in all queries
- [x] UNIQUE constraint on people(user_id, name) exists — migration 20260415000007 created (push pending)

## Self-Check: PASSED

Files exist:
- FOUND: supabase/migrations/20260415000007_people_unique_name.sql
- FOUND: src/memory/people.service.ts
- FOUND: src/memory/people.service.spec.ts

Commits exist:
- 2e96473 — chore(02-03): add UNIQUE constraint migration
- b267ace — test(02-03): add failing tests (RED)
- c8af68b — feat(02-03): implement PeopleService (GREEN)
- 13281e8 — feat(02-03): wire MemoryModule + AppModule

---
*Phase: 02-core-data-layer*
*Completed: 2026-04-15*
