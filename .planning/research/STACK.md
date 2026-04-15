# Stack Research: Know Me

**Researched:** 2026-04-15
**Overall confidence:** MEDIUM (findings from training data + project lock file audit; confidence levels noted per section)

---

## Chosen Stack Validation

### NestJS 11 — VALID

NestJS 11 is the current major version as of 2025. Lock file confirms 11.1.19 resolved (specifier `^11.0.1`). NestJS 11 requires Node 18.19+/20.11+/22+ — Node 22 LTS satisfies this cleanly.

### TypeScript 5.x strict — VALID WITH ONE GAP

Lock file resolves 5.9.3 from `^5.7.3`. `tsconfig.json` uses `module: nodenext` + `moduleResolution: nodenext` — correct for Node 22. `emitDecoratorMetadata: true` + `experimentalDecorators: true` are required for NestJS DI.

**Gap:** `noImplicitAny: false` deviates from the stated "TypeScript strict" constraint. Should be `true`.

### Node 22 LTS — VALID

Node 22 became LTS in October 2024. All NestJS 11, LangChain 0.3.x, and Socket.io 4.x support it.

### Socket.io (NestJS WebSockets) — VALID

`@nestjs/websockets` + `@nestjs/platform-socket.io` is the standard pattern. Socket.io 4.x is stable and well-supported.

### LangChain JS 0.3.x — VALID WITH CAVEATS

LangChain JS underwent a major architectural split in 2024. Required package structure for 2025:
- `@langchain/core` — base types, runnables, interfaces (always install)
- `@langchain/anthropic` — Claude models
- `@langchain/openai` — OpenAI models + embeddings
- `langchain` — high-level chains (LCEL), output parsers

Do NOT import from `langchain/llms/*` or `langchain/chat_models/*` — these paths were removed in 0.3.x.

### LangGraph JS 0.2.x — VALID WITH CAVEATS

`@langchain/langgraph` is correct. LangGraph JS reached stable 0.2.x in late 2024. The `Annotation.Root()` API is the current typed state definition pattern. Graphs compiled with `.compile()` are plain objects with no NestJS DI awareness — construction must live inside an `@Injectable()` service with dependencies captured by closure.

### pgvector via pg (raw) — VALID

Raw `pg` / node-postgres with pgvector extension is correct. No ORM needed. Avoid TypeORM's experimental pgvector support and Drizzle's ORM overhead. pgvector 0.5.0+ required for HNSW indexes — Supabase Docker images from mid-2024 onward include pgvector 0.7.x.

### Vitest — VALID (replaces Jest scaffold)

The Jest scaffold in `package.json` (Jest 30.3.0, ts-jest, @types/jest) must be fully removed. Vitest 2.x integrates with `@nestjs/testing` without changes to the test module. Critical configuration: SWC transform for decorator metadata (see Known Issues).

---

## Version Pinning

Recommended versions (MEDIUM confidence — verify with `pnpm outdated` before committing).

### Production Dependencies to Add

```json
{
  "@nestjs/websockets": "^11.1.19",
  "@nestjs/platform-socket.io": "^11.1.19",
  "@nestjs/config": "^3.3.0",
  "@nestjs/bullmq": "^10.0.0",
  "bullmq": "^5.0.0",
  "@langchain/core": "^0.3.0",
  "@langchain/anthropic": "^0.3.0",
  "@langchain/openai": "^0.3.0",
  "@langchain/langgraph": "^0.2.0",
  "langchain": "^0.3.0",
  "class-validator": "^0.14.1",
  "class-transformer": "^0.5.1",
  "pg": "^8.13.0",
  "socket.io": "^4.8.0",
  "zod": "^3.23.0",
  "multer": "^1.4.5-lts.1"
}
```

### Development Dependencies to Add

```json
{
  "vitest": "^2.2.0",
  "@vitest/coverage-v8": "^2.2.0",
  "vite-tsconfig-paths": "^5.0.0",
  "unplugin-swc": "^1.4.0",
  "@swc/core": "^1.7.0",
  "@types/pg": "^8.11.0",
  "@types/multer": "^1.4.11"
}
```

### Development Dependencies to Remove

```
jest
ts-jest
@types/jest
```

Also remove the `"jest"` config block from `package.json` and update `test`, `test:watch`, `test:cov` scripts.

### Version Rationale

| Package | Version | Rationale |
|---------|---------|-----------|
| `@nestjs/*` | `^11.1.19` | Match resolved version in lockfile |
| `@langchain/core` | `^0.3.0` | Stable post-restructure series; 0.2.x and below have deprecated paths |
| `@langchain/langgraph` | `^0.2.0` | Adds typed `Annotation` API — ergonomic in strict TypeScript |
| `bullmq` + `@nestjs/bullmq` | `^5.0.0` + `^10.0.0` | Official NestJS adapter; replaces deprecated `@nestjs/bull` (Bull v3) |
| `pg` | `^8.13.0` | node-postgres 8.x; v9 in development, not stable |
| `socket.io` | `^4.8.0` | NestJS WebSocket adapter targets Socket.io 4.x |
| `zod` | `^3.23.0` | LangChain uses Zod 3.x for schemas — stay aligned |
| `vitest` | `^2.2.0` | Node 22 support confirmed in 2.x |

