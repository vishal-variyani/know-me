# Roadmap: Know Me
**Milestone:** v1.0 — Working conversational memory agent backend
**Granularity:** Standard
**Generated:** 2026-04-15

## Overview

Six phases build the system from the ground up. Phase 1 lays the infrastructure foundation (tooling, Docker, schema); Phase 2 delivers the core data layer shared by both runtime paths; Phase 3 completes the latency-critical chat path — producing a fully demo-able, memory-aware streaming backend; Phase 4 implements the background extraction pipeline; Phase 5 adds document upload as a thin reuse layer over extraction; Phase 6 tests and hardens everything for production.

---

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Tooling swap, Docker Compose with Postgres + Redis + pgvector, all five table migrations, environment validation
- [ ] **Phase 2: Core Data Layer** - EmbeddingService + MemoryService + PeopleService — the shared backbone of both runtime paths
- [ ] **Phase 3: Chat Path** - WebSocket gateway with streaming Claude responses, hybrid retrieval injected into context, fire-and-forget extraction stub
- [ ] **Phase 4: Extraction Pipeline** - LangGraph Classify → Extract → Validate → Store pipeline running in BullMQ background jobs
- [ ] **Phase 5: Document Upload** - REST endpoint that feeds the extraction pipeline with journal/document text
- [ ] **Phase 6: Test Suite & Hardening** - Vitest unit coverage of core services, error boundaries, and production readiness

---

## Phase Details

### Phase 1: Foundation

**Goal**: The development environment is fully operational — Vitest replaces Jest, Docker Compose runs Postgres + pgvector + Redis, all five tables exist with RLS and HNSW indexes, and the app validates required env vars at startup.

**Depends on**: Nothing (foundation phase)

**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07, DB-01, DB-02, DB-03, DB-04, DB-05, DB-06, DB-07

**Success Criteria** (what must be TRUE):
  1. `pnpm test` runs the Vitest suite with zero Jest references in package.json, tsconfig, or any config file; NestJS decorators resolve correctly in test context
  2. `docker compose up -d` starts Postgres with pgvector extension loaded and Redis >= 7.2; `docker compose ps` shows all containers healthy
  3. `supabase db push` applies all five table migrations; `\d` in psql shows conversations, conversation_messages, message_embeddings, people, memory_entries with correct columns, HNSW indexes, and B-tree user_id indexes
  4. App bootstrap throws a descriptive error naming the missing variable when any required env var (ANTHROPIC_MODEL, OPENAI_EXTRACTION_MODEL, OPENAI_EMBEDDING_MODEL, EMBEDDING_DIMS, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, REDIS_HOST, REDIS_PORT) is absent
  5. A Socket.io client can connect to the running app (IoAdapter wired in main.ts)

**Plans**: 4 plans

Plans:
- [x] 01-01-PLAN.md — Remove Jest scaffold; install Vitest 2.x + unplugin-swc; create vitest.config.ts; flip noImplicitAny:true; verify NestJS DI smoke test passes
- [x] 01-02-PLAN.md — Create docker-compose.yml (supabase/postgres + redis:7.2-alpine); create .env.example with all 9 required vars; add .env to .gitignore
- [x] 01-03-PLAN.md — Write 7 Supabase migration files (extensions, 5 tables with RLS + HNSW + B-tree indexes, search_user_memories function); push to local Postgres (human-verified checkpoint)
- [x] 01-04-PLAN.md — Rewrite main.ts with validateEnv() guard + IoAdapter; update AppModule with ConfigModule.forRoot({isGlobal:true}); add main.spec.ts unit tests

**UI hint**: no

---

### Phase 2: Core Data Layer

**Goal**: `EmbeddingService`, `MemoryService`, and `PeopleService` are fully implemented and injectable — every downstream module (chat path and extraction path) can embed text, persist and query memories, and look up people without touching raw SQL.

**Depends on**: Phase 1

**Requirements**: EMBED-01, EMBED-02, EMBED-03, MEM-01, MEM-02, MEM-03, MEM-04, MEM-05, MEM-06

