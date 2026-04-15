# Architecture Research: Know Me

**Researched:** 2026-04-15
**Confidence:** HIGH (NestJS 11 module system, BullMQ, pgvector patterns stable; LangGraph JS MEDIUM — verify node API against current @langchain/langgraph docs before implementation)

---

## System Overview

Know Me is two separate runtime paths sharing a common database layer:

1. **Chat path** (latency-critical): WebSocket message in → hybrid retrieval → LLM stream → chunks out. Must complete streaming before the user perceives lag.
2. **Extraction path** (throughput-critical, latency-irrelevant): message/document text → BullMQ job → LangGraph pipeline (Classify → Extract → Validate → Store) → PostgreSQL writes. Runs entirely after the chat response is already streaming.

These two paths share only the database (Supabase PostgreSQL + pgvector) and EmbeddingService. They must never block each other.

```
Client (WebSocket)
    │
    ▼
ChatGateway (Socket.io)
    │  ├─ enqueueExtraction() ──► BullMQ Queue ──► ExtractionProcessor
    │  │                                                │
    │  ▼                                         LangGraph Pipeline
    │  RetrievalService                                 │
    │  │  ├─ pgvector cosine top-k=5                   ▼
    │  │  └─ PeopleService direct lookup          MemoryService (write)
    │  ▼                                                │
    │  LlmService (Claude stream)                       ▼
    │  │                                          PostgreSQL / Supabase
    │  ▼
    chat:chunk × N → chat:complete

REST Controller (document upload)
    │
    └─ enqueueExtraction() ──► same BullMQ Queue (same pipeline)
```

---

## NestJS Module Boundaries

### Module Map

| Module | File | Responsibility | Exports |
|--------|------|----------------|---------|
| `DatabaseModule` | `database.module.ts` | pg Pool factory, service-role setup | `PG_POOL` token |
| `EmbeddingModule` | `embedding.module.ts` | `text-embedding-3-small` via LangChain; single instance for both paths | `EmbeddingService` |
| `MemoryModule` | `memory.module.ts` | CRUD for all 5 tables (conversations, conversation_messages, message_embeddings, people, memory_entries) | `MemoryService`, `PeopleService` |
| `RetrievalModule` | `retrieval.module.ts` | Hybrid retrieval: pgvector cosine top-k=5 + people name-detection + direct lookup | `RetrievalService` |
| `LlmModule` | `llm.module.ts` | Claude streaming via LangChain ChatAnthropic; context assembly | `LlmService` |
| `ExtractionModule` | `extraction.module.ts` | LangGraph pipeline definition; BullMQ processor; owns enqueue() | `ExtractionService` |
| `ChatModule` | `chat.module.ts` | Socket.io gateway; session/user scoping; orchestrates retrieval → LLM → enqueue | `ChatGateway` |
| `UploadModule` | `upload.module.ts` | REST multipart endpoint; text extraction; enqueues to extraction queue | `UploadController` |
| `AppModule` | `app.module.ts` | Root: imports all feature modules, BullMQ.forRoot, global config | — |

### Why These Boundaries

**DatabaseModule is `@Global()`.** Needed by MemoryModule, ExtractionModule, RetrievalModule. Mark global to avoid listing it in every import array.

**EmbeddingModule is separate from MemoryModule and RetrievalModule.** Both the chat path (embed the query for retrieval) and the extraction path (embed facts before storing) call `text-embedding-3-small`. Centralizing prevents duplicate LangChain client instantiation and allows single-point rate limiting or caching.

**RetrievalModule is separate from LlmModule.** Retrieval is pure DB + embedding work. LLM is the streaming call. Separate modules mean retrieval is testable without an LLM mock, and retrieval strategy changes don't touch LLM code.

**ExtractionModule owns the LangGraph graph.** Graph definition, node implementations, and the BullMQ processor all live here. `ExtractionService.enqueue()` is the only surface that ChatModule and UploadModule ever call — they never import LangGraph directly.

**ChatModule = thin gateway.** The gateway dispatches to services; zero business logic lives in the gateway class itself.

---

## Data Flow

### Chat Path