---

## NestJS 11 Integration Patterns

### ConfigModule (env vars, global)

```typescript
// app.module.ts
ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })
```

`ConfigService` injectable anywhere. All LLM model names, API keys, and database URLs come from `configService.getOrThrow<string>('KEY')`.

### WebSocket Gateway (streaming pattern)

```typescript
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/chat' })
export class ChatGateway {
  @SubscribeMessage('chat:send')
  async handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ChatMessageDto,
  ): Promise<void> {
    const userId = client.handshake.auth['userId'] as string;

    for await (const chunk of this.chatService.streamResponse(userId, payload)) {
      client.emit('chat:chunk', { content: chunk });
    }
    client.emit('chat:complete', {});

    // Fire-and-forget — does NOT await
    void this.extractionService.enqueue(userId, payload.message, 'conversation');
  }
}
```

**Key:** Return type is `Promise<void>`. Do not use `WsResponse` — it sends a single ack and is incompatible with streaming.

### LangChain Clients as an Injectable Service

```typescript
@Injectable()
export class LlmService {
  readonly chatModel: ChatAnthropic;
  readonly extractionModel: ChatOpenAI;
  readonly embeddings: OpenAIEmbeddings;

  constructor(private readonly config: ConfigService) {
    this.chatModel = new ChatAnthropic({
      model: this.config.getOrThrow<string>('CLAUDE_MODEL'),
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
      streaming: true,
    });
    this.extractionModel = new ChatOpenAI({
      model: this.config.getOrThrow<string>('OPENAI_EXTRACTION_MODEL'),
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      temperature: 0,
    });
    this.embeddings = new OpenAIEmbeddings({
      model: this.config.getOrThrow<string>('OPENAI_EMBEDDING_MODEL'),
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      dimensions: 1536,
    });
  }
}
```

### LangGraph Pipeline — Service-Owned Graph Construction

```typescript
const ExtractionState = Annotation.Root({
  rawText: Annotation<string>(),
  categories: Annotation<string[]>({ default: () => [] }),
  extracted: Annotation<ExtractedFact[]>({ default: () => [] }),
  validated: Annotation<ExtractedFact[]>({ default: () => [] }),
});

@Injectable()
export class ExtractionService {
  private readonly graph;

  constructor(
    private readonly llm: LlmService,
    private readonly memoryService: MemoryService,
  ) {
    // Graph captures injected services via closure — no DI adapter needed
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const llm = this.llm;
    const memory = this.memoryService;

    return new StateGraph(ExtractionState)
      .addNode('classify', async (state) => { /* use llm */ return { categories: [] }; })
      .addNode('extract',  async (state) => { return { extracted: [] }; })
      .addNode('validate', async (state) => { return { validated: state.extracted }; })
      .addNode('store',    async (state) => { await memory.bulkInsert(state.validated); return {}; })
      .addEdge('__start__', 'classify')
      .addEdge('classify', 'extract')
      .addEdge('extract', 'validate')
      .addEdge('validate', 'store')
      .addEdge('store', '__end__')
      .compile();
  }
}
```

### pg Pool as a Global Custom Provider

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

// Injection in any service:
constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
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

### Vitest Configuration with SWC for Decorator Metadata

```typescript
// vitest.config.ts
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    swc.vite({
      module: { type: 'commonjs' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true, legacyDecorator: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
```

---

## Known Issues & Gotchas

### Critical: Vitest Missing Decorator Metadata (BREAKS DI)

Vitest's default Vite transform does not emit decorator metadata. Without `unplugin-swc` configured with `decoratorMetadata: true`, every NestJS test using `Test.createTestingModule()` will fail because injected dependencies will be `undefined`. This is the #1 NestJS + Vitest failure mode.

**Fix:** Configure `unplugin-swc` in `vitest.config.ts` before writing any tests.

### Critical: LangChain 0.3.x Legacy Import Paths Removed

`langchain/llms/openai`, `langchain/chat_models/anthropic`, `langchain/embeddings/openai` are removed in 0.3.x. These cause runtime `MODULE_NOT_FOUND` errors. Use `@langchain/openai` and `@langchain/anthropic` exclusively.

### Critical: Jest Scaffold Must Be Removed Before Vitest Works

`package.json` has a `"jest"` config block and `ts-jest` / `@types/jest` devDeps that conflict with Vitest transforms. Remove them entirely in Phase 1 before writing any tests.

### Moderate: Socket.io Handler Must NOT Return WsResponse for Streaming

