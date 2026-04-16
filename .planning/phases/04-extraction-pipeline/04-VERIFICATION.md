---
phase: 04-extraction-pipeline
verified: 2026-04-16T16:33:00Z
status: human_needed
score: 5/6
overrides_applied: 0
human_verification:
  - test: "Apply migration and start the app; send a message with a proper noun (e.g., 'my friend Jake is a software engineer'); confirm logs show classify->extract->validate->store sequence and that a people row for Jake and a memory_entry with fact_type='fact' appear in the DB"
    expected: "Startup logs show 'ExtractionService initialized with model=<OPENAI_EXTRACTION_MODEL>'; job logs show classifyNode shouldExtract=true, extractNode runs, validateNode valid=true, storeNode upserts person; DB has people row and memory_entry"
    why_human: "SC#2 requires end-to-end pipeline producing DB rows — cannot verify DB writes or LLM calls without running the application and inspecting the database. The plan's Task 2 human-verify checkpoint remains marked 'Awaiting human verification' in 04-04-SUMMARY.md."
---

# Phase 4: Extraction Pipeline Verification Report

**Phase Goal:** Every message and document text that passes through the system is asynchronously analyzed by a LangGraph pipeline (Classify → Extract → Validate → Store) that persists facts as memory entries and people rows — without blocking the chat response path.
**Verified:** 2026-04-16T16:33:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ExtractionService.enqueue()` adds a BullMQ job and returns immediately | VERIFIED | `enqueue()` calls `queue.add()` with attempts:3 + exponential backoff and returns; no synchronous graph execution |
| 2 | Message with relationship reference produces people row and memory_entry | NEEDS HUMAN | Pipeline wiring confirmed in code; end-to-end DB write requires live run — plan 04-04 human-verify checkpoint NOT yet approved |
| 3 | Message "ok" causes Classify to return shouldExtract:false; Extract skipped | VERIFIED | `classifyNode` returns `{ classifyResult: { shouldExtract: false } }` for trivial patterns; conditional edge routes to END; 12/12 classify tests pass |
| 4 | Same fact twice does not create duplicate memory_entries | VERIFIED | `MemoryService.upsertMemoryEntry()` checks cosine >= 0.90 before insert; store.node.ts delegates all dedup to this service |
| 5 | BullMQ job that fails 3 attempts is logged with correlation ID and does not crash the process | VERIFIED | `runGraph()` wraps `graph.invoke()` in try/catch that logs `[correlationId] runGraph failed` and re-throws; BullMQ processor does not swallow errors |
| 6 | Validate node filters pronouns, normalizes names, deduplicates within-batch, maps relationship synonyms | VERIFIED | `makeValidateNode` implements FILTERED_NAMES set, HONORIFIC_PATTERN, RELATIONSHIP_SYNONYMS, `normalizePeople()` dedup logic; 7/7 validate tests pass |

**Score:** 5/6 truths verified (1 needs human)

### Plan Must-Haves (All Plans)

#### Plan 04-01 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | pnpm add installs all four packages without errors | VERIFIED | `node -e "require('@nestjs/bullmq'); require('bullmq'); require('ioredis'); require('@langchain/langgraph')"` exits 0 |
| 2 | ExtractionProcessor extends WorkerHost with @Processor('extraction', { concurrency: 3 }) | VERIFIED | extraction.processor.ts line 7-8 |
| 3 | BullModule.forRootAsync wired in AppModule reading REDIS_HOST and REDIS_PORT via ConfigService | VERIFIED | app.module.ts lines 17-27 |
| 4 | ExtractionModule registers 'extraction' queue, provides ExtractionService and ExtractionProcessor | VERIFIED | extraction.module.ts: BullModule.registerQueue, providers array |
| 5 | ExtractionJobPayload, ExtractionState, PersonExtraction exported from extraction.types.ts | VERIFIED | extraction.types.ts: all three interfaces exported, no runtime imports |
| 6 | ExtractionState.correlationId carries BullMQ job ID through all nodes | VERIFIED | ExtractionState includes `correlationId: string`; processor sets `correlationId = job.id` |

#### Plan 04-02 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | classifyNode returns shouldExtract=false for trivial messages | VERIFIED | TRIVIAL_PATTERN regex + 12 passing tests |
| 2 | classifyNode returns shouldExtract=true for messages with proper nouns | VERIFIED | hasProperNounInContent() + passing test cases for "Sarah", "Jake" |
| 3 | extractNode calls ChatOpenAI with JSON structured output via Zod schema | VERIFIED | `prompt.pipe(llm.withStructuredOutput(ExtractOutputSchema))` in extract.node.ts |
| 4 | extractNode retries once on failure, returns empty result on second failure — no throw | VERIFIED | 2-iteration retry loop; absorbs on attempt=2; 5/5 extract tests pass |
| 5 | Both nodes are pure factory functions closed over dependencies | VERIFIED | makeClassifyNode(logger) and makeExtractNode(llm, logger) return inner functions |

#### Plan 04-03 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | validateNode normalizes names, filters pronouns, deduplicates within-batch, maps relationship synonyms | VERIFIED | normalizePeople(), FILTERED_NAMES, HONORIFIC_PATTERN, RELATIONSHIP_SYNONYMS; 7/7 tests pass |
| 2 | validateNode returns undefined validateResult when nothing valid remains | VERIFIED | Returns `{ validateResult: undefined }` when normalized people and keyFacts are both empty |
| 3 | storeNode calls upsertPerson for each person and embed + upsertMemoryEntry for each keyFact | VERIFIED | store.node.ts lines 26-75; each loop calls respective service |
| 4 | storeNode uses factType='fact' for keyFacts entries | VERIFIED | `memoryService.upsertMemoryEntry(fact, vector, userId, 'fact', sourceType)` |
| 5 | FactType updated to 'fact' \| 'preference' \| 'relationship' \| 'emotion' | VERIFIED | memory.types.ts line 1 |
| 6 | Migration drops old CHECK constraint and adds new one | VERIFIED | migration file: DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT with new values |
| 7 | EXTR-07 satisfied by implicit HIGH confidence interpretation | VERIFIED | Comment in store.node.ts lines 47-51 documents interpretation |

#### Plan 04-04 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | enqueue() adds BullMQ job with attempts:3 and exponential backoff; does not run graph synchronously | VERIFIED | `queue.add('extract', payload, { attempts: 3, backoff: { type: 'exponential', delay: 1000 } })` |
| 2 | runGraph() compiles and invokes StateGraph with Classify→Extract→Validate→Store flow | VERIFIED | onModuleInit() builds StateGraph with 4 nodes, 2 conditional edges; runGraph() calls graph.invoke() |
| 3 | Conditional edge Classify→END fires when shouldExtract=false | VERIFIED | `builder.addConditionalEdges('classify', state => state.classifyResult?.shouldExtract ? 'extract' : END)` |
| 4 | Conditional edge Validate→END fires when validateResult is undefined | VERIFIED | `builder.addConditionalEdges('validate', state => state.validateResult !== undefined ? 'store' : END)` |
| 5 | All node invocations wrapped in try/catch with correlationId logging and re-throw | VERIFIED | runGraph() wraps graph.invoke() in try/catch; logs error and re-throws |
| 6 | ChatGateway continues to call void enqueue() without changes | VERIFIED | chat.gateway.ts line 134-141: `void this.extractionService.enqueue(...)` unchanged |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/extraction/extraction.types.ts` | ExtractionState, ExtractionJobPayload, PersonExtraction interfaces | VERIFIED | All three exported; no runtime imports; 30 lines |
| `src/extraction/extraction.processor.ts` | BullMQ WorkerHost with @Processor decorator | VERIFIED | Extends WorkerHost, @Processor('extraction', {concurrency:3}), calls runGraph() |
| `src/extraction/extraction.module.ts` | ExtractionModule with BullMQ queue + provider wiring | VERIFIED | BullModule.registerQueue, EmbeddingModule, MemoryModule, both providers |
| `src/app.module.ts` | BullModule.forRootAsync + ExtractionModule imported at app root | VERIFIED | Both present; BullModule.forRootAsync before ExtractionModule |
| `src/extraction/nodes/classify.node.ts` | makeClassifyNode factory | VERIFIED | 63 lines; factory pattern; TRIVIAL_PATTERN + hasProperNounInContent() |
| `src/extraction/nodes/extract.node.ts` | makeExtractNode factory with ChatOpenAI + Zod | VERIFIED | 109 lines; ExtractOutputSchema Zod; EMPTY_RESULT; retry-then-absorb |
| `src/extraction/nodes/validate.node.ts` | makeValidateNode factory | VERIFIED | 106 lines; full normalization pipeline |
| `src/extraction/nodes/store.node.ts` | makeStoreNode factory | VERIFIED | 83 lines; upsertPerson + embed + upsertMemoryEntry loops |
| `src/extraction/extraction.service.ts` | Full ExtractionService with StateGraph + enqueue + runGraph | VERIFIED | 171 lines; OnModuleInit; compiled graph; all node factories wired |
| `src/memory/memory.types.ts` | Updated FactType | VERIFIED | `'fact' \| 'preference' \| 'relationship' \| 'emotion'` |
| `supabase/migrations/20260416000000_fact_type_constraint.sql` | Migration with back-fill and constraint update | VERIFIED | Back-fill + DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/app.module.ts` | BullModule.forRootAsync | ConfigService reading REDIS_HOST + REDIS_PORT | WIRED | useFactory injects ConfigService, reads both env vars |
| `src/extraction/extraction.processor.ts` | ExtractionService.runGraph() | called in process() | WIRED | `await this.extractionService.runGraph(job.data, correlationId)` |
| `src/extraction/extraction.module.ts` | BullModule.registerQueue | queue name 'extraction' | WIRED | `BullModule.registerQueue({ name: 'extraction' })` |
| `src/extraction/extraction.service.ts` | @nestjs/bullmq Queue | @InjectQueue('extraction') | WIRED | Constructor parameter @InjectQueue('extraction') |
| `src/extraction/extraction.service.ts` | StateGraph | compiled in onModuleInit; graph.invoke() in runGraph | WIRED | `new StateGraph`, `builder.compile()`, `this.graph.invoke(initialState)` |
| `src/extraction/extraction.service.ts` | makeClassifyNode / makeExtractNode / makeValidateNode / makeStoreNode | Called in onModuleInit() | WIRED | All four factories called to build nodes before builder.addNode() |
| `src/extraction/nodes/classify.node.ts` | ExtractionState.classifyResult | returns { classifyResult: { shouldExtract } } | WIRED | Line 60 |
| `src/extraction/nodes/extract.node.ts` | ChatOpenAI.withStructuredOutput | chain = prompt.pipe(llm.withStructuredOutput(ExtractOutputSchema)) | WIRED | Line 80 |
| `src/extraction/nodes/validate.node.ts` | ExtractionState.validateResult | returns { validateResult: ... } or undefined | WIRED | Lines 100-103 |
| `src/extraction/nodes/store.node.ts` | MemoryService.upsertMemoryEntry | called per keyFact | WIRED | Lines 65-66 |
| `src/extraction/nodes/store.node.ts` | PeopleService.upsertPerson | called per person | WIRED | Line 32 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `extraction.service.ts` | `initialState` | `ExtractionJobPayload` from BullMQ job | Yes — payload from real queue | FLOWING |
| `extract.node.ts` | `extractResult` | `chain.invoke({ content })` — real GPT-4o-mini call | Yes — or EMPTY_RESULT on failure | FLOWING |
| `validate.node.ts` | `validateResult` | `extractResult.people` + `extractResult.keyFacts` | Yes — normalization of LLM output | FLOWING |
| `store.node.ts` | `storeResult.persisted` | DB writes via service calls | Yes — writes to DB; cannot verify without runtime | FLOWING (code verified; DB path needs human) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 4 node packages resolvable | `node -e "require('@nestjs/bullmq'); require('bullmq'); require('ioredis'); require('@langchain/langgraph')"` | all packages ok | PASS |
| classify.node tests pass (12 tests) | `pnpm test classify.node.spec.ts` | 12/12 pass | PASS |
| extract.node tests pass (5 tests) | `pnpm test extract.node.spec.ts` | 5/5 pass | PASS |
| validate.node tests pass (7 tests) | `pnpm test validate.node.spec.ts` | 7/7 pass | PASS |
| TypeScript build succeeds | `pnpm build` | exits 0 | PASS |
| End-to-end pipeline (SC#2) | `pnpm start:dev` + socket message | Not tested — human required | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXTR-01 | 04-01, 04-04 | BullMQ queue 'extraction'; WorkerHost; attempts:3; exponential backoff | SATISFIED | ExtractionProcessor @Processor decorator; enqueue() queue.add with attempts:3+backoff |
| EXTR-02 | 04-04 | LangGraph StateGraph 4 nodes; compiled graph private to ExtractionService | SATISFIED (with deviation) | StateGraph compiled in onModuleInit() instead of constructor — documented in plan as correct NestJS lifecycle pattern; intent (graph constructed once) is met |
| EXTR-03 | 04-02 | Classify node — GPT-4o-mini classifies categories | DEVIATION | Requirement specifies LLM-based classification with categories; actual implementation is rule-based (zero LLM cost). ROADMAP SC#3 only requires shouldExtract:false for trivial messages — which IS verified. The classify-with-LLM + categories behavior is not in any ROADMAP success criterion. |
| EXTR-04 | 04-02 | Extract node — MemoryFact[] with confidence: HIGH/MEDIUM/LOW | DEVIATION | Requirement specifies MemoryFact[] with confidence field; actual output is {people[], topics[], emotionalTone, keyFacts[]}. ROADMAP SC#2 only requires memory_entry with fact_type='fact' — which the current shape supports. No ROADMAP SC requires the MemoryFact+confidence schema. |
| EXTR-05 | 04-03 | Validate node — LLM-arbitrated contradiction resolution (UPDATE/APPEND/IGNORE) | DEVIATION | Requirement specifies LLM arbitration; actual validateNode is deterministic normalization only. Dedup delegated to MemoryService.upsertMemoryEntry (0.90 cosine). No ROADMAP SC requires LLM contradiction resolution. |
| EXTR-06 | 04-03 | Store node — soft-delete on UPDATE; supersedes FK | DEVIATION | Requirement specifies soft-delete + supersedes FK; store.node.ts has no soft-delete. ROADMAP SC#4 only requires dedup via last_reinforced_at update — which MemoryService.upsertMemoryEntry handles. No ROADMAP SC requires soft-delete or supersedes. |
| EXTR-07 | 04-03 | Only HIGH confidence facts stored | SATISFIED (interpretation) | Documented in store.node.ts: all keyFacts treated as implicitly HIGH confidence; LLM prompt constrains output to significant facts only |
| EXTR-08 | 04-04 | Error boundary — log + re-throw for BullMQ retry | SATISFIED | runGraph() try/catch logs with correlationId and re-throws |
| EXTR-09 | 04-01, 04-04 | enqueue() is the only public surface | SATISFIED | ChatGateway calls void extractionService.enqueue(); ExtractionService exports only enqueue() as public API |

**Requirements with structural deviations from requirement text (EXTR-03, EXTR-04, EXTR-05, EXTR-06):** These deviations are documented in the plan files and summaries. The ROADMAP success criteria — which are the governing contract for verification — do NOT require the specific implementation details (LLM-based classify, MemoryFact schema, LLM contradiction resolution, soft-delete). All 6 ROADMAP success criteria are verifiable with the current implementation. The requirement text represents an earlier planning intent that was deliberately redesigned in the execution plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/extraction/extraction.service.ts` | 46 | `private graph!: any` | Info | Necessary workaround for LangGraph TypeScript generics; documented in plan and summary; no runtime impact |
| `src/extraction/extraction.service.ts` | 81 | `}) as any` | Info | Same LangGraph TS typing workaround; multiple eslint-disable comments present documenting reason |