```
Client ──WS──► ChatGateway.handleMessage(socket, { text })
                │
                1. Extract userId from socket.handshake.auth.userId
                2. Persist conversation_message (write via MemoryService)
                3. RetrievalService.retrieve(text, userId)
                │    ├── EmbeddingService.embed(text) → vector
                │    ├── MemoryService.pgvectorSearch(vector, userId, k=5)
                │    ├── PeopleService.detectNames(text)
                │    └── PeopleService.lookupByNames(names, userId)
                │    returns: MemoryContext { memories[], people[] }
                │
                4. LlmService.streamResponse(text, memoryContext, history)
                │    ├── Assembles system prompt with injected memories + people
                │    ├── ChatAnthropic({ streaming: true })
                │    └── Returns: AsyncIterable<string>
                │
                5. for await (const chunk of stream):
                │    socket.emit('chat:chunk', { chunk, messageId })
                │
                6. On stream end:
                │    socket.emit('chat:complete', { messageId, fullText })
                │    MemoryService.persistAssistantMessage(fullText, conversationId)
                │
                7. ExtractionService.enqueue(text, userId, 'conversation')
                   ← synchronous enqueue only; no await on pipeline completion
```

**Critical:** Step 7 is the only extraction-path touch from the chat handler. `enqueue()` adds a BullMQ job and returns immediately. The handler does not await pipeline completion.

**Streaming implementation:** `LlmService.streamResponse()` returns `AsyncIterable<string>`. The gateway iterates with `for await` and emits `chat:chunk` per iteration. AsyncIterable is preferred over RxJS Observable — simpler, no subscription lifecycle management, and LangChain's streaming API exposes AsyncIterable natively.

### Extraction Path

```
BullMQ Queue ('extraction')
    Job payload: { text, userId, sourceType: 'conversation' | 'document' }
    │
    ▼
ExtractionProcessor.process(job)   ← @Processor('extraction')
    │
    ▼
ExtractionService.runPipeline(text, userId)
    │
    ▼
LangGraph StateGraph:
    │
    ├── Node: Classify
    │    GPT-4o-mini → categories[], shouldExtract: boolean
    │
    ├── Node: Extract  (conditional: skip if shouldExtract=false)
    │    GPT-4o-mini per category → MemoryFact[]
    │
    ├── Node: Validate
    │    Zod schema validation + dedup via MemoryService.findSimilar()
    │    → validFacts[], duplicateIds[]
    │
    └── Node: Store
         For each validFact:
           EmbeddingService.embed(fact.text) → vector
           MemoryService.upsertMemoryEntry(fact, vector, userId)
           if fact.type === 'relationship':
             PeopleService.upsertPerson(fact, userId)
```

**LangGraph state shape:**

```typescript
interface ExtractionState {
  text: string;
  userId: string;
  sourceType: 'conversation' | 'document';
  categories: string[];
  shouldExtract: boolean;
  extractedFacts: MemoryFact[];
  validFacts: MemoryFact[];
  duplicateIds: string[];
  storedIds: string[];
}
```

**Error handling:** Each node is wrapped in try/catch. Node failures log via NestJS Logger. BullMQ job options: `attempts: 3`, exponential backoff. Failed jobs after max retries go to BullMQ's failed set — they do not crash the process.

Document upload uses the identical pipeline: `UploadController` extracts text from the file and calls `ExtractionService.enqueue(text, userId, 'document')`.

---

## Background Work Patterns in NestJS

### Recommended: BullMQ via @nestjs/bullmq

`@nestjs/bullmq` is the official NestJS adapter for BullMQ (replaces deprecated `@nestjs/bull`). Correct choice for NestJS 11.

| Option | Verdict | Reason |
|--------|---------|--------|
| BullMQ (`@nestjs/bullmq`) | **Use this** | Persistent jobs (survives restart), retry + backoff, concurrency control, failed queue |
| NestJS EventEmitter (in-process) | Avoid | Jobs lost on crash, no retry, no durability |
| `setImmediate` / raw Promise chain | Avoid | Same as EventEmitter; no observability |
| `@nestjs/schedule` (cron polling) | Wrong tool | Event-driven problem; polling adds latency and DB load |
| Separate worker process | Overkill for v1 | Valid at scale; BullMQ supports it later without refactor |

**Setup:**

```typescript
// app.module.ts
BullModule.forRoot({
  connection: {
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
  },
}),

// extraction.module.ts
BullModule.registerQueue({ name: 'extraction' }),

// extraction.processor.ts
@Processor('extraction')
export class ExtractionProcessor extends WorkerHost {
  async process(job: Job<ExtractionJobPayload>): Promise<void> {
    await this.extractionService.runPipeline(job.data);
  }
}
```

**Redis requirement:** BullMQ requires Redis. Add Redis to Docker Compose alongside Supabase — it is not included in Supabase's Docker image.

**Concurrency:** Set to match LLM API rate limits:

```typescript
@Processor('extraction', { concurrency: 3 })
```

---

## Build Order

