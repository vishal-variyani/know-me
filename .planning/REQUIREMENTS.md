# Requirements: Know Me

**Defined:** 2026-04-15
**Core Value:** The AI gets meaningfully better at knowing each user the more they interact — persistent, accumulating memory that makes every response feel personally aware.

---

## v1 Requirements

### Infrastructure & Tooling

- [ ] **INFRA-01**: Jest scaffold fully removed (jest, ts-jest, @types/jest, jest config block in package.json) and replaced with Vitest 2.x + unplugin-swc + @swc/core with decorator metadata support
- [ ] **INFRA-02**: `vitest.config.ts` configured with SWC plugin emitting `decoratorMetadata: true` — NestJS DI resolves correctly in tests
- [ ] **INFRA-03**: `tsconfig.json` updated to `noImplicitAny: true` — TypeScript strict enforced throughout
- [ ] **INFRA-04**: Docker Compose includes Supabase PostgreSQL + pgvector AND Redis (Redis required by BullMQ; not in Supabase image)
- [ ] **INFRA-05**: `main.ts` uses `IoAdapter` from `@nestjs/platform-socket.io` — Socket.io clients can connect
- [ ] **INFRA-06**: Environment validation at bootstrap — all required env vars (`ANTHROPIC_MODEL`, `OPENAI_EXTRACTION_MODEL`, `OPENAI_EMBEDDING_MODEL`, `EMBEDDING_DIMS`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`) are validated before `NestFactory.create()` throws on missing values
- [ ] **INFRA-07**: `@nestjs/config` with `ConfigModule.forRoot({ isGlobal: true })` — all config injectable via `ConfigService.getOrThrow()`, no hardcoded strings

### Database Schema

- [ ] **DB-01**: Migration creates `conversations` table with `id`, `user_id`, `title`, `created_at`, `updated_at` — RLS policy scoped to `user_id`
- [ ] **DB-02**: Migration creates `conversation_messages` table with `id`, `conversation_id`, `user_id`, `role` (`user|assistant`), `content`, `created_at` — RLS scoped to `user_id`
- [ ] **DB-03**: Migration creates `message_embeddings` table with `id`, `message_id`, `user_id`, `embedding vector(1536)`, `created_at` — HNSW index with `vector_cosine_ops`
- [ ] **DB-04**: Migration creates `people` table with `id`, `user_id`, `name`, `aliases text[]`, `facts jsonb`, `created_at`, `updated_at` — RLS scoped to `user_id`
- [ ] **DB-05**: Migration creates `memory_entries` table with `id`, `user_id`, `content`, `embedding vector(1536)`, `fact_type` (`preference|relationship|event|belief|goal|habit`), `confidence float` (0.0–1.0), `last_reinforced_at timestamptz`, `is_active boolean` (default true), `source_type` (`conversation|document`), `supersedes uuid NULL`, `created_at`, `updated_at` — HNSW index with `vector_cosine_ops`; RLS scoped to `user_id`
- [ ] **DB-06**: `search_user_memories` Postgres function encapsulates user-scoped HNSW similarity search with `iterative_scan = relaxed_order` and `ef_search = 40` — user isolation enforced inside function, not at call site
- [ ] **DB-07**: All tables have B-tree index on `user_id` for efficient filtering alongside HNSW index

### Embedding Layer

- [ ] **EMBED-01**: `EmbeddingModule` exports `EmbeddingService` that wraps `OpenAIEmbeddings` with model from `OPENAI_EMBEDDING_MODEL` env var, `dimensions: 1536` — shared by both chat path and extraction path
- [ ] **EMBED-02**: `EmbeddingService.embed(text: string): Promise<number[]>` — returns 1536-dim vector
- [ ] **EMBED-03**: Dimension mismatch detected at startup — `EMBEDDING_DIMS` env var validated against expected 1536

### Memory Data Layer

- [ ] **MEM-01**: `MemoryModule` exports `MemoryService` (CRUD for conversations, messages, memory_entries, message_embeddings) and `PeopleService` (CRUD for people)
- [ ] **MEM-02**: `MemoryService.searchSimilar(userId, embedding, topK)` calls the `search_user_memories` Postgres function — never constructs raw pgvector SQL at the service layer
- [ ] **MEM-03**: `MemoryService.upsertMemoryEntry(fact, vector, userId)` — checks cosine similarity > 0.90 before insert; if match found, updates `last_reinforced_at` and increments `confidence` instead of inserting duplicate
- [ ] **MEM-04**: `PeopleService.detectNames(text): string[]` — extracts proper noun names from text (used to trigger direct lookup)
- [ ] **MEM-05**: `PeopleService.lookupByNames(names, userId)` — direct `SELECT` from people table by name/aliases match for specified userId
- [ ] **MEM-06**: Every MemoryService and PeopleService method enforces `user_id` filter — no query returns data across users

### Chat Path (WebSocket)

- [ ] **CHAT-01**: `ChatGateway` uses Socket.io with `@WebSocketGateway` — handles `chat:send` event, emits `chat:chunk` per streamed token, emits `chat:complete` when stream ends
- [ ] **CHAT-02**: `userId` extracted from `socket.handshake.auth.userId` — Socket.io middleware validates UUID format and rejects non-UUID values before connection is accepted
- [ ] **CHAT-03**: `AbortController` created per socket connection — `handleDisconnect` aborts active stream; LLM stream passes `{ signal }` to stop token generation on disconnect
- [ ] **CHAT-04**: `LlmService.streamResponse()` returns `AsyncIterable<string>` — gateway iterates with `for await...of`, emits `chat:chunk` per iteration; never returns `WsResponse`
- [ ] **CHAT-05**: `LlmService` uses `ChatAnthropic` with model from `ANTHROPIC_MODEL` env var, `streaming: true` in constructor
- [ ] **CHAT-06**: Extraction triggered as fire-and-forget after stream completes — `void extractionService.enqueue(...)` with `.catch()` logging failure via NestJS Logger; gateway never awaits extraction
- [ ] **CHAT-07**: Memory injection: retrieved memories and people facts assembled into a structured block in system prompt (`[Memory: X | confidence: Y | last confirmed: Z]` format); only memories above a relevance threshold injected

### Hybrid Retrieval

- [ ] **RETR-01**: `RetrievalService.retrieve(text, userId): Promise<MemoryContext>` — orchestrates both retrieval arms in parallel
- [ ] **RETR-02**: Arm 1 — semantic retrieval: `EmbeddingService.embed(text)` then `MemoryService.searchSimilar(userId, vector, 5)` — top-k=5 by cosine similarity
- [ ] **RETR-03**: Arm 2 — named-entity retrieval: `PeopleService.detectNames(text)` then `PeopleService.lookupByNames(names, userId)` — direct SQL lookup, not vector search
- [ ] **RETR-04**: Both arms run concurrently (`Promise.all`) — combined result is the `MemoryContext` injected into chat

### Extraction Pipeline (Background)

- [ ] **EXTR-01**: `ExtractionModule` uses `@nestjs/bullmq` with queue name `'extraction'` — `ExtractionProcessor extends WorkerHost` processes jobs with `attempts: 3` and exponential backoff
- [ ] **EXTR-02**: LangGraph `StateGraph` with 4 nodes: Classify → Extract → Validate → Store — compiled graph is a private property of `ExtractionService`, constructed in constructor via closure over injected services
- [ ] **EXTR-03**: Classify node — GPT-4o-mini with model from `OPENAI_EXTRACTION_MODEL` env var classifies whether text contains extractable facts and what categories (`preference|relationship|event|belief|goal|habit`)
- [ ] **EXTR-04**: Extract node — GPT-4o-mini extracts typed `MemoryFact[]` with Zod schema requiring `content: string`, `factType`, `directlyStated: boolean`, `confidence: HIGH|MEDIUM|LOW`; conditional — skipped if Classify returns no extractable facts
- [ ] **EXTR-05**: Validate node — Zod schema validation + deduplication check via `MemoryService.findSimilar()` (cosine > 0.90 = duplicate, update instead of insert) + LLM-arbitrated contradiction resolution (sends candidate + existing similar facts to GPT-4o-mini: UPDATE / APPEND / IGNORE decision)
- [ ] **EXTR-06**: Store node — for each valid fact: `EmbeddingService.embed()` → `MemoryService.upsertMemoryEntry()`; if `factType === 'relationship'`, also `PeopleService.upsertPerson()`; if UPDATE decision, soft-deletes old entry (`is_active = false`) and sets `supersedes` FK
- [ ] **EXTR-07**: Only `HIGH` confidence facts stored in v1 — `MEDIUM` and `LOW` are logged but not persisted
- [ ] **EXTR-08**: All LangGraph nodes wrapped with error boundary — node failures logged via NestJS Logger with correlation ID; errors re-thrown to trigger BullMQ retry; no unhandled rejections
- [ ] **EXTR-09**: `ExtractionService.enqueue(text, userId, sourceType)` is the only public surface — ChatGateway and UploadController call only this method; they never import LangGraph

### Document Upload

- [ ] **UPLOAD-01**: REST `POST /upload` accepts `multipart/form-data` with text file (`.txt`, `.md`) and `userId` in request body
- [ ] **UPLOAD-02**: Uploaded text is enqueued via `ExtractionService.enqueue(text, userId, 'document')` — identical extraction pipeline as conversation messages
- [ ] **UPLOAD-03**: `userId` validated as UUID in upload controller before enqueue

### Testing

- [ ] **TEST-01**: Vitest unit tests for `RetrievalService` — mock `EmbeddingService` and `PeopleService` via `Test.createTestingModule().overrideProvider()`
- [ ] **TEST-02**: Vitest unit tests for each LangGraph node function — each node tested independently with mocked LLM responses
- [ ] **TEST-03**: Vitest unit tests for `MemoryService.upsertMemoryEntry()` — deduplication logic (similarity check + update path vs insert path)
- [ ] **TEST-04**: Vitest unit tests for `ChatGateway` — streaming path, fire-and-forget extraction call, AbortController on disconnect

---

## v2 Requirements

### Memory Quality

- **QUALITY-01**: Memory confidence decay — scheduled weekly job decrements confidence on unreinforced facts; facts below 0.2 threshold soft-deleted (`is_active = false`)
- **QUALITY-02**: Retrieval re-ranking — retrieve top-20 by cosine similarity, re-rank by relevance to current turn, truncate to top-5 before injection
- **QUALITY-03**: Query expansion — LLM generates 2-3 alternative phrasings before vector search to broaden semantic net

### Memory Management API

- **MGMT-01**: `GET /memories?userId=` — returns all active memories for a user (paginated)
- **MGMT-02**: `PATCH /memories/:id` — allows user to correct a wrong fact (updates `content`, resets `confidence: HIGH`, sets `last_reinforced_at: now`)
- **MGMT-03**: `DELETE /memories/:id` — soft-deletes a memory (`is_active = false`)
- **MGMT-04**: `GET /memories/export?userId=` — exports all memories as structured JSON (GDPR data portability)

### People API

- **PEOPLE-01**: `GET /people?userId=` — returns all people in user's social graph
- **PEOPLE-02**: `GET /people/:id` — returns a specific person and all their associated facts

---

## Out of Scope

| Feature | Reason |
|---------|--------|
| Frontend / client UI | Backend API only; a client may be built later but is not in scope for v1 |
| JWT authentication | userId in Socket.io handshake; RLS + service-role key is the security model for v1 |
| Hardcoded model names | All LLM model identifiers must come from env vars — never hardcoded in source |
| `console.log` | NestJS Logger is the only logging mechanism |
| `any` types | TypeScript strict; `unknown` with narrowing |
| Multi-modal memory (images, audio) | Separate embedding pipelines; trebles complexity; text-only for v1 |
| Real-time collaborative memory | Shared memories across users; ownership ambiguity; v3+ |
| Manual memory organization (tags, folders) | Classification taxonomy handles this without user effort |
| Memory-to-memory knowledge graph | Graph DB reasoning; not pgvector's strength; v3+ |
| Proactive push notifications | Requires scheduler, notification system, user preference management |
| Memory summarization / compression | Needed at scale after 3-6 months of heavy use; v2+ background job |
| Fine-tuned per-user models | Operationally brutal at multi-user scale; retrieval-augmented personalization is correct v1 |
| Plugin / integration ecosystem | Calendar, email, Spotify as memory sources is a product in itself |

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 through INFRA-07 | Phase 1 | Pending |
| DB-01 through DB-07 | Phase 1 | Pending |
| EMBED-01 through EMBED-03 | Phase 2 | Pending |
| MEM-01 through MEM-06 | Phase 2 | Pending |
| CHAT-01 through CHAT-07 | Phase 3 | Pending |
| RETR-01 through RETR-04 | Phase 3 | Pending |
| EXTR-01 through EXTR-09 | Phase 4 | Pending |
| UPLOAD-01 through UPLOAD-03 | Phase 5 | Pending |
| TEST-01 through TEST-04 | Phase 6 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-15*
*Last updated: 2026-04-15 after initial definition*
