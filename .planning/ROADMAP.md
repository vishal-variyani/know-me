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
- [ ] 01-01: Remove Jest scaffold, install Vitest 2.x with unplugin-swc + @swc/core, configure `vitest.config.ts` with `decoratorMetadata: true`, verify NestJS DI resolves in a smoke test
- [ ] 01-02: Write `docker-compose.yml` with Supabase-compatible Postgres + pgvector and a Redis 7.2 image; confirm `docker compose up -d` reaches healthy state and pgvector extension loads
- [ ] 01-03: Write Supabase CLI migrations for all five tables (conversations, conversation_messages, message_embeddings, people, memory_entries) with RLS policies, HNSW indexes on vector columns (`m=16, ef_construction=64`), and B-tree indexes on `user_id`; add `search_user_memories` Postgres function with `iterative_scan = relaxed_order` and `ef_search = 40`
- [ ] 01-04: Wire `@nestjs/config` globally, add env-var validation schema in `main.ts` that throws before `NestFactory.create()` on missing values, install `@nestjs/platform-socket.io` and set `IoAdapter` in `main.ts`

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
- [ ] 02-01: Implement `DatabaseModule` as `@Global()` with `PG_POOL` provider using raw `pg` Pool; implement `EmbeddingModule` exporting `EmbeddingService` wrapping `OpenAIEmbeddings` at 1536 dims with dimension validation at startup
- [ ] 02-02: Implement `MemoryService` in `MemoryModule` — CRUD for conversations, conversation_messages, and message_embeddings; implement `searchSimilar()` delegating to `search_user_memories` Postgres function; implement `upsertMemoryEntry()` with 0.90 cosine similarity deduplication guard
- [ ] 02-03: Implement `PeopleService` in `MemoryModule` — `detectNames()` via simple NLP/regex proper noun extraction, `lookupByNames()` by name/aliases match scoped to `user_id`, and `upsertPerson()` for relationship facts; ensure all queries enforce `user_id` filter

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
- [ ] 03-01: Implement `RetrievalModule` with `RetrievalService.retrieve(text, userId)` — parallel `Promise.all` of (a) embed + pgvector cosine top-5 via `MemoryService.searchSimilar()` and (b) `PeopleService.detectNames()` + `PeopleService.lookupByNames()`; returns `MemoryContext`
- [ ] 03-02: Implement `LlmModule` with `LlmService` — `ChatAnthropic` with `streaming: true` and model from `ANTHROPIC_MODEL` env var; `streamResponse(text, memoryContext, history)` assembles system prompt with structured memory block and returns `AsyncIterable<string>`
- [ ] 03-03: Implement `ChatGateway` in `ChatModule` — Socket.io middleware validates UUID on handshake; `handleMessage` persists message, calls retrieval, calls LlmService, iterates `for await...of` emitting `chat:chunk`, emits `chat:complete`; stubs `ExtractionService.enqueue()` with a no-op for this phase
- [ ] 03-04: Wire `AbortController` per socket connection — `handleDisconnect` calls `abort()`; `LlmService.streamResponse()` accepts `{ signal }` and passes it to the LangChain call; replace no-op extraction stub with real `void extractionService.enqueue()` call (even though ExtractionModule is not yet real)

**UI hint**: no

---

### Phase 4: Extraction Pipeline

**Goal**: Every message and document text that passes through the system is asynchronously analyzed by a LangGraph pipeline (Classify → Extract → Validate → Store) that persists only HIGH-confidence facts as memory entries and relationship people rows.

**Depends on**: Phase 2 (EmbeddingService and MemoryService), Phase 3 (ChatGateway calls enqueue())

**Requirements**: EXTR-01, EXTR-02, EXTR-03, EXTR-04, EXTR-05, EXTR-06, EXTR-07, EXTR-08, EXTR-09

**Success Criteria** (what must be TRUE):
  1. Calling `ExtractionService.enqueue(text, userId, 'conversation')` adds a BullMQ job to the `extraction` queue and returns immediately — the caller does not wait for pipeline completion
  2. A message containing a clear user preference (e.g., "I love spicy food") results in a memory_entry row in the database within 30 seconds, with `fact_type = 'preference'` and `confidence` in the HIGH range
  3. A message with no extractable facts (e.g., "ok") results in the Classify node returning `shouldExtract: false` and the Extract node being skipped entirely
  4. A message containing a relationship reference (e.g., "my friend Jake is a software engineer") results in a people row for Jake and a memory_entry with `fact_type = 'relationship'`, with the people row linked via `upsertPerson()`
  5. Submitting the same fact twice does not create two memory_entries — the second run updates `last_reinforced_at` and `confidence` on the existing row
  6. A BullMQ job that fails on all 3 attempts lands in the failed queue and does not crash the NestJS process; each failure is logged via NestJS Logger with a correlation ID

**Plans**: 4 plans

Plans:
- [ ] 04-01: Install `@nestjs/bullmq`, `bullmq`; configure `BullModule.forRoot()` in `AppModule` using Redis connection from env vars; create `ExtractionModule` with `BullModule.registerQueue({ name: 'extraction' })` and `ExtractionProcessor extends WorkerHost` with `concurrency: 3`, `attempts: 3`, exponential backoff
- [ ] 04-02: Implement the Classify and Extract LangGraph nodes — Classify uses GPT-4o-mini (from `OPENAI_EXTRACTION_MODEL`) to determine `shouldExtract` and `categories[]`; Extract uses GPT-4o-mini with Zod schema to produce `MemoryFact[]` with `content`, `factType`, `directlyStated`, `confidence: HIGH|MEDIUM|LOW`; conditional edge skips Extract if `shouldExtract = false`
- [ ] 04-03: Implement the Validate and Store LangGraph nodes — Validate runs Zod schema validation then deduplication via `MemoryService.findSimilar()` (cosine > 0.90 = duplicate), then sends contradictions to GPT-4o-mini for UPDATE/APPEND/IGNORE arbitration; Store calls `EmbeddingService.embed()` then `MemoryService.upsertMemoryEntry()` for HIGH-confidence facts only, and `PeopleService.upsertPerson()` for relationship facts; UPDATE path soft-deletes old entry and sets `supersedes` FK
- [ ] 04-04: Wire `ExtractionService` to compose the `StateGraph` in its constructor; wrap all four nodes in try/catch with NestJS Logger + correlation ID; re-throw errors to trigger BullMQ retry; verify `ExtractionService.enqueue()` is the only public surface and that ChatGateway's no-op stub is replaced with the real call

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
