# Pitfalls Research: Know Me

**Domain:** NestJS conversational memory agent (LangChain.js + LangGraph + pgvector + Socket.io)
**Researched:** 2026-04-15
**Confidence:** HIGH for individual library behaviors / MEDIUM for library interaction behaviors

---

## Critical (Blocks Launch)

### C1: Jest vs Vitest Config Conflict — Tests Will Never Run Correctly

**What goes wrong:** The scaffold ships with Jest fully configured in `package.json` (`"jest": {...}`, `"test": "jest"` script, `ts-jest` in devDependencies, `@types/jest`). If Vitest is installed without cleanly removing the Jest config, two incompatible type namespaces coexist — `describe`, `it`, and `expect` become ambiguous. `pnpm test` still runs Jest, ignoring the Vitest config.

**Symptom:** `Cannot find name 'describe'` or `Cannot find name 'vi'` in test files. Tests pass locally (wrong runner) and fail in CI.

**Fix — full migration:**
1. Remove from `package.json`: the entire `"jest"` block, `jest`, `ts-jest`, `@types/jest` from devDependencies
2. Add: `vitest`, `@vitest/coverage-v8`, `unplugin-swc`, `@swc/core` to devDependencies
3. Create `vitest.config.ts` with SWC plugin (required for decorator support — see C5)
4. Update scripts: `"test": "vitest run"`, `"test:watch": "vitest"`, `"test:cov": "vitest run --coverage"`
5. Add `"types": ["vitest/globals"]` to tsconfig so `describe`/`it`/`expect` resolve globally

---

### C2: LangChain.js ESM/CJS Import Paths Break Under `module: nodenext`

**What goes wrong:** The existing `tsconfig.json` uses `"module": "nodenext"`. Under `nodenext`, TypeScript enforces `package.json` exports maps strictly. Many tutorial examples show import paths like `from 'langchain/chat_models/openai'` — these paths were removed in 0.3.x.

**Symptom:** `error TS2307: Cannot find module 'langchain/chat_models/openai'`. Runtime `ERR_PACKAGE_PATH_NOT_EXPORTED` even when TS compiles (if `skipLibCheck: true` masks the type error).

**Fix — correct import sources:**
```typescript
// WRONG:
import { ChatOpenAI } from 'langchain/chat_models/openai';

// CORRECT:
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { StateGraph, Annotation } from '@langchain/langgraph';
```

---

### C3: pgvector HNSW Index Silently Ignored Without Operator Class

**What goes wrong:** Creating an HNSW index without specifying the vector operator class causes the Postgres query planner to fall back to sequential scan for every cosine similarity query.

**Symptom:** `EXPLAIN (ANALYZE)` shows `Seq Scan on memory_entries` instead of `Index Scan`. No error thrown. Results correct but slow.

**Fix — exact SQL:**
```sql
-- WRONG (planner ignores this for <=> operator):
CREATE INDEX ON memory_entries USING hnsw (embedding);

-- CORRECT:
CREATE INDEX ON memory_entries USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Set at query time:
SET hnsw.ef_search = 40;  -- default is 10; 40 gives ~95% recall
```

---

### C4: Supabase Service Role Key Bypasses RLS — All Users Can See All Data

**What goes wrong:** The service-role key has the `bypass rls` claim. Using it without explicit `user_id` filtering in every query means user A can retrieve user B's memories.

**Symptom:** No error. In single-user testing, invisible. In multi-user scenarios, data leaks across users.

**Fix:** Add `.eq('user_id', userId)` to every user-scoped query — it is mandatory and can never be omitted. Use a Postgres function with user_id as a parameter (see Mitigation Pattern C) to make user-scoping impossible to forget.

---

### C5: Vitest + NestJS Decorators Break Without SWC Transform

**What goes wrong:** Vitest's default esbuild transform does NOT process `emitDecoratorMetadata`. Running NestJS `@Injectable()` services under Vitest causes constructor parameters to receive `undefined`.

**Symptom:**
```
Nest can't resolve dependencies of SomeService (?).
Please make sure that the argument at index [0] is available in SomeModule context.
```

**Fix — `vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: { globals: true, environment: 'node' },
});
```

Required packages: `unplugin-swc`, `@swc/core`

---

