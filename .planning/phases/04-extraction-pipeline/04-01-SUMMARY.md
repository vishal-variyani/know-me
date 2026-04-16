---
phase: 04-extraction-pipeline
plan: "01"
subsystem: extraction
tags: [bullmq, redis, langgraph, queue, types]
dependency_graph:
  requires:
    - 03-chat-path (ExtractionService.enqueue call site in ChatGateway already exists)
  provides:
    - BullMQ queue infrastructure ('extraction' queue + WorkerHost processor)
    - ExtractionState, ExtractionJobPayload, PersonExtraction typed interfaces
    - AppModule BullModule.forRootAsync wired to REDIS_HOST + REDIS_PORT
  affects:
    - src/app.module.ts (BullModule.forRootAsync + ExtractionModule import added)
    - src/extraction/extraction.module.ts (BullModule.registerQueue + EmbeddingModule + MemoryModule)
    - src/extraction/extraction.service.ts (runGraph stub signature added)
tech_stack:
  added:
    - "@nestjs/bullmq 11.0.4"
    - "bullmq 5.74.1"
    - "ioredis 5.10.1"
    - "@langchain/langgraph 1.2.8"
  patterns:
    - BullMQ WorkerHost processor extending WorkerHost with @Processor decorator
    - BullModule.forRootAsync with ConfigService injection (mirrors DatabaseModule useFactory)
    - Interface-only types file (mirrors memory.types.ts)
key_files:
  created:
    - src/extraction/extraction.types.ts
    - src/extraction/extraction.processor.ts
  modified:
    - src/extraction/extraction.module.ts
    - src/app.module.ts
    - src/extraction/extraction.service.ts
    - package.json
    - pnpm-lock.yaml
decisions:
  - "correlationId added to ExtractionState (beyond D-21 spec) so node functions can log with BullMQ job ID (D-26) without threading it as a separate parameter"
  - "runGraph() stub added to ExtractionService now (not plan 04-04) to allow ExtractionProcessor to compile cleanly — plan 04-04 implements the body"
  - "ExtractionModule imports EmbeddingModule + MemoryModule now so plan 04-04's node implementations have their service dependencies available without module changes"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-04-16"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 5
---

# Phase 04 Plan 01: BullMQ Infrastructure Scaffold Summary

BullMQ queue wiring with typed ExtractionState/ExtractionJobPayload/PersonExtraction interfaces, ExtractionProcessor WorkerHost, and AppModule BullModule.forRootAsync reading REDIS_HOST + REDIS_PORT via ConfigService.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Install missing packages | b5ac582 | package.json, pnpm-lock.yaml |
| 2 | Create extraction.types.ts | 22bfd9d | src/extraction/extraction.types.ts |
| 3 | ExtractionProcessor + ExtractionModule + AppModule | 3ecaba1 | src/extraction/extraction.processor.ts, src/extraction/extraction.module.ts, src/app.module.ts, src/extraction/extraction.service.ts |

## Verification Results

```
all packages ok
export interface ExtractionState        ✓
export interface ExtractionJobPayload   ✓
export interface PersonExtraction       ✓
@Processor('extraction', { concurrency: 3 })  ✓
export class ExtractionProcessor extends WorkerHost  ✓
BullModule.forRootAsync                 ✓
ExtractionModule in AppModule           ✓
pnpm build exits 0                      ✓
```

## Deviations from Plan

### Auto-applied (within plan instructions)

**1. runGraph stub placement** — Plan Task 3 noted two options for making ExtractionProcessor compile: cast to `unknown` or add stub to ExtractionService. Applied the cleaner approach (stub method on ExtractionService) as the plan recommended, preserving the existing `enqueue()` signature exactly per D-28.

No bugs auto-fixed, no blocking issues encountered.

## Known Stubs

| File | Line | Stub | Resolved By |
|------|------|------|-------------|
| src/extraction/extraction.service.ts | 20-24 | `runGraph()` throws — not yet implemented | Plan 04-04 |
| src/extraction/extraction.service.ts | 7-16 | `enqueue()` logs only — no real BullMQ queue push | Plan 04-04 |

These stubs are intentional scaffolding. The ExtractionProcessor and type contracts are the deliverable of this plan; the graph implementation is plan 04-04's responsibility.

## Threat Flags

No new threat surface introduced beyond what is documented in the plan's threat model. Redis connection string (`REDIS_HOST`, `REDIS_PORT`) is read via `ConfigService.getOrThrow` and never logged — T-04-01-01 is mitigated.

## Self-Check: PASSED

Files verified:
- src/extraction/extraction.types.ts: FOUND
- src/extraction/extraction.processor.ts: FOUND
- src/extraction/extraction.module.ts: FOUND (modified)
- src/app.module.ts: FOUND (modified)
- src/extraction/extraction.service.ts: FOUND (modified)

Commits verified:
- b5ac582: FOUND (chore(04-01): install packages)
- 22bfd9d: FOUND (feat(04-01): extraction.types.ts)
- 3ecaba1: FOUND (feat(04-01): BullMQ infrastructure)