```
Phase 1: Foundation
  DatabaseModule — pg Pool, schema migrations, RLS table definitions
  └── MUST be first: everything else depends on it
  └── Also: Jest → Vitest migration happens here

Phase 2: Core Data Layer
  EmbeddingModule — text-embedding-3-small via LangChain
  MemoryModule    — CRUD for all 5 tables; imports EmbeddingModule
  └── EmbeddingModule before MemoryModule (hard dependency)

Phase 3: Chat Path (build the latency-critical path first)
  RetrievalModule — pgvector + people lookup
  LlmModule       — Claude streaming
  ChatModule      — Socket.io gateway (ExtractionModule stubbed at this stage)
  └── Product is demo-able after this phase

Phase 4: Extraction Path
  ExtractionModule (real) — LangGraph pipeline + BullMQ processor
  └── Redis must be in Docker Compose before this phase
  └── ChatModule updated to call real enqueue()

Phase 5: Document Upload
  UploadModule — REST + file parsing + enqueue
  └── Thin layer; reuses ExtractionModule.enqueue()

Phase 6: Hardening
  Error handling, failed job inspection, Vitest suite, observability
```

**Rationale for chat-before-extraction ordering:** Building the chat path first produces a working, streaming, memory-aware product — even with extraction stubbed and memories pre-seeded. This validates the latency-critical path and pgvector retrieval before adding LangGraph and BullMQ complexity.

---

## pgvector + Supabase in NestJS

### Client Architecture

Use raw `pg` Pool — not `@supabase/supabase-js`, not TypeORM, not Prisma. The pg client expresses `<=>` cosine distance natively in SQL and avoids the `rpc()` indirection of the Supabase JS client.

```typescript
export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [{
    provide: PG_POOL,
    useFactory: (config: ConfigService) =>
      new Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL'), max: 10 }),
    inject: [ConfigService],
  }],
  exports: [PG_POOL],
})
export class DatabaseModule {}
```

### pgvector Cosine Similarity Query

```typescript
async findSimilar(userId: string, embedding: number[], topK = 5) {
  const result = await this.pool.query(
    `SELECT id, content, 1 - (embedding <=> $1::vector) AS similarity
     FROM memory_entries
     WHERE user_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [`[${embedding.join(',')}]`, userId, topK],
  );
  return result.rows;
}
```

### HNSW Index (not IVFFlat)

```sql
CREATE INDEX ON memory_entries
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX ON message_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

IVFFlat requires training on existing rows and degrades with incremental inserts. HNSW maintains index quality automatically — correct for an incrementally-growing table.

### Migrations

Use Supabase CLI migrations only — never create tables from application code or NestJS lifecycle hooks. Migration files live in `supabase/migrations/`. Apply with `supabase db push` locally. Schema changes tracked in git.

---

## Module Dependency Graph

```
AppModule
├── DatabaseModule (@Global)     ← no imports
├── EmbeddingModule              ← no imports
├── MemoryModule                 ← DatabaseModule, EmbeddingModule
├── RetrievalModule              ← MemoryModule, EmbeddingModule
├── LlmModule                    ← ConfigModule only
├── ExtractionModule             ← MemoryModule, EmbeddingModule, BullMQ
├── ChatModule                   ← RetrievalModule, LlmModule, ExtractionModule
└── UploadModule                 ← ExtractionModule
```

No circular dependencies. DatabaseModule is `@Global()` so it does not appear in every import array.

---

## Anti-Patterns to Avoid

1. **Awaiting extraction in the chat handler.** `enqueue()` must be fire-and-forget (`void this.extractionService.enqueue(...)`). Any `await` adds GPT-4o-mini latency on top of Claude streaming latency.
2. **Using IVFFlat.** Degrades silently on incremental inserts. Use HNSW.
3. **God MemoryModule.** MemoryModule = CRUD only. Retrieval logic, pipeline writes, and people lookups belong in separate modules.
4. **In-process EventEmitter for extraction.** Lost jobs on restart = permanently lost memories. BullMQ provides durability and retry at minimal operational cost (one Redis container).
5. **Returning `WsResponse` from streaming handlers.** Use `client.emit()` inside `for await...of`. `WsResponse` sends a single ack — incompatible with streaming.

---

## Open Questions

- **LangGraph JS API version:** Confirm whether `StateGraph` uses `Annotation.Root` or channel-based state definition in the version installed. Check current `@langchain/langgraph` docs before building Phase 4.
- **Redis version for BullMQ:** BullMQ requires Redis >= 7.2 (for `LMPOP`). Confirm the Docker image version in Compose.
- **`SUPABASE_SERVICE_ROLE_KEY` in local dev:** Confirm Supabase Docker exposes this in `supabase status` output.

---
*Research completed: 2026-04-15*