### C6: NestJS WebSocket Gateway Uses WS Adapter by Default — Socket.io Clients Cannot Connect

**What goes wrong:** Without explicit adapter configuration, NestJS uses the built-in `WsAdapter` (raw WebSocket protocol). Socket.io clients use a different handshake protocol and silently fail to connect.

**Symptom:** Client emits `connect`, server shows no connection event. Socket.io client shows `xhr poll error`.

**Fix — `main.ts`:**
```typescript
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));  // required for Socket.io
  await app.listen(process.env.PORT ?? 3000);
}
```

---

## Significant (Degrades Quality)

### S1: tsconfig Has `noImplicitAny: false` — Contradicts "No any" Constraint

**What goes wrong:** The existing `tsconfig.json` sets `"noImplicitAny": false`. TypeScript silently infers `any` in callback parameters, JSON parse results, and LangChain SDK callback signatures. The "no any" constraint becomes unenforceable.

**Fix:**
```json
{ "compilerOptions": { "noImplicitAny": true } }
```
Enabling this will surface real issues in LangChain callbacks — address with `unknown` + type narrowing, not `as any`.

---

### S2: LangGraph.js State Type Inference Collapses Without Explicit `Annotation.Root`

**What goes wrong:** Without `Annotation.Root()`, TypeScript infers node function inputs as `unknown`, requiring `as` casts everywhere.

**Fix — use `Annotation.Root` from LangGraph 0.2.x:**
```typescript
const PipelineAnnotation = Annotation.Root({
  rawText: Annotation<string>(),
  userId: Annotation<string>(),
  classification: Annotation<'memory' | 'correction' | 'none' | 'pending'>({ default: () => 'pending' }),
  extractedFacts: Annotation<ExtractedFact[]>({
    reducer: (existing, incoming) => [...existing, ...incoming],
    default: () => [],
  }),
});

const classifyNode = async (
  state: typeof PipelineAnnotation.State,
): Promise<Partial<typeof PipelineAnnotation.State>> => {
  return { classification: 'memory' };
};
```

---

### S3: Socket.io + NestJS — Disconnect Does Not Cancel Active LLM Streams

**What goes wrong:** When a client disconnects mid-stream, the LangChain chain continues running, burning tokens and compute. Socket.io swallows the emit error silently.

**Fix — AbortController per socket:**
```typescript
@WebSocketGateway({ cors: true })
export class ChatGateway implements OnGatewayDisconnect {
  private readonly activeStreams = new Map<string, AbortController>();

  @SubscribeMessage('chat:send')
  async handleMessage(@ConnectedSocket() client: Socket, @MessageBody() payload: ChatPayload): Promise<void> {
    const controller = new AbortController();
    this.activeStreams.set(client.id, controller);
    try {
      await this.chatService.streamToClient(client, payload, controller.signal);
    } finally {
      this.activeStreams.delete(client.id);
    }
  }

  handleDisconnect(client: Socket): void {
    this.activeStreams.get(client.id)?.abort();
    this.activeStreams.delete(client.id);
  }
}
```

---

### S4: Background LangGraph Pipeline — Unhandled Rejections Crash Node 22 Process

**What goes wrong:** Node 22 terminates the process on unhandled promise rejections. A fire-and-forget extraction pipeline without `.catch()` will crash the server if any node throws.

**Fix:**
```typescript
// WRONG:
this.extractionPipeline.run(state);

// CORRECT:
this.extractionPipeline
  .run(state)
  .catch((error: unknown) => {
    this.logger.error(`[${correlationId}] Extraction pipeline failed`,
      error instanceof Error ? error.stack : String(error),
      ExtractionService.name);
  });
```

---

### S5: pgvector Filtered HNSW — User Filter Applied After Global Similarity Sort Returns Incomplete Top-K

**What goes wrong:** When `WHERE user_id = $1` is applied to an HNSW query, Postgres may scan globally (finding top-k across all users) then filter — returning fewer than k results for the user.

**Fix:** Use pgvector `iterative_scan` (available in pgvector >= 0.8.0):
```sql
SET hnsw.iterative_scan = relaxed_order;
SELECT id, content, 1 - (embedding <=> $1) AS similarity
FROM memory_entries WHERE user_id = $2
ORDER BY embedding <=> $1 LIMIT 5;
```
Also create a B-tree index on `user_id` to help Postgres plan the combined query.

