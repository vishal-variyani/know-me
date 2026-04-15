# Phase 3: Chat Path - Research

**Researched:** 2026-04-16
**Domain:** NestJS WebSocket Gateway, LangChain Anthropic streaming, Hybrid memory retrieval
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Load the last 10 messages from `conversation_messages` for the current conversation and pass them as chat history on every `chat:send` turn. The LLM receives both the memory block (system prompt) and prior conversation turns.

**D-02:** 10 messages is a hard-coded constant for v1 (not an env var). Fetched via a DB read per turn before the LLM call starts.

**D-03:** Only inject memories with similarity score >= 0.7 into the system prompt. Memories returned by `search_user_memories` (top-5 by cosine) are filtered by this threshold before building the `[Memory: ...]` block. If no memories meet the threshold, the block is omitted from the system prompt entirely.

**D-04:** The 0.7 threshold applies to the `similarity` field on `MemorySearchResult` (already defined in `memory.types.ts` as the `1 - cosine_distance` value from `search_user_memories`).

### Claude's Discretion

- Conversation creation strategy — whether a conversation is created per-connection (`handleConnection`) or lazily on first `chat:send`; how conversationId is tracked within the gateway
- Exact system prompt copy/structure around the `[Memory: X | confidence: Y | last confirmed: Z]` block
- Assistant message persistence timing — whether the full assembled response is saved to `conversation_messages` after stream completes, or per-chunk; either is acceptable as long as persistence completes before extraction is enqueued
- Error event format for stream failures (shape of `chat:error` payload)
- UUID validation error handling — whether gateway disconnects the socket silently or emits an error event before closing

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | `ChatGateway` uses Socket.io with `@WebSocketGateway` — handles `chat:send` event, emits `chat:chunk` per streamed token, emits `chat:complete` when stream ends | NestJS WebSocket gateway pattern; `@SubscribeMessage` + manual `client.emit()` for streaming (not `WsResponse`) |
| CHAT-02 | `userId` extracted from `socket.handshake.auth.userId` — Socket.io middleware validates UUID format and rejects non-UUID values before connection is accepted | Socket.io `use()` middleware in `afterInit()`; UUID regex validation; `next(new Error(...))` to reject |
| CHAT-03 | `AbortController` created per socket connection — `handleDisconnect` aborts active stream; LLM stream passes `{ signal }` to stop token generation on disconnect | LangChain `RunnableConfig.signal?: AbortSignal`; pass to `llm.stream(messages, { signal })` |
| CHAT-04 | `LlmService.streamResponse()` returns `AsyncIterable<string>` — gateway iterates with `for await...of`, emits `chat:chunk` per iteration; never returns `WsResponse` | LangChain `ChatAnthropic.stream()` returns `IterableReadableStream<AIMessageChunk>`; extract `.content` as string per chunk |
| CHAT-05 | `LlmService` uses `ChatAnthropic` with model from `ANTHROPIC_MODEL` env var, `streaming: true` in constructor | `@langchain/anthropic` not yet installed; verified as version 1.3.26 on npm; add to dependencies |
| CHAT-06 | Extraction triggered as fire-and-forget after stream completes — `void extractionService.enqueue(...)` with `.catch()` logging via NestJS Logger; gateway never awaits | ExtractionService stub (interface + no-op or queued stub) required; wired in Phase 4 |
| CHAT-07 | Memory injection: `[Memory: X \| confidence: Y \| last confirmed: Z]` block in system prompt; only memories >= threshold injected | RetrievalService builds `MemoryContext`; gateway formats system prompt block |
| RETR-01 | `RetrievalService.retrieve(text, userId): Promise<MemoryContext>` — orchestrates both retrieval arms in parallel | New service in `RetrievalModule`; depends on `EmbeddingService` and `MemoryModule` providers |
| RETR-02 | Arm 1 — semantic retrieval: `EmbeddingService.embed(text)` then `MemoryService.searchSimilar(userId, vector, 5)` — top-k=5 by cosine similarity | Both methods exist and are ready; `searchSimilar` returns `MemorySearchResult[]` with `similarity` field |
| RETR-03 | Arm 2 — named-entity retrieval: `PeopleService.detectNames(text)` then `PeopleService.lookupByNames(names, userId)` — direct SQL lookup | Both methods exist and are ready; `detectNames` is synchronous; `lookupByNames` is async |
| RETR-04 | Both arms run concurrently (`Promise.all`) — combined result is the `MemoryContext` injected into chat | `Promise.all([semanticArm, peopleArm])` pattern; semantic arm is `async`; people arm has sync detect + async lookup |
</phase_requirements>