**Success Criteria** (what must be TRUE):
  1. `EmbeddingService.embed("hello")` returns a 1536-dimensional `number[]` using the model from `OPENAI_EMBEDDING_MODEL` env var; startup fails if `EMBEDDING_DIMS` env var does not equal 1536
  2. `MemoryService.searchSimilar(userId, vector, 5)` calls the `search_user_memories` Postgres function and returns results scoped to the given `user_id` only — no raw `<=>` SQL at the service layer
  3. `MemoryService.upsertMemoryEntry()` inserts a new row when no similar entry exists (cosine < 0.90); when similarity >= 0.90, updates `last_reinforced_at` and increments `confidence` on the existing row without inserting a duplicate
  4. `PeopleService.detectNames("I had lunch with Sarah and Tom")` returns `["Sarah", "Tom"]`; `lookupByNames` returns only people rows belonging to the specified `user_id`
  5. Every MemoryService and PeopleService method that accepts `userId` filters by `user_id` — a query for user A never returns rows belonging to user B

**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Implement `DatabaseModule` as `@Global()` with `PG_POOL` provider using raw `pg` Pool; implement `EmbeddingModule` exporting `EmbeddingService` wrapping `OpenAIEmbeddings` at 1536 dims with dimension validation at startup
- [x] 02-02-PLAN.md — Implement `MemoryService` in `MemoryModule` — CRUD for conversations, conversation_messages, and message_embeddings; implement `searchSimilar()` delegating to `search_user_memories` Postgres function; implement `upsertMemoryEntry()` with 0.90 cosine similarity deduplication guard
- [x] 02-03-PLAN.md — Implement `PeopleService` in `MemoryModule` — `detectNames()` via simple NLP/regex proper noun extraction, `lookupByNames()` by name/aliases match scoped to `user_id`, and `upsertPerson()` for relationship facts; ensure all queries enforce `user_id` filter

**UI hint**: no

---

### Phase 3: Chat Path

**Goal**: A Socket.io client can send a message, receive streamed Claude tokens as `chat:chunk` events, and receive a `chat:complete` event — with retrieved memories injected into context and extraction enqueued as fire-and-forget — making the product fully demo-able.

**Depends on**: Phase 2

**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, RETR-01, RETR-02, RETR-03, RETR-04

**Success Criteria** (what must be TRUE):
  1. A Socket.io client connecting without a valid UUID in `handshake.auth.userId` is rejected before the connection is accepted
  2. A connected client that sends `chat:send` receives a sequence of `chat:chunk` events followed by exactly one `chat:complete` event; each chunk contains a token from Claude's streaming output
  3. Disconnecting mid-stream (closing the socket) aborts the in-flight LLM stream — no orphaned async work continues after disconnect
  4. The system prompt contains a `[Memory: ... | confidence: ... | last confirmed: ...]` block when the user has existing memories matching the message; the block is absent (or empty) for a user with no memories
  5. Both retrieval arms (pgvector cosine top-5 and people direct lookup) run concurrently via `Promise.all` and complete before the LLM call starts
  6. `void extractionService.enqueue(...)` is called after stream completes and the gateway does not await it — the chat response is not blocked by extraction latency

**Plans**: 4 plans

Plans:
- [x] 03-01-PLAN.md — Implement `RetrievalModule` with `RetrievalService.retrieve(text, userId)` — parallel `Promise.all` of embed+searchSimilar (arm 1) and detectNames+lookupByNames (arm 2); returns `MemoryContext`; unit tested with mocked services
- [x] 03-02-PLAN.md — Install `@langchain/anthropic`; implement `LlmModule` with `LlmService` — `ChatAnthropic` streaming:true + model from ANTHROPIC_MODEL; `streamResponse(messages, signal)` returns `AsyncIterable<string>`; unit tested with mocked ChatAnthropic
- [x] 03-03-PLAN.md — Add `MemoryService.getRecentMessages(conversationId, limit)` (chronological order); create `ExtractionService` stub (no-op enqueue); define chat event payload types; wire `ChatModule` scaffold with all 4 dependencies
- [x] 03-04-PLAN.md — Implement full `ChatGateway` — UUID middleware in afterInit(); per-socket AbortController Map; handleChatSend streaming loop emitting chat:chunk/chat:complete; memory injection at 0.7 threshold; D-01/D-02 10-message history; fire-and-forget extraction; wire into AppModule