---

### S6: LLM Fact Hallucination in Extraction Pipeline — Confident False Memories

**What goes wrong:** GPT-4o-mini extracts facts that were never stated: inferring from adjacent context, inverting relationships, fabricating specific details.

**Fix:**
1. Use `withStructuredOutput()` with a Zod schema requiring a `directlyStated: boolean` field — only store facts where `directlyStated: true`
2. In Validate node, re-read source text and confirm each fact traces to a literal phrase
3. Prompt: "Extract only facts explicitly stated. Do not infer, generalize, or elaborate."
4. Add `confidence: 'HIGH' | 'MEDIUM' | 'LOW'` to fact schema; only store `HIGH` in v1

---

### S7: Memory Deduplication — Cosine Similarity Alone Cannot Detect Contradiction

**What goes wrong:** "User is vegetarian" and "User eats chicken" are near-neighbors in embedding space (~0.88 similarity) but logically contradictory. Storing both poisons retrieval context.

**Fix:**
1. In Store node, retrieve top-3 semantically similar existing memories for the same `userId`
2. Send candidate + existing to a fast LLM call: "Does the new fact contradict any existing fact? If yes, which does it supersede?"
3. If supersedes detected: soft-delete the old memory (`is_active = false`), insert new one with `supersedes` reference

---

### S8: Supabase PgBouncer Transaction Mode Breaks `SET` Session Parameters

**What goes wrong:** Supabase uses PgBouncer in transaction mode on port 6543. `SET hnsw.ef_search` and `SET hnsw.iterative_scan` are session-level and do not persist across PgBouncer connections.

**Fix:**
- Connect via **direct connection** (port 5432) for vector operations, not the pooler port (6543)
- Or: embed `SET LOCAL` in the same transaction as the query
- Or: use a Postgres function with `SET LOCAL` inside — parameters persist for the function's lifetime even through PgBouncer (see Mitigation Pattern C)

---

### S9: LangChain.js Streaming — Callback vs AsyncIterator Are Incompatible Patterns

**What goes wrong:** Mixing LangChain callback-style streaming with Socket.io can cause double-emission or dropped tokens under concurrent load.

**Fix — always use the async generator pattern:**
```typescript
const stream = await this.llm.streamEvents(messages, { version: 'v2' });
for await (const event of stream) {
  if (event.event === 'on_chat_model_stream') {
    const content = event.data.chunk.content;
    if (typeof content === 'string' && content.length > 0) {
      client.emit('chat:chunk', { content });
    }
  }
}
client.emit('chat:complete');
```

---

## Minor (Good to Know)

### M1: pnpm Hoisting — LangChain Peer Dependencies Not Auto-Installed

pnpm does not hoist packages by default. Peer dependencies (`@anthropic-ai/sdk`, `openai`, `tiktoken`) must be installed explicitly. TS compilation may succeed via symlink resolution but runtime throws `Cannot find module`.

**Fix:** Explicitly install all peer dependencies. Run `pnpm why @anthropic-ai/sdk` to confirm direct installation.

---

### M2: `ChatAnthropic` Requires `streaming: true` in Constructor

Calling `.stream()` on a `ChatAnthropic` instance without `streaming: true` silently buffers the entire response and emits as a single chunk.

**Fix:** `new ChatAnthropic({ ..., streaming: true })`

---

### M3: `text-embedding-3-small` Dimension Mismatch Causes Runtime Error

The pgvector column must be `vector(1536)` and `OpenAIEmbeddings` must specify `dimensions: 1536`. Divergence throws at insert time: `ERROR: expected 1536 dimensions, not 512`.

**Fix:** Pin dimensions in both places. Add startup validation checking `EMBEDDING_DIMS` env var matches the DB column.

---

### M4: LangGraph Node Errors Lose Type Information When Propagated

LangGraph wraps errors from node execution as generic `Error` objects. A `ZodError` becomes a plain `Error` by the time it reaches `graph.invoke()`'s catch block — `instanceof ZodError` returns false.

**Fix:** Catch and handle typed errors within each node. Never let typed errors escape to the graph boundary.

---

### M5: Socket.io `userId` in Handshake — No Format Validation Allows Impersonation