---

## Summary

Phase 3 builds the latency-critical real-time path: a NestJS WebSocket gateway that validates userId from the Socket.io handshake, streams Claude responses as `chat:chunk` events, injects hybrid-retrieved memories into context, loads the last 10 messages of conversation history, and stubs extraction as fire-and-forget.

The core technical challenge is three-way integration: (1) Socket.io middleware for pre-connection UUID validation, (2) LangChain `ChatAnthropic.stream()` wired to an `AbortController` that is triggered on socket disconnect, and (3) concurrent memory retrieval via `Promise.all` across the semantic (vector) arm and the named-entity (people) arm.

The phase requires installing one new package (`@langchain/anthropic`) and adding one new method to the existing `MemoryService` (`getRecentMessages`). All other building blocks — `EmbeddingService`, `MemoryService`, `PeopleService`, the pg pool, Socket.io adapter — are already wired and ready.

**Primary recommendation:** Implement in four plans: (1) `LlmService` + `ChatModule` (streaming core); (2) `RetrievalService` + `RetrievalModule` (concurrent retrieval); (3) `ChatGateway` (WebSocket + auth + stream + abort); (4) `ExtractionService` stub + wire-up.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UUID validation / connection auth | API / Backend (Socket.io middleware) | — | Must run before connection is accepted; belongs in transport middleware, not handler |
| Message streaming to client | API / Backend (WebSocket gateway) | — | Gateway owns emit loop; LlmService produces the stream |
| LLM call + token streaming | API / Backend (LlmService) | — | Service layer wraps LangChain; gateway consumes AsyncIterable |
| Abort on disconnect | API / Backend (ChatGateway) | — | AbortController per-socket; triggered in `handleDisconnect` |
| Hybrid memory retrieval | API / Backend (RetrievalService) | — | Orchestrates EmbeddingService + MemoryService + PeopleService |
| Semantic search (vector) | Database / Storage (pgvector fn) | API / Backend (MemoryService) | `search_user_memories` DB function does cosine search; MemoryService is the call-site |
| Named-entity lookup | API / Backend (PeopleService) | Database / Storage | compromise NLP runs in process; SQL lookup hits pg |
| Conversation history load | Database / Storage (pg) | API / Backend (MemoryService) | `getRecentMessages` reads `conversation_messages` with LIMIT 10 ORDER BY created_at DESC |
| System prompt assembly | API / Backend (ChatGateway) | — | Gateway builds final message array from memories + history + current turn |
| Fire-and-forget extraction | API / Backend (ExtractionService stub) | — | Stub fulfills the interface; Phase 4 replaces with real queue |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nestjs/websockets` | 11.1.19 | Gateway decorators (`@WebSocketGateway`, `@SubscribeMessage`, etc.) | Already installed; NestJS official WS package |
| `@nestjs/platform-socket.io` | 11.1.19 | Socket.io adapter; `IoAdapter` already wired in `main.ts` | Already installed; IoAdapter confirmed in main.ts |
| `@langchain/anthropic` | 1.3.26 | `ChatAnthropic` with `.stream()` method; model from env | **NOT YET INSTALLED** — must add to dependencies |
| `@langchain/core` | 1.1.40 | `BaseMessageChunk`, `RunnableConfig` (carries `signal`) | Already installed; `signal?: AbortSignal` field on `RunnableConfig` [VERIFIED: node_modules/@langchain/core/dist/runnables/types.d.ts] |
| `socket.io` | 4.x (transitive via @nestjs/platform-socket.io) | Socket type (`Socket` from `socket.io`) | Transitive dependency; import type from `socket.io` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | NOT installed | UUID v4 regex validation | Not needed — use inline regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` in middleware |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@langchain/anthropic ChatAnthropic` | Anthropic SDK directly | Direct SDK works but bypasses LangChain's `RunnableConfig.signal` integration and requires manual chunk parsing — LangChain is the project standard |
| Inline UUID regex | `uuid` package `validate()` | `uuid` not installed and not worth adding for one regex; inline regex is simpler and zero-dependency |
| Socket.io middleware (`socket.use()`) | `handleConnection` + `client.disconnect()` | Middleware is the cleaner pattern — rejects the connection before it is fully accepted; `handleConnection` approach allows the connection but then closes it, which can emit misleading events |

**Installation:**
```bash
pnpm add @langchain/anthropic
```

**Version verification:** [VERIFIED: npm registry] — `@langchain/anthropic@1.3.26` is current as of 2026-04-16.

---

## Architecture Patterns

### System Architecture Diagram

```
Socket.io client
      |
      | connect (handshake.auth.userId)
      v
