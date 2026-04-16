# Phase 4: Extraction Pipeline - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the background LangGraph extraction pipeline: a 4-node StateGraph (Classify → Extract → Validate → Store) that runs asynchronously after every user message and document chunk via BullMQ. The pipeline never blocks the chat flow. It persists people rows and memory entries from extracted facts.

Out of scope: document upload REST endpoint (Phase 5), full test suite (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Classify Node — Rule-Based (No LLM)
- **D-01:** Classify is pure rule-based — zero LLM cost. Checks: (1) content contains proper nouns, (2) content is not a trivial greeting or filler (e.g., "ok", "thanks", "sure"). Both checks must pass to proceed.
- **D-02:** Conditional edge: fails classification → END immediately, skipping Extract, Validate, and Store entirely. Estimated ~30-40% of messages filtered here, saving LLM cost and latency.
- **D-03:** No LLM arbitration or scoring in Classify — deterministic signal only.

### Extract Node — Single LLM Call
- **D-04:** Single GPT-4o-mini call (model from `OPENAI_EXTRACTION_MODEL` env var) using JSON mode with a ChatPromptTemplate.
- **D-05:** Output schema: `{ people: Array<{ name: string, relationship: string, facts: string[] }>, topics: string[], emotionalTone: string (enum), keyFacts: string[] }` — where `keyFacts` captures facts about the user themselves.
- **D-06:** Retry once on failure (timeout, malformed JSON). On second failure: log the error via NestJS Logger and pass an empty result forward. Store treats an empty result as a no-op — no DB writes occur.

### Validate Node — Deterministic (No LLM)
- **D-07:** No LLM calls in Validate — fully deterministic processing.
- **D-08:** Runs class-validator schema validation on the Extract output.
- **D-09:** Name normalization: trim whitespace, title-case, strip honorifics (Mr., Dr., etc.).
- **D-10:** Filter out pronouns and generic references that GPT sometimes emits as entity names: "he", "she", "they", "someone", "the user", "a person", etc.
- **D-11:** Within-batch deduplication: if the same name appears multiple times in one extraction batch, collapse to a single entry with merged facts.
- **D-12:** Relationship synonym mapping: e.g., "girlfriend" and "partner" resolve to a consistent canonical form.
- **D-13:** If validation fails entirely (e.g., output is structurally invalid after all normalization): conditional edge → END. No garbage data reaches the DB.
- **D-14:** Cross-session deduplication (against existing memory_entries) is NOT done in Validate — that responsibility belongs to Store via `MemoryService.upsertMemoryEntry()`'s 0.90 cosine guard.

### Store Node — DB Operations Only
- **D-15:** People upsert: query by `(user_id, lower(name))`. If exists: merge new facts into existing JSONB array (avoiding exact duplicates), update `updated_at`. If new: insert with relationship and initial facts array.
- **D-16:** Functional unique index on `(user_id, lower(name))` with `ON CONFLICT` JSONB merge — atomic upsert, no race condition.
- **D-17:** `updated_at` on the people row serves as "last mentioned" timestamp — no new `last_mentioned_at` column; no schema migration needed for this.
- **D-18:** memory_entries rows created with the new `fact_type` enum: `fact | preference | relationship | emotion`. This **overrides** the old enum (`preference | relationship | event | belief | goal | habit`) — a migration is required to update the `CHECK` constraint on `memory_entries.fact_type`.
- **D-19:** Embeddings generated for each memory_entry content via `EmbeddingService.embed()`, stored in `message_embeddings` and linked via `embedding_id`.
- **D-20:** `MemoryService.upsertMemoryEntry()` handles cross-session deduplication: cosine similarity >= 0.90 → update `last_reinforced_at` and increment `confidence` instead of inserting a duplicate.

### ExtractionState — Typed Interface
- **D-21:** Typed `ExtractionState` interface carries state through all nodes:
  ```typescript
  interface ExtractionState {
    content: string;
    userId: string;
    sourceType: 'conversation' | 'document';
    classifyResult?: { shouldExtract: boolean };
    extractResult?: { people: PersonExtraction[]; topics: string[]; emotionalTone: string; keyFacts: string[] };
    validateResult?: { people: PersonExtraction[]; keyFacts: string[] };
    storeResult?: { persisted: number };
  }
  ```

### Routing — Two Conditional Edges
- **D-22:** Classify node → conditional edge to Extract (if shouldExtract) or END (if not).
- **D-23:** Validate node → conditional edge to Store (if validation passes) or END (if validation fails entirely).
- **D-24:** Trivial messages touch only Classify (1 node). Failed extractions touch Classify + Extract (2 nodes). Successful extractions flow through all 4.

### BullMQ Worker Configuration
- **D-25:** Queue name: `'extraction'`. Worker: `ExtractionProcessor extends WorkerHost` with `concurrency: 3`, `attempts: 3`, exponential backoff.
- **D-26:** BullMQ job ID used as correlation ID for all NestJS Logger calls within a job — surfaces job context in log output.

### ExtractionService Architecture
- **D-27:** The compiled LangGraph `StateGraph` is a private property of `ExtractionService`, constructed once in the constructor via closure over injected services (`EmbeddingService`, `MemoryService`, `PeopleService`, `LLM`).
- **D-28:** `ExtractionService.enqueue(text, userId, sourceType)` remains the only public surface — ChatGateway and UploadController never import LangGraph directly. The existing stub interface is preserved exactly.

### Claude's Discretion
- Exact ChatPromptTemplate wording for Extract node
- Emotional tone enum values (e.g., neutral, positive, negative, anxious, excited — or a different set)
- Exact relationship synonym mapping table
- BullMQ exponential backoff intervals (delay, multiplier)
- Whether `ExtractionProcessor` or `ExtractionService` owns the compiled graph (either is acceptable given D-27 intent)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Extraction Pipeline (EXTR-01 through EXTR-09) — BullMQ queue setup, LangGraph node contracts, confidence filtering, error boundaries, public surface constraint
- **Note:** EXTR-03 (Classify via LLM) is **overridden** by D-01–D-03: Classify is rule-based, not LLM-based.
- **Note:** EXTR-05 (LLM contradiction arbitration in Validate) is **overridden** by D-13–D-14: Validate is deterministic; cross-session dedup is handled at Store layer.
- **Note:** EXTR-04 (MemoryFact[] schema with HIGH/MEDIUM/LOW confidence) is **overridden** by D-05: Extract output schema is `{ people[], topics[], emotionalTone, keyFacts[] }`.

### Roadmap
- `.planning/ROADMAP.md` Phase 4 — Goal, Success Criteria (6 criteria), plan descriptions (04-01 through 04-04)

### Existing Implementation
- `src/extraction/extraction.service.ts` — stub to replace; interface (`enqueue(text, userId, sourceType)`) must be preserved
- `src/extraction/extraction.module.ts` — module shell; needs BullMQ wired in
- `src/memory/memory.service.ts` — `upsertMemoryEntry()` handles cross-session dedup (0.90 cosine guard)
- `src/memory/people.service.ts` — `upsertPerson()` for people writes
- `src/embedding/embedding.service.ts` — `embed()` for vector generation
- `src/memory/memory.types.ts` — `FactType` enum (needs updating to new values), `MemorySearchResult`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/extraction/extraction.service.ts` — stub with correct `enqueue(text, userId, sourceType): Promise<void>` interface; replace body, keep signature
- `src/extraction/extraction.module.ts` — module exists; add `BullModule.registerQueue({ name: 'extraction' })` and `ExtractionProcessor`
- `src/memory/memory.service.ts` — `upsertMemoryEntry()` already has 0.90 cosine dedup guard; `searchSimilar()` calls the Postgres function
- `src/memory/people.service.ts` — `upsertPerson()` for relationship facts; `detectNames()` / `lookupByNames()` for retrieval path (already used in Phase 3)
- `src/embedding/embedding.service.ts` — `embed(text): Promise<number[]>` returns 1536-dim vector
- `src/memory/memory.types.ts` — `FactType` type defined here; update to `'fact' | 'preference' | 'relationship' | 'emotion'`

### Established Patterns
- All services use `@Inject(PG_POOL)` for DB access via global `DatabaseModule`
- NestJS Logger (`private readonly logger = new Logger(ClassName.name)`) — only logging mechanism
- `ConfigService.getOrThrow<string>('ENV_VAR')` for all env var access
- TypeScript strict: no `any` types; `unknown` with narrowing
- Module export pattern: every module providing injectable services exports them

### Integration Points
- `src/app.module.ts` — needs `BullModule.forRoot()` (Redis connection) and `ExtractionModule` added to imports
- `src/chat/chat.gateway.ts` — already calls `void this.extractionService.enqueue(...).catch(...)` after stream completes; stub replaced by real implementation without changing call site
- `src/main.ts` — `REDIS_HOST` and `REDIS_PORT` already in `validateEnv()` required vars list
- DB migration needed: update `memory_entries.fact_type` CHECK constraint from old enum to `fact|preference|relationship|emotion`

</code_context>

<specifics>
## Specific Ideas

- Classify should filter ~30-40% of messages at zero LLM cost — the rule-based approach is a deliberate cost/latency optimization, not a simplification
- Extract JSON mode output maps to a structured schema that differs from the old REQUIREMENTS.md MemoryFact[] shape — the new schema is the source of truth
- People upsert uses `lower(name)` functional unique index for case-insensitive atomic merge — the planner should account for this index existing or needing to be added
- BullMQ job ID doubles as correlation ID — log it on every node entry/exit within a job

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 04-extraction-pipeline*
*Context gathered: 2026-04-16*