**UI hint**: no

---

### Phase 4: Extraction Pipeline

**Goal**: Every message and document text that passes through the system is asynchronously analyzed by a LangGraph pipeline (Classify → Extract → Validate → Store) that persists facts as memory entries and people rows — without blocking the chat response path.

**Depends on**: Phase 2 (EmbeddingService and MemoryService), Phase 3 (ChatGateway calls enqueue())

**Requirements**: EXTR-01, EXTR-02, EXTR-03, EXTR-04, EXTR-05, EXTR-06, EXTR-07, EXTR-08, EXTR-09

**Success Criteria** (what must be TRUE):
  1. Calling `ExtractionService.enqueue(text, userId, 'conversation')` adds a BullMQ job to the `extraction` queue and returns immediately — the caller does not wait for pipeline completion
  2. A message containing a relationship reference (e.g., "my friend Jake is a software engineer") results in a people row for Jake and a memory_entry with `fact_type = 'fact'`, with the people row linked via `upsertPerson()`
  3. A message with no extractable facts (e.g., "ok") results in the Classify node returning `shouldExtract: false` and the Extract node being skipped entirely
  4. Submitting the same fact twice does not create two memory_entries — the second run updates `last_reinforced_at` and `confidence` on the existing row
  5. A BullMQ job that fails on all 3 attempts lands in the failed queue and does not crash the NestJS process; each failure is logged via NestJS Logger with a correlation ID (BullMQ job ID)
  6. Validate node filters pronouns and generic references, normalizes names to title-case, deduplicates within-batch, and maps relationship synonyms before any DB write occurs

**Plans**: 4 plans

Plans:
- [ ] 04-01-PLAN.md — Install 6 packages (@nestjs/bullmq, bullmq, ioredis, @langchain/langgraph, class-validator, class-transformer); create extraction.types.ts (ExtractionState, ExtractionJobPayload, PersonExtraction); create ExtractionProcessor (WorkerHost, concurrency: 3); update ExtractionModule with BullMQ queue registration; wire BullModule.forRootAsync in AppModule
- [ ] 04-02-PLAN.md — Implement makeClassifyNode (rule-based: proper noun detection + trivial filter, zero LLM cost); implement makeExtractNode (GPT-4o-mini with Zod-validated JSON output schema: people[], topics[], emotionalTone, keyFacts[]); retry-once-then-absorb error handling for Extract
- [ ] 04-03-PLAN.md — Implement makeValidateNode (title-case normalization, honorific stripping, pronoun filter, within-batch dedup, relationship synonym mapping, conditional END); implement makeStoreNode (PeopleService.upsertPerson per person, EmbeddingService.embed + MemoryService.upsertMemoryEntry per keyFact); update FactType enum to 'fact|preference|relationship|emotion'; write Supabase migration for CHECK constraint update
- [ ] 04-04-PLAN.md — Replace ExtractionService stub with full implementation: StateGraph compiled in onModuleInit(), enqueue() adds BullMQ job with attempts:3 + exponential backoff, runGraph() invokes graph with error boundary that re-throws for BullMQ retry; human-verify checkpoint confirming end-to-end pipeline and migration push

**UI hint**: no

---

### Phase 5: Document Upload

**Goal**: A client can POST a `.txt` or `.md` file to `POST /upload`, and the file's text content is enqueued into the same extraction pipeline that conversation messages use — persisting facts and people just as if the text had been spoken in chat.

**Depends on**: Phase 4

**Requirements**: UPLOAD-01, UPLOAD-02, UPLOAD-03

**Success Criteria** (what must be TRUE):
  1. `POST /upload` with a valid `.txt` file and a UUID `userId` in the form body returns a 2xx response and enqueues a BullMQ extraction job within the same request cycle
  2. A `.txt` file containing extractable facts results in memory_entries appearing in the database within 30 seconds — identical to what conversation messages produce
  3. `POST /upload` with a non-UUID `userId` returns a 400 error before any file is processed or any job is enqueued
  4. Uploading a file with an unsupported extension (e.g., `.pdf`, `.png`) returns a 415 error

