---
phase: 04-extraction-pipeline
plan: "02"
subsystem: extraction
tags: [langgraph, classify, extract, zod, gpt-4o-mini, tdd]
dependency_graph:
  requires:
    - 04-01 (ExtractionState types, BullMQ infrastructure)
    - "@langchain/openai (ChatOpenAI.withStructuredOutput)"
    - "@langchain/core/prompts (ChatPromptTemplate)"
    - "zod (Zod schema validation)"
  provides:
    - makeClassifyNode factory (rule-based, synchronous, zero LLM cost)
    - makeExtractNode factory (GPT-4o-mini call with Zod-validated JSON output)
  affects:
    - src/extraction/nodes/classify.node.ts (new)
    - src/extraction/nodes/extract.node.ts (new)
tech_stack:
  added:
    - "zod 4.3.6 (explicit dep — was previously only a transitive dep of @langchain packages)"
  patterns:
    - "LangGraph node factory pattern: closure over deps, returns Partial<ExtractionState>"
    - "ChatPromptTemplate system/human message separation (T-04-02-02 prompt injection mitigation)"
    - "Zod withStructuredOutput for LLM output validation (T-04-02-01 tamper mitigation)"
    - "TDD RED/GREEN cycle per task"
key_files:
  created:
    - src/extraction/nodes/classify.node.ts
    - src/extraction/nodes/classify.node.spec.ts
    - src/extraction/nodes/extract.node.ts
    - src/extraction/nodes/extract.node.spec.ts
  modified:
    - package.json (zod added as explicit dependency)
    - pnpm-lock.yaml
decisions:
  - "Used word-splitting approach for proper noun detection instead of regex lookbehind — more readable and avoids variable-length lookbehind compat concerns in Node.js"
  - "mockLlm passed directly to makeExtractNode in tests (not via new ChatOpenAI()) — factory takes pre-built llm instance per D-27; no need to mock the class constructor"
  - "zod installed as explicit dep even though it was already a transitive dep — makes the dependency contract explicit and prevents breakage if langchain changes its internal deps"
metrics:
  duration: "~3 minutes"
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 2
---

# Phase 04 Plan 02: Classify and Extract Nodes Summary

Rule-based `makeClassifyNode` (zero LLM, synchronous) and GPT-4o-mini `makeExtractNode` (Zod schema, retry-then-absorb) as pure factory functions following the closure-over-deps pattern — both implemented TDD with full passing test suites.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 (RED) | Failing test for classifyNode | 621305e | src/extraction/nodes/classify.node.spec.ts |
| 1 (GREEN) | Implement makeClassifyNode | d846d7d | src/extraction/nodes/classify.node.ts |
| 2 (RED) | Failing test for extractNode | 091ab1f | src/extraction/nodes/extract.node.spec.ts |
| 2 (GREEN) | Implement makeExtractNode | 2579d5e | src/extraction/nodes/extract.node.ts, package.json, pnpm-lock.yaml |

## Verification Results

```
export function makeClassifyNode     ✓
shouldExtract in classify.node.ts    ✓
export function makeExtractNode      ✓
withStructuredOutput in extract.node ✓
ExtractOutputSchema in extract.node  ✓
EMPTY_RESULT in extract.node         ✓
classify.node.spec.ts — 12/12 pass   ✓
extract.node.spec.ts — 5/5 pass      ✓
No typed `any` in either file        ✓
pnpm build exits 0                   ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed zod as explicit dependency**
- **Found during:** Task 2 (GREEN) — first test run after writing extract.node.ts
- **Issue:** `import { z } from 'zod'` failed with "Failed to load url zod" — zod was only a transitive dep of `@langchain/openai`, not installed as a hoisted package accessible to application code
- **Fix:** `pnpm add zod` — added zod 4.3.6 as an explicit project dependency
- **Files modified:** package.json, pnpm-lock.yaml
- **Commit:** 2579d5e

**2. [Rule 1 - Bug] Fixed test mock to pass mockLlm directly instead of `{} as never`**
- **Found during:** Task 2 (GREEN) — tests failed with "llm.withStructuredOutput is not a function"
- **Issue:** Plan template used `{} as never` as the llm arg in tests; `makeExtractNode` calls `llm.withStructuredOutput(...)` at factory construction time — the mock needed to have that method
- **Fix:** Removed `@langchain/openai` vi.mock (unnecessary since we pass llm directly), built `mockLlm = { withStructuredOutput: vi.fn().mockReturnValue({ invoke: mockInvoke }) }` and passed it to `makeExtractNode(mockLlm, mockLogger)` in each test
- **Files modified:** src/extraction/nodes/extract.node.spec.ts

## TDD Gate Compliance

Both tasks followed the RED/GREEN cycle:

| Task | RED commit | GREEN commit |
|------|-----------|--------------|
| 1 (classifyNode) | 621305e `test(04-02): add failing test for classifyNode` | d846d7d `feat(04-02): implement makeClassifyNode` |
| 2 (extractNode) | 091ab1f `test(04-02): add failing test for extractNode` | 2579d5e `feat(04-02): implement makeExtractNode` |

RED gate confirmed: tests failed with "Failed to load url ./classify.node.js" and "Failed to load url ./extract.node.js" respectively before implementation files existed.

## Known Stubs

None — both node factories are fully implemented and tested. No placeholder values or TODO items.

## Threat Surface Review

All mitigations from the plan's threat model are implemented:

| Threat | Mitigation | Status |
|--------|-----------|--------|
| T-04-02-01: LLM JSON output tampering | `llm.withStructuredOutput(ExtractOutputSchema)` — Zod validation throws on malformed output, triggering D-06 retry-then-absorb | Implemented |
| T-04-02-02: Prompt injection | `['system', SYSTEM_PROMPT]` and `['human', '{content}']` as separate LangChain message roles | Implemented |
| T-04-02-03: Classify DoS | Rule-based, synchronous, O(n) — no external calls | By design |
| T-04-02-04: Error info disclosure | Errors logged via `logger.error(String(err))` — no user content in error strings | Implemented |

No new threat surface introduced beyond what the plan documents.

## Self-Check: PASSED

Files verified:
- src/extraction/nodes/classify.node.ts: FOUND
- src/extraction/nodes/classify.node.spec.ts: FOUND
- src/extraction/nodes/extract.node.ts: FOUND
- src/extraction/nodes/extract.node.spec.ts: FOUND

Commits verified:
- 621305e: FOUND (test(04-02): add failing test for classifyNode)
- d846d7d: FOUND (feat(04-02): implement makeClassifyNode)
- 091ab1f: FOUND (test(04-02): add failing test for extractNode)
- 2579d5e: FOUND (feat(04-02): implement makeExtractNode)