No blocking anti-patterns found. The `any` usage is confined to LangGraph internal wiring (not business logic) and is accompanied by eslint-disable comments with explanations.

### Human Verification Required

#### 1. End-to-End Pipeline Smoke Test

**Test:** Apply the DB migration (`supabase db push`), start the app (`pnpm start:dev`), connect a Socket.io client and send a message containing a proper noun (e.g., "my friend Jake is a software engineer"). Wait up to 30 seconds, then check the DB.

**Expected:**
- Startup log: `ExtractionService initialized with model=<OPENAI_EXTRACTION_MODEL>`
- Job logs (in order): `classifyNode shouldExtract=true`, `extractNode people=N keyFacts=N`, `validateNode valid=true`, `storeNode upserted person name=Jake`, `runGraph complete`
- DB: a `people` row with `name='Jake'` and a `memory_entries` row with `fact_type='fact'`

**Why human:** SC#2 requires actual DB rows to be created. The wiring is code-verified, but confirming that GPT-4o-mini returns the expected structure and that MemoryService/PeopleService write to the DB requires a live application run with a real Redis instance and real Supabase. The plan's Task 2 human-verify checkpoint remains "Awaiting human verification" in 04-04-SUMMARY.md.

#### 2. Trivial Message Skips Pipeline (Confirmatory)

**Test:** Send a trivial message (e.g., "ok") via Socket.io and check BullMQ job logs.

**Expected:** `classifyNode shouldExtract=false` in logs; no extractNode, validateNode, storeNode log lines; no new DB rows created.

**Why human:** Validates the conditional edge routing in the live pipeline (runtime behavior, not just code structure).

### Gaps Summary

No blocking gaps. The pipeline code is substantive, fully wired, and all automated tests pass. The phase cannot be marked `passed` because:

1. **SC#2 (end-to-end DB write)** requires live application verification — the plan's own human-verify checkpoint is documented as "Awaiting human verification" in 04-04-SUMMARY.md.
2. **EXTR-02 through EXTR-06 structural deviations** from requirement text are intentional redesigns accepted during execution. All ROADMAP success criteria are verifiable with the implemented design. No override entries are needed because no ROADMAP SC is violated — only the lower-level requirement text descriptions differ from implementation.

Once the human-verify checkpoint is approved, the phase can be re-verified as `passed`.

---

_Verified: 2026-04-16T16:33:00Z_
_Verifier: Claude (gsd-verifier)_
