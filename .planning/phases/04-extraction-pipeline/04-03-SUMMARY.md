---
phase: 04-extraction-pipeline
plan: "03"
subsystem: extraction
tags: [langgraph, validate-node, store-node, fact-type, migration, tdd]
dependency_graph:
  requires:
    - 04-01 (ExtractionState, PersonExtraction types)
    - 02-core-data-layer (MemoryService, PeopleService, EmbeddingService)
  provides:
    - makeValidateNode: deterministic normalization + filtering factory
    - makeStoreNode: people + memory entry persistence factory
    - Updated FactType: 'fact' | 'preference' | 'relationship' | 'emotion'
    - Migration: memory_entries CHECK constraint updated to new enum
  affects:
    - src/memory/memory.types.ts (FactType narrowed to 4 values)
    - supabase/migrations/ (new constraint migration)
tech_stack:
  added: []
  patterns:
    - LangGraph node factory pattern (closure over Logger + services, pure function)
    - TDD RED/GREEN cycle for validate node (7 tests)
    - Per-item error handling in store loop (partial write over abort)
    - SQL back-fill before DROP CONSTRAINT to handle existing rows
key_files:
  created:
    - src/extraction/nodes/validate.node.ts
    - src/extraction/nodes/validate.node.spec.ts
    - src/extraction/nodes/store.node.ts
    - supabase/migrations/20260416000000_fact_type_constraint.sql
  modified:
    - src/memory/memory.types.ts
decisions:
  - "EXTR-07 (HIGH-confidence-only storage) satisfied by treating all keyFacts[] as implicitly HIGH confidence — LLM prompt instructs significant-facts-only extraction; no explicit confidence field needed in v1"
  - "D-19 embedding storage interpretation: MemoryService.upsertMemoryEntry() stores embeddings inline in memory_entries.embedding (Phase 2 established pattern); message_embeddings is for message-level retrieval, not memory_entry embeddings"
  - "Per-item error catching in storeNode loops: one person/fact failure should not abort remaining writes; BullMQ retry is for catastrophic (uncaught) failures only"
  - "Migration uses safe two-step: back-fill old values to nearest new enum, then DROP/ADD constraint; prevents constraint rejection of existing rows"
metrics:
  duration: "~4 minutes"
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
---

# Phase 04 Plan 03: Validate Node, Store Node, FactType Update Summary

Deterministic Validate node with honorific stripping, pronoun filtering, within-batch dedup, and relationship synonym mapping; async Store node calling PeopleService.upsertPerson + EmbeddingService.embed + MemoryService.upsertMemoryEntry; FactType narrowed to 4-value enum with safe back-fill migration.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing tests for makeValidateNode | dbadee1 | src/extraction/nodes/validate.node.spec.ts |
| 1 (GREEN) | Implement makeValidateNode | 50a07e4 | src/extraction/nodes/validate.node.ts |
| 2 | Update FactType, migration, makeStoreNode | eb6a3c9 | src/memory/memory.types.ts, supabase/migrations/20260416000000_fact_type_constraint.sql, src/extraction/nodes/store.node.ts |

## Verification Results

```
FactType updated:      export type FactType = 'fact' | 'preference' | 'relationship' | 'emotion'  ✓
Migration:             DROP CONSTRAINT IF EXISTS memory_entries_fact_type_check                   ✓
                       ADD CONSTRAINT memory_entries_fact_type_check CHECK (...)                   ✓
                       Back-fill: fact_type IN ('event','belief','goal','habit') → 'fact'          ✓
Validate node:         export function makeValidateNode                                            ✓
                       FILTERED_NAMES, RELATIONSHIP_SYNONYMS, normalizePeople                     ✓
Store node:            export function makeStoreNode                                               ✓
                       upsertPerson, upsertMemoryEntry, embeddingService.embed                    ✓
Tests:                 7/7 passing                                                                 ✓
TypeScript:            No errors on non-spec production files                                      ✓
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all functions are fully implemented. validate.node.ts and store.node.ts are production-ready node factories.

## Threat Flags

No new threat surface beyond the plan's threat model. All T-04-03-* mitigations applied:

- T-04-03-01: FILTERED_NAMES set blocks pronoun injection into people table via validateNode
- T-04-03-02: PeopleService.upsertPerson uses parameterized queries; name never interpolated into SQL
- T-04-03-04: Migration back-fills with exact literals `WHERE fact_type IN (...)`; DROP IF EXISTS is idempotent
- T-04-03-05: userId from ExtractionState originates from BullMQ payload validated upstream; used verbatim in parameterized queries

## Self-Check: PASSED

Files verified:
- src/extraction/nodes/validate.node.ts: FOUND
- src/extraction/nodes/validate.node.spec.ts: FOUND
- src/extraction/nodes/store.node.ts: FOUND
- supabase/migrations/20260416000000_fact_type_constraint.sql: FOUND
- src/memory/memory.types.ts: FOUND (modified)

Commits verified:
- dbadee1: FOUND (test(04-03): add failing tests for makeValidateNode)
- 50a07e4: FOUND (feat(04-03): implement makeValidateNode)
- eb6a3c9: FOUND (feat(04-03): update FactType, add migration, implement makeStoreNode)

## TDD Gate Compliance

- RED gate: test(04-03) commit dbadee1 exists — 7 failing tests confirmed before implementation
- GREEN gate: feat(04-03) commit 50a07e4 exists — all 7 tests passing after implementation