`@SubscribeMessage` handlers that stream return `Promise<void>` and emit directly on the client socket. Returning `WsResponse` sends a single ack response — incompatible with streaming.

### Moderate: NestJS WebSocket Packages Must Version-Match Core

`@nestjs/platform-socket.io` and `@nestjs/websockets` must match `@nestjs/core` exactly. Version mismatch causes DI token conflicts at bootstrap. Always install with an explicit version, not just `^11`.

### Moderate: pgvector HNSW Requires pgvector >= 0.5.0

Verify with `SELECT extversion FROM pg_extension WHERE extname = 'vector';` after `docker compose up`. Supabase Docker images from mid-2024 onward include pgvector 0.7.x.

### Moderate: LangGraph Typed State with noImplicitAny

With `noImplicitAny: true` (which must be enabled), `Annotation.Root()` channel definitions need explicit type parameters. Without them, TypeScript infers `unknown` and graph node functions fail type checking.

### Moderate: BullMQ Requires Redis >= 7.2

BullMQ requires Redis >= 7.2 (for `LMPOP`). Add Redis to Docker Compose alongside Supabase — it is not included in Supabase's Docker image.

### Minor: class-validator AND class-transformer Both Required

`ValidationPipe` with `transform: true` uses `class-transformer` internally. Installing only `class-validator` causes runtime errors on transformation. Both must be production dependencies.

### Minor: @types/socket.io Is for Socket.io 2.x — Do Not Install

Socket.io 4.x ships its own TypeScript types inside the `socket.io` package. The old `@types/socket.io` DefinitelyTyped package causes type conflicts.

---

## What NOT to Use

| Avoid | Use Instead | Reason |
|-------|-------------|--------|
| `langchain/llms/*` or `langchain/chat_models/*` imports | `@langchain/openai`, `@langchain/anthropic` | Removed in LangChain 0.3.x; runtime `MODULE_NOT_FOUND` |
| TypeORM pgvector integration | Raw `pg` + SQL | Experimental, poorly typed, adds unnecessary ORM abstraction |
| `@nestjs/bull` (Bull v3) | `@nestjs/bullmq` | Deprecated; BullMQ is the current maintained version |
| `WsResponse` return from streaming handlers | `client.emit()` in `for await...of` | Sends single message; streaming needs per-chunk emit |
| `console.log` | `NestJS Logger` | Project constraint |
| `any` types | `unknown` + type narrowing | Project constraint |
| `@types/socket.io` (DefinitelyTyped) | Types from `socket.io` package | Targets Socket.io 2.x; conflicts with 4.x types |
| LangGraph checkpointer persistence for extraction | In-memory execution | Fire-and-forget extraction doesn't need durable checkpointing |

---

## Install Command Reference

```bash
# Production
pnpm add \
  @nestjs/websockets @nestjs/platform-socket.io @nestjs/config \
  @nestjs/bullmq bullmq \
  @langchain/core @langchain/anthropic @langchain/openai @langchain/langgraph langchain \
  class-validator class-transformer \
  pg zod socket.io multer

# Dev
pnpm add -D \
  vitest @vitest/coverage-v8 vite-tsconfig-paths \
  unplugin-swc @swc/core \
  @types/pg @types/multer

# Remove Jest scaffold
pnpm remove jest ts-jest @types/jest
# Then remove "jest" block from package.json and update test scripts to use vitest
```

---

## Confidence Levels

| Area | Confidence | Reasoning |
|------|------------|-----------|
| NestJS 11.1.19 | HIGH | From pnpm-lock.yaml directly |
| TypeScript 5.9.3 | HIGH | From pnpm-lock.yaml directly |
| LangChain 0.3.x package split | HIGH | Well-documented migration; import removals in changelog |
| LangGraph 0.2.x Annotation API | MEDIUM | Stable at training cutoff; may have minor additions since |
| Vitest + unplugin-swc decorator pattern | MEDIUM | Established 2024 pattern; verify plugin name on npm before use |
| pgvector HNSW index syntax | HIGH | Stable since pgvector 0.5.0 (2023) |
| BullMQ + @nestjs/bullmq | MEDIUM | Stable adapter; verify version against npm |
| Specific LangChain/LangGraph version numbers | LOW | Cannot verify against live npm; treat as starting point, run `pnpm outdated` |

---

## Open Questions

- Exact current versions of `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/openai` — run `pnpm add @langchain/core@latest` and inspect what resolves.
- Whether `unplugin-swc` has been renamed or superseded in 2025 — verify on npm before installing.
- Whether `@nestjs/config` 3.x is current or if NestJS 11 ships a 4.x module — check `@nestjs/config` npm page.
- pgvector version in the specific Supabase Docker image — run `SELECT extversion FROM pg_extension WHERE extname = 'vector';` after `docker compose up`.
- Redis version in Docker Compose — must be >= 7.2 for BullMQ.

---
*Research completed: 2026-04-15*
