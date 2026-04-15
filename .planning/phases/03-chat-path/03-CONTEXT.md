# Phase 3: Chat Path - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the latency-critical chat path: a Socket.io WebSocket gateway that validates userId, streams Claude tokens as `chat:chunk` events, injects hybrid-retrieved memories into the system prompt, includes recent conversation history in context, and stubs the extraction pipeline as fire-and-forget. This phase makes the product fully demo-able.

Out of scope: the LangGraph extraction implementation (Phase 4), document upload (Phase 5), full test suite (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Message History in Context
- **D-01:** Load the last 10 messages from `conversation_messages` for the current conversation and pass them as chat history on every `chat:send` turn. The LLM receives both the memory block (system prompt) and prior conversation turns.
- **D-02:** 10 messages is a hard-coded constant for v1 (not an env var). Fetched via a DB read per turn before the LLM call starts.

### Memory Relevance Threshold
- **D-03:** Only inject memories with similarity score >= 0.7 into the system prompt. Memories returned by `search_user_memories` (top-5 by cosine) are filtered by this threshold before building the `[Memory: ...]` block. If no memories meet the threshold, the block is omitted from the system prompt entirely.
- **D-04:** The 0.7 threshold applies to the `similarity` field on `MemorySearchResult` (already defined in `memory.types.ts` as the `1 - cosine_distance` value from `search_user_memories`).

### Claude's Discretion
- Conversation creation strategy — whether a conversation is created per-connection (`handleConnection`) or lazily on first `chat:send`; how conversationId is tracked within the gateway
- Exact system prompt copy/structure around the `[Memory: X | confidence: Y | last confirmed: Z]` block
- Assistant message persistence timing — whether the full assembled response is saved to `conversation_messages` after stream completes, or per-chunk; either is acceptable as long as persistence completes before extraction is enqueued
- Error event format for stream failures (shape of `chat:error` payload)
- UUID validation error handling — whether gateway disconnects the socket silently or emits an error event before closing

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` §Chat Path (CHAT-01 through CHAT-07) — WebSocket gateway spec, `chat:send`/`chat:chunk`/`chat:complete` event contract, userId handshake validation, AbortController on disconnect, LlmService streaming interface, fire-and-forget extraction, memory injection format
- `.planning/REQUIREMENTS.md` §Hybrid Retrieval (RETR-01 through RETR-04) — RetrievalService interface, two parallel arms (semantic + people), `Promise.all` concurrency requirement, `MemoryContext` result type

### Roadmap
- `.planning/ROADMAP.md` Phase 3 — Goal, Success Criteria (5 criteria), plan count (4 plans)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/memory/memory.service.ts` — `createConversation(userId, title?)`, `addMessage(conversationId, userId, role, content)`, `searchSimilar(userId, vector, topK)` — all ready to consume in ChatGateway and RetrievalService
- `src/memory/people.service.ts` — `detectNames(text)`, `lookupByNames(names, userId)` — RetrievalService consumes both for the people retrieval arm
- `src/embedding/embedding.service.ts` — `embed(text): Promise<number[]>` — RetrievalService uses this for the semantic retrieval arm
- `src/memory/memory.types.ts` — `MemorySearchResult` (has `similarity` field — the 0.7 threshold applies here), `ConversationRow`, `ConversationMessageRow` — reuse directly; define `MemoryContext` type here or in a new `chat/chat.types.ts`

### Established Patterns
- All services use `@Inject(PG_POOL)` for database access via the global `DatabaseModule`
- NestJS Logger (`private readonly logger = new Logger(ClassName.name)`) — only logging mechanism; no `console.log`
- `ConfigService.getOrThrow<string>('ENV_VAR')` for all config access — never `process.env` directly
- TypeScript strict: no `any` types; `unknown` with narrowing where needed
- All module exports: every module that provides something exports it (EmbeddingModule, MemoryModule) — new ChatModule and RetrievalModule should follow the same pattern

### Integration Points
- `src/app.module.ts` — ChatModule and RetrievalModule need to be imported here; EmbeddingModule and MemoryModule are already imported globally
- `src/main.ts` — `IoAdapter` already wired; `validateEnv()` guard runs at startup; `ANTHROPIC_MODEL` already in the required env vars list
- Extraction stub: `ChatGateway` will call `void extractionService.enqueue(text, userId, 'conversation').catch(...)` — `ExtractionService` doesn't exist yet; Phase 3 should define the interface/stub and Phase 4 implements it; alternatively, the gateway can skip the stub entirely and Phase 4 wires it in

</code_context>

<specifics>
## Specific Ideas

No specific references or "I want it like X" moments from discussion — open to standard NestJS/Socket.io patterns within the constraints above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 03-chat-path*
*Context gathered: 2026-04-16*