[Socket.io middleware]  ← afterInit() registers use()
  UUID regex check
  fail → next(Error) → connection rejected
  pass → next() → connection accepted
      |
      | chat:send {message: string}
      v
[ChatGateway.handleChatSend()]
      |
      +---> [MemoryService.createConversation()] (lazy, on first send if no conversationId)
      |
      +---> [MemoryService.addMessage(conv, user, 'user', text)]  // persist user message
      |
      +---> [MemoryService.getRecentMessages(conversationId, 10)]  // history
      |
      +---> [RetrievalService.retrieve(text, userId)]
      |           |
      |           | Promise.all([
      |           |   EmbeddingService.embed(text) → MemoryService.searchSimilar(user, vec, 5),
      |           |   PeopleService.detectNames(text) → PeopleService.lookupByNames(names, user)
      |           | ])
      |           |
      |           v
      |       MemoryContext { memories: MemorySearchResult[], people: PersonRow[] }
      |
      +---> build system prompt (memory block if any >= 0.7, else empty)
      |
      +---> [LlmService.streamResponse(messages, { signal })]
      |           |
      |           | ChatAnthropic.stream(messages, { signal: abortCtrl.signal })
      |           | → AsyncIterable<string>
      |
      | for await token of stream:
      |   client.emit('chat:chunk', { token })
      |   accumulate fullResponse
      |
      | stream done:
      |   [MemoryService.addMessage(conv, user, 'assistant', fullResponse)]
      |   client.emit('chat:complete', { conversationId })
      |   void extractionService.enqueue(text+fullResponse, userId, 'conversation').catch(logger.error)
      |
      | disconnect:
      |   abortController.abort()  ← stops in-flight LLM stream
```

### Recommended Project Structure

```
src/
├── chat/
│   ├── chat.gateway.ts          # WebSocket gateway, streaming loop, abort
│   ├── chat.module.ts           # imports RetrievalModule, LlmModule (or inline LlmService)
│   └── chat.types.ts            # ChatSendPayload, ChatChunkPayload, ChatCompletePayload
├── llm/
│   ├── llm.service.ts           # ChatAnthropic wrapper, streamResponse()
│   └── llm.module.ts            # exports LlmService
├── retrieval/
│   ├── retrieval.service.ts     # retrieve(), Promise.all orchestration
│   ├── retrieval.module.ts      # imports EmbeddingModule, MemoryModule; exports RetrievalService
│   └── retrieval.types.ts       # MemoryContext type
└── extraction/
    ├── extraction.service.ts    # stub: enqueue() is a no-op or logs; Phase 4 replaces
    └── extraction.module.ts     # exports ExtractionService
```

### Pattern 1: Socket.io Middleware for UUID Validation

**What:** Register a Socket.io `use()` middleware on the server instance in `afterInit()`. The middleware runs before `handleConnection`. If validation fails, call `next(new Error(...))` — Socket.io drops the connection before it is established.

**When to use:** Any pre-connection validation that must block the connection entirely.

```typescript
// Source: verified from NestJS docs + Socket.io middleware API
import {
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@WebSocketGateway()
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ChatGateway.name);

  afterInit(server: Server): void {
    server.use((socket: Socket, next) => {
      const userId = socket.handshake.auth['userId'] as unknown;
      if (typeof userId !== 'string' || !UUID_REGEX.test(userId)) {
        next(new Error('Invalid userId: must be a valid UUID'));
        return;
      }
      next();
    });
  }

  handleConnection(client: Socket): void {
    const userId = client.handshake.auth['userId'] as string;
    // Create AbortController, store per-client
    this.abortControllers.set(client.id, new AbortController());
    this.logger.log(`Client connected: ${client.id} userId=${userId}`);
  }

  handleDisconnect(client: Socket): void {
    const ctrl = this.abortControllers.get(client.id);
    if (ctrl) {
      ctrl.abort();
      this.abortControllers.delete(client.id);
    }
  }
}
```

### Pattern 2: LangChain ChatAnthropic Streaming with AbortSignal

**What:** `ChatAnthropic.stream()` returns `IterableReadableStream<AIMessageChunk>`. The second argument is `Partial<CallOptions>` which extends `RunnableConfig`. `RunnableConfig` has `signal?: AbortSignal` — passing the AbortController's signal cancels the HTTP request to Anthropic mid-stream.

**When to use:** Every LLM call in the chat path.

```typescript
// Source: [VERIFIED: node_modules/@langchain/core/dist/runnables/types.d.ts line 64-68]
// + [CITED: https://docs.langchain.com/oss/javascript/langchain/streaming]
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';