Since there is no JWT, any string can be sent as `userId`. Combined with service-role bypassing RLS, this enables reading any user's data.

**Fix:** Add a Socket.io middleware that validates UUID format before accepting the connection:
```typescript
server.use((socket, next) => {
  const userId = socket.handshake.auth?.userId;
  if (typeof userId !== 'string' || !isUUID(userId)) {
    next(new Error('Invalid userId'));
    return;
  }
  next();
});
```

---

### M6: NestJS Logger Context — Inconsistent Strings Make Production Debugging Hard

Without a convention, tracing a single conversation through the pipeline requires reading all logs unfiltered.

**Fix — establish from the start:**
```typescript
private readonly logger = new Logger(ServiceClassName.name);
this.logger.log(`[${conversationId}] Extraction started`, ExtractionService.name);
this.logger.error(`[${conversationId}] Failed`, err.stack, EmbeddingService.name);
```

---

### M7: Vitest Mocking LangChain Classes — Module Mocks vs Provider Overrides

`vi.mock('@langchain/anthropic')` fights with NestJS DI — if `AppModule` initializes a provider before the mock is applied, the real SDK makes HTTP calls during test setup.

**Fix:** Use NestJS `overrideProvider()` instead of module mocks. Inject LangChain instances as named tokens (`'LLM_CLIENT'`, `'EMBEDDINGS_CLIENT'`) in module providers.

---

## Mitigation Patterns

### Pattern A: Typed Fire-and-Forget with Correlation Logging

Addresses: S4

```typescript
function fireAndForget(promise: Promise<unknown>, logger: Logger, context: string, correlationId: string): void {
  promise.catch((error: unknown) => {
    logger.error(`[${correlationId}] Background task failed`,
      error instanceof Error ? error.stack : String(error), context);
  });
}

// Usage:
fireAndForget(this.extractionPipeline.run(state), this.logger, ExtractionService.name, payload.conversationId);
```

---

### Pattern B: AbortController Tied to Socket Lifecycle

Addresses: S3 — see S3 fix above for full implementation.

---

### Pattern C: pgvector User-Scoped Query via Postgres Function

Addresses: C4, S5, S8 (combines user isolation + filtered HNSW + PgBouncer-safe parameter setting)

```sql
CREATE OR REPLACE FUNCTION search_user_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int DEFAULT 5,
  similarity_threshold float DEFAULT 0.75
)
RETURNS TABLE(id uuid, content text, similarity float, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET hnsw.iterative_scan = 'relaxed_order'
SET hnsw.ef_search = 40
AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.content, 1 - (m.embedding <=> query_embedding) AS similarity, m.created_at
  FROM memory_entries m
  WHERE m.user_id = match_user_id
    AND m.is_active = true
    AND 1 - (m.embedding <=> query_embedding) > similarity_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
```

This pattern: (a) enforces user isolation in the DB so it cannot be forgotten at the call site, (b) sets HNSW parameters within the function bypassing PgBouncer session issues, (c) uses `SECURITY DEFINER` safely because user_id is a parameter checked inside the function.

---

### Pattern D: Environment Validation at Bootstrap

Addresses: M2, M3, and general env-var safety

```typescript
// main.ts — run before NestFactory.create():
const REQUIRED_ENV = [
  'ANTHROPIC_MODEL', 'OPENAI_EXTRACTION_MODEL', 'OPENAI_EMBEDDING_MODEL',
  'EMBEDDING_DIMS', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'DATABASE_URL', 'REDIS_HOST', 'REDIS_PORT',
] as const;

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) throw new Error(`Missing required env var: ${key}`);
}
```

---

### Pattern E: LangGraph Node Boundary Wrapper

Addresses: M4, S4

```typescript
function makeNode<TState extends object>(
  name: string,
  fn: (state: TState) => Promise<Partial<TState>>,
  logger: Logger,
): (state: TState) => Promise<Partial<TState>> {
  return async (state: TState) => {
    try {
      return await fn(state);
    } catch (error: unknown) {
      logger.error(`LangGraph node '${name}' failed`,
        error instanceof Error ? error.stack : String(error), 'ExtractionPipeline');
      throw error;
    }
  };
}
```

---
*Research completed: 2026-04-15*
