---
phase: 04-extraction-pipeline
plan: "04"
subsystem: extraction
tags: [langgraph, bullmq, stategraph, extraction-service, integration]
dependency_graph:
  requires:
    - 04-01 (BullMQ queue, ExtractionProcessor, ExtractionState types)
    - 04-02 (makeClassifyNode, makeExtractNode)
    - 04-03 (makeValidateNode, makeStoreNode)
  provides:
    - Full ExtractionService: StateGraph compiled on startup, enqueue() pushes BullMQ job, runGraph() invokes graph
    - End-to-end extraction pipeline: ChatGateway → enqueue() → BullMQ → ExtractionProcessor → runGraph() → StateGraph → DB
  affects:
    - src/extraction/extraction.service.ts (stub replaced with full implementation)
tech_stack:
  added: []
  patterns:
    - LangGraph StateGraph wiring with conditional edges (Classify→END, Validate→END)
    - OnModuleInit for post-DI graph compilation (avoids constructor DI timing issues)
    - BullMQ enqueue with attempts: 3 + exponential backoff
    - try/catch re-throw pattern for EXTR-08 error boundary
key_files:
  created: []
  modified:
    - src/extraction/extraction.service.ts
decisions:
  - "Cast StateGraph builder to `any` for graph wiring — LangGraph TypeScript generics are overly strict about node name literals before addNode() is called; the cast is internal plumbing with no runtime impact"
  - "onModuleInit() used instead of constructor for graph compilation per D-27 — injected services (MemoryService, PeopleService, EmbeddingService) are not guaranteed initialized in constructors under NestJS DI"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-04-16"
  tasks_completed: 1
  tasks_total: 2
  files_created: 0
  files_modified: 1
---

# Phase 04 Plan 04: ExtractionService Full Implementation Summary

Full `ExtractionService` replacing the Phase 3 stub: LangGraph `StateGraph` compiled once in `onModuleInit()` wiring all four node factories, `enqueue()` pushing BullMQ jobs with retry/backoff, and `runGraph()` invoking the compiled graph with correlationId-tagged error boundaries for EXTR-08 retry behavior.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Replace ExtractionService stub with full implementation | e0ff41f | src/extraction/extraction.service.ts |

## Pending

| # | Name | Status |
|---|------|--------|
| 2 | checkpoint:human-verify — End-to-end pipeline verification | Awaiting human verification |

## Verification Results

```
InjectQueue present:                     ✓
StateGraph + graph.invoke present:       ✓
makeClassifyNode/Extract/Validate/Store: ✓
async enqueue() with attempts: 3:        ✓
async runGraph() with re-throw:          ✓
pnpm build exits 0:                      ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cast StateGraph builder to `any` to resolve LangGraph TS2345 type errors**
- **Found during:** Task 1 verification — `pnpm build` failed with 5 TS2345 errors on node name strings
- **Issue:** LangGraph's `StateGraph<T>` TypeScript generics only know `'__start__'` as a valid node name until nodes are added via `addNode()`. All string literals (`'classify'`, `'extract'`, `'validate'`, `'store'`) were rejected as not assignable to `'__start__'`.
- **Fix:** Cast the builder result of `new StateGraph<ExtractionState>(...)` to `any` for the graph wiring section. The plan's task description explicitly notes: "If LangGraph type errors appear in the StateGraph constructor or node additions, apply targeted `as never` casts on those specific lines."
- **Files modified:** src/extraction/extraction.service.ts
- **Commit:** e0ff41f (included in Task 1 commit)

## Known Stubs

None — `ExtractionService` is fully implemented. The pipeline is end-to-end wired pending the human-verify checkpoint approval.

## Threat Flags

No new threat surface beyond the plan's threat model. All T-04-04-* mitigations applied:

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-04-04-01: Repudiation | correlationId (BullMQ job ID) in all log calls via runGraph() | Implemented |
| T-04-04-02: DoS via runaway retries | attempts: 3, exponential backoff delay: 1000ms | Implemented |
| T-04-04-03: Model name disclosure | Only model name logged (not API key) | Implemented |
| T-04-04-04: userId spoofing | userId passes through to parameterized DB queries unchanged | By design |
| T-04-04-05: Graph node order tampering | Node order enforced by compiled graph edges; deterministic | By design |

## Self-Check: PASSED

Files verified:
- src/extraction/extraction.service.ts: FOUND (153 lines, full implementation)

Commits verified:
- e0ff41f: FOUND (feat(04-04): implement ExtractionService with StateGraph and BullMQ enqueue)