// In LlmService constructor (OnModuleInit):
this.llm = new ChatAnthropic({
  model: this.config.getOrThrow<string>('ANTHROPIC_MODEL'),
  streaming: true,
});

// streamResponse() returns AsyncIterable<string>
async *streamResponse(
  messages: BaseMessage[],
  signal: AbortSignal,
): AsyncIterable<string> {
  const stream = await this.llm.stream(messages, { signal });
  for await (const chunk of stream) {
    const text = typeof chunk.content === 'string'
      ? chunk.content
      : chunk.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map((c) => c.text)
          .join('');
    if (text) yield text;
  }
}
```

### Pattern 3: Streaming Chat Handler (fire-and-forget extraction)

**What:** The `@SubscribeMessage('chat:send')` handler must be `async` and return `void` (not `WsResponse`). It emits events directly via `client.emit()`. Fire-and-forget extraction is called with `void` to drop the Promise.

**When to use:** Any streaming event handler in NestJS WebSocket gateway.

```typescript
// Source: [CITED: NestJS docs - websockets/gateways.md]
@SubscribeMessage('chat:send')
async handleChatSend(
  @ConnectedSocket() client: Socket,
  @MessageBody() payload: ChatSendPayload,
): Promise<void> {
  const userId = client.handshake.auth['userId'] as string;
  const ctrl = this.abortControllers.get(client.id);
  if (!ctrl) return; // client disconnected before handler ran

  let fullResponse = '';
  try {
    const [memoryContext, history] = await Promise.all([
      this.retrievalService.retrieve(payload.message, userId),
      this.memoryService.getRecentMessages(this.getConversationId(client), 10),
    ]);

    const messages = buildMessages(memoryContext, history, payload.message);

    for await (const token of this.llmService.streamResponse(messages, ctrl.signal)) {
      client.emit('chat:chunk', { token });
      fullResponse += token;
    }

    await this.memoryService.addMessage(
      this.getConversationId(client),
      userId,
      'assistant',
      fullResponse,
    );
    client.emit('chat:complete', { conversationId: this.getConversationId(client) });

    void this.extractionService
      .enqueue(payload.message + '\n' + fullResponse, userId, 'conversation')
      .catch((err: unknown) => this.logger.error('Extraction enqueue failed', err));

  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Client disconnected — normal path, no error event needed
      return;
    }
    this.logger.error('Stream error', err);
    client.emit('chat:error', { message: 'Stream failed' });
  }
}
```

### Pattern 4: RetrievalService with Promise.all

**What:** Both arms must start simultaneously. The semantic arm is fully async (embed → searchSimilar). The people arm has a synchronous detect step followed by an async lookup.

**When to use:** Any parallel retrieval operation.

```typescript
// Source: [CITED: REQUIREMENTS.md RETR-04]
async retrieve(text: string, userId: string): Promise<MemoryContext> {
  const [memories, people] = await Promise.all([
    // Arm 1: semantic
    this.embeddingService.embed(text)
      .then((vec) => this.memoryService.searchSimilar(userId, vec, 5)),
    // Arm 2: named-entity (detectNames is synchronous)
    this.peopleService.lookupByNames(
      this.peopleService.detectNames(text),
      userId,
    ),
  ]);
  return { memories, people };
}
```

### Pattern 5: MemoryService.getRecentMessages (NEW method required)

**What:** `MemoryService` does not yet have a method to fetch the last N messages of a conversation. Phase 3 adds it.

```typescript
// SELECT with ORDER BY DESC + LIMIT, then reverse for chronological order
async getRecentMessages(
  conversationId: string,
  limit: number,
): Promise<ConversationMessageRow[]> {
  const result = await this.pool.query<ConversationMessageRow>(
    `SELECT id, conversation_id, user_id, role, content, created_at
     FROM conversation_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );
  // Reverse to chronological order (oldest first)
  return result.rows.reverse();
}
```

### Anti-Patterns to Avoid

- **Returning `WsResponse` from streaming handler:** NestJS treats the return value of `@SubscribeMessage` handlers as a single response. For streaming, always emit directly via `client.emit()` and return `Promise<void>`.
- **Awaiting extraction:** `void extractionService.enqueue(...)` with `.catch()` is mandatory. Never `await extractionService.enqueue(...)` in the chat path — it blocks the response.
- **Storing AbortController as a class property (single instance):** Multiple concurrent clients each need their own `AbortController`. Use a `Map<string, AbortController>` keyed on `client.id`.
- **Not reversing the `ORDER BY DESC` history result:** The DB query fetches latest-first for efficiency with LIMIT, but LLM context requires chronological (oldest-first) order. Always `.reverse()` after fetching.
- **Passing `signal` as top-level to `ChatAnthropic` constructor:** The `signal` goes in the runtime `stream()` options, not the constructor. The constructor only takes static config (model, streaming flag, etc.).
- **Using `any` type for handshake.auth:** TypeScript strict mode requires `socket.handshake.auth['userId'] as unknown` with a runtime type check before narrowing to `string`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM streaming + backpressure | Custom HTTP SSE/chunked reader | `ChatAnthropic.stream()` → `AsyncIterable` | LangChain handles Anthropic's streaming protocol, SSE parsing, error retries |
| AbortSignal plumbing | Custom cancellation flag/event | `AbortController` + `RunnableConfig.signal` | Native browser/Node API; LangChain passes it to the underlying HTTP client automatically |
| Concurrent async fan-out | Manual `Promise` chaining | `Promise.all([arm1, arm2])` | Standard; handles partial failures correctly when one arm is fully async and other has sync prefix |
| UUID format validation | Custom parser | Inline regex `/^[0-9a-f]{8}-...-[0-9a-f]{12}$/i` | One line, zero dependencies, covers all UUID versions |
| Socket.io connection rejection | Custom `handleConnection` disconnect dance | `server.use(middleware)` with `next(new Error(...))` | Middleware runs before connection is established; cleaner and prevents resource leaks |

**Key insight:** The streaming + abort pattern is the entire phase's technical complexity. Everything else is wiring. Get `ChatAnthropic.stream(messages, { signal })` correct first.

---

## Common Pitfalls

### Pitfall 1: `@langchain/anthropic` Not Installed

**What goes wrong:** `Cannot find module '@langchain/anthropic'` at runtime or TypeScript compile time.
**Why it happens:** Package.json only has `@langchain/core` and `@langchain/openai`. `ChatAnthropic` is in a separate package.
**How to avoid:** First task of the phase: `pnpm add @langchain/anthropic` before writing `LlmService`.
**Warning signs:** TypeScript error on `import { ChatAnthropic } from '@langchain/anthropic'`.

### Pitfall 2: AbortError Not Caught Separately

**What goes wrong:** When a socket disconnects mid-stream, the `for await` loop throws an `AbortError`. If not caught and distinguished from real errors, the gateway logs a spurious error and may emit `chat:error` to a disconnected client.
**Why it happens:** `AbortController.abort()` causes the underlying fetch to throw `DOMException: The operation was aborted` with `name === 'AbortError'`.
**How to avoid:** In the `catch` block, check `err instanceof Error && err.name === 'AbortError'` and return silently.
**Warning signs:** "Aborted" errors in logs on normal client disconnects.

### Pitfall 3: AbortController Not Cleaned Up on Non-Streaming Disconnect

**What goes wrong:** Map of AbortControllers grows unbounded if `handleDisconnect` is not called or the `Map` entry is not deleted.
**Why it happens:** NestJS does call `handleDisconnect` on Socket.io disconnect events, but if an exception occurs in `handleConnection` before the controller is registered, the `delete` in `handleDisconnect` silently no-ops (Map.delete is safe on missing keys).
**How to avoid:** Register the `AbortController` at the TOP of `handleConnection` before any async work. Always `abortControllers.delete(client.id)` in `handleDisconnect`.
**Warning signs:** Memory growing with concurrent users in load tests.

### Pitfall 4: History Fetched in Wrong Order

**What goes wrong:** The LLM receives messages in reverse order (newest first), which produces incoherent context.
**Why it happens:** `ORDER BY created_at DESC LIMIT 10` is efficient but returns newest-first. If `.reverse()` is omitted, the oldest messages appear last in the context window.
**How to avoid:** Always call `.reverse()` on the array returned by `getRecentMessages` before building the message list for the LLM — OR use the subquery pattern `SELECT * FROM (SELECT ... ORDER BY DESC LIMIT 10) sub ORDER BY created_at ASC`. The simple `.reverse()` on the application side is clearer.
**Warning signs:** LLM responses referencing context non-sequentially.

### Pitfall 5: AIMessageChunk.content Type is `string | MessageContentComplex[]`

**What goes wrong:** `chunk.content` is not always a plain string. For standard text models it usually is, but for extended thinking or tool-use responses it can be `MessageContentComplex[]`.
**Why it happens:** LangChain's `BaseMessageChunk.content` has a union type. Claude's normal text responses DO return `string`, but defensive code prevents future breakage.
**How to avoid:** In `LlmService.streamResponse()`, always check: `typeof chunk.content === 'string' ? chunk.content : complexContentToString(chunk.content)`. See code example in Pattern 2.
**Warning signs:** TypeScript strict mode will catch this if `noImplicitAny: true` forces explicit type handling.

### Pitfall 6: Conversation ID Not Available at First `chat:send`

**What goes wrong:** If conversation is created lazily on first `chat:send`, the gateway needs to track `conversationId` per client across multiple messages. A simple class-level `Map<socketId, conversationId>` is required.
**Why it happens:** Socket.io connections are stateful (per-connection), but the gateway class is a singleton.
**How to avoid:** Maintain `private readonly conversationIds = new Map<string, string>()`. Create conversation on first send, store the ID, reuse on subsequent sends. Clean up in `handleDisconnect`.
**Warning signs:** Each `chat:send` creates a new conversation row.

### Pitfall 7: Missing `.js` Extension on Local Imports

**What goes wrong:** `Cannot find module './llm.service'` at runtime under `moduleResolution: nodenext`.
**Why it happens:** ESM under nodenext requires explicit `.js` extensions on local imports even in TypeScript source.
**How to avoid:** All local imports must end in `.js` (e.g., `import { LlmService } from './llm.service.js'`). This is the established pattern throughout the codebase.
**Warning signs:** Runtime `ERR_MODULE_NOT_FOUND` errors.

---

## Code Examples

### LlmService: ChatAnthropic initialization and streaming

```typescript
// Source: [VERIFIED: node_modules/@langchain/core/dist/runnables/types.d.ts] + [CITED: https://docs.langchain.com/oss/javascript/langchain/streaming]
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseMessage } from '@langchain/core/messages';

@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private llm!: ChatAnthropic;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const model = this.config.getOrThrow<string>('ANTHROPIC_MODEL');
    this.llm = new ChatAnthropic({ model, streaming: true });
    this.logger.log(`LlmService initialized with model=${model}`);
  }

  async *streamResponse(
    messages: BaseMessage[],
    signal: AbortSignal,
  ): AsyncIterable<string> {
    const stream = await this.llm.stream(messages, { signal });
    for await (const chunk of stream) {
      const text =
        typeof chunk.content === 'string'
          ? chunk.content
          : chunk.content
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map((c) => c.text)
              .join('');
      if (text) yield text;
    }
  }
}
```

### RetrievalService: MemoryContext type and retrieve()

```typescript
// src/retrieval/retrieval.types.ts
import type { MemorySearchResult, PersonRow } from '../memory/memory.types.js';

export interface MemoryContext {
  memories: MemorySearchResult[];
  people: PersonRow[];
}

// src/retrieval/retrieval.service.ts
import { Injectable } from '@nestjs/common';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { MemoryService } from '../memory/memory.service.js';
import { PeopleService } from '../memory/people.service.js';
import type { MemoryContext } from './retrieval.types.js';

@Injectable()
export class RetrievalService {
  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly memoryService: MemoryService,
    private readonly peopleService: PeopleService,
  ) {}

  async retrieve(text: string, userId: string): Promise<MemoryContext> {
    const [memories, people] = await Promise.all([
      this.embeddingService.embed(text)
        .then((vec) => this.memoryService.searchSimilar(userId, vec, 5)),
      this.peopleService.lookupByNames(
        this.peopleService.detectNames(text),
        userId,
      ),
    ]);
    return { memories, people };
  }
}
```

### System prompt memory block builder

```typescript
// Source: [CITED: REQUIREMENTS.md CHAT-07, CONTEXT.md D-03/D-04]
import type { MemoryContext } from '../retrieval/retrieval.types.js';
import type { ConversationMessageRow } from '../memory/memory.types.js';
import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages';

const MEMORY_THRESHOLD = 0.7; // D-03: hard-coded constant

function buildSystemPrompt(ctx: MemoryContext): string {
  const relevantMemories = ctx.memories.filter(
    (m) => m.similarity >= MEMORY_THRESHOLD,
  );

  const memoryBlock = relevantMemories.length > 0
    ? relevantMemories
        .map(
          (m) =>
            `[Memory: ${m.content} | confidence: ${m.confidence.toFixed(2)} | last confirmed: ${m.last_reinforced_at.toISOString().split('T')[0]}]`,
        )
        .join('\n')
    : '';

  const peopleBlock = ctx.people.length > 0
    ? ctx.people
        .map((p) => `[Person: ${p.name} | facts: ${JSON.stringify(p.facts)}]`)
        .join('\n')
    : '';

  const contextSection = [memoryBlock, peopleBlock].filter(Boolean).join('\n');

  return contextSection
    ? `You are a helpful assistant with memory of this user.\n\n${contextSection}`
    : 'You are a helpful assistant.';
}

function buildMessages(
  ctx: MemoryContext,
  history: ConversationMessageRow[],
  currentMessage: string,
): BaseMessage[] {
  const system = new SystemMessage(buildSystemPrompt(ctx));
  const historyMessages: BaseMessage[] = history.map((row) =>
    row.role === 'user'
      ? new HumanMessage(row.content)
      : new AIMessage(row.content),
  );
  return [system, ...historyMessages, new HumanMessage(currentMessage)];
}
```

### ExtractionService stub

```typescript
// src/extraction/extraction.service.ts
// Stub: Phase 4 replaces with real BullMQ queue implementation
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async enqueue(
    text: string,
    userId: string,
    sourceType: 'conversation' | 'document',
  ): Promise<void> {
    // Stub: log for now; Phase 4 wires real queue
    this.logger.debug(
      `[ExtractionService stub] enqueue userId=${userId} sourceType=${sourceType} textLen=${text.length}`,
    );
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| NestJS 10 | NestJS 11 | 2024 | Minor — decorators, DI syntax unchanged; `@nestjs/websockets@11` already installed |
| LangChain 0.x | LangChain 1.x (`@langchain/core@1.1`) | 2024 | Major API: `stream()` returns `IterableReadableStream`; `RunnableConfig` carries `signal` |
| Returning `WsResponse` with `Observable` for streaming | Direct `client.emit()` loop | Ongoing | `WsResponse` is for single-response handlers; streaming requires manual emit |

**Deprecated/outdated:**
- `socket.handshake.query.userId`: Query param approach (GET request) — use `handshake.auth.userId` instead (passed in Socket.io client constructor options, not URL params)
- `Observable`-based streaming handlers: Still supported in NestJS but discouraged for streaming — `async`/`await` with `for await...of` is cleaner and TypeScript-idiomatic

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `AIMessageChunk.content` from Claude text responses is `string` at runtime (not `MessageContentComplex[]`) for standard non-tool calls | Code Examples / Pattern 2 | Low — fallback branch in the filter handles complex content; no breakage |
| A2 | Socket.io `server.use()` middleware (registered in `afterInit`) runs before `handleConnection` for all clients | Pattern 1 | Medium — if order differs, UUID validation happens after connection is established; test in Wave 0 |

---

## Open Questions

1. **ExtractionService stub location**
   - What we know: CONTEXT.md says "Phase 3 should define the interface/stub and Phase 4 implements it; alternatively, the gateway can skip the stub entirely and Phase 4 wires it in"
   - What's unclear: Whether the stub should live in `src/extraction/` (and be replaced in Phase 4) or be injected as a no-op in `ChatModule` providers for now
   - Recommendation: Define the stub as a real class in `src/extraction/extraction.module.ts`. Phase 4 replaces only the implementation. This avoids rewiring the gateway in Phase 4.

2. **Conversation creation timing**
   - What we know: CONTEXT.md marks this as Claude's discretion — per-connection or lazy on first send
   - What's unclear: Per-connection creation wastes a DB round-trip for clients that connect but never send; lazy creation requires tracking whether a conversation exists per client
   - Recommendation: Create lazily on first `chat:send`. Track `conversationId` in a `Map<string, string>` keyed on `socket.id`. Clean up in `handleDisconnect`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@nestjs/websockets` | ChatGateway | Yes | 11.1.19 | — |
| `@nestjs/platform-socket.io` | IoAdapter | Yes | 11.1.19 | — |
| `socket.io` (transitive) | Type imports | Yes (transitive) | 4.x | — |
| `@langchain/anthropic` | LlmService | **No** | — | Must install: `pnpm add @langchain/anthropic` |
| `@langchain/core` | BaseMessage, RunnableConfig | Yes | 1.1.40 | — |
| PostgreSQL (via pg pool) | MemoryService, getRecentMessages | Yes (DatabaseModule global) | — | — |

**Missing dependencies with no fallback:**
- `@langchain/anthropic` — required by `LlmService`. First task of Wave 1 must be `pnpm add @langchain/anthropic`.

**Missing dependencies with fallback:**
- None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.1.9 |
| Config file | `vitest.config.ts` (exists at project root) |
| Quick run command | `pnpm test -- --run src/retrieval/retrieval.service.spec.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-01 | `retrieve()` returns `MemoryContext` with both arms' results | unit | `pnpm test -- --run src/retrieval/retrieval.service.spec.ts` | No — Wave 0 |
| RETR-02 | Arm 1: embed → searchSimilar called with correct args | unit | (same file) | No — Wave 0 |
| RETR-03 | Arm 2: detectNames → lookupByNames called with correct args | unit | (same file) | No — Wave 0 |
| RETR-04 | `Promise.all` concurrency: both arms start before either resolves | unit | (same file) | No — Wave 0 |
| CHAT-02 | Middleware rejects non-UUID userId | unit | `pnpm test -- --run src/chat/chat.gateway.spec.ts` | No — Wave 0 |
| CHAT-03 | Disconnect calls `ctrl.abort()` | unit | (same file) | No — Wave 0 |
| CHAT-04 | Gateway emits `chat:chunk` per token, `chat:complete` after stream | unit | (same file) | No — Wave 0 |
| CHAT-06 | Fire-and-forget: gateway does NOT await extraction | unit | (same file) | No — Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm test -- --run src/retrieval/retrieval.service.spec.ts src/chat/chat.gateway.spec.ts`
- **Per wave merge:** `pnpm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/retrieval/retrieval.service.spec.ts` — covers RETR-01 through RETR-04
- [ ] `src/chat/chat.gateway.spec.ts` — covers CHAT-02, CHAT-03, CHAT-04, CHAT-06
- [ ] `src/llm/llm.service.spec.ts` — covers CHAT-04, CHAT-05 (streaming iteration, abort propagation)

*(All other test infrastructure — vitest.config.ts, SWC plugin, globals — already exists from Phase 1/2)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | UUID validation in Socket.io middleware (`server.use()`); no JWT in v1 by design |
| V3 Session Management | Yes | `AbortController` per-socket; `Map` cleanup on disconnect prevents stale session state |
| V4 Access Control | Yes | All DB queries filtered by `userId` (enforced in `MemoryService`, `PeopleService`); `userId` extracted from validated handshake only |
| V5 Input Validation | Yes | `payload.message` should be validated as non-empty string before processing |
| V6 Cryptography | No | No crypto in this phase |

### Known Threat Patterns for WebSocket + LLM stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized socket connection | Spoofing | UUID middleware validation before connection accepted |
| Cross-user memory leak | Information Disclosure | All DB queries use `userId` from validated handshake — never from message payload |
| LLM prompt injection via message | Tampering | System prompt structure separates memory block from user input; `HumanMessage` wraps user content |
| Orphaned async extraction after disconnect | Denial of Service | `void enqueue(...).catch(logger.error)` — fails silently; BullMQ queue in Phase 4 handles retry |
| `userId` from `MessageBody` instead of handshake | Spoofing | NEVER accept `userId` from `chat:send` payload — ALWAYS from `socket.handshake.auth` |

---

## Sources

### Primary (HIGH confidence)

- `node_modules/@langchain/core/dist/runnables/types.d.ts` — confirmed `signal?: AbortSignal` on `RunnableConfig`
- `node_modules/@langchain/core/dist/runnables/base.d.ts` — confirmed `stream(input, options?: Partial<CallOptions>)` signature
- `/nestjs/docs.nestjs.com` (Context7) — WebSocket gateway lifecycle hooks, `@SubscribeMessage`, `@ConnectedSocket`, `@WebSocketServer`, `afterInit` pattern
- `src/memory/memory.service.ts`, `src/memory/people.service.ts`, `src/embedding/embedding.service.ts` — verified existing method signatures
- `src/main.ts` — confirmed `IoAdapter` already wired
- `npm view @langchain/anthropic version` — confirmed 1.3.26 is latest, NOT yet in package.json

### Secondary (MEDIUM confidence)

- [preetmishra.com — WebSocket auth in NestJS](https://preetmishra.com/blog/the-best-way-to-authenticate-websockets-in-nestjs) — `server.use()` middleware pattern confirmed; adapted for UUID (not JWT)
- [LangChain JS cancellation docs](https://js.langchain.com/docs/how_to/cancel_execution/) — AbortController pattern referenced; redirects to new docs

### Tertiary (LOW confidence)

- None — all critical claims were verified at source level.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in node_modules or npm registry
- Architecture: HIGH — patterns verified against installed LangChain types and NestJS docs
- Pitfalls: HIGH — derived from codebase analysis + TypeScript type inspection

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable stack)
