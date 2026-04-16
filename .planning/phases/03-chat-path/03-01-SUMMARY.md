---
phase: 03-chat-path
plan: "01"
subsystem: retrieval
tags: [retrieval, hybrid-search, pgvector, nlp, promise-all, tdd]
dependency_graph:
  requires:
    - 02-02 (EmbeddingModule — EmbeddingService.embed)
    - 02-03 (MemoryModule — MemoryService.searchSimilar, PeopleService.detectNames/lookupByNames)
  provides:
    - RetrievalModule with RetrievalService.retrieve(text, userId): Promise<MemoryContext>
  affects:
    - 03-03 (ChatGateway imports RetrievalModule directly)
tech_stack:
  added: []
  patterns:
    - Promise.all for concurrent retrieval arms (semantic + people)
    - NestJS module wiring with EmbeddingModule + MemoryModule imports
    - TDD with vitest globals (no explicit vi import needed)
key_files:
  created:
    - src/retrieval/retrieval.types.ts
    - src/retrieval/retrieval.service.ts
    - src/retrieval/retrieval.module.ts
    - src/retrieval/retrieval.service.spec.ts
  modified: []
decisions:
  - "lookupByNames called with empty array when detectNames returns [] — no short-circuit at RetrievalService level; PeopleService.lookupByNames already guards empty array internally (returns [] immediately)"
metrics:
  duration_seconds: 84
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 03 Plan 01: RetrievalModule Summary

**One-liner:** Parallel hybrid retrieval layer combining pgvector cosine similarity (top-5) and compromise NLP named-entity lookup via Promise.all, fully unit-tested with all services mocked.

## What Was Built

The `src/retrieval/` directory implements the retrieval layer that ChatGateway will consume before every LLM call:

- `retrieval.types.ts` — `MemoryContext` interface (`{ memories: MemorySearchResult[], people: PersonRow[] }`)
- `retrieval.service.ts` — `RetrievalService.retrieve(text, userId)` orchestrating both arms concurrently
- `retrieval.module.ts` — NestJS module importing EmbeddingModule + MemoryModule, exporting RetrievalService
- `retrieval.service.spec.ts` — 4 unit tests covering RETR-01 through RETR-04 (all mocked)

## Task Completion

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for RetrievalService | 8a5ccf5 | src/retrieval/retrieval.service.spec.ts |
| 1 (GREEN) | RetrievalService types + implementation | a858509 | src/retrieval/retrieval.types.ts, src/retrieval/retrieval.service.ts |
| 2 | RetrievalModule wiring | fe2aae0 | src/retrieval/retrieval.module.ts |

## Architecture

`RetrievalService.retrieve(text, userId)` runs two arms concurrently inside `Promise.all`:

- **Arm 1 (semantic):** `EmbeddingService.embed(text)` → `MemoryService.searchSimilar(userId, vec, 5)` — pgvector cosine similarity top-5
- **Arm 2 (people):** `PeopleService.detectNames(text)` (synchronous) → `PeopleService.lookupByNames(names, userId)` — direct SQL lookup by name/aliases

Because `detectNames` is synchronous, it executes before `Promise.all` suspends on the embedding call — the people lookup begins immediately while the embedding network call is in-flight, maximizing concurrency.

## Verification Results

- `pnpm test --run src/retrieval/retrieval.service.spec.ts` — 4/4 tests pass
- `pnpm test --run` (full suite) — 36/36 tests pass, 6 test files
- `grep -r ': any' src/retrieval/` — empty (no any types)
- `grep -r 'console.' src/retrieval/` — empty (no console.log)
- `grep 'Promise.all' src/retrieval/retrieval.service.ts` — confirmed present

## TDD Gate Compliance

- RED gate: commit `8a5ccf5` — `test(03-01): add failing tests for RetrievalService`
- GREEN gate: commit `a858509` — `feat(03-01): implement RetrievalService with parallel hybrid retrieval`

Both gates satisfied.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — RetrievalService is fully implemented with real service dependencies (no hardcoded mock data flowing to callers).

## Threat Flags

No new security surface introduced. RetrievalService is an internal service; userId flows through from gateway's validated handshake only. Both downstream services (MemoryService, PeopleService) enforce `WHERE user_id = $1` scoping in their SQL queries.

## Self-Check: PASSED

Files confirmed present:
- src/retrieval/retrieval.types.ts — FOUND
- src/retrieval/retrieval.service.ts — FOUND
- src/retrieval/retrieval.module.ts — FOUND
- src/retrieval/retrieval.service.spec.ts — FOUND

Commits confirmed:
- 8a5ccf5 — RED test commit
- a858509 — GREEN implementation commit
- fe2aae0 — RetrievalModule commit