**Plans**: 2 plans

Plans:
- [ ] 05-01: Create `UploadModule` with `UploadController` — wire `multer` (or NestJS `FileInterceptor`) for `multipart/form-data`; validate `userId` as UUID before processing; read file buffer as UTF-8 string; call `ExtractionService.enqueue(text, userId, 'document')`; return 202 Accepted
- [ ] 05-02: Add file type validation (accept only `.txt` and `.md` by MIME type and extension); add request-level error handling (400 for invalid UUID, 415 for unsupported file type, 413 for oversized file); write integration smoke test confirming a valid upload produces a BullMQ job

**UI hint**: no

---

### Phase 6: Test Suite & Hardening

**Goal**: The four critical service paths have Vitest unit test coverage, all unhandled error scenarios are logged and contained, and the application is ready for a production Supabase cloud deployment.

**Depends on**: Phase 5 (all features exist before hardening)

**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04

**Success Criteria** (what must be TRUE):
  1. `pnpm test` runs all Vitest suites and passes — covering RetrievalService, each LangGraph node, MemoryService.upsertMemoryEntry(), and ChatGateway streaming/disconnect behavior
  2. RetrievalService tests confirm both retrieval arms (semantic + named-entity) fire concurrently via mocked EmbeddingService and PeopleService — no real LLM or DB calls made during unit tests
  3. Each LangGraph node (Classify, Extract, Validate, Store) is tested in isolation with mocked LLM responses — node contracts are verified independently of the full pipeline
  4. ChatGateway tests confirm the AbortController fires on disconnect (aborting the stream) and that `void extractionService.enqueue()` is called after stream completion without being awaited
  5. `MemoryService.upsertMemoryEntry()` tests cover both the insert path (no existing similar entry) and the update path (existing entry with cosine >= 0.90) using mocked DB responses

**Plans**: 3 plans

Plans:
- [ ] 06-01: Write Vitest unit tests for `RetrievalService` using `Test.createTestingModule().overrideProvider()` to mock `EmbeddingService` and `PeopleService`; assert `Promise.all` parallelism; assert `MemoryContext` shape returned; assert `userId` is passed through to both arms
- [ ] 06-02: Write Vitest unit tests for each LangGraph node function in isolation (Classify, Extract, Validate, Store) with mocked GPT-4o-mini responses; write Vitest unit tests for `MemoryService.upsertMemoryEntry()` covering insert path and deduplication update path with mocked `findSimilar()` return values
- [ ] 06-03: Write Vitest unit tests for `ChatGateway` — mock LlmService to return a short `AsyncIterable<string>`, assert `chat:chunk` emitted per token, assert `chat:complete` emitted once, assert `AbortController.abort()` called on disconnect, assert `extractionService.enqueue` called and not awaited; audit all modules for `console.log` (replace with NestJS Logger) and `any` types (replace with typed alternatives)

**UI hint**: no

---

## Milestone: v1.0 Complete

**Definition of done:**
- A Socket.io client can connect with a UUID userId, send a message, and receive streamed Claude tokens with injected memory context
- Memory entries accumulate automatically in the background as conversations progress — without blocking chat streaming
- Retrieval uses hybrid strategy: pgvector cosine top-5 for general memory + direct people lookup when names are mentioned
- Uploaded `.txt` and `.md` documents are processed through the identical extraction pipeline as conversation messages
- All four core service paths have Vitest unit test coverage passing in CI
- Docker Compose starts Postgres + pgvector + Redis in one command; all five tables have HNSW indexes and RLS policies
- No `console.log` anywhere in the codebase; no `any` types; all model names read from env vars

---

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 0/4 | Not started | - |
| 2. Core Data Layer | 0/3 | Not started | - |
| 3. Chat Path | 0/4 | Not started | - |
| 4. Extraction Pipeline | 0/4 | Not started | - |
| 5. Document Upload | 0/2 | Not started | - |
| 6. Test Suite & Hardening | 0/3 | Not started | - |

---
*Generated: 2026-04-15*
*Phase 1 plans created: 2026-04-15*
*Phase 3 plans created: 2026-04-16*
*Phase 4 plans created: 2026-04-16*
